/**
 * Standalone indexer: polls RPC for block + block_results, updates daily_metrics
 * and hourly_metrics (same dimensions; hour bucket from block time UTC).
 * Run: DATABASE_URL=... RPC_URL=... tsx scripts/indexer.ts
 */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { EncodeObject } from "@cosmjs/proto-signing";
import { fromBase64 } from "@cosmjs/encoding";
import pg from "pg";
import * as schema from "../src/db/schema";
import {
  decodeMsg,
  decodeTxRawTx,
  extractPaidFeesFromEvents,
  parseCoinsAmounts,
} from "../src/lib/cosmos";
import { rpcCall, type RpcBlockResponse, type RpcBlockResultsResponse } from "../src/lib/rpc";
import {
  MESSAGE_ATTRIBUTION,
  MSG_IBC_TRANSFER,
  MSG_RECV_PACKET,
  SERIES,
  TRANSFER_MSG_TYPES,
  TX_SUCCESS_CODE,
} from "../src/lib/semantics";

const DATABASE_URL = process.env.DATABASE_URL;
const RPC_URL = process.env.RPC_URL ?? "https://main.rpc.agoric.net";
const POLL_MS = Number(process.env.INDEXER_POLL_MS ?? "20000");
const BATCH = Number(process.env.INDEXER_BATCH ?? "25");
const LAG = Number(process.env.INDEXER_LAG ?? "3");
const INITIAL_WINDOW = BigInt(process.env.INDEXER_INITIAL_WINDOW ?? "500");

if (!DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema });

const { dailyMetrics, hourlyMetrics } = schema;

