/**
 * Folds the payload's per-category offer trend into automated / interactive / unknown rows per
 * bucket, for the Offers activity chart. The automated-vs-interactive grouping is the read-time
 * relabel of offer_category (offerCategory.ts), so it can be refined without reindexing.
 */
import { categoryAutomation, type OfferCategory } from "@/lib/offerCategory";

export interface CategoryTrend {
  category: string;
  data: { bucket: string; value: string }[];
}

export interface OffersActivityRow {
  bucket: string;
  automated: number;
  interactive: number;
  unknown: number;
}

export function buildOffersActivityRows(categoriesOverTime: CategoryTrend[]): OffersActivityRow[] {
  const byBucket = new Map<string, OffersActivityRow>();
  const row = (bucket: string): OffersActivityRow => {
    let r = byBucket.get(bucket);
    if (!r) {
      r = { bucket, automated: 0, interactive: 0, unknown: 0 };
      byBucket.set(bucket, r);
    }
    return r;
  };

  for (const trend of categoriesOverTime) {
    const cls = categoryAutomation(trend.category as OfferCategory);
    for (const point of trend.data) {
      const n = Number(point.value);
      if (!Number.isFinite(n) || n === 0) {
        row(point.bucket); // still register the bucket so the axis stays dense
        continue;
      }
      row(point.bucket)[cls] += n;
    }
  }

  return [...byBucket.values()].sort((a, b) => (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0));
}
