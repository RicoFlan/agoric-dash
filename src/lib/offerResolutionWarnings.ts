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
/**
 * Counts for ONE reporting interval, plus since-start totals for context.
 *
 * Interval-scoped deliberately: a cumulative counter cannot say whether the problem is happening
 * now or stopped hours ago, and after a map refresh it would keep reporting the old failures until
 * the process restarted. Draining at each log makes the signal current and bounds memory in the
 * same step — both maps are keyed by CHAIN-CONTROLLED strings, so an unbounded key space is a
 * memory leak an adversary could drive.
 */
export interface ResolutionWarnings {
  /** Board id → count of offers that named it while the map did not resolve it. */
  readonly unresolvedInstances: Map<string, number>;
  /** Maker name → count of instance-less offers that fell through to `other`. */
  readonly unclassifiedMakers: Map<string, number>;
  /** Actions considered this interval, so a count can be read as a share. */
  totalActions: number;
  /**
   * OBSERVATIONS dropped this interval after the map hit {@link MAX_TRACKED_KEYS} — not distinct
   * keys. An overflow key seen ten times counts ten, because it is never stored and so can never be
   * recognised as already-seen. Counting distinct keys past the ceiling would need the very
   * unbounded set the ceiling exists to avoid.
   */
  droppedObservations: number;
  /** Since process start, for context in the log line. */
  totalActionsSinceStart: number;
  unresolvedHitsSinceStart: number;
  unclassifiedHitsSinceStart: number;
}

/**
 * Ceiling on distinct keys held per map. Well above any plausible real cardinality — there are 41
 * instances and 10 makers in all of indexed history — so hitting it means something is generating
 * junk names, which the dropped-key count reports rather than silently absorbing.
 */
export const MAX_TRACKED_KEYS = 200;

export function newResolutionWarnings(): ResolutionWarnings {
  return {
    unresolvedInstances: new Map(),
    unclassifiedMakers: new Map(),
    totalActions: 0,
    droppedObservations: 0,
    totalActionsSinceStart: 0,
    unresolvedHitsSinceStart: 0,
    unclassifiedHitsSinceStart: 0,
  };
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

/** Increment `k`, or count a dropped observation once the map is at its ceiling. */
function bump(acc: ResolutionWarnings, m: Map<string, number>, k: string): void {
  const seen = m.get(k);
  if (seen === undefined && m.size >= MAX_TRACKED_KEYS) {
    acc.droppedObservations += 1;
    return;
  }
  m.set(k, (seen ?? 0) + 1);
}

/** Control characters, including the C1 range that some terminals still act on. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * Render a chain-controlled key safely for a log line.
 *
 * Board ids and maker names come off the decoded offer, so they are attacker-chosen. Interpolating
 * one raw lets a crafted name inject newlines — forging whole log lines, which is how log-based
 * alerting gets fooled — or terminal escape sequences that rewrite what an operator sees (CWE-117).
 * Control characters become visible escapes, and the result is capped so one key cannot crowd out
 * the rest of the line.
 */
export function sanitizeLogKey(k: string, maxLen = 48): string {
  const escaped = k.replace(CONTROL_CHARS, (c) => "\\x" + c.charCodeAt(0).toString(16).padStart(2, "0"));
  return escaped.length > maxLen ? escaped.slice(0, maxLen) + "\u2026" : escaped;
}

/** Record one classified action. Cheap enough to call per action. */
export function recordResolution(acc: ResolutionWarnings, o: ResolutionObservation): void {
  acc.totalActions += 1;
  acc.totalActionsSinceStart += 1;
  // A named instance that did not resolve is the stale-map signal, and it is worth flagging even
  // when the action still got a category some other way — the map is wrong either way.
  if (o.instanceBoardId && !o.instanceName) {
    acc.unresolvedHitsSinceStart += 1;
    bump(acc, acc.unresolvedInstances, o.instanceBoardId);
  }
  // Only instance-less offers reach the maker fallback, so a maker is a rule candidate only there.
  if (o.category === "other" && !o.instanceBoardId && o.maker) {
    acc.unclassifiedHitsSinceStart += 1;
    bump(acc, acc.unclassifiedMakers, o.maker);
  }
}

function top(m: Map<string, number>, n: number): string {
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${sanitizeLogKey(k)}×${v}`)
    .join(", ");
}

/**
 * Format the interval's counts AND reset them, so the next line reports the next interval rather
 * than everything since process start. Always resets, including when it returns null — otherwise a
 * quiet interval would carry its (empty) state forward and the since-start totals would drift from
 * the interval ones.
 */
export function drainResolutionWarning(acc: ResolutionWarnings, topN = 5): string | null {
  const msg = formatResolutionWarning(acc, topN);
  acc.unresolvedInstances.clear();
  acc.unclassifiedMakers.clear();
  acc.totalActions = 0;
  acc.droppedObservations = 0;
  return msg;
}

/**
 * A one-line summary of the CURRENT interval, or null when there is nothing to say. Null rather than
 * an empty string so a caller cannot accidentally log a blank warning line every interval. Pure —
 * see {@link drainResolutionWarning} for the reset.
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
  if (acc.droppedObservations > 0) {
    parts.push(`${acc.droppedObservations} further observation(s) dropped at the ${MAX_TRACKED_KEYS}-key ceiling`);
  }
  const since =
    acc.totalActionsSinceStart > acc.totalActions
      ? `; since start ${acc.unresolvedHitsSinceStart} unresolved / ${acc.unclassifiedHitsSinceStart} unclassified of ${acc.totalActionsSinceStart}`
      : "";
  return `[offer-category] ${parts.join("; ")} (of ${acc.totalActions} actions this interval${since})`;
}
