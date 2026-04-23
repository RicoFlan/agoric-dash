import { NextRequest, NextResponse } from "next/server";
import { buildMetricsPayload, type Granularity } from "@/lib/metricsQuery";

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

  const granularity: Granularity = g === "week" ? "week" : "day";

  try {
    const payload = await buildMetricsPayload(from, to, granularity);
    return NextResponse.json(payload);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "metrics failed" },
      { status: 500 }
    );
  }
}
