import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEngineContext } from "@/lib/engine/context";
import { runForecasts, runOptimiser } from "@/lib/engine/pipeline";

export const dynamic = "force-dynamic";

// GET /api/optimise → latest stored run (or null)
export async function GET() {
  try {
    const run = await db.optimiserRun.findFirst({ orderBy: { createdAt: "desc" } });
    if (!run) return NextResponse.json({ run: null });
    return NextResponse.json({
      run: {
        runId: run.id,
        createdAt: run.createdAt,
        assignments: JSON.parse(run.assignmentsJson),
        metrics: JSON.parse(run.metricsJson),
        baseline: JSON.parse(run.baselineJson),
        deltas: JSON.parse(run.deltasJson),
        deferred: JSON.parse(run.deferredJson),
        params: JSON.parse(run.paramsJson),
      },
    });
  } catch (e) {
    console.error("[api/optimise GET]", e);
    return NextResponse.json({ error: "Failed to load run" }, { status: 500 });
  }
}

// POST /api/optimise → run the optimiser now and persist the result.
// Optional JSON body = what-if scenario: { craneFactor?: 0.5..1, moveRatePerCraneHour?: 20..35 }
export async function POST(req: NextRequest) {
  try {
    let scenario: { craneFactor?: number; moveRatePerCraneHour?: number } = {};
    try {
      const body = await req.json();
      if (body && typeof body === "object") {
        if (typeof body.craneFactor === "number") scenario.craneFactor = body.craneFactor;
        if (typeof body.moveRatePerCraneHour === "number") scenario.moveRatePerCraneHour = body.moveRatePerCraneHour;
      }
    } catch {
      // no/!json body → base scenario
    }
    const ctx = await getEngineContext(true);
    const forecasts = await runForecasts(ctx);
    const out = runOptimiser(ctx, forecasts, {}, scenario);

    await db.optimiserRun.create({
      data: {
        paramsJson: JSON.stringify(out.params),
        assignmentsJson: JSON.stringify(out.assignments),
        metricsJson: JSON.stringify(out.metrics),
        baselineJson: JSON.stringify(out.baseline),
        deltasJson: JSON.stringify(out.deltas),
        deferredJson: JSON.stringify(out.deferred),
      },
    });

    return NextResponse.json({ run: out });
  } catch (e) {
    console.error("[api/optimise POST]", e);
    return NextResponse.json({ error: "Optimisation failed" }, { status: 500 });
  }
}
