import { NextResponse } from "next/server";
import { getIndexerStatus } from "@/lib/metricsQuery";

export async function GET() {
  try {
    const indexer = await getIndexerStatus();
    return NextResponse.json({
      chainId: "agoric-3",
      ...indexer,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "status failed" },
      { status: 500 }
    );
  }
}
