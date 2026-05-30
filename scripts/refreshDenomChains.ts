/**
 * Disambiguate denoms.json display labels by the IBC asset's ORIGIN chain (provenance).
 *
 * Many `ibc/…` denoms collapse to the same bare symbol (several "USDC", "USDT", "ATOM", "BLD", "IST"),
 * which is confusing in the Value-handled table and Value Flow Map. For each `ibc/…` denom this finds
 * the chain where the asset is native by WALKING the full IBC denom trace, then tags the label
 * `BASE (Origin)` — but only when BASE is shared by more than one ibc denom (singletons stay clean).
 *
 *   1. GET /ibc/apps/transfer/v1/denom_traces/{hash} → path (`transfer/channel-A/transfer/channel-B/…`)
 *      + base_denom.
 *   2. Walk the path hop-by-hop: from Agoric, resolve channel-A → next chain (client_state.chain_id);
 *      from that chain's registry REST resolve channel-B → next chain; … last chain = origin.
 *   3. base_denom overrides for bridged assets: `gravity0x…` → Gravity Bridge, `peggy0x…` → Injective,
 *      bare `0x…` hex → Wormhole.
 *   4. chain_id → friendly label (CHAIN_LABELS, else derived).
 *
 * Same-asset-same-origin denoms (different historical paths) intentionally share a label. The CoinGecko
 * resolver strips trailing ` (…)` groups, so USD pricing is unaffected. Native denoms are untouched.
 *
 * Dry-run by default (prints resolution + planned changes). WRITE=1 applies to src/config/denoms.json
 * and public/denom-translations.csv.
 *
 *   npx tsx scripts/refreshDenomChains.ts            # dry run
 *   WRITE=1 npx tsx scripts/refreshDenomChains.ts    # apply
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const AGORIC_LCD = [process.env.LCD_URL ?? "https://main.api.agoric.net", "https://agoric-api.polkachu.com"];
const WRITE = process.env.WRITE === "1";
const DENOMS_PATH = resolve(__dirname, "../src/config/denoms.json");
const CSV_PATH = resolve(__dirname, "../public/denom-translations.csv");

/** counterparty chain_id → friendly label. Unknowns fall back to a derived label. */
const CHAIN_LABELS: Record<string, string> = {
  "cosmoshub-4": "Cosmos Hub",
  "osmosis-1": "Osmosis",
  "axelar-dojo-1": "Axelar",
  "gravity-bridge-3": "Gravity Bridge",
  "noble-1": "Noble",
  "kaiyo-1": "Kujira",
  "stride-1": "Stride",
  "neutron-1": "Neutron",
  "injective-1": "Injective",
  celestia: "Celestia",
  "secret-4": "Secret",
  "juno-1": "Juno",
  "stargaze-1": "Stargaze",
  "evmos_9001-2": "Evmos",
  "dydx-mainnet-1": "dYdX",
  "core-1": "Persistence",
  "crescent-1": "Crescent",
  "phoenix-1": "Terra",
  "pacific-1": "Sei",
  "omniflixhub-1": "OmniFlix",
  "bitsong-2b": "BitSong",
  "carbon-1": "Carbon",
  "chihuahua-1": "Chihuahua",
  "comdex-1": "Comdex",
  "umee-1": "UX (Umee)",
  "quicksilver-2": "Quicksilver",
  "sentinelhub-2": "Sentinel",
  "pirin-1": "Nolus",
  "centauri-1": "Composable",
  "migaloo-1": "Migaloo",
  "archway-1": "Archway",
  "kava_2222-10": "Kava",
  "provenance-mainnet": "Provenance",
  "pio-mainnet-1": "Provenance",
  "agoric-3": "Agoric",
};

/**
 * Native minimal-denom → origin chain. Authoritative for cosmos-native assets (a token's base_denom
 * is stable, unlike walked channel numbers which drift for round-trip / legacy IBC paths).
 */
