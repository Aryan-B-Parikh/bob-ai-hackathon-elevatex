import { NextResponse } from "next/server";
import { getEngineContext } from "@/lib/engine/context";
import { runForecasts, runOptimiser, runRouting } from "@/lib/engine/pipeline";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await getEngineContext();
    const forecasts = await runForecasts(ctx);
    const opt = runOptimiser(ctx, forecasts);
    const recs = runRouting(ctx, forecasts, opt);
    return NextResponse.json({
      recommendations: recs,
      summary: {
        divert: recs.filter((r) => r.option === "DIVERT").length,
        slowSteam: recs.filter((r) => r.option === "SLOW_STEAM").length,
        priority: recs.filter((r) => r.option === "PRIORITY_WINDOW").length,
        hold: recs.filter((r) => r.option === "HOLD").length,
        totalSavingsUsd: recs
          .filter((r) => r.option !== "HOLD")
          .reduce((a, r) => a + r.estSavingsUsd, 0),
      },
    });
  } catch (e) {
    console.error("[api/routing]", e);
    return NextResponse.json({ error: "Routing failed" }, { status: 500 });
  }
}
