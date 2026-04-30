/**
 * Chart colors aligned with docs/style-guide.md (dark theme, teal accent).
 * Recharts does not read CSS variables in all props; keep hex in sync with :root there.
 */

export const chartTheme = {
  grid: "#2A3648",
  axisTick: "#C8D2DE",
  axisLabelMuted: "#94A1B2",
  tooltipBg: "#1E2B3C",
  tooltipBorder: "#2A3648",
  tooltipMuted: "#C8D2DE",
  tooltipText: "#F2F6FA",
  /** Series strokes — distinguishable without neon; first follows accent */
  lineA: "#2ED3B7",
  lineB: "#5BA8E8",
  lineC: "#9B8FD9",
  lineD: "#E0565B",
  lineE: "#F5A623",
  barPrimary: "#2ED3B7",
} as const;
