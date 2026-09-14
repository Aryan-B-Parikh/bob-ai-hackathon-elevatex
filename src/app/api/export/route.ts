import { NextRequest, NextResponse } from "next/server";
import { getEngineContext } from "@/lib/engine/context";
import { runForecasts, runOptimiser, runRouting } from "@/lib/engine/pipeline";
import { getOptimiserRunOrRun } from "@/lib/engine/snapshot";

export const dynamic = "force-dynamic";

function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const s = String(c);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");
}

// GET /api/export?type=assignments|routing|vessels|forecast → CSV download
export async function GET(req: NextRequest) {
  try {
    const type = req.nextUrl.searchParams.get("type") ?? "assignments";
    const ctx = await getEngineContext();

    let csv: string;
    let filename: string;

    if (type === "assignments") {
      const run = await getOptimiserRunOrRun(ctx);
      csv = toCsv([
        ["vessel", "carrier", "class", "loa_ft", "moves_teu", "reefer", "terminal", "pier", "berth", "start_h", "end_h", "cranes", "wait_h"],
        ...(run?.assignments ?? []).map((a) => [
          a.vesselName, a.carrier, a.vesselClass, a.loaFt, a.moves, a.reeferUnits,
          a.terminalCode, a.pier, a.berthName, a.startHour, a.endHour, a.cranes, a.waitHours,
        ]),
        [],
        ["deferred_vessel", "reason"],
        ...(run?.deferred ?? []).map((d) => [d.vesselName, d.reason]),
      ]);
      filename = "berth-assignments.csv";
    } else if (type === "routing") {
      const forecasts = await runForecasts(ctx);
      const opt = runOptimiser(ctx, forecasts);
      const recs = runRouting(ctx, forecasts, opt);
      csv = toCsv([
        ["vessel", "carrier", "class", "status", "dest_zone", "option", "target_port", "predicted_wait_h", "eta_shift_h", "est_savings_usd", "confidence", "rationale"],
        ...recs.map((r) => [
          r.vesselName, r.carrier, r.vesselClass, r.status, r.destZoneCode, r.option,
          r.targetPort ?? "", r.predictedWaitHrs, r.etaShiftHrs, r.estSavingsUsd, r.confidence, r.rationale,
        ]),
      ]);
      filename = "routing-recommendations.csv";
    } else if (type === "vessels") {
      csv = toCsv([
        ["mmsi", "vessel", "carrier", "class", "loa_ft", "beam_ft", "draft_ft", "teu_capacity", "import_moves", "export_moves", "reefer", "origin", "status", "anchorage", "anchored_h", "eta_h", "dest_zone"],
        ...ctx.vessels.map((v) => [
          v.mmsi, v.name, v.carrier, v.vesselClass, v.loaFt, v.beamFt, v.draftFt, v.teuCapacity,
          v.importMoves, v.exportMoves, v.reeferUnits, v.originPort, v.status, v.anchorageZone,
          v.anchoredHours, v.etaHours, v.destZoneCode,
        ]),
      ]);
      filename = "vessel-queue.csv";
    } else if (type === "forecast") {
      const forecasts = await runForecasts(ctx);
      const rows: (string | number)[][] = [["zone", "hour_ahead", "ts", "index", "queue", "wait_h", "band_lo", "band_hi"]];
      for (const f of Object.values(forecasts)) {
        for (const p of f.points) {
          rows.push([f.zoneCode, p.hour, p.ts, p.index, p.queue, p.wait, p.lo, p.hi]);
        }
      }
      csv = toCsv(rows);
      filename = "congestion-forecast-72h.csv";
    } else {
      return NextResponse.json({ error: "unknown export type" }, { status: 400 });
    }

    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    console.error("[api/export]", e);
    return NextResponse.json({ error: "export failed" }, { status: 500 });
  }
}
