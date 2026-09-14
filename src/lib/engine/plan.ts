// ============================================================================
// 72-hour port operations plan generator.
//
// Fuses the three engines (forecast + optimiser + routing) into 12 × 6h shifts
// with per-shift arrivals, berthing operations, crane deployment, congestion
// alerts, routing decisions and a supervisor checklist. Produces structured
// JSON + a human-readable text rendering for shift handover.
// ============================================================================
import { ZONE_LABELS } from "./context";
import type {
  Assignment,
  ForecastResult,
  OpsPlanOutput,
  PlanShift,
  PlanSummary,
  RoutingRec,
  VesselInfo,
} from "./types";

const SHIFT_LEN = 6;
const NUM_SHIFTS = 12; // 72h

function two(n: number) {
  return String(n).padStart(2, "0");
}
function fmtWall(tsIso: string): string {
  const d = new Date(tsIso);
  return `${two(d.getUTCMonth() + 1)}/${two(d.getUTCDate())} ${two(d.getUTCHours())}:00Z`;
}

export interface PlanInput {
  t0: Date;
  vessels: VesselInfo[];
  berths: number; // total berth count for utilisation math
  assignments: Assignment[];
  deferredCount: number;
  forecasts: ForecastResult[]; // one per zone incl. Z-PORT
  routing: RoutingRec[];
}