function dayUtc(isoTime: string): string {
  const d = new Date(isoTime);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Truncate block time to the UTC hour for hourly_metrics */
function hourStartUtcFromIso(isoTime: string): Date {
  const d = new Date(isoTime);
  d.setUTCMilliseconds(0);
  d.setUTCSeconds(0);
  d.setUTCMinutes(0);
  return d;
}

async function upsertDelta(
  day: string,
  hour: Date,
  series: string,
  dimension: string,
  delta: bigint
) {
  if (delta === BigInt(0)) return;
  const dStr = delta.toString();
  await db
    .insert(dailyMetrics)
    .values({
      day,
      series,
      dimension,
      value: dStr,
    })
    .onConflictDoUpdate({
      target: [dailyMetrics.day, dailyMetrics.series, dailyMetrics.dimension],
      set: {
        value: sql`${dailyMetrics.value} + ${sql.raw("excluded.value")}`,
      },
    });
  await db
    .insert(hourlyMetrics)
    .values({
      hour,
      series,
      dimension,
      value: dStr,
    })
    .onConflictDoUpdate({
      target: [hourlyMetrics.hour, hourlyMetrics.series, hourlyMetrics.dimension],
      set: {
        value: sql`${hourlyMetrics.value} + ${sql.raw("excluded.value")}`,
      },
    });
}

async function getCursor(): Promise<bigint> {
  const rows = await db
    .select()
    .from(schema.indexerState)
    .where(eq(schema.indexerState.id, "singleton"))
    .limit(1);
  return rows[0]?.lastIndexedHeight ?? BigInt(0);
}

async function setCursor(h: bigint) {
  await db
    .insert(schema.indexerState)
    .values({ id: "singleton", lastIndexedHeight: h, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.indexerState.id,
      set: { lastIndexedHeight: h, updatedAt: new Date() },
    });
}

function asEventKV(
  txs: RpcBlockResultsResponse["txs_results"]
): Array<Array<{ type: string; attributes: { key: string; value: string }[] }>> {
  if (!txs) return [];
  return txs.map((tx) =>
    (tx.events ?? []).map((e) => ({
      type: e.type,
      attributes: (e.attributes ?? []).map((a) => ({
        key: a.key,
        value: a.value,
      })),
    }))
  );
}

async function indexBlock(height: bigint): Promise<void> {
  const hStr = height.toString();
  const block = await rpcCall<RpcBlockResponse>(RPC_URL, "block", { height: hStr });
  const results = await rpcCall<RpcBlockResultsResponse>(RPC_URL, "block_results", {
    height: hStr,
  });

  const iso = block.block.header.time;
  const day = dayUtc(iso);
  const hour = hourStartUtcFromIso(iso);
  const txsB64 = block.block.data?.txs ?? [];
  const txResults = results.txs_results ?? [];
  const eventsPerTx = asEventKV(txResults);

  if (txsB64.length !== txResults.length) {
    console.warn(`height ${hStr}: txs len ${txsB64.length} != results ${txResults.length}`);
  }

  const n = Math.min(txsB64.length, txResults.length);

  for (let i = 0; i < n; i++) {
    const raw = fromBase64(txsB64[i]);
    const tr = txResults[i];
    const ok = tr.code === TX_SUCCESS_CODE;

    await upsertDelta(day, hour, ok ? SERIES.TX_SUCCESS : SERIES.TX_FAILED, "", BigInt(1));

    const gas = BigInt(tr.gas_used ?? "0");
    await upsertDelta(day, hour, SERIES.GAS_USED, "", gas);

    if (!ok) continue;

    const fees = extractPaidFeesFromEvents(eventsPerTx[i] ?? []);
    for (const [denom, amt] of fees) {
      await upsertDelta(day, hour, SERIES.FEE_PAID, denom, amt);
    }

    let decoded;
    try {
      decoded = decodeTxRawTx(raw);
    } catch (e) {
      console.warn(`decode failed height ${hStr} idx ${i}:`, e);
      continue;
    }

    const msgs = decoded.body.messages;
    if (MESSAGE_ATTRIBUTION === "first_message" && msgs.length > 0) {
      const first = msgs[0]!;
      await upsertDelta(day, hour, SERIES.MSG_TYPE, first.typeUrl, BigInt(1));
    }

    for (const msg of msgs) {
      const enc = msg as EncodeObject;
      const typeUrl = enc.typeUrl;

      if (!TRANSFER_MSG_TYPES.has(typeUrl)) {
        if (typeUrl === MSG_RECV_PACKET) {
          await upsertDelta(day, hour, SERIES.IBC_TRANSFER_IN_COUNT, "", BigInt(1));
          for (const ev of eventsPerTx[i] ?? []) {
            if (ev.type !== "coin_received" && ev.type !== "transfer") continue;
            for (const a of ev.attributes) {
              if (a.key !== "amount") continue;
              for (const [denom, amt] of parseCoinsAmounts(a.value)) {
                await upsertDelta(day, hour, SERIES.IBC_TRANSFER_AMOUNT_IN, denom, amt);
              }
            }
          }
        }
        continue;
      }

      try {
        const decodedMsg = decodeMsg(enc) as {
          amount?: Array<{ denom: string; amount: string }>;
          outputs?: Array<{ coins: Array<{ denom: string; amount: string }> }>;
          token?: { denom: string; amount: string };
        };

        if (typeUrl.includes("MsgSend")) {
          for (const c of decodedMsg.amount ?? []) {
            await upsertDelta(day, hour, SERIES.TRANSFER_VOLUME, c.denom, BigInt(c.amount));
          }
        }
        if (typeUrl.includes("MsgMultiSend")) {
          for (const o of decodedMsg.outputs ?? []) {
            for (const c of o.coins ?? []) {
              await upsertDelta(day, hour, SERIES.TRANSFER_VOLUME, c.denom, BigInt(c.amount));
            }
          }
        }
        if (typeUrl === MSG_IBC_TRANSFER && decodedMsg.token) {
          await upsertDelta(
            day,
            hour,
            SERIES.TRANSFER_VOLUME,
            decodedMsg.token.denom,
            BigInt(decodedMsg.token.amount)
          );
          await upsertDelta(day, hour, SERIES.IBC_TRANSFER_OUT_COUNT, "", BigInt(1));
          await upsertDelta(
            day,
            hour,
            SERIES.IBC_TRANSFER_AMOUNT_OUT,
            decodedMsg.token.denom,
            BigInt(decodedMsg.token.amount)
          );
        }
      } catch {
        /* ignore malformed */
      }
    }
  }
}

async function latestHeight(): Promise<bigint> {
  const st = await rpcCall<{ sync_info: { latest_block_height: string } }>(RPC_URL, "status", {});
  return BigInt(st.sync_info.latest_block_height);
}

async function loop() {
  let cursor = await getCursor();
  const tip = await latestHeight();
  const target = tip - BigInt(LAG);

  let next: bigint;
  if (cursor === BigInt(0)) {
    next =
      target > INITIAL_WINDOW ? target - INITIAL_WINDOW + BigInt(1) : BigInt(1);
  } else {
    next = cursor + BigInt(1);
  }

  let processed = 0;
  while (next <= target && processed < BATCH) {
    await indexBlock(next);
    await setCursor(next);
    cursor = next;
    next += BigInt(1);
    processed += 1;
  }

  if (processed > 0) {
    console.log(`Indexer: processed ${processed} blocks, cursor=${cursor}, tip=${tip}`);
  }
}

async function main() {
  console.log(`Indexer RPC=${RPC_URL} poll=${POLL_MS}ms`);
  await loop();
  setInterval(() => {
    void loop().catch((e) => console.error(e));
  }, POLL_MS);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
