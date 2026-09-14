import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEngineContext } from "@/lib/engine/context";
import {
  buildOpsPlanOutput,
  runForecasts,
  runOptimiser,
  runRouting,
} from "@/lib/engine/pipeline";

export const dynamic = "force-dynamic";

// GET /api/plan            → latest stored plan (JSON)
// GET /api/plan?text=1     → latest stored plan, human-readable text body
export async function GET(req: NextRequest) {
  try {
    const asText = req.nextUrl.searchParams.get("text") === "1";
    const plan = await db.opsPlan.findFirst({ orderBy: { createdAt: "desc" } });
    if (!plan) return NextResponse.json({ plan: null }, { status: 404 });
    if (asText) {
      return new NextResponse(plan.textPlan, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return NextResponse.json({
      plan: {
        id: plan.id,
        createdAt: plan.createdAt,
        horizonHours: plan.horizonHours,
        summary: JSON.parse(plan.summaryJson),
        shifts: JSON.parse(plan.shiftsJson),
        text: plan.textPlan,
      },
    });
  } catch (e) {
    console.error("[api/plan GET]", e);
    return NextResponse.json({ error: "Failed to load plan" }, { status: 500 });
  }
}

// POST /api/plan → regenerate the full pipeline and persist a fresh plan
export async function POST() {
  try {
    const ctx = await getEngineContext(true);
    const forecasts = await runForecasts(ctx);
    const opt = runOptimiser(ctx, forecasts);
    const routing = runRouting(ctx, forecasts, opt);
    const plan = buildOpsPlanOutput(ctx, forecasts, opt, routing);

    const saved = await db.opsPlan.create({
      data: {
        horizonHours: 72,
        summaryJson: JSON.stringify(plan.summary),
        shiftsJson: JSON.stringify(plan.shifts),
        textPlan: plan.text,
      },
    });

    return NextResponse.json({
      plan: { id: saved.id, createdAt: saved.createdAt, ...plan },
    });
  } catch (e) {
    console.error("[api/plan POST]", e);
    return NextResponse.json({ error: "Plan generation failed" }, { status: 500 });
  }
}
