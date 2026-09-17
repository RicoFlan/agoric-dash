"use client";

import type { OfferLabeledCount } from "@/components/dashboard/types";
import { CARD_CLASS, EmptyNote, IN_CARD_TITLE_CLASS, TABLE_CLASS, TABLE_HEAD_ROW_CLASS, TABLE_ROW_CLASS } from "@/components/dashboard/primitives";

const AUTOMATION_LABEL: Record<string, string> = {
  automated: "Automated",
  interactive: "User-initiated",
  unknown: "Uncategorized",
};

export function OfferEmpty() {
  return (
    <EmptyNote>
      No wallet actions in range. Offer rollups populate as the indexer processes blocks (full backfill on next
      reindex).
    </EmptyNote>
  );
}

export function OfferCategoryTable({ rows }: { rows: { category: string; automation: string; count: string }[] }) {
  return (
    <div className={CARD_CLASS}>
      <h3 className={IN_CARD_TITLE_CLASS}>Actions by functional category</h3>
      <p className="mb-3 text-xs leading-snug text-[var(--muted)]">
        Exactly one category per action (additive, non-overlapping). Class is the read-time
        automated-vs-user-initiated grouping that drives the organic ratio. Categories with no actions in range are
        absent from this table rather than shown as zero.
      </p>
      {rows.length === 0 ? (
        <OfferEmpty />
      ) : (
        <div className="max-h-64 overflow-y-auto">
          <table className={TABLE_CLASS}>
            <thead>
              <tr className={TABLE_HEAD_ROW_CLASS}>
                <th className="py-2 pr-4 font-semibold">Category</th>
                <th className="py-2 pr-4 font-semibold">Class</th>
                <th className="py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.category} className={TABLE_ROW_CLASS}>
                  <td className="py-1.5 pr-4 font-mono text-[var(--text)]">{r.category}</td>
                  <td className="py-1.5 pr-4 text-[var(--muted)]">{AUTOMATION_LABEL[r.automation] ?? r.automation}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-[var(--text)]">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function OfferLabeledTable({
  title,
  hint,
  colLabel,
  rows,
}: {
  title: string;
  hint: string;
  colLabel: string;
  rows: OfferLabeledCount[];
}) {
  return (
    <div className={CARD_CLASS}>
      <h3 className={IN_CARD_TITLE_CLASS}>{title}</h3>
      <p className="mb-3 text-xs leading-snug text-[var(--muted)]">{hint}</p>
      {rows.length === 0 ? (
        <OfferEmpty />
      ) : (
        <div className="max-h-64 overflow-y-auto">
          <table className={TABLE_CLASS}>
            <thead>
              <tr className={TABLE_HEAD_ROW_CLASS}>
                <th className="py-2 pr-4 font-semibold">{colLabel}</th>
                <th className="py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={TABLE_ROW_CLASS}>
                  <td className="py-1.5 pr-4 font-mono text-[var(--text)] break-all">{r.label}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-[var(--text)]">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
