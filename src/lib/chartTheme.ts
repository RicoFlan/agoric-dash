/**
 * Chart colors aligned with docs/style-guide.md (dark theme, teal accent).
 * Recharts does not read CSS variables in all props; keep hex in sync with :root there.
 */

export const chartTheme = {
  /** Aligned to docs/style-guide.md & globals.css :root */
  grid: "#232C38",
  axisTick: "#AAB6C4",
  axisLabelMuted: "#6B7785",
  tooltipBg: "#161D26",
  tooltipBorder: "#232C38",
  tooltipMuted: "#AAB6C4",
  tooltipText: "#E6EDF3",
  /** Series strokes — distinguishable without neon; first follows accent */
  lineA: "#2ED3B7",
  lineB: "#5BA8E8",
  lineC: "#9B8FD9",
  lineD: "#E0565B",
  lineE: "#F5A623",
  barPrimary: "#2ED3B7",
  /** Linear OLS trend overlays (dashed, slightly thinner than primary series). */
  trendLineProps: {
    strokeDasharray: "5 5",
    strokeWidth: 1.5,
  },
} as const;
