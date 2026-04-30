"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Catches Recharts / render failures so one bad chart domain doesn’t white-screen the whole page.
 * Resettable so users can recover without a full reload when possible.
 */
export class MetricsErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Dashboard render error:", error.message, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className="rounded-lg border p-6"
          style={{
            borderColor: "color-mix(in srgb, var(--color-error) 40%, var(--border))",
            background: "var(--surface)",
          }}
        >
          <h2 className="text-lg font-medium text-[var(--color-text-primary)]">Display error</h2>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            The dashboard hit a rendering error (often chart data edge cases). You can retry; if it
            persists, hard-refresh the page or run <code className="text-[var(--accent)]">npm run dev:clean</code>.
          </p>
          <p className="mt-2 font-mono text-xs text-[var(--muted)]">{this.state.error.message}</p>
          <button
            type="button"
            className="mt-4 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-on)] hover:bg-[var(--color-accent-hover)]"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
