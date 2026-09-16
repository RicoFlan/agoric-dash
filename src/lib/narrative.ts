/**
 * "What changed this period" — deterministic sentences over the `questions` payload. No model call:
 * each question has a template; sentences are ranked by how much they stand out (largest anomaly
 * z-score, then the size of the prior-window change) and the top few are shown. A question with no
 * data in either window produces nothing rather than a sentence about nothing.
 */
import type { QuestionsPayload } from "@/lib/questionsPayload";
import { methodologyChangesInRange } from "@/lib/semantics";

export interface NarrativeSentence {
  id: "busier" | "organic" | "value-flow" | "base";
  text: string;
  /** Ranking keys: largest |z| among flagged days (0 if none), then |Δ%| vs the prior window. */
  maxZ: number;
  absDeltaPct: number;
}

function pctWord(pct: number | null): { verb: "rose" | "fell" | "held"; mag: string } {
  if (pct === null || !Number.isFinite(pct) || Math.abs(pct) < 0.05) return { verb: "held", mag: "" };
  return { verb: pct > 0 ? "rose" : "fell", mag: `${Math.abs(pct).toFixed(pct >= 100 || pct <= -100 ? 0 : 1)}%` };
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function fmtUsd(n: number, signed = true): string {
  const abs = Math.abs(n);
  const s = abs >= 1e6 ? `$${(abs / 1e6).toFixed(2)}M` : abs >= 1e3 ? `$${(abs / 1e3).toFixed(1)}k` : `$${abs.toFixed(0)}`;
  if (n < 0) return `−${s}`;
  return signed && n > 0 ? `+${s}` : s;
}

function windowDays(q: QuestionsPayload): number {
  const a = new Date(`${q.comparisonWindow.from}T00:00:00Z`).getTime();
  const b = new Date(`${q.comparisonWindow.to}T00:00:00Z`).getTime();
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) + 1 : 0;
}

