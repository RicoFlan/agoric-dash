"use client";

/**
 * Shared building blocks for the question-led dashboard (docs: "Four Questions", P3).
 *
 *  - QuestionBlock: one top-level section = one question. Rail heading (style guide §2), intro,
 *    headline row, body (chart + support figures), and a native <details> drawer for everything
 *    retained but demoted.
 *  - Headline: the one number that answers the question, with its prior-window delta.
 *  - SupportFigure / KpiCard / KpiCardLite: small cards. Support figures carry an optional one-line
 *    definition rendered as a hover/focus hint (P4 replaces the hint with a definitions map).
 *  - DetailDrawer: <details>/<summary>, no JS state, keyboard-accessible by default.
 */
import type { ReactNode } from "react";

/** docs/style-guide.md §2 — top-level section rails: accent (H2 / 20px) + left rail */
export const SECTION_HEADING_CLASS =
  "border-l-2 border-[var(--color-accent)] pl-3 text-xl font-semibold leading-tight tracking-tight text-[var(--color-accent)]";

/** Section intro copy under H2 — full content width (matches chart/card panels). */
export const SECTION_INTRO_CLASS = "w-full text-sm leading-snug text-[var(--color-text-secondary)]";

/** In-card panel title (H3 / 18px): primary + subtle rule under the title (style guide structure) */
export const IN_CARD_TITLE_CLASS =
  "mb-2 border-b border-[var(--border)] pb-2 text-lg font-semibold leading-snug text-[var(--color-text-primary)]";

export const CARD_CLASS = "rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5";

