"use client";

import type { UsdPricingMeta } from "@/lib/denomPrices";

/**
 * One-sentence statement of what basis a USD figure has: day rows, spot fallback for some days, or
 * spot only (table absent / not yet backfilled). Rendered inline after the USD explanation.
 */
export function UsdBasisNote({ meta }: { meta: UsdPricingMeta }) {
  const parts: string[] = [];
  if (meta.basis === "daily-close") {
    parts.push(`All ${meta.pricedDays.toLocaleString()} priced denom-days used stored daily prices.`);
  } else if (meta.basis === "mixed") {
    parts.push(
      `${meta.pricedDays.toLocaleString()} denom-days used stored daily prices; ${meta.spotFallbackDays.toLocaleString()} (usually today) used current spot.`
    );
  } else if (meta.basis === "spot-fallback") {
    parts.push(
      `No stored daily prices for this range — ${meta.spotFallbackDays.toLocaleString()} denom-days used current spot (run the price backfill).`
    );
  } else {
    parts.push("No USD prices were available for this range.");
  }
  if (meta.unpricedDays > 0) parts.push(`${meta.unpricedDays.toLocaleString()} mapped denom-days had no price and are excluded.`);
  if (meta.partialOrStale) parts.push("The spot feed was unavailable or rate-limited, so some fallback cells may be empty.");
  return (
    <span>
      {" "}
      {parts.join(" ")}
      {meta.spotFetchedAt && (
        <>
          {" "}
          Spot fetched{" "}
          <time dateTime={meta.spotFetchedAt}>{new Date(meta.spotFetchedAt).toLocaleString()}</time>.
        </>
      )}
    </span>
  );
}