function anomalyClause(anoms: { day: string; direction: "high" | "low" }[]): string {
  if (anoms.length === 0) return "";
  const days = [...anoms].sort((x, y) => (x.day < y.day ? -1 : 1));
  const md = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}`;
  if (days.length === 1) return `, with an unusually ${days[0]!.direction} day on ${md(days[0]!.day)}`;
  return `, with ${days.length} unusual days between ${md(days[0]!.day)} and ${md(days[days.length - 1]!.day)}`;
}

function topZ(anoms: { z: number }[]): number {
  return anoms.reduce((m, a) => Math.max(m, Math.abs(a.z)), 0);
}

/**
 * Sentences naming a counting-rule change inside the range. They lead the strip because a reader who
 * does not know a definition moved will read the step as behaviour.
 */
export function methodologyNotices(fromDay: string, toDay: string): string[] {
  return methodologyChangesInRange(fromDay, toDay).map(
    (c) => `Counting rule changed on ${c.day} (${c.affects}): ${c.note}`
  );
}

export interface Verdict {
  id: NarrativeSentence["id"];
  /** The answer to the question, in one sentence. */
  answer: string;
  /** The thing that would mislead a reader who stopped at the answer. */
  qualifier: string | null;
}

/** Largest share of a total held by one member, as a percentage; null when there is nothing to divide. */
function topSharePct(parts: number[]): number | null {
  const total = parts.reduce((s, n) => s + Math.abs(n), 0);
  if (total <= 0 || parts.length === 0) return null;
  return (Math.max(...parts.map(Math.abs)) / total) * 100;
}

/**
 * One explicit answer per question, with the qualifier that keeps it honest. Written here rather
 * than in the components so the wording and the arithmetic stay together, and so a reader who stops
 * at the verdict is not misled by it.
 */
export function buildVerdicts(q: QuestionsPayload, opts: { symbolOf?: (denom: string) => string } = {}): Verdict[] {
  const symbolOf = opts.symbolOf ?? ((d: string) => d);
  const out: Verdict[] = [];

  // Q1
  {
    const h = q.q1.headline;
    const pct = h.pctChange;
    const answer =
      h.current === null || h.current === 0
        ? "No indexed transaction activity in this range."
        : pct === null
          ? `${fmtInt(h.current)} successful transactions; no comparable prior window.`
          : Math.abs(pct) < 5
            ? `Broadly flat: ${fmtInt(h.current)} successful transactions, ${pctWord(pct).verb === "held" ? "level" : `${pctWord(pct).mag}`} against the prior window.`
            : `${pct > 0 ? "Busier" : "Quieter"}: successful transactions ${pctWord(pct).verb} ${pctWord(pct).mag}.`;
    const flagged = q.q1.anomalies.length;
    out.push({
      id: "busier",
      answer,
      qualifier:
        flagged > 0
          ? `${flagged} unusual day${flagged === 1 ? "" : "s"} contributed, so the change is not evenly spread. Transaction count is not users.`
          : "Transaction count is not users, and it does not measure contract workload, which runs outside transactions.",
    });
  }

  // Q2
  {
    const h = q.q2.headline;
    const cur = q.q2.counts.current;
    const answer =
      h.current === null
        ? "No smart-wallet actions in this range."
        : h.deltaPts === null
          ? `${h.current.toFixed(1)}% of wallet actions were user-initiated.`
          : Math.abs(h.deltaPts) < 0.5
            ? `Steady: ${h.current.toFixed(1)}% of wallet actions were user-initiated.`
            : `${h.deltaPts > 0 ? "More" : "Less"} user-initiated: ${h.current.toFixed(1)}% of wallet actions, ${Math.abs(h.deltaPts).toFixed(1)} points ${h.deltaPts > 0 ? "up" : "down"}.`;
    const top = cur.interactiveByCategory[0];
    const share = top && cur.interactive > 0 ? (top.count / cur.interactive) * 100 : null;
    out.push({
      id: "organic",
      answer,
      qualifier:
        share !== null && share >= 50
          ? `${share.toFixed(0)}% of user-initiated actions came from ${top!.category} alone, so this is that product's adoption rather than broad growth.`
          : "Action-weighted, so a few busy wallets can move it; compare with distinct interactive wallets.",
    });
  }

  // Q3
  {
    const h = q.q3.headline;
    const answer =
      h.netUsd === null
        ? "No priced IBC transfer traffic in this range."
        : `${h.netUsd >= 0 ? "Net inflow" : "Net outflow"} of ${fmtUsd(Math.abs(h.netUsd), false)} across priced assets.`;
    const dayShare = topSharePct(q.q3.daily.map((d) => d.value ?? 0));
    const bits: string[] = [];
    if (h.pricedAssets < h.activeAssets) {
      bits.push(`${h.activeAssets - h.pricedAssets} asset${h.activeAssets - h.pricedAssets === 1 ? "" : "s"} could not be priced and ${h.activeAssets - h.pricedAssets === 1 ? "is" : "are"} excluded`);
    }
    if (dayShare !== null && dayShare >= 40) bits.push(`one day accounts for ${dayShare.toFixed(0)}% of the movement`);
    bits.push("outbound counts when a transfer starts, not when it settles");
    out.push({ id: "value-flow", answer, qualifier: bits.join("; ") + "." });
  }

  // Q4
  {
    const h = q.q4.headline;
    const answer =
      h.current === null
        ? "Not enough priced fee activity to measure concentration."
        : h.pctChange === null || Math.abs(h.pctChange) < 5
          ? `Fee funding is concentrated: the equivalent of ${h.current.toFixed(1)} equally-active payers.`
          : `${h.pctChange > 0 ? "Broadening" : "Narrowing"}: the equivalent of ${h.current.toFixed(1)} equally-active fee payers, ${pctWord(h.pctChange).verb} ${pctWord(h.pctChange).mag}.`;
    const top10 = q.q4.support.top10FeeSharePct;
    out.push({
      id: "base",
      answer,
      qualifier:
        top10 !== null
          ? `The top ten payers cover ${top10.toFixed(0)}% of fees, and a fee grant makes one sponsor look like one payer, so this measures funding and not the size of the user base.`
          : "This measures who funds activity, not how many people are active.",
    });
    void symbolOf;
  }

  return out;
}

