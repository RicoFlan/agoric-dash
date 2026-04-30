import { Dashboard } from "@/components/Dashboard";
import { MetricsErrorBoundary } from "@/components/MetricsErrorBoundary";

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-10 border-b border-[var(--border)] pb-8">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight text-[var(--color-accent)]">
          Agoric L1 activity
        </h1>
        <p className="mt-2 text-sm leading-[1.4] text-[var(--muted)]">
          Mainnet <code className="text-[var(--accent)]">agoric-3</code>
        </p>
      </header>
      <MetricsErrorBoundary>
        <Dashboard />
      </MetricsErrorBoundary>
    </main>
  );
}