export function buildPlan(input: PlanInput): OpsPlanOutput {
  const { t0, vessels, berths: berthCount, assignments, forecasts, routing } = input;
  const vesselById = new Map(vessels.map((v) => [v.id, v]));
  const portFc = forecasts.find((f) => f.zoneCode === "Z-PORT")!;

  const shifts: PlanShift[] = [];
  let totalCraneHours = 0;
  let totalMoves = 0;

  for (let s = 0; s < NUM_SHIFTS; s++) {
    const startHour = s * SHIFT_LEN;
    const endHour = startHour + SHIFT_LEN;
    const inWindow = (h: number) => h > startHour && h <= endHour;

    // arrivals: inbound vessels physically arriving in this shift
    const arrivals = vessels
      .filter((v) => v.status === "INBOUND" && inWindow(v.etaHours))
      .map((v) => ({
        vesselName: v.name,
        carrier: v.carrier,
        zoneCode: v.destZoneCode,
        etaHour: +v.etaHours.toFixed(1),
      }))
      .sort((a, b) => a.etaHour - b.etaHour);

    // berthing operations starting in this shift
    const berthings = assignments
      .filter((a) => inWindow(a.startHour))
      .map((a) => ({
        vesselName: a.vesselName,
        berthName: `${a.pier} ${a.berthName}`,
        terminalCode: a.terminalCode,
        startHour: a.startHour,
        cranes: a.cranes,
      }))
      .sort((a, b) => a.startHour - b.startHour);

    // crane deployment: assignments overlapping the shift, cranes prorated
    const craneDeployment: Record<string, number> = {};
    for (const a of assignments) {
      const overlap = Math.max(0, Math.min(a.endHour, endHour) - Math.max(a.startHour, startHour));
      if (overlap <= 0) continue;
      craneDeployment[a.terminalCode] =
        (craneDeployment[a.terminalCode] ?? 0) + a.cranes * (overlap / SHIFT_LEN);
      totalCraneHours += a.cranes * overlap;
      totalMoves += a.moves * (overlap / Math.max(1e-6, a.endHour - a.startHour));
    }
    const craneDeploymentInt = Object.fromEntries(
      Object.entries(craneDeployment).map(([k, v]) => [k, Math.round(v)]),
    );

    // congestion alerts in this shift window
    const congestionAlerts = forecasts
      .map((f) => {
        const seg = f.points.slice(Math.max(0, startHour - 1), endHour);
        const peak = seg.reduce((b, p) => (p.index > b.index ? p : b), seg[0]);
        if (!peak) return null;
        const level = peak.index >= 75 ? "CRIT" : peak.index >= 60 ? "WARN" : peak.index >= 45 ? "WATCH" : null;
        return level
          ? { zoneCode: f.zoneCode, peakIndex: peak.index, peakHour: peak.hour, level: level as "WATCH" | "WARN" | "CRIT" }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.peakIndex - a.peakIndex);

    // routing decisions that must be finalised in this shift
    const routingActions: string[] = [];
    for (const r of routing) {
      const v = vesselById.get(r.vesselId);
      if (!v) continue;
      if (r.option === "HOLD") continue;
      const decideBy = Math.max(1, Math.round(v.etaHours - (r.option === "DIVERT" ? 12 : 4)));
      if (inWindow(decideBy)) {
        routingActions.push(
          r.option === "DIVERT"
            ? `FINALISE by +${two(decideBy)}h: divert ${r.vesselName} → ${r.targetPort} (est. save $${r.estSavingsUsd.toLocaleString()}).`
            : r.option === "SLOW_STEAM"
              ? `ORDER by +${two(decideBy)}h: ${r.vesselName} slow-steam to +${r.etaShiftHrs}h arrival (save $${r.estSavingsUsd.toLocaleString()}).`
              : `GRANT by +${two(decideBy)}h: ${r.vesselName} priority window (${v.reeferUnits} reefers aboard).`,
        );
      }
    }

    // supervisor checklist (dynamic from shift content)
    const checklist: string[] = [];
    if (arrivals.length) checklist.push(`Confirm VTS queue position for ${arrivals.length} arriving vessel(s).`);
    if (berthings.length)
      checklist.push(
        `Line-handlers & tugs booked for ${berthings.length} berthing(s): ${berthings.map((b) => `${b.vesselName} @ ${b.berthName}`).join(", ")}.`,
      );
    const reefers = assignments
      .filter((a) => inWindow(a.startHour) && a.reeferUnits > 200)
      .map((a) => `${a.vesselName} (${a.reeferUnits} plugs)`);
    if (reefers.length) checklist.push(`Stage reefer monitoring for: ${reefers.join(", ")}.`);
    for (const ca of congestionAlerts.slice(0, 2)) {
      checklist.push(
        `Watch ${ZONE_LABELS[ca.zoneCode] ?? ca.zoneCode}: index peak ${ca.peakIndex.toFixed(0)} @ +${ca.peakHour}h — ${ca.level === "CRIT" ? "prep contingency berthing" : "verify crane gangs"}.`,
      );
    }
    if (!checklist.length) checklist.push("No special actions — routine rotation and crane maintenance windows apply.");

    const importH = assignments
      .filter((a) => inWindow(a.startHour))
      .reduce((a, b) => a + vesselById.get(b.vesselId)!.importMoves, 0);
    const yardNote =
      importH > 9000
        ? `Heavy discharge window (~${Math.round(importH / 1000)}k import TEU) — pre-stage yard blocks & extra hostlers.`
        : undefined;

    shifts.push({
      seq: s + 1,
      label: `Shift ${two(s + 1)} · +${startHour}h → +${endHour}h`,
      startHour,
      endHour,
      windowLabel: `${fmtWall(new Date(t0.getTime() + startHour * 3600000))} → ${fmtWall(new Date(t0.getTime() + endHour * 3600000))}`,
      arrivals,
      berthings,
      craneDeployment: craneDeploymentInt,
      congestionAlerts,
      routingActions,
      checklist,
      yardNote,
    });
  }

  const peakPoint = portFc.points.reduce((b, p) => (p.index > b.index ? p : b), portFc.points[0]);
  const peakZoneFc = forecasts
    .filter((f) => f.zoneCode !== "Z-PORT")
    .reduce((b, f) => (f.peak.index > (b?.peak.index ?? -1) ? f : b), forecasts[1] ?? forecasts[0]);
  // occupancy measured inside the 72h window only (work spilling past +72h
  // does not consume berth-hours of the plan window)
  const occupied = assignments.reduce(
    (a, x) => a + Math.max(0, Math.min(x.endHour, NUM_SHIFTS * SHIFT_LEN) - Math.min(x.startHour, NUM_SHIFTS * SHIFT_LEN)),
    0,
  );
  const idleBerthHoursPct = +(
    (1 - occupied / (berthCount * NUM_SHIFTS * SHIFT_LEN)) * 100
  ).toFixed(1);

  const riskLevel: PlanSummary["riskLevel"] =
    peakPoint.index >= 80 ? "SEVERE" : peakPoint.index >= 65 ? "HIGH" : peakPoint.index >= 45 ? "ELEVATED" : "LOW";

  const topActions = shifts
    .flatMap((s) => s.routingActions)
    .slice(0, 3)
    .concat(
      congestionTop(portFc),
    );

  const summary: PlanSummary = {
    generatedAt: new Date().toISOString(),
    horizonHours: 72,
    totalArrivals: shifts.reduce((a, s) => a + s.arrivals.length, 0),
    totalBerthings: shifts.reduce((a, s) => a + s.berthings.length, 0),
    totalMoves: Math.round(totalMoves),
    craneHours: Math.round(totalCraneHours),
    peakIndex: +peakPoint.index.toFixed(1),
    peakZone: peakZoneFc?.zoneCode ?? "Z-PORT",
    riskLevel,
    topActions: topActions.filter(Boolean).slice(0, 4),
    idleBerthHoursPct,
    deferredCount: input.deferredCount,
  };

  return { summary, shifts, text: renderText(summary, shifts) };
}

function congestionTop(portFc: ForecastResult): string {
  return `Monitor port-wide peak index ${portFc.peak.index.toFixed(0)} at +${portFc.peak.hour}h; trigger contingency plan if revised forecast ≥ 80.`;
}

function renderText(summary: PlanSummary, shifts: PlanShift[]): string {
  const L: string[] = [];
  const line = "─".repeat(78);
  L.push(line);
  L.push("SAN PEDRO BAY — 72-HOUR PORT OPERATIONS PLAN");
  L.push(`Generated: ${new Date(summary.generatedAt).toISOString()}   |   Risk: ${summary.riskLevel}`);
  L.push(
    `Arrivals: ${summary.totalArrivals}   Berthings: ${summary.totalBerthings}   Moves: ${summary.totalMoves.toLocaleString()} TEU   Crane-hours: ${summary.craneHours.toLocaleString()}`,
  );
  L.push(`Idle berth-hours: ${summary.idleBerthHoursPct}%   Deferred: ${summary.deferredCount}   Peak index: ${summary.peakIndex} (${summary.peakZone})`);
  L.push(line);
  for (const s of shifts) {
    L.push("");
    L.push(`${s.label}   [${s.windowLabel}]`);
    if (s.arrivals.length)
      L.push(
        `  Arrivals : ${s.arrivals.map((a) => `${a.vesselName.replace("M/V ", "")}→${a.zoneCode.replace("Z-", "")}@+${a.etaHour}h`).join(", ")}`,
      );
    else L.push("  Arrivals : none");
    if (s.berthings.length)
      for (const b of s.berthings)
        L.push(`  Berth    : ${b.vesselName} → ${b.berthName} (${b.terminalCode}) @ +${two(b.startHour)}h w/ ${b.cranes} cranes`);
    if (Object.keys(s.craneDeployment).length)
      L.push(
        `  Cranes   : ${Object.entries(s.craneDeployment).map(([k, v]) => `${k}=${v}`).join("  ")}`,
      );
    for (const a of s.congestionAlerts)
      L.push(`  ALERT    : [${a.level}] ${a.zoneCode} peak ${a.peakIndex.toFixed(0)} @ +${a.peakHour}h`);
    for (const r of s.routingActions) L.push(`  ROUTE    : ${r}`);
    if (s.yardNote) L.push(`  YARD     : ${s.yardNote}`);
    L.push("  Checklist:");
    for (const c of s.checklist) L.push(`    □ ${c}`);
  }
  L.push("");
  L.push(line);
  L.push("Sources: congestion forecast = schedule-aware ridge model; assignments = berth/crane optimiser;");
  L.push("routing = rule recommender. Terminal capacity: Port of Long Beach fact sheets (real).");
  return L.join("\n");
}
