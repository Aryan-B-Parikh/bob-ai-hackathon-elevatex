// ============================================================================
// Pipeline: runs the four engines in dependency order and caches results.
//   forecast → optimiser → routing → 72h plan   (+ overview KPIs)
// This module is what the API routes (and Bob) call — one shared model time.
// ============================================================================
import { congestionIndex, forecastZone, buildArrivalSchedule } from "./forecast";
import { getEngineContext, zoneCapacity, ZONE_LABELS, type EngineContext } from "./context";
import { optimise } from "./optimiser";
import { recommendRouting } from "./routing";
import { buildPlan } from "./plan";
import type {
  ForecastResult,
  OptimiserOutput,
  OpsPlanOutput,
  RoutingRec,
  VesselInfo,
} from "./types";

export const DAILY_OP_COST_USD = 32_000;
export const DATASET_NOTE =
  "Terminal capacity = real Port of Long Beach fact-sheet figures. Vessel queue + 14-day congestion history = labelled demo dataset (scripts/ais replaces it with real NOAA AccessAIS-derived series).";

export const TERMINAL_ZONES = ["Z-LBCT", "Z-ITS", "Z-PCT", "Z-TTI"] as const;

// ------------------------------------------------------------------ forecast
let fcCache: { key: string; forecasts: Record<string, ForecastResult> } | null = null;

export async function runForecasts(ctx: EngineContext): Promise<Record<string, ForecastResult>> {
  const key = ctx.t0.toISOString();
  if (fcCache && fcCache.key === key) return fcCache.forecasts;

  const zones = ["Z-PORT", ...TERMINAL_ZONES];
  const forecasts: Record<string, ForecastResult> = {};
  for (const zone of zones) {
    const zoneVessels =
      zone === "Z-PORT" ? ctx.vessels : ctx.vessels.filter((v) => v.destZoneCode === zone);
    forecasts[zone] = forecastZone({
      zoneCode: zone,
      zoneName: ZONE_LABELS[zone] ?? zone,
      history: ctx.history[zone] ?? [],
      vessels: zoneVessels,
      capacity: zoneCapacity(ctx, zone),
      t0: ctx.t0,
    });
  }
  fcCache = { key, forecasts };
  return forecasts;
}

// ------------------------------------------------------------------ optimiser
export interface ScenarioOptions {
  craneFactor?: number; // 0.5..1 — e.g. 0.8 simulates a 20% crane outage
  moveRatePerCraneHour?: number; // 20..35 — weather/labour productivity
}

export function runOptimiser(
  ctx: EngineContext,
  forecasts: Record<string, ForecastResult>,
  params: { horizonHours?: number } = {},
  scenario: ScenarioOptions = {},
): OptimiserOutput {
  const craneFactor = Math.min(1, Math.max(0.5, scenario.craneFactor ?? 1));
  const moveRate = Math.min(35, Math.max(20, scenario.moveRatePerCraneHour ?? DEFAULT_MOVE_RATE));
  const zoneIndexAt = (zoneCode: string, hour: number) => {
    const fc = forecasts[zoneCode] ?? forecasts["Z-PORT"];
    if (!fc) return 0;
    const p = fc.points[Math.min(fc.points.length - 1, Math.max(0, Math.round(hour) - 1))];
    return p ? p.index : 0;
  };
  // scenario: scale berth-level crane caps (floor 1) so both optimised AND the
  // FIFO baseline run against the same impaired capacity — fair comparison
  const berths =
    craneFactor < 1
      ? ctx.berths.map((b) => ({ ...b, cranesMax: Math.max(1, Math.round(b.cranesMax * craneFactor)) }))
      : ctx.berths;
  return optimise(
    ctx.vessels,
    berths,
    {
      horizonHours: 72,
      ...params,
      moveRatePerCraneHour: moveRate,
      craneFactor: craneFactor < 1 ? craneFactor : undefined,
    },
    zoneIndexAt,
  );
}

const DEFAULT_MOVE_RATE = 28;

