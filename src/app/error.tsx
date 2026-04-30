"use client";

/**
 * App Router segment error boundary — catches render errors in `page` and below (not root layout).
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const detail =
    process.env.NODE_ENV === "development" ? error.message : "Something unexpected occurred.";

  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="text-xl font-semibold leading-tight text-[var(--color-text-primary)]">
        This page failed to load
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">{detail}</p>
      {error.digest && (
        <p className="mt-2 font-mono text-xs text-[var(--muted)]">Ref: {error.digest}</p>
      )}
      <button
        type="button"
        onClick={() => reset()}
        className="mt-6 rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-on)] hover:bg-[var(--color-accent-hover)]"
      >
        Try again
      </button>
    </main>
  );
}
