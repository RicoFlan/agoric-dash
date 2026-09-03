import type { Metadata } from "next";
import Link from "next/link";
import { DEFINITIONS } from "@/lib/definitions";
import { METHODOLOGY_SECTIONS } from "@/lib/semantics";

export const metadata: Metadata = {
  title: "Methodology — Agoric L1 Activity Explorer",
  description: "How every figure on the dashboard is made: sources, counting rules, and caveats.",
};

function anchorId(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * The full methodology as a standalone, linkable page. The dashboard keeps one-line definitions in
 * ⓘ popovers and links here for the long form; the text itself stays in METHODOLOGY_SECTIONS so the
 * two surfaces cannot drift.
 */
export default function MethodologyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-8 border-b border-[var(--border)] pb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
          Agoric L1 Activity Explorer
        </p>
        <h1 className="mt-1 text-2xl font-semibold leading-tight tracking-tight text-white">Methodology &amp; caveats</h1>
        <p className="mt-2 text-sm leading-[1.4] text-[var(--color-text-secondary)]">
          How every figure on the dashboard is made — sources, counting rules, and what the numbers are not.{" "}
          <Link href="/" className="text-[var(--accent)] underline-offset-2 hover:underline">
            Back to the dashboard
          </Link>
        </p>
      </header>

      <nav aria-label="Sections" className="mb-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">Contents</p>
        <ol className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <li>
            <a href="#definitions" className="text-[var(--color-text-secondary)] hover:text-[var(--accent)] hover:underline">
              Indicator definitions
            </a>
          </li>
          {METHODOLOGY_SECTIONS.map((s) => (
            <li key={s.title}>
              <a href={`#${anchorId(s.title)}`} className="text-[var(--color-text-secondary)] hover:text-[var(--accent)] hover:underline">
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <section id="definitions" className="mb-10 scroll-mt-6">
        <h2 className="border-l-2 border-[var(--color-accent)] pl-3 text-xl font-semibold leading-tight tracking-tight text-[var(--color-accent)]">
          Indicator definitions
        </h2>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          The one-line definitions shown in the ⓘ hints on each headline and support figure.
        </p>
        <dl className="mt-4 space-y-3">
          {Object.entries(DEFINITIONS).map(([id, text]) => (
            <div key={id} id={`def-${id}`} className="scroll-mt-6 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
              <dt className="font-mono text-xs text-[var(--accent)]">{id}</dt>
              <dd className="mt-1 text-sm leading-snug text-[var(--color-text-primary)]">{text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="space-y-8">
        {METHODOLOGY_SECTIONS.map((s) => (
          <section key={s.title} id={anchorId(s.title)} className="scroll-mt-6">
            <h2 className="border-l-2 border-[var(--color-accent)] pl-3 text-xl font-semibold leading-tight tracking-tight text-[var(--color-accent)]">
              {s.title}
            </h2>
            <p className="mt-3 text-sm leading-[1.55] text-[var(--color-text-secondary)]">{s.body}</p>
          </section>
        ))}
      </div>
    </main>
  );
}
