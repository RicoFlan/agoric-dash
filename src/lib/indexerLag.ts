/**
 * How far the indexer trails the chain head.
 *
 * Two independent signals, deliberately kept separate because they fail differently:
 *   - `blocksBehind` — chain head minus last indexed height. Exact, but needs a live RPC call, so it
 *     is null whenever the head could not be read.
 *   - `secondsSinceUpdate` — wall-clock age of the indexer's own `updated_at`. Always available, and
 *     it is the only signal that still moves when the indexer has stopped writing entirely.
 *
 * No block time is assumed anywhere: a block count is never converted to a duration, because Agoric
 * block intervals vary and a fabricated "≈ 4 minutes behind" would be a claim the data cannot carry.
 */

/** At or under this many blocks behind, the dashboard is effectively current. */
export const LAG_LIVE_BLOCKS = 60;
/** Beyond this many blocks behind, treat the indexer as stalled rather than merely trailing. */
export const LAG_STALLED_BLOCKS = 1_000;
/** Beyond this long without an indexer write, treat it as stalled even if the head is unreadable. */
export const LAG_STALLED_SECONDS = 15 * 60;

export type LagLevel = "live" | "behind" | "stalled" | "unknown";

export interface IndexerLag {
  lastIndexedHeight: string | null;
  chainHeight: string | null;
  /** chainHeight − lastIndexedHeight; null when either side is missing. Never negative — see below. */
  blocksBehind: number | null;
  /** Age of the indexer's last write in seconds; null without a usable timestamp. */
  secondsSinceUpdate: number | null;
  level: LagLevel;
  /**
   * True when the indexer reports a height ABOVE the chain head. That means the head came from a
   * lagging RPC peer, not that the indexer ran ahead, so `blocksBehind` is clamped to 0 and the
   * level is reported as unknown rather than live.
   */
  headBehindIndexer: boolean;
}

function parseHeight(v: string | null | undefined): bigint | null {
  if (typeof v !== "string" || !/^\d+$/.test(v)) return null;
  return BigInt(v);
}

export function computeIndexerLag(input: {
  lastIndexedHeight: string | null | undefined;
  chainHeight: string | null | undefined;
  updatedAt: string | null | undefined;
  now?: Date;
}): IndexerLag {
  const indexed = parseHeight(input.lastIndexedHeight);
  const head = parseHeight(input.chainHeight);
  const now = input.now ?? new Date();

  let secondsSinceUpdate: number | null = null;
  if (typeof input.updatedAt === "string") {
    const t = Date.parse(input.updatedAt);
    if (Number.isFinite(t)) secondsSinceUpdate = Math.max(0, Math.round((now.getTime() - t) / 1000));
  }

  const headBehindIndexer = indexed !== null && head !== null && head < indexed;
  const blocksBehind = indexed !== null && head !== null ? Number(head > indexed ? head - indexed : BigInt(0)) : null;

  let level: LagLevel;
  if (secondsSinceUpdate !== null && secondsSinceUpdate > LAG_STALLED_SECONDS) {
    level = "stalled";
  } else if (headBehindIndexer || blocksBehind === null) {
    level = "unknown";
  } else if (blocksBehind > LAG_STALLED_BLOCKS) {
    level = "stalled";
  } else if (blocksBehind > LAG_LIVE_BLOCKS) {
    level = "behind";
  } else {
    level = "live";
  }

  return {
    lastIndexedHeight: indexed !== null ? indexed.toString() : null,
    chainHeight: head !== null ? head.toString() : null,
    blocksBehind,
    secondsSinceUpdate,
    level,
    headBehindIndexer,
  };
}

/** Short human phrase for the badge; never invents a duration from a block count. */
export function describeIndexerLag(lag: IndexerLag): string {
  if (lag.level === "stalled" && lag.blocksBehind === null) return "Indexer not writing";
  switch (lag.level) {
    case "live":
      return lag.blocksBehind === 0 ? "At chain head" : `${lag.blocksBehind} blocks behind head`;
    case "behind":
      return `${lag.blocksBehind} blocks behind head`;
    case "stalled":
      return `Stalled — ${lag.blocksBehind} blocks behind head`;
    default:
      return lag.headBehindIndexer ? "Chain head unavailable (peer lagging)" : "Chain head unavailable";
  }
}
