import { NextRequest, NextResponse } from "next/server";
import { clampMetricsRangeToIndexedHistory, validateMetricsQuery } from "@/lib/metricsApiValidation";
import { enrichParticipationAndConcentration } from "@/lib/enrichParticipationConcentration";
import { enrichMetricsForDisplay } from "@/lib/metricsEnrichment";
import { buildMetricsPayload, type Granularity } from "@/lib/metricsQuery";
import { enrichTransferAndBankCreditsUsdEstimates } from "@/lib/transferVolumeUsdEstimates";
import { enrichOfferValueUsd } from "@/lib/offerValueUsd";
import { allDenoms, denomToCoinIdMap } from "@/lib/denomPrices";
import { loadDailyPriceTable } from "@/lib/loadDailyPriceTable";
import { parseUsdEstimateSortKey } from "@/lib/grossTableUsdSort";
import { computeNormalizedRatios, formatNormalizedRatios } from "@/lib/normalizedRatios";
import { FEE_DENOM_UBLB, INDEXED_HISTORY_FROM_DAY } from "@/lib/semantics";

/** Parse a numeric-string kpi value to bigint, tolerating "" / non-numeric (→ 0). */
function bigintOrZero(s: string | undefined | null): bigint {
  if (typeof s !== "string" || !/^\d+$/.test(s)) return BigInt(0);
  return BigInt(s);
}

export const dynamic = "force-dynamic";

function serverErrorResponse(e: unknown) {
  console.error("[api/metrics]", e);
  const generic = "Metrics could not be loaded. Try again later.";
  const body =
    process.env.NODE_ENV === "production"
      ? { error: generic }
      : {
          error: e instanceof Error ? e.message : generic,
        };
  return NextResponse.json(body, { status: 500 });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const g = searchParams.get("granularity") ?? "day";

  if (!from || !to) {
    return NextResponse.json(
      { error: "Query params `from` and `to` (YYYY-MM-DD) are required." },
      { status: 400 }
    );
  }

  const granularity: Granularity =
    g === "week" ? "week" : g === "hour" ? "hour" : "day";

  const invalid = validateMetricsQuery(from, to, granularity);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }

  const { from: qFrom, to: qTo } = clampMetricsRangeToIndexedHistory(from, to);

  try {
    const payload = await buildMetricsPayload(qFrom, qTo, granularity);
    const display = enrichMetricsForDisplay(payload);
    const fromDay = qFrom.slice(0, 10);
    const toDay = qTo.slice(0, 10);

    /** Day-grain pricing inputs are consumed here and not sent to the client. */
    const { pricingInputs, ...payloadForResponse } = payload;

    /**
     * One price table per request: `denom_price_day` rows for the range plus spot only for ids
     * missing a day. Participation/concentration extends it with any extra denoms it meets.
     */
    const pricedDenoms = new Set<string>();
    for (const m of Object.values(pricingInputs)) for (const d of allDenoms(m)) pricedDenoms.add(d);
    const table = await loadDailyPriceTable(fromDay, toDay, denomToCoinIdMap(pricedDenoms).values());

    const usd = enrichTransferAndBankCreditsUsdEstimates(
      pricingInputs.transferVolumeByDayDenom,
      pricingInputs.bankCreditsByDayDenom,
      display,
      table
    );
    const participationConcentration = await enrichParticipationAndConcentration(fromDay, toDay, display, table);

    const offerValueUsd = payload.offers
      ? enrichOfferValueUsd(
          pricingInputs.offerGiveByDayDenom,
          pricingInputs.offerWantByDayDenom,
          pricingInputs.offerPayoutByDayDenom,
          display,
          table
        )
      : null;

    const grossUsdTotalNum = parseUsdEstimateSortKey(usd.transferVolumeUsdTotal ?? null);
    const normalizedRatios = formatNormalizedRatios(
      computeNormalizedRatios({
        gasUsed: bigintOrZero(payload.kpis.gasUsed.current),
        successfulTxs: bigintOrZero(payload.kpis.txSuccess.current),
        failedTxs: bigintOrZero(payload.kpis.txFailed.current),
        feeUbld: bigintOrZero(payload.kpis.feePaidUbld.current),
        feeDenomDecimals: display.metas[FEE_DENOM_UBLB]?.decimals ?? 6,
        activeAddresses: Number(participationConcentration.participation.distinctSigners) || 0,
        grossUsdTotal: Number.isFinite(grossUsdTotalNum) ? grossUsdTotalNum : null,
      })
    );

    return NextResponse.json({
      ...payloadForResponse,
      display,
      ...usd,
      ...participationConcentration,
      offerValueUsd,
      normalizedRatios,
      indexedHistoryFromDay: INDEXED_HISTORY_FROM_DAY,
    });
  } catch (e) {
    return serverErrorResponse(e);
  }
}
