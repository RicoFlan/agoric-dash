"use client";

import { useEffect, useState } from "react";
import { describeIndexerLag, type IndexerLag, type LagLevel } from "@/lib/indexerLag";

/**
 * Indexed height plus how far that trails the chain head.
 *
 * The lag comes from `/api/status`, not from the metrics payload, so a slow or unreachable RPC
 * cannot delay the dashboard's own load. It refreshes on its own short interval because the lag is
 * the one figure on the page that goes stale while the reader is looking at it.
 */
const REFRESH_MS = 60_000;

const LEVEL_COLOR: Record<LagLevel, string> = {
  live: "var(--color-success)",
  behind: "var(--color-warning)",
  stalled: "var(--color-error)",
  unknown: "var(--color-text-muted)",
};

interface StatusResponse {
  lastIndexedHeight?: string | null;
  updatedAt?: string | null;
  lag?: IndexerLag;
}

export function IndexerStatusLine({ fallbackHeight, fallbackUpdatedAt }: { fallbackHeight?: string | null; fallbackUpdatedAt?: string | null }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as StatusResponse;
        if (!cancelled) setStatus(j);
      } catch {
        // Leave the previous reading in place; the height from the metrics payload still renders.
      }
    };
    void load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const height = status?.lastIndexedHeight ?? fallbackHeight ?? null;
  const updatedAt = status?.updatedAt ?? fallbackUpdatedAt ?? null;
  const lag = status?.lag;
  if (!height) return null;

  return (
    <p className="text-left text-xs font-bold text-[var(--color-text-secondary)]">
      Last indexed block height: <code className="font-bold text-[var(--accent)]">{height}</code>
      {lag && (
        <span
          className="ml-2 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-bold"
          style={{ borderColor: `color-mix(in srgb, ${LEVEL_COLOR[lag.level]} 45%, transparent)`, color: LEVEL_COLOR[lag.level] }}
          title={
            lag.chainHeight
              ? `Chain head ${lag.chainHeight}; indexed ${height}.`
              : "The chain head could not be read, so the block gap is unknown."
          }
        >
          <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: LEVEL_COLOR[lag.level] }} />
          {describeIndexerLag(lag)}
        </span>
      )}
      {updatedAt && <span className="ml-2 font-bold">(indexer updated {new Date(updatedAt).toLocaleString()})</span>}
    </p>
  );
}
