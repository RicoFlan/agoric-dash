import { NextRequest, NextResponse } from "next/server";
import { validateMetricsQuery } from "@/lib/metricsApiValidation";
import { enrichMetricsForDisplay } from "@/lib/metricsEnrichment";
import { buildMetricsPayload, type Granularity } from "@/lib/metricsQuery";

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

  try {
    const payload = await buildMetricsPayload(from, to, granularity);
    const display = enrichMetricsForDisplay(payload);
    return NextResponse.json({ ...payload, display });
  } catch (e) {
    return serverErrorResponse(e);
  }
}
