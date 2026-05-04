import Image from "next/image";
import { Dashboard } from "@/components/Dashboard";
import { MetricsErrorBoundary } from "@/components/MetricsErrorBoundary";
import { dashboardNavLinks } from "@/lib/dashboardNav";

const NAV_LINK_CLASS =
  "whitespace-nowrap text-[var(--color-text-secondary)] underline-offset-2 transition-colors hover:text-[var(--accent)] hover:underline";

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-10 border-b border-[var(--border)] pb-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
            <Image
              src="/agoric-logo.webp"
              alt=""
              width={40}
              height={40}
              className="mt-0.5 h-10 w-10 shrink-0 object-contain sm:mt-0"
              priority
            />
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold leading-tight tracking-tight text-white">
                Agoric L1 Activity Explorer
              </h1>
              <p className="mt-2 text-sm leading-[1.4] text-[var(--color-text-secondary)]">
                Mainnet <code className="text-[var(--accent)]">agoric-3</code>
              </p>
            </div>
          </div>
          <nav
            className="flex shrink-0 flex-wrap justify-end gap-x-4 gap-y-2 text-sm self-end sm:self-start sm:pt-0.5"
            aria-label="On-page sections"
          >
            {dashboardNavLinks.map(({ id, label }) => (
              <a key={id} href={`#${id}`} className={NAV_LINK_CLASS}>
                {label}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <MetricsErrorBoundary>
        <Dashboard />
      </MetricsErrorBoundary>
    </main>
  );
}
