// ============================================================================
// Alternate routing recommendation engine (rule-based, documented cost model).
//
// Decides per vessel between: DIVERT / SLOW_STEAM / PRIORITY_WINDOW / HOLD,
// using the congestion forecast at the vessel's destination zone + published
// operating-cost assumptions (all constants cited in docs/solution-overview.md).
// ============================================================================
import type { RoutingRec, VesselInfo } from "./types";

// Documented assumption: daily operating cost (fuel + ops) for a mid/large
// container ship. Public industry estimates range ~$25k–$45k/day; we use $32k.
const DAILY_OP_COST_USD = 32_000;
const REEFER_CONTENT_VALUE_USD = 180; // expected spoilage-risk per reefer unit per event

interface AltPort {
  name: string;
  distanceNm: number;
  transitHrsAt15kn: number;
  // rule-based availability for redirected capacity (demo constant, documented)
  availability: "high" | "medium" | "low";
  maxLoaFt: number;
}

const ALT_PORTS: AltPort[] = [
  { name: "Port of Oakland", distanceNm: 500, transitHrsAt15kn: 33, availability: "medium", maxLoaFt: 1320 },
  { name: "Seattle-Tacoma (NW Seaport)", distanceNm: 1180, transitHrsAt15kn: 79, availability: "low", maxLoaFt: 1320 },
  { name: "Prince Rupert (Fairview)", distanceNm: 1260, transitHrsAt15kn: 84, availability: "low", maxLoaFt: 1300 },
  { name: "Ensenada (ECT)", distanceNm: 150, transitHrsAt15kn: 10, availability: "high", maxLoaFt: 1000 },
];

const availabilityBufferHrs: Record<AltPort["availability"], number> = {
  high: 6,
  medium: 18,
  low: 36,
};

export interface RoutingInput {
  vessels: VesselInfo[];
  // predicted avg anchorage wait (hours) at the vessel's destination zone
  // over the window in which the vessel would be worked
  predictedWaitFor: (v: VesselInfo) => number;
}

export function recommendRouting(input: RoutingInput): RoutingRec[] {
  const recs: RoutingRec[] = [];

  for (const v of input.vessels) {
    const wait = input.predictedWaitFor(v);
    const base = {
      vesselId: v.id,
      vesselName: v.name,
      carrier: v.carrier,
      vesselClass: v.vesselClass,
      destZoneCode: v.destZoneCode,
      status: v.status,
      predictedWaitHrs: +wait.toFixed(1),
    };

    // ---------------------------------------------------------------- DIVERT
    if (wait >= 48) {
      const candidates = ALT_PORTS.filter(
        (p) => v.loaFt <= p.maxLoaFt && p.availability !== "low",
      );
      let best: { port: AltPort; savings: number; shift: number } | null = null;
      for (const p of candidates) {
        // divert cost = extra transit beyond the wait we avoid + terminal buffer
        const shift = Math.max(0, p.transitHrsAt15kn + availabilityBufferHrs[p.availability] - wait);
        const waitAvoided = Math.max(0, wait - shift);
        const savings = (waitAvoided / 24) * DAILY_OP_COST_USD - (shift / 24) * DAILY_OP_COST_USD * 0.35;
        if (!best || savings > best.savings) best = { port: p, savings, shift };
      }
      if (best && best.savings > 0) {
        recs.push({
          ...base,
          option: "DIVERT",
          targetPort: best.port.name,
          etaShiftHrs: +best.shift.toFixed(1),
          estSavingsUsd: Math.round(best.savings),
          rationale: `Predicted ${wait.toFixed(0)}h wait at destination vs ${best.port.transitHrsAt15kn}h transit to ${best.port.name} (${best.port.availability} availability). Diversion avoids ~${Math.max(0, wait - best.shift).toFixed(0)}h of anchorage time; net saving ≈ $${Math.round(best.savings).toLocaleString()} at $32k/day ship cost.`,
          confidence: 0.82,
          tier: "critical",
        });
        continue;
      }
    }

    // ------------------------------------------------------------ SLOW_STEAM
    if (wait >= 18 && wait < 48 && v.status === "INBOUND") {
      // vessel can cut speed to arrive as the window opens; ~35% fuel-burn
      // reduction steaming at ~60% power (documented slow-steaming figure)
      const steamDownHrs = Math.min(wait - 6, 48);
      const savings = 0.35 * (steamDownHrs / 24) * DAILY_OP_COST_USD;
      recs.push({
        ...base,
        option: "SLOW_STEAM",
        etaShiftHrs: +steamDownHrs.toFixed(1),
        estSavingsUsd: Math.round(savings),
        rationale: `Inbound with predicted ${wait.toFixed(0)}h queue. Reduce to ~14 kn so arrival coincides with the freed window; ~35% fuel-burn reduction over ${steamDownHrs.toFixed(0)}h saves ≈ $${Math.round(savings).toLocaleString()} and frees anchorage space.`,
        confidence: 0.72,
        tier: "high",
      });
      continue;
    }

    // -------------------------------------------------------- PRIORITY_WINDOW
    if (wait >= 10 && v.reeferUnits >= 200) {
      const savings = v.reeferUnits * REEFER_CONTENT_VALUE_USD * 0.4;
      recs.push({
        ...base,
        option: "PRIORITY_WINDOW",
        etaShiftHrs: -Math.min(6, wait - 8),
        estSavingsUsd: Math.round(savings),
        rationale: `${v.reeferUnits} reefer units aboard with predicted ${wait.toFixed(0)}h wait. Request priority window swap with a lower-priority call; avoids spoilage risk ≈ $${Math.round(savings).toLocaleString()} and reduces genset load at anchor.`,
        confidence: 0.64,
        tier: "medium",
      });
      continue;
    }

    // ------------------------------------------------------------------ HOLD
    recs.push({
      ...base,
      option: "HOLD",
      etaShiftHrs: 0,
      estSavingsUsd: 0,
      rationale:
        wait < 10
          ? `Predicted ${wait.toFixed(0)}h wait is within normal rotation — hold current schedule.`
          : `Moderate ${wait.toFixed(0)}h wait but no reefer/size constraint and diversion economics negative — hold and re-evaluate next cycle.`,
      confidence: 0.55,
      tier: "low",
    });
  }

  return recs.sort(
    (a, b) =>
      ({ critical: 0, high: 1, medium: 2, low: 3 })[a.tier] -
      ({ critical: 0, high: 1, medium: 2, low: 3 })[b.tier] ||
      b.estSavingsUsd - a.estSavingsUsd,
  );
}