const BASE_ORIGIN: Record<string, string> = {
  uatom: "Cosmos Hub",
  uosmo: "Osmosis",
  uion: "Osmosis",
  ubld: "Agoric",
  uist: "Agoric",
  uscrt: "Secret",
  ukuji: "Kujira",
  ustrd: "Stride",
  untrn: "Neutron",
  uxprt: "Persistence",
  uflix: "OmniFlix",
  ucre: "Crescent",
  ucmst: "Comdex",
  uluna: "Terra",
  uusd: "Terra Classic",
  uqck: "Quicksilver",
  uumee: "UX (Umee)",
  inj: "Injective",
  ujuno: "Juno",
  ustars: "Stargaze",
  usei: "Sei",
  udvpn: "Sentinel",
  uhuahua: "Chihuahua",
  nhash: "Provenance",
  ppica: "Composable",
  aevmos: "Evmos",
  aarch: "Archway",
  ugraviton: "Gravity Bridge",
  unym: "Nym",
  nund: "Unification",
  stuatom: "Stride",
  stuosmo: "Stride",
  stuluna: "Stride",
  stutia: "Stride",
  stinj: "Stride",
};

/** bech32 prefix of a Token Factory denom → origin chain. */
const FACTORY_PREFIX_ORIGIN: Record<string, string> = {
  neutron: "Neutron",
  osmo: "Osmosis",
  kujira: "Kujira",
  inj: "Injective",
  stars: "Stargaze",
  juno: "Juno",
};

function deriveChainLabel(chainId: string): string {
  const stem = chainId.replace(/[-_][0-9a-z]*\d[0-9a-z]*$/i, "").replace(/[-_]+/g, " ").trim();
  if (!stem) return chainId;
  return stem
    .split(" ")
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");
}

interface Entry {
  match: string;
  displaySymbol: string;
  decimals: number;
}

