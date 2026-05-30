/**
 * VALIDATION SPIKE (read-only, Phase 0b for SwingSet/Zoe offer surfacing).
 *
 * Scans recent agoric-3 blocks for smart-wallet actions
 * (`/agoric.swingset.MsgWalletSpendAction`, `/agoric.swingset.MsgWalletAction`), decodes the
 * marshalled CapData offer body, and reports the real shapes + an oracle-vs-user mix estimate.
 *
 * Purpose: ground the classification logic before touching the indexer. Prints nothing that is
 * persisted; safe to run anytime. NOT part of the production indexer.
 *
 * IMPORTANT: the @endo shims below MUST be imported before @endo/marshal. They install the
 * eventual-send + assert shims WITHOUT calling SES lockdown (Object.prototype stays unfrozen, so
 * pg/cosmjs are unaffected). Confirmed in Phase 0b.
 *
 * Run: RPC_URL=... SPIKE_BLOCKS=1500 npx tsx scripts/spikeWalletOffers.ts
 */
import "@endo/init/pre.js";
import "@endo/eventual-send/shim.js";
import "dotenv/config";
import { Far, makeMarshal } from "@endo/marshal";
import { toBech32 } from "@cosmjs/encoding";
import { fromBase64 } from "@cosmjs/encoding";
import type { EncodeObject } from "@cosmjs/proto-signing";
import { decodeMsg, decodeTxRawTx } from "../src/lib/cosmos";
import { rpcCallWithFallback, type RpcBlockResponse, type RpcBlockResultsResponse } from "../src/lib/rpc";

const RPC_URL_PRIMARY = process.env.RPC_URL ?? "https://main-a.rpc.agoric.net";
const RPC_URL_FALLBACK = process.env.RPC_URL_FALLBACK ?? "";
const RPC_URLS: readonly string[] = [RPC_URL_PRIMARY, RPC_URL_FALLBACK];
const SPIKE_BLOCKS = Number(process.env.SPIKE_BLOCKS ?? "1500");
const CONCURRENCY = Math.max(1, Math.min(48, Number(process.env.SPIKE_CONCURRENCY ?? "20")));
const MAX_SAMPLES = Number(process.env.SPIKE_MAX_SAMPLES ?? "240");
const LAG = 3;

const WALLET_SPEND = "/agoric.swingset.MsgWalletSpendAction";
const WALLET_ACTION = "/agoric.swingset.MsgWalletAction";

/**
 * Decode marshaller. A slot reference (`$N` in smallcaps) must resolve to a *remotable*, not a plain
 * record — passStyleOf rejects anything else. We return a `Far` remotable (works without SES
 * lockdown, confirmed Phase 0b) and remember its board id in a WeakMap so we can recover it after
 * decode. board ids are the on-chain identifiers for Instances/Brands.
 */
const slotById = new WeakMap<object, string>();
const marshaller = makeMarshal(
  undefined,
  (slot: string, iface?: string): object => {
    const r = Far(`BoardRemote${iface ? ` ${iface}` : ""}`, {});
    slotById.set(r as object, slot);
    return r as object;
  },
  { serializeBodyFormat: "smallcaps" }
);

function slotOf(v: unknown): string | null {
  return typeof v === "object" && v !== null && slotById.has(v) ? slotById.get(v)! : null;
}

async function latestHeight(): Promise<bigint> {
  const st = await rpcCallWithFallback<{ sync_info: { latest_block_height: string } }>(RPC_URLS, "status", {});
  return BigInt(st.sync_info.latest_block_height);
}

async function fetchPair(h: bigint): Promise<{ block: RpcBlockResponse; results: RpcBlockResultsResponse }> {
  const hStr = h.toString();
  const [block, results] = await Promise.all([
    rpcCallWithFallback<RpcBlockResponse>(RPC_URLS, "block", { height: hStr }),
    rpcCallWithFallback<RpcBlockResultsResponse>(RPC_URLS, "block_results", { height: hStr }),
  ]);
  return { block, results };
}

type ProposalLeg = { keyword: string; brandSlot: string | null; value: string | null };

