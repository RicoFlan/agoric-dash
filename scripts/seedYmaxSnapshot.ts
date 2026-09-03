/**
 * Seed the YMax tables from the CURRENT vstorage state (REST), not from block history.
 *
 * Positions carry cumulative totals (totalIn / totalOut / netTransfers), so the latest published
 * record per (portfolio, key) is the truth — a snapshot is sufficient and much cheaper than a replay.
 * Portfolio status records are seeded the same way; their `flowsRunning` seeds any in-progress flows.
 * Historical (finished) flows are NOT recoverable from a snapshot; they come from the EndBlock
 * replay (scripts/backfillEndBlock.ts) or accrue forward from the indexer.
 *
 * Additive and idempotent: upserts with latest-wins by the cell's blockHeight; never deletes.
 *
 * Env: DATABASE_URL (required), API_URL (default https://main-a.api.agoric.net), YMAX_CONTRACTS
 *      (default "ymax0,ymax1"), SEED_CONCURRENCY (default 8)
 * Run: npm run seed:ymax
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../src/db/schema";
import { ensureYmaxTables } from "../src/db/ensureAdditiveTables";
import { parseCapData } from "../src/lib/walletOfferMarshal";
import { YmaxAccumulator, persistYmax } from "../src/lib/ymaxRollup";
import { classifyYmaxPath } from "../src/lib/ymaxVstorage";

const TAG = "[seedYmaxSnapshot]";
const DATABASE_URL = process.env.DATABASE_URL;
const API_URL = (process.env.API_URL ?? "https://main-a.api.agoric.net").replace(/\/$/, "");
const CONTRACTS = (process.env.YMAX_CONTRACTS ?? "ymax0,ymax1").split(",").map((s) => s.trim()).filter(Boolean);
const CONCURRENCY = Math.max(1, Math.min(32, Number(process.env.SEED_CONCURRENCY ?? "8")));

if (!DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema });

async function getJson<T>(url: string): Promise<T | null> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      if (attempt === 4) throw e;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  return null;
}

async function children(path: string): Promise<string[]> {
  const j = await getJson<{ children?: string[] }>(`${API_URL}/agoric/vstorage/children/${path}`);
  return j?.children ?? [];
}

/** Latest CapData string + the cell's block height for a vstorage data node, or null when empty. */
async function latestCell(path: string): Promise<{ capData: string; height: bigint } | null> {
  const j = await getJson<{ value?: string }>(`${API_URL}/agoric/vstorage/data/${path}`);
  if (!j?.value) return null;
  let cell: { blockHeight?: string; values?: unknown };
  try {
    cell = JSON.parse(j.value) as { blockHeight?: string; values?: unknown };
  } catch {
    return null;
  }
  const values = Array.isArray(cell.values) ? cell.values.filter((v): v is string => typeof v === "string") : [];
  if (values.length === 0) return null;
  const h = cell.blockHeight && /^\d+$/.test(cell.blockHeight) ? BigInt(cell.blockHeight) : BigInt(0);
  return { capData: values[values.length - 1]!, height: h };
}

async function mapPool<T>(items: T[], fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      for (;;) {
        const idx = i++;
        if (idx >= items.length) return;
        await fn(items[idx]!);
      }
    })
  );
}

async function main() {
  await ensureYmaxTables(db);
  const acc = new YmaxAccumulator();
  const seededAtDay = new Date().toISOString().slice(0, 10);
  let portfolios = 0;
  let positions = 0;

  for (const contract of CONTRACTS) {
    const ps = await children(`published.${contract}.portfolios`);
    console.error(`${TAG} ${contract}: ${ps.length} portfolios`);
    await mapPool(ps, async (p) => {
      const base = `published.${contract}.portfolios.${p}`;
      const status = await latestCell(base);
      if (status) {
        const path = classifyYmaxPath(["published", contract, "portfolios", p]);
        if (path) {
          try {
            acc.applyDecoded(path, parseCapData(status.capData), status.height, seededAtDay);
            portfolios += 1;
          } catch (e) {
            console.warn(`${TAG} decode failed ${base}:`, e instanceof Error ? e.message : e);
          }
        }
      }
      for (const key of await children(`${base}.positions`)) {
        const cell = await latestCell(`${base}.positions.${key}`);
        if (!cell) continue;
        const path = classifyYmaxPath(["published", contract, "portfolios", p, "positions", key]);
        if (!path) continue;
        try {
          acc.applyDecoded(path, parseCapData(cell.capData), cell.height, seededAtDay);
          positions += 1;
        } catch (e) {
          console.warn(`${TAG} decode failed ${base}.positions.${key}:`, e instanceof Error ? e.message : e);
        }
      }
    });
  }

  await persistYmax(db, acc);
  console.error(`${TAG} done: ${portfolios} portfolios, ${positions} positions, ${acc.flows.size} in-progress flows upserted`);
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