async function lcdGet<T>(bases: string[], path: string): Promise<T | null> {
  for (const base of bases) {
    if (!base) continue;
    try {
      const r = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(12000) });
      if (r.ok) return (await r.json()) as T;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** channel on Agoric → counterparty chain_id (stable; Agoric's own channels), cached. */
const agoricHopCache = new Map<string, string | null>();

async function agoricFirstHopChain(path: string): Promise<string | null> {
  const channel = path.split("/").filter((s) => s.startsWith("channel-"))[0];
  if (!channel) return null;
  if (agoricHopCache.has(channel)) return agoricHopCache.get(channel)!;
  const res = await lcdGet<{ identified_client_state?: { client_state?: { chain_id?: string } } }>(
    AGORIC_LCD,
    `/ibc/core/channel/v1/channels/${channel}/ports/transfer/client_state`
  );
  const next = res?.identified_client_state?.client_state?.chain_id ?? null;
  agoricHopCache.set(channel, next);
  return next;
}

function baseSymbol(displaySymbol: string): string {
  return displaySymbol.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/** True for Axelar EVM-wrapped minimal denoms (dai-wei, weth-wei, wbtc-satoshi, uaxl, avalanche-*, …). */
function isAxelarBase(base: string): boolean {
  return (
    /-(wei|satoshi|planck)$/.test(base) ||
    base.startsWith("avalanche-") ||
    base.startsWith("polygon-") ||
    base.startsWith("frax") ||
    base === "uaxl"
  );
}

/**
 * Origin (provenance) label for an IBC asset, from its base_denom — the reliable signal — with a
 * stable Agoric first-hop query only to split Circle/Noble vs Axelar USDC/USDT.
 */
async function resolveOrigin(path: string, baseDenom: string): Promise<string | null> {
  // Bridge-wrapped EVM assets identify their bridge by base_denom shape.
  if (/^gravity0x[0-9a-fA-F]+$/.test(baseDenom)) return "Gravity Bridge";
  if (/^peggy0x[0-9a-fA-F]+$/.test(baseDenom)) return "Injective";
  if (/^0x[0-9a-fA-F]{40}$/.test(baseDenom)) return "Wormhole";
  if (isAxelarBase(baseDenom)) return "Axelar";

  // Circle USDC / Tether USDT carry a generic micro-denom on both Noble and Axelar — split by the
  // (stable) chain Agoric directly connects to; default to Axelar for legacy multi-hop relays.
  if (baseDenom === "uusdc" || baseDenom === "uusdt") {
    const hop = await agoricFirstHopChain(path);
    if (hop === "noble-1") return "Noble";
    if (hop === "axelar-dojo-1") return "Axelar";
    return "Axelar";
  }

  // Native cosmos assets: authoritative base_denom → chain.
  if (BASE_ORIGIN[baseDenom]) return BASE_ORIGIN[baseDenom]!;
  if (baseDenom.startsWith("stk/")) return "Persistence"; // pSTAKE liquid staking
  const factoryPrefix = baseDenom.match(/^factory[/:]([a-z]+)1/)?.[1];
  if (factoryPrefix && FACTORY_PREFIX_ORIGIN[factoryPrefix]) return FACTORY_PREFIX_ORIGIN[factoryPrefix]!;

  // Fallback: the chain Agoric received it from (transit ≈ origin for single-hop exotics).
  const hop = await agoricFirstHopChain(path);
  if (!hop) return null;
  return CHAIN_LABELS[hop] ?? deriveChainLabel(hop);
}

async function main() {
  const denoms = JSON.parse(readFileSync(DENOMS_PATH, "utf8")) as { note: string; entries: Entry[] };
  const entries = denoms.entries;
  const ibc = entries.filter((e) => e.match.startsWith("ibc/"));

  const baseCount = new Map<string, number>();
  for (const e of ibc) baseCount.set(baseSymbol(e.displaySymbol), (baseCount.get(baseSymbol(e.displaySymbol)) ?? 0) + 1);

  const newByMatch = new Map<string, string>();
  console.error("match,oldSymbol,base_denom,origin,newSymbol");
  let changed = 0;
  let unresolved = 0;

  for (const e of ibc) {
    const hash = e.match.slice("ibc/".length);
    const tr = await lcdGet<{ denom_trace?: { path?: string; base_denom?: string } }>(
      AGORIC_LCD,
      `/ibc/apps/transfer/v1/denom_traces/${hash}`
    );
    const path = tr?.denom_trace?.path ?? "";
    const base = tr?.denom_trace?.base_denom ?? "";
    const origin = path ? await resolveOrigin(path, base) : null;
    const sym = baseSymbol(e.displaySymbol);
    const ambiguous = (baseCount.get(sym) ?? 0) > 1;
    const newSymbol = ambiguous && origin ? `${sym} (${origin})` : e.displaySymbol;
    newByMatch.set(e.match, newSymbol);
    if (!origin) unresolved++;
    if (newSymbol !== e.displaySymbol) changed++;
    console.error(`${e.match.slice(0, 14)}…,${e.displaySymbol},${base.slice(0, 28)},${origin ?? "?"},${newSymbol}`);
  }

  console.error(`\n${ibc.length} ibc denoms; ${changed} label changes; ${unresolved} unresolved origins.`);

  if (!WRITE) {
    console.error("\nDRY RUN — set WRITE=1 to apply to denoms.json + denom-translations.csv.");
    return;
  }

  for (const e of entries) {
    const s = newByMatch.get(e.match);
    if (s) e.displaySymbol = s;
  }
  writeFileSync(DENOMS_PATH, JSON.stringify(denoms, null, 2) + "\n");

  const csv = readFileSync(CSV_PATH, "utf8").split("\n");
  const out: string[] = [];
  for (let i = 0; i < csv.length; i++) {
    const line = csv[i]!;
    if (i === 0 || line.trim() === "") {
      out.push(line);
      continue;
    }
    const firstComma = line.indexOf(",");
    const match = line.slice(0, firstComma);
    const s = newByMatch.get(match);
    if (!s) {
      out.push(line);
      continue;
    }
    const rest = line.slice(firstComma + 1);
    const secondComma = rest.indexOf(",");
    out.push(`${match},${s}${rest.slice(secondComma)}`);
  }
  writeFileSync(CSV_PATH, out.join("\n"));
  console.error(`\nWROTE ${changed} label changes to denoms.json + denom-translations.csv.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