export function buildWhatChanged(
  q: QuestionsPayload,
  opts: { symbolOf?: (denom: string) => string; max?: number } = {}
): NarrativeSentence[] {
  const symbolOf = opts.symbolOf ?? ((d: string) => d);
  const max = opts.max ?? 3;
  const n = windowDays(q);
  const prior = n > 0 ? `the prior ${n} day${n === 1 ? "" : "s"}` : "the prior window";
  const out: NarrativeSentence[] = [];

  // Q1
  {
    const h = q.q1.headline;
    if (h.current !== null && (h.current > 0 || (h.previous ?? 0) > 0)) {
      const w = pctWord(h.pctChange);
      const base =
        w.verb === "held"
          ? `Successful txs held at ${fmtInt(h.current)} vs ${prior}`
          : `Successful txs ${w.verb} ${w.mag} vs ${prior} (${fmtInt(h.previous ?? 0)} → ${fmtInt(h.current)})`;
      out.push({ id: "busier", text: `${base}${anomalyClause(q.q1.anomalies)}.`, maxZ: topZ(q.q1.anomalies), absDeltaPct: Math.abs(h.pctChange  ?? 0) });
    }
  }

  // Q2
  {
    const h = q.q2.headline;
    const c = q.q2.counts;
    if (h.current !== null) {
      const total = pctWord(
        c.previous.total > 0 ? ((c.current.total - c.previous.total) / c.previous.total) * 100 : null
      );
      const pts = h.deltaPts;
      const share =
        pts === null || Math.abs(pts) < 0.5
          ? `Organic share held at ${h.current.toFixed(1)}%`
          : `Organic share ${pts > 0 ? "rose" : "fell"} ${Math.abs(pts).toFixed(1)} pts to ${h.current.toFixed(1)}%`;
      const actions =
        total.verb === "held" ? `total wallet actions were flat at ${fmtInt(c.current.total)}` : `total wallet actions ${total.verb} ${total.mag} to ${fmtInt(c.current.total)}`;
      const relPct = h.previous !== null && h.previous > 0 ? ((h.current - h.previous) / h.previous) * 100 : null;
      out.push({ id: "organic", text: `${share} while ${actions}${anomalyClause(q.q2.anomalies)}.`, maxZ: topZ(q.q2.anomalies), absDeltaPct: Math.abs(relPct ?? 0) });
    }
  }

  // Q3
  {
    const h = q.q3.headline;
    if (h.netUsd !== null) {
      const cur = h.netUsd;
      const prev = h.previousNetUsd;
      let shape: string;
      if (prev === null) shape = `Net IBC flow was ${fmtUsd(cur)}`;
      else if (Math.sign(cur) !== Math.sign(prev) && cur !== 0 && prev !== 0)
        shape = `Net IBC flow turned ${cur > 0 ? "positive" : "negative"}: ${fmtUsd(cur)} vs ${fmtUsd(prev)} in ${prior}`;
      else {
        const widened = Math.abs(cur) > Math.abs(prev);
        shape = `Net ${cur >= 0 ? "inflow" : "outflow"} ${widened ? "widened" : "narrowed"} to ${fmtUsd(cur)} (${fmtUsd(prev)} in ${prior})`;
      }
      const lead = q.q3.byAsset.find((a) => a.netUsd !== null && a.netUsd !== 0);
      const led = lead ? `, led by ${symbolOf(lead.denom)} ${lead.netUsd! > 0 ? "inflows" : "outflows"} of ${fmtUsd(Math.abs(lead.netUsd!), false)}` : "";
      const pct = prev !== null && prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : null;
      out.push({ id: "value-flow", text: `${shape}${led}${anomalyClause(q.q3.anomalies)}.`, maxZ: topZ(q.q3.anomalies), absDeltaPct: Math.abs(pct  ?? 0) });
    }
  }

  // Q4
  {
    const h = q.q4.headline;
    const r = q.q4.retention;
    if (h.current !== null) {
      const w = pctWord(h.pctChange);
      const base =
        w.verb === "held"
          ? `The effective number of fee payers held at ${h.current.toFixed(1)}`
          : `The effective number of fee payers ${w.verb} ${w.mag} to ${h.current.toFixed(1)} (${w.verb === "rose" ? "broader" : "more concentrated"} base)`;
      const ret =
        r.current.retainedSharePct !== null
          ? `; ${r.current.retainedSharePct.toFixed(0)}% of active addresses were also active in ${prior}`
          : "";
      out.push({ id: "base", text: `${base}${ret}${anomalyClause(q.q4.anomalies)}.`, maxZ: topZ(q.q4.anomalies), absDeltaPct: Math.abs(h.pctChange  ?? 0) });
    }
  }

  return out.sort((a, b) => b.maxZ - a.maxZ || b.absDeltaPct - a.absDeltaPct).slice(0, max);
}