interface OfferRecord {
  height: string;
  owner: string;
  msgType: string;
  code: number;
  method: string | null;
  source: string | null;
  instanceSlot: string | null;
  instancePath: string | null;
  invitationMaker: string | null;
  description: string | null;
  give: ProposalLeg[];
  want: ProposalLeg[];
}

function legsFrom(proposalPart: unknown): ProposalLeg[] {
  if (typeof proposalPart !== "object" || proposalPart === null) return [];
  const out: ProposalLeg[] = [];
  for (const [keyword, amt] of Object.entries(proposalPart as Record<string, unknown>)) {
    const a = amt as { brand?: unknown; value?: unknown };
    out.push({
      keyword,
      brandSlot: slotOf(a?.brand),
      value: a && a.value !== undefined ? String(a.value as unknown) : null,
    });
  }
  return out;
}

/** Heuristic actor tag from offer shape — to be validated/refined in Phase 1a. */
function classify(rec: OfferRecord): "oracle" | "user" | "automated_other" {
  const maker = (rec.invitationMaker ?? "").toLowerCase();
  const desc = (rec.description ?? "").toLowerCase();
  if (maker.includes("pushprice") || desc.includes("oracle") || maker.includes("pricefeed")) return "oracle";
  // continuing offers w/ no give/want are often automated bookkeeping (e.g. operator invitations)
  if (rec.source === "continuing" && rec.give.length === 0 && rec.want.length === 0) return "automated_other";
  return "user";
}

const rawFailures: string[] = [];
const rawByMethod = new Map<string, string>();

function extractOffer(height: string, owner: string, msgType: string, code: number, actionStr: string): OfferRecord | null {
  let action: Record<string, unknown>;
  try {
    action = marshaller.fromCapData(JSON.parse(actionStr)) as Record<string, unknown>;
  } catch (e) {
    if (rawFailures.length < 12) {
      rawFailures.push(`[${height}] ${(e as Error).message?.slice(0, 80)} :: ${actionStr.slice(0, 360)}`);
    }
    return null;
  }
  const methodKey = typeof action.method === "string" ? action.method : "(none)";
  if (!rawByMethod.has(methodKey)) {
    rawByMethod.set(methodKey, `[${height}] ${JSON.stringify(action, jsonSafe).slice(0, 700)}`);
  }
  const method = typeof action.method === "string" ? action.method : null;
  const offer = (action.offer ?? {}) as Record<string, unknown>;
  const spec = (offer.invitationSpec ?? {}) as Record<string, unknown>;
  const proposal = (offer.proposal ?? {}) as Record<string, unknown>;
  const callPipe = spec.callPipe as Array<[string, ...unknown[]]> | undefined;
  const invitationMaker =
    (typeof spec.publicInvitationMaker === "string" && spec.publicInvitationMaker) ||
    (typeof spec.invitationMakerName === "string" && spec.invitationMakerName) ||
    (Array.isArray(callPipe) && callPipe[0]?.[0]) ||
    null;
  return {
    height,
    owner,
    msgType,
    code,
    method,
    source: typeof spec.source === "string" ? spec.source : null,
    instanceSlot: slotOf(spec.instance),
    instancePath: Array.isArray(spec.instancePath) ? (spec.instancePath as unknown[]).join("/") : null,
    invitationMaker: invitationMaker || null,
    description: typeof spec.description === "string" ? spec.description : null,
    give: legsFrom(proposal.give),
    want: legsFrom(proposal.want),
  };
}

function jsonSafe(_k: string, v: unknown): unknown {
  return typeof v === "bigint" ? `${v.toString()}n` : v;
}

function bump(m: Map<string, number>, k: string) {
  m.set(k, (m.get(k) ?? 0) + 1);
}

function topN(m: Map<string, number>, n: number): string {
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `    ${v.toString().padStart(5)}  ${k}`)
    .join("\n");
}

