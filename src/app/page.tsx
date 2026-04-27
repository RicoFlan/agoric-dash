import { Dashboard } from "@/components/Dashboard";

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8 border-b border-[var(--border)] pb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">
          Agoric L1 activity
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Mainnet <code className="text-[var(--accent)]">agoric-3</code>
        </p>
      </header>
      <Dashboard />
    </main>
  );
}
