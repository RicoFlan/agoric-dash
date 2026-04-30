import { NextResponse } from "next/server";
import { getIndexerStatus } from "@/lib/metricsQuery";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const indexer = await getIndexerStatus();
    return NextResponse.json({
      chainId: "agoric-3",
      ...indexer,
    });
  } catch (e) {
    console.error("[api/status]", e);
    const generic = "Status could not be loaded. Try again later.";
    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === "production" ? generic : e instanceof Error ? e.message : generic,
      },
      { status: 500 }
    );
  }
}