export function fmtPct(n: number | null, digits = 1): string {
  if (n === null || !Number.isFinite(n)) return "n/a";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

export function fmtPts(n: number | null, digits = 1): string {
  if (n === null || !Number.isFinite(n)) return "n/a";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)} pts`;
}

export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

export function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** One-decimal percentage for ratios that are already 0–100 (satisfaction, retention, organic share). */
export function fmtPct1(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

export function fmtUsd(n: number | null | undefined, signed = false): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const opts: Intl.NumberFormatOptions =
    abs >= 1e6 ? { maximumFractionDigits: 1 } : abs >= 1 ? { maximumFractionDigits: 2 } : { maximumFractionDigits: 4 };
  const s = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", ...opts }).format(abs);
  if (n < 0) return `−${s}`;
  return signed && n > 0 ? `+${s}` : s;
}

/** Semantic colour for a delta where "up is good" (default) or "up is bad". */
export function deltaTone(value: number | null, upIsGood = true): string {
  if (value === null || !Number.isFinite(value) || value === 0) return "text-[var(--color-text-secondary)]";
  const good = upIsGood ? value > 0 : value < 0;
  return good ? "text-[var(--color-success)]" : "text-[var(--color-warning)]";
}

export function QuestionBlock({
  id,
  eyebrow,
  title,
  verdict,
  intro,
  headline,
  children,
  detail,
  detailLabel = "Detail",
}: {
  id: string;
  eyebrow: string;
  title: string;
  /** The explicit answer, with the qualifier that keeps a reader who stops here from being misled. */
  verdict?: { answer: string; qualifier: string | null };
  intro?: ReactNode;
  headline: ReactNode;
  children?: ReactNode;
  detail?: ReactNode;
  detailLabel?: string;
}) {
  return (
    <section id={id} className="scroll-mt-6 min-w-0 space-y-5">
      <div>
        <p className="mb-1 pl-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">{eyebrow}</p>
        <h2 className={SECTION_HEADING_CLASS}>{title}</h2>
      </div>
      {verdict && (
        <div className="rounded-lg border-l-2 border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_6%,var(--surface))] px-4 py-3">
          <p className="text-base font-semibold leading-snug text-[var(--color-text-primary)]">{verdict.answer}</p>
          {verdict.qualifier && <p className="mt-1 text-xs leading-snug text-[var(--color-text-secondary)]">{verdict.qualifier}</p>}
        </div>
      )}
      {intro && <p className={SECTION_INTRO_CLASS}>{intro}</p>}
      {headline}
      {children}
      {detail && <DetailDrawer label={detailLabel}>{detail}</DetailDrawer>}
    </section>
  );
}

/**
 * The answer to the question: a large figure, its prior-window comparison, and a one-line
 * definition. `delta` is already formatted (pct or pts); `deltaValue` drives the colour.
 */
/**
 * An abbreviated figure that still carries its full value. The exact number goes in `title` (shown
 * on hover and by screen readers via the accessible description) and the text is marked so a reader
 * can tell there is more behind it. With no `exact` it renders the text unchanged, so callers can
 * pass the result of a compact formatter straight through.
 */
export function ExactValue({ text, exact }: { text: string; exact?: string | null }) {
  if (!exact) return <>{text}</>;
  return (
    <span title={exact} className="cursor-help underline decoration-dotted decoration-from-font underline-offset-4">
      {text}
    </span>
  );
}

export function Headline({
  label,
  value,
  unit,
  previous,
  delta,
  deltaValue,
  upIsGood = true,
  definition,
  aside,
  exact,
  previousExact,
}: {
  label: string;
  value: string;
  unit?: string;
  previous?: string;
  delta?: string;
  deltaValue?: number | null;
  upIsGood?: boolean;
  definition?: string;
  aside?: ReactNode;
  /** Full-precision value behind an abbreviated `value`; omit when `value` is already exact. */
  exact?: string | null;
  /** Full-precision value behind an abbreviated `previous`. */
  previousExact?: string | null;
}) {
  return (
    <div className={`${CARD_CLASS} flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between`}>
      <div className="min-w-0">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
          {label}
          {definition && <InfoHint text={definition} />}
        </h3>
        <p className="mt-2 font-mono text-4xl leading-none tracking-tight text-[var(--text)]">
          <ExactValue text={value} exact={exact} />
          {unit && <span className="ml-2 text-base text-[var(--color-text-secondary)]">{unit}</span>}
        </p>
        {(previous !== undefined || delta !== undefined) && (
          <p className="mt-2 text-xs text-[var(--muted)]">
            {previous !== undefined && (
              <>
                Prior window:{" "}
                <span className="font-mono text-[var(--text)]">
                  <ExactValue text={previous} exact={previousExact} />
                </span>
              </>
            )}
            {previous !== undefined && delta !== undefined && " · "}
            {delta !== undefined && <span className={`font-semibold ${deltaTone(deltaValue ?? null, upIsGood)}`}>{delta}</span>}
          </p>
        )}
      </div>
      {aside && <div className="shrink-0 text-xs text-[var(--muted)] sm:max-w-xs sm:text-right">{aside}</div>}
    </div>
  );
}

/** A supporting figure: label, value, prior-window comparison, optional definition hint. */
export function SupportFigure({
  label,
  value,
  previous,
  delta,
  deltaValue,
  upIsGood = true,
  definition,
  note,
}: {
  label: string;
  value: string;
  previous?: string;
  delta?: string;
  deltaValue?: number | null;
  upIsGood?: boolean;
  definition?: string;
  note?: string;
}) {
  return (
    <div className={CARD_CLASS}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
        {label}
        {definition && <InfoHint text={definition} />}
      </h3>
      <p className="mt-2 font-mono text-2xl text-[var(--text)]">{value}</p>
      {(previous !== undefined || delta !== undefined) && (
        <p className="mt-1 text-xs text-[var(--muted)]">
          {previous !== undefined && (
            <>
              Prior: <span className="font-mono text-[var(--text)]">{previous}</span>
            </>
          )}
          {previous !== undefined && delta !== undefined && " · "}
          {delta !== undefined && <span className={deltaTone(deltaValue ?? null, upIsGood)}>{delta}</span>}
        </p>
      )}
      {note && <p className="mt-1 text-xs text-[var(--muted)]">{note}</p>}
    </div>
  );
}

/** ⓘ with the definition as a native tooltip and as accessible text; P4 swaps this for a popover. */
export function InfoHint({ text }: { text: string }) {
  return (
    <span
      className="ml-1 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-[var(--border)] align-middle text-[10px] font-semibold normal-case tracking-normal text-[var(--color-text-secondary)]"
      title={text}
      tabIndex={0}
      aria-label={text}
    >
      i
    </span>
  );
}

export function DetailDrawer({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_60%,var(--bg))]">
      <summary className="cursor-pointer select-none px-5 py-3 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--text)] [&::-webkit-details-marker]:hidden">
        <span className="mr-2 inline-block transition-transform group-open:rotate-90">▸</span>
        {label}
      </summary>
      <div className="space-y-6 border-t border-[var(--border)] p-5">{children}</div>
    </details>
  );
}

export function KpiCard({
  title,
  subtitle,
  current,
  previous,
  pct,
  definition,
  upIsGood = true,
}: {
  title: string;
  subtitle?: string;
  current: string;
  previous: string;
  pct: number | null;
  definition?: string;
  upIsGood?: boolean;
}) {
  return (
    <div className={CARD_CLASS}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
        {title}
        {definition && <InfoHint text={definition} />}
      </h3>
      {subtitle && <p className="mt-1 text-xs text-[var(--muted)]">{subtitle}</p>}
      <p className="mt-2 font-mono text-2xl text-[var(--text)]">{current}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Prior window (equal length): <span className="font-mono text-[var(--text)]">{previous}</span>
        {" · "}
        <span className={deltaTone(pct, upIsGood)}>{fmtPct(pct)}</span>
      </p>
    </div>
  );
}

export function KpiCardLite({ title, subtitle, value }: { title: string; subtitle?: string; value: string }) {
  return (
    <div className={CARD_CLASS}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{title}</h3>
      {subtitle && <p className="mt-1 text-xs text-[var(--muted)]">{subtitle}</p>}
      <p className="mt-2 font-mono text-2xl text-[var(--text)]">{value}</p>
    </div>
  );
}

/** Empty-state line for tables. */
export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="text-xs text-[var(--muted)]">{children}</p>;
}

export const TABLE_CLASS = "w-full border-collapse text-xs sm:text-sm";
export const TABLE_HEAD_ROW_CLASS = "border-b border-[var(--border)] text-left text-[var(--color-accent)]";
export const TABLE_ROW_CLASS = "border-b border-[var(--border)]/40";
