import { NextRequest, NextResponse } from "next/server";
import { and, gte, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { dailyMetrics, hourlyMetrics } from "@/db/schema";
import { toCsv, exportFilename } from "@/lib/csv";
import { clampMetricsRangeToIndexedHistory, validateMetricsQuery } from "@/lib/metricsApiValidation";
import type { Granularity } from "@/lib/metricsQuery";

export const dynamic = "force-dynamic";

/**
 * Download the numbers behind the current view.
 *
 * This exports the stored metric rows in long form (bucket, series, dimension, value) rather than
 * the shaped dashboard payload, for two reasons. The rows are the source the charts are drawn from,
 * so an export can be reconciled against the page. And values stay exact strings: chain amounts run
 * to 78 digits, which no spreadsheet column and no JSON number would survive intact.
 *
 * A week view exports the day rows it aggregates, because there is no stored week grain to export;
 * the response says so in `grain`, and the CSV filename keeps the requested granularity.
 */
const EXPORT_HEADER = ["bucket", "series", "dimension", "value"] as const;

type ExportRow = { bucket: string; series: string; dimension: string; value: string };

function sortRows(rows: ExportRow[]): ExportRow[] {
  return rows.sort(
    (a, b) =>
      a.bucket.localeCompare(b.bucket) || a.series.localeCompare(b.series) || a.dimension.localeCompare(b.dimension)
  );
}

async function readRows(from: string, to: string, granularity: Granularity): Promise<{ rows: ExportRow[]; grain: "hour" | "day" }> {
  if (granularity === "hour") {
    const fromStart = new Date(`${from}T00:00:00.000Z`);
    const toEnd = new Date(`${to}T23:59:59.999Z`);
    const rows = await db
      .select()
      .from(hourlyMetrics)
      .where(and(gte(hourlyMetrics.hour, fromStart), lte(hourlyMetrics.hour, toEnd)));
    return {
      grain: "hour",
      rows: sortRows(
        rows.map((r) => ({ bucket: r.hour.toISOString(), series: r.series, dimension: r.dimension, value: r.value }))
      ),
    };
  }
  const rows = await db
    .select()
    .from(dailyMetrics)
    .where(and(gte(dailyMetrics.day, from), lte(dailyMetrics.day, to)));
  return {
    grain: "day",
    rows: sortRows(rows.map((r) => ({ bucket: r.day, series: r.series, dimension: r.dimension, value: r.value }))),
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rawFrom = searchParams.get("from");
  const rawTo = searchParams.get("to");
  const g = searchParams.get("granularity") ?? "day";
  const format = searchParams.get("format") === "json" ? "json" : "csv";

  if (!rawFrom || !rawTo) {
    return NextResponse.json({ error: "Query params `from` and `to` (YYYY-MM-DD) are required." }, { status: 400 });
  }
  const granularity: Granularity = g === "week" ? "week" : g === "hour" ? "hour" : "day";
  const invalid = validateMetricsQuery(rawFrom, rawTo, granularity);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const { from, to } = clampMetricsRangeToIndexedHistory(rawFrom, rawTo);

  try {
    const { rows, grain } = await readRows(from, to, granularity);
    const filename = exportFilename(from, to, granularity, format === "json" ? "json" : "csv");
    const disposition = `attachment; filename="${filename}"`;

    if (format === "json") {
      return NextResponse.json(
        { range: { from, to }, granularity, grain, generatedAt: new Date().toISOString(), rowCount: rows.length, rows },
        { headers: { "Content-Disposition": disposition, "Cache-Control": "no-store" } }
      );
    }
    const csv = toCsv([...EXPORT_HEADER], rows.map((r) => [r.bucket, r.series, r.dimension, r.value]));
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": disposition,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[api/export]", e);
    const generic = "Export could not be generated. Try again later.";
    return NextResponse.json(
      { error: process.env.NODE_ENV === "production" ? generic : e instanceof Error ? e.message : generic },
      { status: 500 }
    );
  }
}
