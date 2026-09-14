// ============================================================================
// Berth & crane assignment optimiser.
//
//   baseline  : FIFO first-fit (industry default) — serves as comparison
//   optimised : priority-scorced greedy + pairwise berth-swap local search
//
// Hard constraints use the REAL Port of Long Beach terminal fact-sheet data
// (berth length, depth, max STS cranes per berth). Service times follow a
// documented productivity model: moves / (cranes × moves-per-crane-hour).
// ============================================================================
import { uuid } from "@/lib/utils";
import type {
  Assignment,
  BerthInfo,
  DeferredVessel,
  OptimiserMetrics,
  OptimiserOutput,
  OptimiserParams,
  VesselInfo,
} from "./types";

export const DEFAULT_PARAMS: OptimiserParams = {
  horizonHours: 72,
  moveRatePerCraneHour: 28, // STS productivity: 25–35 moves/h (industry range, mid-point)
  serviceBufferHours: 2, // mooring/unmooring + paperwork buffer
  maxCranesPerVessel: 8, // practical simultaneous crane cap per vessel
};

const readyHour = (v: VesselInfo) => Math.max(0, v.etaHours);
const totalMoves = (v: VesselInfo) => v.importMoves + v.exportMoves;

function priorityScore(v: VesselInfo): number {
  // documented heuristic: waiting time dominates, then size scarcity, cargo
  // volume and time-sensitive reefer cargo
  return (
    0.5 * v.anchoredHours +
    0.02 * v.loaFt +
    0.003 * totalMoves(v) +
    0.02 * v.reeferUnits
  );
}

// wait-weighting: an hour of delay hurts a long-waiting/large/reefer-loaded
// vessel more than a fresh small feeder — the optimiser's objective is to
// minimise PRIORITY-WEIGHTED wait, shifting delay to low-cost callers.
function waitWeight(v: VesselInfo): number {
  return 1 + v.anchoredHours / 48 + v.reeferUnits / 300;
}

function feasible(v: VesselInfo, b: BerthInfo): boolean {
  return v.loaFt <= b.lengthFt && v.draftFt <= b.depthFt;
}

function cranesFor(v: VesselInfo, b: BerthInfo, p: OptimiserParams): number {
  const byVolume = Math.ceil(totalMoves(v) / 900);
  return Math.max(2, Math.min(b.cranesMax, p.maxCranesPerVessel, byVolume));
}

function serviceHours(v: VesselInfo, cranes: number, p: OptimiserParams): number {
  return totalMoves(v) / (cranes * p.moveRatePerCraneHour) + p.serviceBufferHours;
}

interface Slot {
  vessel: VesselInfo;
  berth: BerthInfo;
  cranes: number;
  start: number;
  end: number;
  wait: number;
}

// Recompute exact timing for per-berth ordered sequences.
function recompute(slots: Slot[], p: OptimiserParams): void {
  const byBerth = new Map<string, Slot[]>();
  for (const s of slots) {
    const arr = byBerth.get(s.berth.id) ?? [];
    arr.push(s);
    byBerth.set(s.berth.id, arr);
  }
  for (const arr of byBerth.values()) {
    arr.sort((a, b) => a.start - b.start);
    let prevEnd = 0;
    for (const s of arr) {
      s.start = Math.max(readyHour(s.vessel), prevEnd);
      s.end = s.start + serviceHours(s.vessel, s.cranes, p);
      s.wait = s.start - readyHour(s.vessel);
      prevEnd = s.end;
    }
  }
}

