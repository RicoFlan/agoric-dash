/** Shown while a lazy-loaded chart chunk downloads (dev) or hydrates. */
export function ChartChunkFallback({
  title,
  className,
}: {
  title?: string;
  /** Optional Tailwind height/layout overrides (e.g. `h-80`). */
  className?: string;
}) {
  return (
    <div
      className={`flex w-full animate-pulse items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] ${className ?? "h-72"}`}
    >
      <p className="text-sm text-[var(--muted)]">{title ? `Loading ${title}…` : "Loading chart…"}</p>
    </div>
  );
}