// ------------------------------------------------------------------ routing
export function runRouting(
  ctx: EngineContext,
  forecasts: Record<string, ForecastResult>,
  optimiser?: OptimiserOutput,
): RoutingRec[] {
  const assignmentByVessel = new Map(
    (optimiser?.assignments ?? []).map((a) => [a.vesselId, a]),
  );
  return recommendRouting({
    vessels: ctx.vessels,
    predictedWaitFor: (v: VesselInfo) => {
      const a = assignmentByVessel.get(v.id);
      const zone = a?.zoneCode ?? v.destZoneCode;
      const fc = forecasts[zone] ?? forecasts["Z-PORT"];
      const hour = Math.min(72, Math.max(1, Math.round(a?.startHour ?? Math.max(1, v.etaHours))));
      const fcWait = fc.points[hour - 1]?.wait ?? v.anchoredHours;
      // vessels the optimiser could not slot inside the horizon face an
      // effective wait beyond the plan window → prime divert candidates
      if (!a) return Math.max(fcWait, 78);
      return fcWait;
    },
  });
}

// ------------------------------------------------------------------ plan
export function buildOpsPlanOutput(
  ctx: EngineContext,
  forecasts: Record<string, ForecastResult>,
  optimiserOut: OptimiserOutput,
  routing: RoutingRec[],
): OpsPlanOutput {
  return buildPlan({
    t0: ctx.t0,
    vessels: ctx.vessels,
    berths: ctx.berths.length,
    assignments: optimiserOut.assignments,
    deferredCount: optimiserOut.deferred.length,
    forecasts: ["Z-PORT", ...TERMINAL_ZONES].map((z) => forecasts[z]),
    routing,
  });
}

// ------------------------------------------------------------------ overview
export interface OverviewData {
  t0: string;
  dataset: { source: string; note: string };
  kpis: {
    vesselsAtAnchor: number;
    vesselsInbound: number;
    avgAnchorageWait: number;
    maxAnchoredHours: number;
    arrivalsNext24: number;
    portIndexNow: number;
    peakForecastIndex: number;
    peakForecastHour: number;
    movesPending: number;
    dailyFleetBurnUsd: number;
    berthUtilPct: number;
    craneUtilPct: number;
  };
  zones: {
    zoneCode: string;
    label: string;
    currentIndex: number;
    peakIndex: number;
    peakHour: number;
    queueNow: number;
    waitNow: number;
    trend: "rising" | "falling" | "flat";
    level: "LOW" | "ELEVATED" | "HIGH" | "CRIT";
    berths: number;
    cranes: number;
    recentIndex: number[]; // last 48 observed hourly index values (sparkline)
  }[];
  alerts: { severity: "info" | "warn" | "crit"; title: string; detail: string; hour?: number }[];
  arrivalsTimeline: { hour: number; count: number }[];
  lastUpdated: string;
}

function levelOf(index: number): OverviewData["zones"][number]["level"] {
  return index >= 75 ? "CRIT" : index >= 60 ? "HIGH" : index >= 45 ? "ELEVATED" : "LOW";
}

