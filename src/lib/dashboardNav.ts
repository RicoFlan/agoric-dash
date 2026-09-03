/**
 * Dashboard section anchors — jump links in `src/app/page.tsx` header use `dashboardNavLinks`
 * (the date-range toolbar keeps id `filters` but is not linked from the header). One anchor per
 * question (docs: "Four Questions"), plus the network-detail drawer and the methodology footer.
 */
export const dashboardSectionIds = {
  filters: "filters",
  busier: "busier",
  organic: "organic",
  valueFlow: "value-flow",
  base: "base",
  methodology: "methodology",
} as const;

export const dashboardNavLinks: ReadonlyArray<{
  id: (typeof dashboardSectionIds)[keyof typeof dashboardSectionIds];
  label: string;
}> = [
  { id: dashboardSectionIds.busier, label: "Busier?" },
  { id: dashboardSectionIds.organic, label: "Organic?" },
  { id: dashboardSectionIds.valueFlow, label: "Value flow?" },
  { id: dashboardSectionIds.base, label: "Base?" },
  { id: dashboardSectionIds.methodology, label: "Methodology" },
];
