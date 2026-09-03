"use client";

import { useMemo } from "react";
import type { MetricsPayload } from "@/components/dashboard/types";
import { dashboardSectionIds } from "@/lib/dashboardNav";
import { buildWhatChanged } from "@/lib/narrative";

const ANCHOR: Record<string, string> = {
  busier: dashboardSectionIds.busier,
  organic: dashboardSectionIds.organic,
  "value-flow": dashboardSectionIds.valueFlow,
  base: dashboardSectionIds.base,
};

/**
 * "What changed this period": up to three deterministic sentences ranked by how much each question
 * stands out (largest anomaly, then prior-window change). Each links to its section. Renders nothing
 * when the API has no `questions` section or no question has data.
 */
export function WhatChanged({ data }: { data: MetricsPayload }) {
  const q = data.questions;
  const sentences = useMemo(() => {
    if (!q) return [];
    const metas = data.display?.metas ?? {};
    return buildWhatChanged(q, { symbolOf: (d) => metas[d]?.displaySymbol || d, max: 3 });
  }, [q, data.display]);
  if (!q || sentences.length === 0) return null;
  return (
    <section
      aria-label="What changed this period"
      className="rounded-lg border border-[color-mix(in_srgb,var(--color-accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_7%,var(--surface))] p-5"
    >
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-accent)]">
        What changed this period
      </p>
      <ol className="space-y-1.5 text-sm leading-snug text-[var(--color-text-primary)]">
        {sentences.map((s) => (
          <li key={s.id} className="flex gap-2">
            <span aria-hidden className="mt-[0.45em] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
            <a href={`#${ANCHOR[s.id]}`} className="hover:underline underline-offset-2">
              {s.text}
            </a>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-[var(--muted)]">
        Ranked by the largest unusual day (z-score vs the trailing 30 days), then by the size of the change vs the
        prior window. Generated from the figures on this page, not from a model.
      </p>
    </section>
  );
}