function metrics(slots: Slot[], berths: BerthInfo[], deferred: DeferredVessel[], p: OptimiserParams): OptimiserMetrics {
  const totalWait = slots.reduce((a, s) => a + Math.max(0, s.wait), 0);
  // utilisation is measured inside the plan horizon only (work spilling past
  // +72h counts fully for durations but not for utilisation of the window)
  const win = (s: Slot) => Math.max(0, Math.min(s.end, p.horizonHours) - Math.min(s.start, p.horizonHours));
  const occupied = slots.reduce((a, s) => a + win(s), 0);
  const craneHours = slots.reduce((a, s) => a + s.cranes * win(s), 0);
  const berthCap = berths.length * p.horizonHours;
  const craneCap = berths.reduce((a, b) => a + b.cranesMax, 0) * p.horizonHours;
  const served = slots.length;
  return {
    serviced: served,
    deferred: deferred.length,
    totalWaitHours: +totalWait.toFixed(1),
    avgWaitHours: +(totalWait / Math.max(1, served)).toFixed(1),
    maxWaitHours: +Math.max(0, ...slots.map((s) => s.wait)).toFixed(1),
    berthUtilPct: +((occupied / berthCap) * 100).toFixed(1),
    craneUtilPct: +((craneHours / craneCap) * 100).toFixed(1),
    totalMoves: slots.reduce((a, s) => a + totalMoves(s.vessel), 0),
    avgCranesPerVessel: +(slots.reduce((a, s) => a + s.cranes, 0) / Math.max(1, served)).toFixed(1),
    weightedWaitHours: +slots.reduce((a, s) => a + Math.max(0, s.wait) * waitWeight(s.vessel), 0).toFixed(1),
  };
}

function toAssignment(s: Slot): Assignment {
  return {
    vesselId: s.vessel.id,
    vesselName: s.vessel.name,
    carrier: s.vessel.carrier,
    vesselClass: s.vessel.vesselClass,
    loaFt: s.vessel.loaFt,
    moves: totalMoves(s.vessel),
    reeferUnits: s.vessel.reeferUnits,
    berthId: s.berth.id,
    berthName: s.berth.name,
    terminalCode: s.berth.terminalCode,
    pier: s.berth.pier,
    zoneCode: s.berth.zoneCode,
    startHour: +s.start.toFixed(1),
    endHour: +s.end.toFixed(1),
    cranes: s.cranes,
    waitHours: +Math.max(0, s.wait).toFixed(1),
    priorityScore: +priorityScore(s.vessel).toFixed(2),
  };
}

