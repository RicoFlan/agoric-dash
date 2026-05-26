import type { MethodologySection } from "@/lib/semantics";

const METHODOLOGY_TITLE_CLASS =
  "text-sm font-bold leading-snug tracking-tight text-[var(--color-text-primary)]";

const METHODOLOGY_BODY_CLASS = "text-sm leading-relaxed text-[var(--color-text-secondary)]";

export function MethodologyPanel({ sections }: { sections: readonly MethodologySection[] }) {
  return (
    <div
      className="mt-4 space-y-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6"
      role="region"
      aria-label="Methodology and caveats"
    >
      {sections.map((section) => (
        <section key={section.title} className="space-y-2">
          <h3 className={METHODOLOGY_TITLE_CLASS}>{section.title}</h3>
          <p className={METHODOLOGY_BODY_CLASS}>{section.body}</p>
        </section>
      ))}
    </div>
  );
}
