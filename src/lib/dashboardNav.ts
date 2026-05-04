/**
 * Dashboard section anchors — jump links in `src/app/page.tsx` header use `dashboardNavLinks`
 * (the date-range toolbar keeps id `filters` but is not linked from the header).
 */
export const dashboardSectionIds = {
  filters: "filters",
  valueHandled: "value-handled",
  gasFees: "gas-and-fees",
  transactionActivity: "transaction-activity",
  volumeIbc: "volume-ibc",
  participation: "participation",
  methodology: "methodology",
} as const;

export const dashboardNavLinks: ReadonlyArray<{
  id: (typeof dashboardSectionIds)[keyof typeof dashboardSectionIds];
  label: string;
}> = [
  { id: dashboardSectionIds.valueHandled, label: "Value handled" },
  { id: dashboardSectionIds.gasFees, label: "Gas & fees" },
  { id: dashboardSectionIds.transactionActivity, label: "Transactions" },
  { id: dashboardSectionIds.volumeIbc, label: "Volume & IBC" },
  { id: dashboardSectionIds.participation, label: "Participation" },
  { id: dashboardSectionIds.methodology, label: "Methodology" },
];
