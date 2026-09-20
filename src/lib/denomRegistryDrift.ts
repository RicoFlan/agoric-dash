/**
 * Reconcile the committed denom registry against the chain's own vbankAsset table.
 *
 * `src/config/denoms.json` is hand-maintained and can drift: a denom's decimals can be wrong from
 * the day it was added, and nothing in the app would ever say so. Decimals are not cosmetic — they
 * are the divisor on every amount that denom appears in, so an error of one place is an error of
 * 10× in every figure the dashboard prints for it, USD included.
 *
 * **Only decimals are reconciled, not labels.** The chain publishes `issuerName` (`USDC_axl`);
 * denoms.json publishes a chain-disambiguated display label (`USDC (Axelar)`). Those disagree BY
 * DESIGN — the labels exist so that three different USDC rows are tellable apart in a table. A
 * check that demanded they match would fire constantly and teach the reader to ignore it.
 *
 * **A local entry with no chain counterpart is not drift.** Of 125 local entries, 107 are IBC
 * denoms that merely pass through Agoric and are never registered with vbank. Their absence from
 * vbankAsset says nothing about whether they are right. Only the intersection is checkable, plus
 * registered denoms we are missing entirely, which we will fail to resolve at all.
 */
export interface LocalDenomEntry {
  readonly match: string;
  readonly displaySymbol: string;
  readonly decimals: number;
}

export interface ChainDenomLike {
  readonly denom: string;
  readonly issuerName: string | null;
  readonly decimals: number | null;
}

export type DenomDriftKind =
  /** Both sides declare decimals and they disagree: every amount for this denom is off by 10^n. */
  | "decimals-differ"
  /** The chain registers this denom and we have no entry, so it resolves as unknown. */
  | "missing-locally";

export interface DenomDrift {
  readonly kind: DenomDriftKind;
  readonly denom: string;
  readonly chainIssuerName: string | null;
  readonly chainDecimals: number | null;
  readonly localDisplaySymbol: string | null;
  readonly localDecimals: number | null;
}

export interface DenomDriftReport {
  /** Registered denoms the chain published and we could compare. */
  readonly chainEntries: number;
  /** Entries in the committed registry, most of which are unregistered pass-through denoms. */
  readonly localEntries: number;
  /** Registered denoms whose decimals we checked and agreed on. */
  readonly agreed: number;
  /** Everything wrong, worst first: a wrong divisor outranks a denom we simply cannot name. */
  readonly drift: readonly DenomDrift[];
}

const ORDER: Record<DenomDriftKind, number> = { "decimals-differ": 0, "missing-locally": 1 };

/**
 * Compare the two registries.
 *
 * A chain entry that omits decimals is not comparable, so it is neither drift nor agreement — the
 * publication did not say, and inventing a comparison from that would be the same mistake as
 * reading an unindexed day as zero.
 */
export function reconcileDenomRegistry(
  local: readonly LocalDenomEntry[],
  chain: readonly ChainDenomLike[]
): DenomDriftReport {
  const byDenom = new Map<string, LocalDenomEntry>();
  for (const e of local) if (!byDenom.has(e.match)) byDenom.set(e.match, e);

  const drift: DenomDrift[] = [];
  let agreed = 0;

  for (const c of chain) {
    const l = byDenom.get(c.denom);
    if (!l) {
      drift.push({
        kind: "missing-locally",
        denom: c.denom,
        chainIssuerName: c.issuerName,
        chainDecimals: c.decimals,
        localDisplaySymbol: null,
        localDecimals: null,
      });
      continue;
    }
    if (c.decimals === null) continue;
    if (c.decimals === l.decimals) {
      agreed += 1;
      continue;
    }
    drift.push({
      kind: "decimals-differ",
      denom: c.denom,
      chainIssuerName: c.issuerName,
      chainDecimals: c.decimals,
      localDisplaySymbol: l.displaySymbol,
      localDecimals: l.decimals,
    });
  }

  drift.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.denom.localeCompare(b.denom));
  return { chainEntries: chain.length, localEntries: byDenom.size, agreed, drift };
}

/** One line per drift, for a log or a status payload. */
export function describeDenomDrift(d: DenomDrift): string {
  return d.kind === "decimals-differ"
    ? `${d.denom} (${d.localDisplaySymbol}): local decimals ${d.localDecimals}, chain says ${d.chainDecimals} — amounts are off by 10^${Math.abs((d.localDecimals ?? 0) - (d.chainDecimals ?? 0))}`
    : `${d.denom} (${d.chainIssuerName ?? "unnamed"}): registered on chain with no local entry — resolves as unknown`;
}
