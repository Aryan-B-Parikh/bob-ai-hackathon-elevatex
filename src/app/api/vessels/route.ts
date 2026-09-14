import { NextResponse } from "next/server";
import { getEngineContext } from "@/lib/engine/context";
import { getOptimiserRunOrRun } from "@/lib/engine/snapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await getEngineContext();
    const run = await getOptimiserRunOrRun(ctx);
    const assigned = new Set((run?.assignments ?? []).map((a) => a.vesselId));

    return NextResponse.json({
      t0: ctx.t0,
      vessels: ctx.vessels
        .map((v) => {
          const a = run?.assignments.find((x) => x.vesselId === v.id);
          return {
            ...v,
            assignedBerth: a ? `${a.pier} ${a.berthName}` : null,
            assignedTerminal: a?.terminalCode ?? null,
            startHour: a?.startHour ?? null,
            waitHours: a?.waitHours ?? null,
            cranes: a?.cranes ?? null,
            inPlan: assigned.has(v.id),
          };
        })
        .sort(
          (a, b) =>
            b.anchoredHours - a.anchoredHours || a.etaHours - b.etaHours,
        ),
      terminals: ctx.terminals,
    });
  } catch (e) {
    console.error("[api/vessels]", e);
    return NextResponse.json({ error: "Failed to load vessels" }, { status: 500 });
  }
}
