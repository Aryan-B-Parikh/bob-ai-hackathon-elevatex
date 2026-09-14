// Typed client-side API accessors + response mirrors of the engine types.
import type {
  Assignment,
  DeferredVessel,
  ForecastDriver,
  ForecastModelInfo,
  ForecastPoint,
  HistoryPoint,
  OptimiserMetrics,
  OptimiserParams,
  PlanShift,
  PlanSummary,
  RoutingRec,
  TerminalInfo,
} from "@/lib/engine/types";

// ---------------------------------------------------------------- overview
export interface OverviewResponse {
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
    recentIndex: number[];
  }[];
  alerts: { severity: "info" | "warn" | "crit"; title: string; detail: string; hour?: number }[];
  arrivalsTimeline: { hour: number; count: number }[];
  lastUpdated: string;
}

// ---------------------------------------------------------------- forecast
export interface ForecastZoneSummary {
  zoneCode: string;
  label: string;
  currentIndex: number;
  peakIndex: number;
  peakHour: number;
  avgIndex: number;
  queueNow: number;
  waitNow: number;
}

export interface ForecastResponse {
  zones: ForecastZoneSummary[];
  selected: {
    zoneCode: string;
    zoneName: string;
    points: ForecastPoint[];
    current: { index: number; queue: number; wait: number };
    peak: { hour: number; index: number };
    avgIndex: number;
    drivers: ForecastDriver[];
    model: ForecastModelInfo;
    capacity: { berths: number; cranes: number; berthLengthFt: number };
    history: HistoryPoint[];
    hotspotRank: number;
  };
}

// ---------------------------------------------------------------- optimiser
export interface OptimiserRunResponse {
  run: {
    runId: string;
    createdAt: string;
    horizonHours: number;
    assignments: Assignment[];
    deferred: DeferredVessel[];
    metrics: OptimiserMetrics;
    baseline: OptimiserMetrics;
    deltas: Record<string, number>;
    params: OptimiserParams;
  } | null;
}

// ---------------------------------------------------------------- routing
export interface RoutingResponse {
  recommendations: RoutingRec[];
  summary: {
    divert: number;
    slowSteam: number;
    priority: number;
    hold: number;
    totalSavingsUsd: number;
  };
}

// ---------------------------------------------------------------- plan
export interface PlanResponse {
  plan: {
    id: string;
    createdAt: string;
    summary: PlanSummary;
    shifts: PlanShift[];
    text: string;
  } | null;
}

// ---------------------------------------------------------------- vessels
export interface VesselsResponse {
  t0: string;
  vessels: (import("@/lib/engine/types").VesselInfo & {
    assignedBerth: string | null;
    assignedTerminal: string | null;
    startHour: number | null;
    waitHours: number | null;
    cranes: number | null;
    inPlan: boolean;
  })[];
  terminals: TerminalInfo[];
}

// ---------------------------------------------------------------- terminals
export interface TerminalsResponse {
  source: string;
  terminals: (TerminalInfo & { berths: import("@/lib/engine/types").BerthInfo[] })[];
  portWide: {
    polb: { berths: number; piers: number; postPanamaxCranes: number };
    pola: { berths: number; containerCranes: number; containerTerminals: number };
  };
}

// ---------------------------------------------------------------- bob
export interface BobMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta?: { actions?: { tool: string; detail: string }[]; mode?: "llm" | "deterministic" } | null;
  createdAt: string;
}

// ---------------------------------------------------------------- fetchers
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  overview: () => getJson<OverviewResponse>("/api/overview"),
  forecast: (zone: string) => getJson<ForecastResponse>(`/api/forecast?zone=${encodeURIComponent(zone)}`),
  latestRun: () => getJson<OptimiserRunResponse>("/api/optimise"),
  runOptimiser: async () => {
    const res = await fetch("/api/optimise", { method: "POST" });
    if (!res.ok) throw new Error("optimise failed");
    return (await res.json()) as OptimiserRunResponse;
  },
  runScenario: async (scenario: { craneFactor?: number; moveRatePerCraneHour?: number }) => {
    const res = await fetch("/api/optimise", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(scenario),
    });
    if (!res.ok) throw new Error("scenario run failed");
    return (await res.json()) as OptimiserRunResponse;
  },
  exportCsv: (type: "assignments" | "routing" | "vessels" | "forecast") =>
    `/api/export?type=${type}`,
  routing: () => getJson<RoutingResponse>("/api/routing"),
  latestPlan: () => getJson<PlanResponse>("/api/plan"),
  generatePlan: async () => {
    const res = await fetch("/api/plan", { method: "POST" });
    if (!res.ok) throw new Error("plan generation failed");
    return (await res.json()) as { plan: NonNullable<PlanResponse["plan"]> };
  },
  vessels: () => getJson<VesselsResponse>("/api/vessels"),
  terminals: () => getJson<TerminalsResponse>("/api/terminals"),
  bobHistory: () => getJson<{ messages: BobMessage[] }>("/api/bob"),
  sendBob: async (message: string): Promise<{ reply: BobMessage }> => {
    const res = await fetch("/api/bob", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) throw new Error("Bob is unavailable");
    return res.json();
  },
};

// ---------------------------------------------------------------- helpers
export const CARRIER_COLORS = [
  "bg-teal-500/80",
  "bg-amber-500/80",
  "bg-rose-500/80",
  "bg-emerald-500/80",
  "bg-orange-500/80",
  "bg-cyan-600/80",
];
export function carrierColor(carrier: string): string {
  let h = 0;
  for (let i = 0; i < carrier.length; i++) h = (h * 31 + carrier.charCodeAt(i)) >>> 0;
  return CARRIER_COLORS[h % CARRIER_COLORS.length];
}

export function fmtUsd(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
export function fmtHour(h: number): string {
  return `+${Math.round(h)}h`;
}
