/**
 * The committed registries that mirror the chain's decimals, and the drift between them and it.
 *
 * There are TWO local copies, feeding different figures:
 *   - `denoms.json` — hand-maintained, keyed by denom, 125 entries (mostly unregistered
 *     pass-through IBC denoms). Resolves Q3 IBC flow rows.
 *   - `agoricNames.json` `vbankAssets` — script-generated, keyed by brand Board id, 18 entries.
 *     Resolves offer give/want/payout volumes, where the brand is what an offer names.
 *
 * They are checked together because they can disagree with EACH OTHER, and did: `upoc26` read 0
 * decimals in the generated copy and 6 in the hand-maintained one, so every PoC26 amount in Q3 was
 * a millionth of its real size while the offer figures were right. Checking one registry would
 * have caught that only by choosing the right one.
 */
import denoms from "@/config/denoms.json";
import agoricNames from "@/config/agoricNames.json";
import {
  describeDenomDrift,
  reconcileDenomRegistry,
  type ChainDenomLike,
  type LocalDenomEntry,
} from "@/lib/denomRegistryDrift";

export interface LocalRegistry {
  /** Path as a human would open it. */
  readonly source: string;
  readonly entries: readonly LocalDenomEntry[];
}

export function localDenomRegistries(): LocalRegistry[] {
  const fromAgoricNames = Object.values(
    agoricNames.vbankAssets as Record<string, { denom: string; issuerName: string; decimalPlaces: number }>
  ).map((v) => ({ match: v.denom, displaySymbol: v.issuerName, decimals: v.decimalPlaces }));
  return [
    { source: "src/config/denoms.json", entries: denoms.entries as LocalDenomEntry[] },
    { source: "src/config/agoricNames.json (vbankAssets)", entries: fromAgoricNames },
  ];
}

export interface RegistryDriftSummary {
  readonly source: string;
  readonly localEntries: number;
  readonly agreed: number;
  /** One sentence per drift, already stating the size of the error. */
  readonly drift: readonly string[];
}

/** Reconcile every committed registry against one chain snapshot. */
export function summarizeLocalRegistryDrift(chain: readonly ChainDenomLike[]): RegistryDriftSummary[] {
  return localDenomRegistries().map(({ source, entries }) => {
    const r = reconcileDenomRegistry(entries, chain);
    return { source, localEntries: r.localEntries, agreed: r.agreed, drift: r.drift.map(describeDenomDrift) };
  });
}

/** Total drift across every registry — the one number a status payload needs to act on. */
export function totalDrift(summaries: readonly RegistryDriftSummary[]): number {
  return summaries.reduce((n, s) => n + s.drift.length, 0);
}
