import { NextRequest, NextResponse } from "next/server";
import { clampMetricsRangeToIndexedHistory, validateMetricsQuery } from "@/lib/metricsApiValidation";
import { enrichParticipationAndConcentration } from "@/lib/enrichParticipationConcentration";
import { enrichMetricsForDisplay } from "@/lib/metricsEnrichment";
import { buildMetricsPayload, type Granularity } from "@/lib/metricsQuery";
import { enrichTransferAndBankCreditsUsdEstimates } from "@/lib/transferVolumeUsdEstimates";
import { enrichOfferValueUsd } from "@/lib/offerValueUsd";
import { allDenoms, denomToCoinIdMap } from "@/lib/denomPrices";
import { loadDailyPriceTable } from "@/lib/loadDailyPriceTable";
import { queryAddressFeeTotalsByDay, queryDistinctUnionPerDay, queryRetentionCounts } from "@/lib/participationQueries";
import { queryProvisioningSnapshots } from "@/lib/provisioningQuery";
import { queryContractLandings } from "@/lib/contractLandingQuery";
import { queryOfferCategoryParticipantsRange } from "@/lib/offersQuery";
import { queryYmaxSnapshot } from "@/lib/ymaxQueries";
import { buildQuestions } from "@/lib/questionsPayload";
import { utcDaysInclusive } from "@/lib/denomPrices";
import { parseUsdEstimateSortKey } from "@/lib/grossTableUsdSort";
import { computeNormalizedRatios, formatNormalizedRatios } from "@/lib/normalizedRatios";
import { SERIES_COVERAGE_FLOORS } from "@/lib/coverageFloors";
import { FEE_DENOM_UBLB, INDEXED_HISTORY_FROM_DAY, SERIES } from "@/lib/semantics";

/** YYYY-MM-DD shifted by `days` (UTC). */
function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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

    /** Day-grain pricing / questions inputs are consumed here and not sent to the client. */
    const { pricingInputs, questionsInputs, ...payloadForResponse } = payload;
    const { contextFromDay, prevFromDay, prevToDay } = questionsInputs;

    /**
     * One price table per request: `denom_price_day` rows for the range plus spot only for ids
     * missing a day. Participation/concentration extends it with any extra denoms it meets.
     */
    const pricedDenoms = new Set<string>();
    for (const m of Object.values(pricingInputs)) for (const d of allDenoms(m)) pricedDenoms.add(d);
    for (const sm of questionsInputs.dailyContext.values()) {
      for (const series of [SERIES.IBC_TRANSFER_AMOUNT_IN, SERIES.IBC_TRANSFER_AMOUNT_OUT]) {
        for (const d of sm.get(series)?.keys() ?? []) pricedDenoms.add(d);
      }
    }
    /** Questions context (prior window + anomaly lookback) is day-grain and needs the same tables over the wider span. */
    const windowDays = utcDaysInclusive(fromDay, toDay).length;
    const prevPrevToDay = shiftDay(prevFromDay, -1);
    const prevPrevFromDay = shiftDay(prevPrevToDay, -(windowDays - 1));
    const [feeByDayContext, distinctUnionPerDay, retentionCur, retentionPrev, catPartCur, catPartPrev, ymax, provisioning, contractLandings] = await Promise.all([
      queryAddressFeeTotalsByDay(contextFromDay, toDay),
      queryDistinctUnionPerDay(contextFromDay, toDay),
      queryRetentionCounts(fromDay, toDay, prevFromDay, prevToDay),
      queryRetentionCounts(prevFromDay, prevToDay, prevPrevFromDay, prevPrevToDay),
      queryOfferCategoryParticipantsRange(fromDay, toDay),
      queryOfferCategoryParticipantsRange(prevFromDay, prevToDay),
      queryYmaxSnapshot(fromDay, toDay),
      queryProvisioningSnapshots(fromDay, toDay),
      queryContractLandings(fromDay, toDay),
    ]);
    for (const byAddr of feeByDayContext.values()) for (const byDenom of byAddr.values()) for (const d of byDenom.keys()) pricedDenoms.add(d);
    for (const v of ymax.byVenue) if (v.denom) pricedDenoms.add(v.denom);
    for (const f of ymax.flowsInRange) if (f.denom) pricedDenoms.add(f.denom);
    for (const sm of questionsInputs.dailyContext.values()) for (const d of sm.get(SERIES.IBC_TRANSFER_AMOUNT_OUT_ORCH)?.keys() ?? []) pricedDenoms.add(d);
    const denomToCoinId = denomToCoinIdMap(pricedDenoms);
    const table = await loadDailyPriceTable(contextFromDay, toDay, denomToCoinId.values());

    const usd = enrichTransferAndBankCreditsUsdEstimates(
      pricingInputs.transferVolumeByDayDenom,
      pricingInputs.bankCreditsByDayDenom,
      display,
      table
    );
    const participationConcentration = await enrichParticipationAndConcentration(fromDay, toDay, display, table, {
      feeByDay: feeByDayContext,
    });

    const questions = buildQuestions({
      fromDay,
      toDay,
      prevFromDay,
      prevToDay,
      contextFromDay,
      dailyContext: questionsInputs.dailyContext,
      curBuckets: questionsInputs.curBuckets,
      display,
      denomToCoinId,
      table,
      distinctUnionPerDay,
      provisioning,
      contractLandings,
      retention: { current: retentionCur, previous: retentionPrev },
      categoryParticipants: { current: catPartCur, previous: catPartPrev },
      ymax,
      feeByDay: feeByDayContext,
      grossUsdHhi: participationConcentration.concentrationRaw.grossUsdHhi,
      top10FeeSharePct:
        participationConcentration.concentrationRaw.topNShareFeesUsd === null
          ? null
          : participationConcentration.concentrationRaw.topNShareFeesUsd * 100,
      multiDayInRange: Number(participationConcentration.participation.multiDayInRange) || 0,
    });

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
      questions,
      indexedHistoryFromDay: INDEXED_HISTORY_FROM_DAY,
      /**
       * Per-series coverage floors. `indexedHistoryFromDay` above is the REPORTING floor and is true
       * only of the Cosmos-level series; everything message-decoded begins months later. Shipping
       * the floors lets a client say which of its zeros are real.
       */
      seriesCoverage: SERIES_COVERAGE_FLOORS,
    });
  } catch (e) {
    return serverErrorResponse(e);
  }
}