async function main() {
  const tip = await latestHeight();
  const target = tip - BigInt(LAG);
  const from = target - BigInt(SPIKE_BLOCKS) + BigInt(1);
  console.log(
    `Spike RPC=${RPC_URL_PRIMARY} scanning heights ${from}..${target} (${SPIKE_BLOCKS} blocks, conc=${CONCURRENCY})`
  );

  const records: OfferRecord[] = [];
  let blocksWithWallet = 0;
  let walletMsgs = 0;
  let decodeFailures = 0;
  const byMethod = new Map<string, number>();
  const bySource = new Map<string, number>();
  const byMaker = new Map<string, number>();
  const byInstanceSlot = new Map<string, number>();
  const byClass = new Map<string, number>();
  const distinctOwners = new Set<string>();
  let scanned = 0;

  for (let h = from; h <= target; h += BigInt(CONCURRENCY)) {
    if (records.length >= MAX_SAMPLES) break;
    const heights: bigint[] = [];
    for (let i = 0; i < CONCURRENCY && h + BigInt(i) <= target; i++) heights.push(h + BigInt(i));
    const pairs = await Promise.all(
      heights.map((hh) => fetchPair(hh).catch((e) => ({ err: e, hh })))
    );
    for (const p of pairs) {
      scanned++;
      if ("err" in p) continue;
      const { block, results } = p;
      const hStr = block.block.header.height;
      const txs = block.block.data?.txs ?? [];
      const txResults = results.txs_results ?? [];
      let blockHadWallet = false;
      for (let i = 0; i < txs.length; i++) {
        let decoded;
        try {
          decoded = decodeTxRawTx(fromBase64(txs[i]!));
        } catch {
          continue;
        }
        const code = txResults[i]?.code ?? -1;
        for (const msg of decoded.body.messages) {
          const enc = msg as EncodeObject;
          if (enc.typeUrl !== WALLET_SPEND && enc.typeUrl !== WALLET_ACTION) continue;
          walletMsgs++;
          blockHadWallet = true;
          let body: { owner?: Uint8Array; spendAction?: string; action?: string };
          try {
            body = decodeMsg(enc) as typeof body;
          } catch {
            decodeFailures++;
            continue;
          }
          const owner = body.owner && body.owner.length > 0 ? toBech32("agoric", body.owner) : "(unknown)";
          distinctOwners.add(owner);
          const actionStr = body.spendAction ?? body.action ?? "";
          const rec = extractOffer(hStr, owner, enc.typeUrl, code, actionStr);
          if (!rec) {
            decodeFailures++;
            continue;
          }
          bump(byMethod, rec.method ?? "(none)");
          bump(bySource, rec.source ?? "(none)");
          bump(byMaker, rec.invitationMaker ?? "(none)");
          if (rec.instanceSlot) bump(byInstanceSlot, rec.instanceSlot);
          bump(byClass, classify(rec));
          if (records.length < MAX_SAMPLES) records.push(rec);
        }
      }
      if (blockHadWallet) blocksWithWallet++;
    }
  }

  console.log(`\n===== SPIKE SUMMARY =====`);
  console.log(`blocks scanned: ${scanned} | blocks with wallet msgs: ${blocksWithWallet}`);
  console.log(`wallet msgs found: ${walletMsgs} | decode failures: ${decodeFailures} | distinct owners: ${distinctOwners.size}`);
  console.log(`\n-- by method --\n${topN(byMethod, 10)}`);
  console.log(`\n-- by invitationSpec.source --\n${topN(bySource, 10)}`);
  console.log(`\n-- by invitation maker / callPipe[0] --\n${topN(byMaker, 15)}`);
  console.log(`\n-- by instance board slot (top 15) --\n${topN(byInstanceSlot, 15)}`);
  console.log(`\n-- heuristic actor class --\n${topN(byClass, 10)}`);

  console.log(`\n===== RAW DECODE FAILURES (up to 12) =====`);
  for (const f of rawFailures) console.log(f);

  console.log(`\n===== ONE RAW DECODED ACTION PER METHOD =====`);
  for (const [k, v] of rawByMethod) console.log(`${k}: ${v}`);

  console.log(`\n===== SAMPLE OFFERS (first ${Math.min(12, records.length)}) =====`);
  for (const r of records.slice(0, 12)) {
    console.log(JSON.stringify(r));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
