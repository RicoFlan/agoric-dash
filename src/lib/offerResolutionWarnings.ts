/**
 * Makes category-resolution failure visible instead of letting it decay silently.
 *
 * `offer_category` is written at INDEX time and resolves Board ids to contract names through the
 * committed `agoricNames.json`. That map decays continuously: a contract redeployed after the map
 * was generated gets a new Board id, stops resolving, and its offers quietly become `other`. Nothing
 * fails, nothing logs, and the unclassified share creeps up — which is only noticed months later, as
 * a number nobody can explain. Re-running the map costs a full category rebuild, so noticing early
 * is worth a lot.
 *
 * Two distinct signals, because they call for different fixes:
 *  - **Unresolved instance** — the offer named a contract and the map did not know it. The map is
 *    stale; run `scripts/refreshAgoricNames.ts`.
 *  - **Unclassified maker** — a continuing offer with no instance whose maker name has no rule. A
 *    candidate for `MAKER_CATEGORY`, but only if that name is unique to one contract in agoric-sdk
 *    (see offerCategory.ts — `Deposit` and `Withdraw` are the counter-example).
 */
export interface ResolutionWarnings {
  /** Board id → count of offers that named it while the map did not resolve it. */
  readonly unresolvedInstances: Map<string, number>;
  /** Maker name → count of instance-less offers that fell through to `other`. */
  readonly unclassifiedMakers: Map<string, number>;
  /** Actions considered, so a count can be read as a share. */
  totalActions: number;
}

export function newResolutionWarnings(): ResolutionWarnings {
  return { unresolvedInstances: new Map(), unclassifiedMakers: new Map(), totalActions: 0 };
}

export interface ResolutionObservation {
  /** Board id the offer named, when it named one. */
  readonly instanceBoardId: string | null;
  /** What the map returned for it — null means unresolved. */
  readonly instanceName: string | null;
  readonly maker: string | null;
  /** The category the action was ultimately assigned. */
  readonly category: string;
}

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

/** Record one classified action. Cheap enough to call per action. */
export function recordResolution(acc: ResolutionWarnings, o: ResolutionObservation): void {
  acc.totalActions += 1;
  // A named instance that did not resolve is the stale-map signal, and it is worth flagging even
  // when the action still got a category some other way — the map is wrong either way.
  if (o.instanceBoardId && !o.instanceName) bump(acc.unresolvedInstances, o.instanceBoardId);
  // Only instance-less offers reach the maker fallback, so a maker is a rule candidate only there.
  if (o.category === "other" && !o.instanceBoardId && o.maker) bump(acc.unclassifiedMakers, o.maker);
}

function top(m: Map<string, number>, n: number): string {
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k}×${v}`)
    .join(", ");
}

/**
 * A one-line summary, or null when there is nothing to say. Null rather than an empty string so a
 * caller cannot accidentally log a blank warning line every interval.
 */
export function formatResolutionWarning(acc: ResolutionWarnings, topN = 5): string | null {
  if (acc.unresolvedInstances.size === 0 && acc.unclassifiedMakers.size === 0) return null;
  const parts: string[] = [];
  if (acc.unresolvedInstances.size > 0) {
    const hits = [...acc.unresolvedInstances.values()].reduce((s, v) => s + v, 0);
    parts.push(
      `${acc.unresolvedInstances.size} unresolved instance Board id(s) over ${hits} offers [${top(acc.unresolvedInstances, topN)}] — agoricNames.json is stale, run scripts/refreshAgoricNames.ts`
    );
  }
  if (acc.unclassifiedMakers.size > 0) {
    const hits = [...acc.unclassifiedMakers.values()].reduce((s, v) => s + v, 0);
    parts.push(
      `${acc.unclassifiedMakers.size} unclassified maker(s) over ${hits} instance-less offers [${top(acc.unclassifiedMakers, topN)}] — candidates for MAKER_CATEGORY if unique to one contract`
    );
  }
  return `[offer-category] ${parts.join("; ")} (of ${acc.totalActions} actions)`;
}