export function optimise(
  vessels: VesselInfo[],
  berths: BerthInfo[],
  params: Partial<OptimiserParams> = {},
  zoneIndexAt: (zoneCode: string, hour: number) => number = () => 0,
): OptimiserOutput {
  const p: OptimiserParams = { ...DEFAULT_PARAMS, ...params };
  const queue = vessels.filter((v) => readyHour(v) < p.horizonHours);

  // ------------------------------------------------------------ FIFO baseline
  // Same deferral rule as the optimiser (end beyond horizon + 24h → defer)
  // so the comparison is apples-to-apples.
  const fifoSlots: Slot[] = [];
  const fifoFree = new Map<string, number>(berths.map((b) => [b.id, 0]));
  const fifoDeferred: DeferredVessel[] = [];
  const fifoSorted = [...queue].sort(
    (a, b) => readyHour(a) - readyHour(b) || b.anchoredHours - a.anchoredHours,
  );
  for (const v of fifoSorted) {
    const fits = berths.filter((b) => feasible(v, b));
    if (!fits.length) {
      fifoDeferred.push({ vesselId: v.id, vesselName: v.name, reason: `No berth fits LOA ${v.loaFt}ft / draft ${v.draftFt}ft` });
      continue;
    }
    fits.sort((a, b) => (fifoFree.get(a.id) ?? 0) - (fifoFree.get(b.id) ?? 0));
    const b = fits[0];
    const cranes = cranesFor(v, b, p);
    const start = Math.max(readyHour(v), fifoFree.get(b.id) ?? 0);
    const end = start + serviceHours(v, cranes, p);
    if (end > p.horizonHours + 24) {
      fifoDeferred.push({ vesselId: v.id, vesselName: v.name, reason: "Service window exceeds 72h plan horizon" });
      continue;
    }
    fifoFree.set(b.id, end);
    fifoSlots.push({ vessel: v, berth: b, cranes, start, end, wait: start - readyHour(v) });
  }

  // ------------------------------------------------------------ optimised
  // Three-phase construction:
  //   Phase 1 (WHO):   process in priority order to SELECT the serviced set
  //                    under the horizon constraint (selection only).
  //   Phase 2 (WHEN):  sequence the selected set in ready-time order — the
  //                    classic wait-minimising rule — with size-aware berth
  //                    choice (mismatch penalty reserves long berths).
  //   Phase 3 (POLISH): pairwise berth-swap local search on the weighted
  //                    objective.
  const deferred: DeferredVessel[] = [];
  const noFit = new Set<string>();

  function greedyAssign(order: VesselInfo[]): Slot[] {
    const out: Slot[] = [];
    const free = new Map<string, number>(berths.map((b) => [b.id, 0]));
    for (const v of order) {
      if (noFit.has(v.id)) continue;
      const fits = berths.filter((b) => feasible(v, b));
      if (!fits.length) continue;
      let best: { b: BerthInfo; start: number; cranes: number } | null = null;
      let bestCost = Infinity;
      for (const b of fits) {
        const cranes = cranesFor(v, b, p);
        const start = Math.max(readyHour(v), free.get(b.id) ?? 0);
        const wait = start - readyHour(v);
        const mismatch = b.lengthFt - v.loaFt > 700 ? 8 : 0; // reserve long berths for big ships
        const cost = waitWeight(v) * wait + 0.15 * serviceHours(v, cranes, p) + mismatch;
        if (cost < bestCost) {
          bestCost = cost;
          best = { b, start, cranes };
        }
      }
      if (!best) continue;
      const end = best.start + serviceHours(v, best.cranes, p);
      if (end > p.horizonHours + 24) continue; // exceeds plan window → not selected
      free.set(best.b.id, end);
      out.push({ vessel: v, berth: best.b, cranes: best.cranes, start: best.start, end, wait: best.start - readyHour(v) });
    }
    recompute(out, p);
    return out;
  }

  // Phase 1 — selection by priority
  const byPriority = [...queue].sort((a, b) => priorityScore(b) - priorityScore(a));
  for (const v of byPriority) {
    if (!berths.some((b) => feasible(v, b))) {
      noFit.add(v.id);
      deferred.push({ vesselId: v.id, vesselName: v.name, reason: `No berth fits LOA ${v.loaFt}ft / draft ${v.draftFt}ft` });
    }
  }
  const selected = greedyAssign(byPriority).map((s) => s.vessel);

  // Phase 2 — sequence selected set by ready time (wait-minimising)
  const byReady = [...selected].sort(
    (a, b) => readyHour(a) - readyHour(b) || b.anchoredHours - a.anchoredHours,
  );
  const slots = greedyAssign(byReady);
  recompute(slots, p);

  // ------------------------------------------------ local search + insertion
  // Swaps and gap-insertions are interleaved: a swap can re-open an idle gap
  // that a deferred feeder can then backfill (and vice versa).
  const objective = (arr: Slot[]) =>
    arr.reduce((a, s) => a + waitWeight(s.vessel) * Math.max(0, s.wait) + 0.15 * (s.end - s.start), 0);

  function insertionPass(): number {
    let added = 0;
    const insertedIds = new Set(slots.map((s) => s.vessel.id));
    const unserviced = queue
      .filter((v) => !insertedIds.has(v.id) && !noFit.has(v.id))
      .sort((a, b) => readyHour(a) - readyHour(b));
    for (const v of unserviced) {
      let best: { b: BerthInfo; start: number; cranes: number } | null = null;
      let bestCost = Infinity;
      for (const b of berths.filter((x) => feasible(v, x))) {
        const berthSlots = slots.filter((s) => s.berth.id === b.id).sort((x, y) => x.start - y.start);
        // earliest gap that fits after previous work on this berth
        let t = readyHour(v);
        for (const s of berthSlots) {
          if (s.start >= t && s.start - t >= serviceHours(v, cranesFor(v, b, p), p)) break;
          t = Math.max(t, s.end);
        }
        const cranes = cranesFor(v, b, p);
        const end = t + serviceHours(v, cranes, p);
        if (end > p.horizonHours + 24) continue;
        const mismatch = b.lengthFt - v.loaFt > 700 ? 8 : 0;
        const cost = waitWeight(v) * (t - readyHour(v)) + mismatch + end / 1000;
        if (cost < bestCost) {
          bestCost = cost;
          best = { b, start: t, cranes };
        }
      }
      if (best) {
        slots.push({
          vessel: v,
          berth: best.b,
          cranes: best.cranes,
          start: best.start,
          end: best.start + serviceHours(v, best.cranes, p),
          wait: best.start - readyHour(v),
        });
        recompute(slots, p);
        added++;
      }
    }
    return added;
  }

  function swapSearch(): boolean {
    let improvedAny = false;
    let improved = true;
    let passes = 0;
    while (improved && passes < 3) {
      improved = false;
      passes++;
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
          const a = slots[i];
          const b = slots[j];
          if (a.berth.id === b.berth.id) continue;
          if (!feasible(a.vessel, b.berth) || !feasible(b.vessel, a.berth)) continue;
          // honour mismatch reservation after swap
          const mismatchAfter =
            (b.berth.lengthFt - a.vessel.loaFt > 700 ? 8 : 0) + (a.berth.lengthFt - b.vessel.loaFt > 700 ? 8 : 0);
          const mismatchBefore = (a.berth.lengthFt - a.vessel.loaFt > 700 ? 8 : 0) + (b.berth.lengthFt - b.vessel.loaFt > 700 ? 8 : 0);
          const before = objective(slots) + mismatchBefore;
          [a.berth, b.berth] = [b.berth, a.berth];
          recompute(slots, p);
          const after = objective(slots) + mismatchAfter;
          if (after < before - 0.5) {
            improved = true;
            improvedAny = true;
          } else {
            [a.berth, b.berth] = [b.berth, a.berth];
            recompute(slots, p);
          }
        }
      }
    }
    return improvedAny;
  }

  for (let round = 0; round < 2; round++) {
    swapSearch();
    const added = insertionPass();
    if (!added) break;
  }
  swapSearch();

  // Final deferred list = queue vessels not in the schedule and not "no fit"
  const finalIds = new Set(slots.map((s) => s.vessel.id));
  for (const v of queue) {
    if (!finalIds.has(v.id) && !noFit.has(v.id)) {
      deferred.push({
        vesselId: v.id,
        vesselName: v.name,
        reason: "Horizon capacity exhausted — see routing recommendations",
      });
    }
  }

  const mOpt = metrics(slots, berths, deferred, p);
  const mBase = metrics(fifoSlots, berths, fifoDeferred, p);
  const deltas: Record<string, number> = {
    waitTotal: +(mBase.totalWaitHours - mOpt.totalWaitHours).toFixed(1),
    waitTotalPct: mBase.totalWaitHours > 0 ? +(((mBase.totalWaitHours - mOpt.totalWaitHours) / mBase.totalWaitHours) * 100).toFixed(1) : 0,
    avgWait: +(mBase.avgWaitHours - mOpt.avgWaitHours).toFixed(1),
    maxWait: +(mBase.maxWaitHours - mOpt.maxWaitHours).toFixed(1),
    craneUtil: +(mOpt.craneUtilPct - mBase.craneUtilPct).toFixed(1),
    berthUtil: +(mOpt.berthUtilPct - mBase.berthUtilPct).toFixed(1),
    weightedWait: +(mBase.weightedWaitHours - mOpt.weightedWaitHours).toFixed(1),
    moves: +(mOpt.totalMoves - mBase.totalMoves).toFixed(0),
  };

  return {
    runId: uuid(),
    createdAt: new Date().toISOString(),
    horizonHours: p.horizonHours,
    assignments: slots.sort((a, b) => a.start - b.start).map(toAssignment),
    deferred,
    metrics: mOpt,
    baseline: mBase,
    deltas,
    params: p,
  };
}