export async function buildOverview(): Promise<{
  overview: OverviewData;
  ctx: EngineContext;
  forecasts: Record<string, ForecastResult>;
}> {
  const ctx = await getEngineContext();
  const forecasts = await runForecasts(ctx);
  const port = forecasts["Z-PORT"];
  const now = ctx.history["Z-PORT"]?.at(-1);

  const waiting = ctx.vessels.filter((v) => v.status !== "INBOUND");
  const avgWait = waiting.length
    ? waiting.reduce((a, v) => a + v.anchoredHours, 0) / waiting.length
    : 0;

  const arrivalsSched = buildArrivalSchedule(ctx.vessels)["Z-PORT"] ?? [];
  const arrivalsNext24 = arrivalsSched.slice(1, 25).reduce((a, b) => a + b, 0);

  // current berth/crane utilisation proxy from the optimiser's first 24h
  const opt = runOptimiser(ctx, forecasts);
  const occ24 = opt.assignments.reduce(
    (a, x) => a + (Math.min(x.endHour, 24) - Math.min(x.startHour, 24)),
    0,
  );
  const berthUtilPct = +((occ24 / (ctx.berths.length * 24)) * 100).toFixed(1);
  const craneHrs24 = opt.assignments.reduce(
    (a, x) => a + x.cranes * (Math.min(x.endHour, 24) - Math.min(x.startHour, 24)),
    0,
  );
  const craneCap24 = ctx.terminals.reduce((a, t) => a + t.gantryCranes, 0) * 24;
  const craneUtilPct = +((craneHrs24 / craneCap24) * 100).toFixed(1);

  const zones = ["Z-PORT", ...TERMINAL_ZONES].map((z) => {
    const fc = forecasts[z];
    const trend = fc.points[5].index - fc.current.index;
    const hist = ctx.history[z] ?? [];
    return {
      zoneCode: z,
      label: fc.zoneName,
      currentIndex: fc.current.index,
      peakIndex: fc.peak.index,
      peakHour: fc.peak.hour,
      queueNow: fc.current.queue,
      waitNow: fc.current.wait,
      trend: (trend > 2 ? "rising" : trend < -2 ? "falling" : "flat") as OverviewData["zones"][number]["trend"],
      level: levelOf(fc.peak.index),
      berths: fc.capacity.berths,
      cranes: fc.capacity.cranes,
      recentIndex: hist.slice(-48).map((h) => +h.index.toFixed(1)),
    };
  });

  const alerts: OverviewData["alerts"] = [];
  for (const z of zones) {
    if (z.level === "CRIT" || z.level === "HIGH") {
      alerts.push({
        severity: z.level === "CRIT" ? "crit" : "warn",
        title: `${z.label} congestion peak ${z.peakIndex.toFixed(0)} at +${z.peakHour}h`,
        detail: `Queue now ${z.queueNow} vessels / ${z.waitNow.toFixed(0)}h avg wait; trend ${z.trend}.`,
        hour: z.peakHour,
      });
    }
  }
  const longWaiters = ctx.vessels
    .filter((v) => v.anchoredHours >= 72)
    .sort((a, b) => b.anchoredHours - a.anchoredHours);
  if (longWaiters.length) {
    alerts.push({
      severity: "warn",
      title: `${longWaiters.length} vessel(s) anchored 72h+`,
      detail: `Longest: ${longWaiters[0].name} (${longWaiters[0].anchoredHours.toFixed(0)}h, ${longWaiters[0].carrier}).`,
    });
  }
  const reefers = ctx.vessels.filter((v) => v.reeferUnits >= 350);
  if (reefers.length) {
    alerts.push({
      severity: "info",
      title: `${reefers.length} vessel(s) with heavy reefer load`,
      detail: `${reefers.slice(0, 3).map((v) => v.name).join(", ")} — prioritise plug availability at berth.`,
    });
  }

  const overview: OverviewData = {
    t0: ctx.t0.toISOString(),
    dataset: { source: "DEMO_AIS", note: DATASET_NOTE },
    kpis: {
      vesselsAtAnchor: waiting.length,
      vesselsInbound: ctx.vessels.length - waiting.length,
      avgAnchorageWait: +avgWait.toFixed(1),
      maxAnchoredHours: +Math.max(0, ...ctx.vessels.map((v) => v.anchoredHours)).toFixed(0),
      arrivalsNext24,
      portIndexNow: port.current.index,
      peakForecastIndex: port.peak.index,
      peakForecastHour: port.peak.hour,
      movesPending: ctx.vessels.reduce((a, v) => a + v.importMoves + v.exportMoves, 0),
      dailyFleetBurnUsd: waiting.length * DAILY_OP_COST_USD,
      berthUtilPct,
      craneUtilPct,
    },
    zones,
    alerts,
    arrivalsTimeline: arrivalsSched.slice(1, 73).map((count, i) => ({ hour: i + 1, count })),
    lastUpdated: new Date().toISOString(),
  };

  return { overview, ctx, forecasts };
}

export { congestionIndex };
