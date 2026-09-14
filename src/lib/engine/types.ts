// Shared types for the PortFlow SBX prediction/optimisation engines.
// These types are the contract between engine modules, API routes and the UI.

export type ZoneCode = string; // "Z-PORT" | "Z-LBCT" | "Z-ITS" | "Z-PCT" | "Z-TTI"

export interface HistoryPoint {
  ts: string;
  queueCount: number;
  avgWaitHrs: number;
  index: number; // composite congestion index 0..100
}

export interface VesselInfo {
  id: string;
  mmsi: string;
  name: string;
  carrier: string;
  vesselClass: string; // ULCV | POST_PANAMAX | NEO_PANAMAX | PANAMAX | FEEDER
  loaFt: number;
  beamFt: number;
  draftFt: number;
  teuCapacity: number;
  importMoves: number;
  exportMoves: number;
  originPort: string;
  reeferUnits: number;
  status: string; // ANCHORAGE | DRIFTING | INBOUND
  anchorageZone: string;
  etaHours: number; // hours from t0 until ready-to-berth
  anchoredHours: number;
  destZoneCode: ZoneCode;
}

export interface BerthInfo {
  id: string;
  name: string;
  seq: number;
  lengthFt: number;
  depthFt: number;
  cranesMax: number;
  terminalCode: string;
  terminalName: string;
  pier: string;
  zoneCode: ZoneCode;
}

export interface TerminalInfo {
  id: string;
  code: string;
  name: string;
  pier: string;
  berthLengthFt: number;
  deepseaBerths: number;
  gantryCranes: number;
  capacityTeuM: number | null;
  zoneCode: ZoneCode;
  note: string | null;
}

// ---------------------------------------------------------------- forecasting
export interface ForecastPoint {
  hour: number; // 1..72 hours ahead of t0
  ts: string;
  index: number;
  queue: number;
  wait: number;
  lo: number; // 80% band lower (index units)
  hi: number;
}

export interface ForecastModelInfo {
  algorithm: string;
  features: string[];
  trainingRows: number;
  holdoutHours: number;
  mae24: number; // rollout MAE, horizons ≤ 24h
  mae72: number; // rollout MAE, horizons ≤ 72h
  mapePct: number;
  r2: number; // 1-step-ahead holdout R²
  skillPct: number; // % better MAE vs persistence baseline (1-step)
  trainedAt: string;
}

export interface ForecastDriver {
  label: string;
  detail: string;
}

// Deeper model-validation view derived from the multi-origin recursive
// validation rollouts (reuses the same residuals that produce the σ bands).
export interface ForecastValidationBucket {
  label: "1-12h" | "13-24h" | "25-48h" | "49-72h";
  mae: number; // mean |actual − forecast| across all origins in the bucket (index pts)
  sigma: number; // mean per-horizon residual σ over the bucket (80% band width driver)
  bias: number; // mean signed residual (actual − forecast); + = model under-forecasts
  n: number; // origin × horizon samples in the bucket
}

export interface ForecastValidation {
  buckets: ForecastValidationBucket[]; // always 4 entries: 1-12h / 13-24h / 25-48h / 49-72h
  origins: number; // number of recursive multi-origin validation rollouts
  residuals: number[]; // signed residuals (actual − forecast), evenly downsampled to ≤240
}

export interface ForecastResult {
  zoneCode: ZoneCode;
  zoneName: string;
  points: ForecastPoint[];
  current: { index: number; queue: number; wait: number };
  peak: { hour: number; index: number };
  avgIndex: number;
  drivers: ForecastDriver[];
  model: ForecastModelInfo;
  validation: ForecastValidation;
  capacity: { berths: number; cranes: number; berthLengthFt: number };
}

// ---------------------------------------------------------------- optimiser
export interface Assignment {
  vesselId: string;
  vesselName: string;
  carrier: string;
  vesselClass: string;
  loaFt: number;
  moves: number;
  reeferUnits: number;
  berthId: string;
  berthName: string;
  terminalCode: string;
  pier: string;
  zoneCode: ZoneCode;
  startHour: number; // relative to t0
  endHour: number;
  cranes: number;
  waitHours: number; // startHour − readyHour (readyHour = max(0, etaHours))
  priorityScore: number;
}

export interface DeferredVessel {
  vesselId: string;
  vesselName: string;
  reason: string;
}

export interface OptimiserMetrics {
  serviced: number;
  deferred: number;
  totalWaitHours: number;
  avgWaitHours: number;
  maxWaitHours: number;
  weightedWaitHours: number; // Σ wait × priority weight (the optimiser's objective)
  berthUtilPct: number;
  craneUtilPct: number;
  totalMoves: number;
  avgCranesPerVessel: number;
}

export interface OptimiserOutput {
  runId: string;
  createdAt: string;
  horizonHours: number;
  assignments: Assignment[];
  deferred: DeferredVessel[];
  metrics: OptimiserMetrics;
  baseline: OptimiserMetrics;
  deltas: Record<string, number>; // waitTotal, waitAvg, craneUtil, moves
  params: OptimiserParams;
}

export interface OptimiserParams {
  horizonHours: number;
  moveRatePerCraneHour: number;
  serviceBufferHours: number;
  maxCranesPerVessel: number;
  craneFactor?: number; // what-if scenario: fraction of crane capacity available (0.5–1)
}

// ---------------------------------------------------------------- routing
export type RoutingOption = "DIVERT" | "SLOW_STEAM" | "PRIORITY_WINDOW" | "HOLD";

export interface RoutingRec {
  vesselId: string;
  vesselName: string;
  carrier: string;
  vesselClass: string;
  destZoneCode: ZoneCode;
  status: string;
  option: RoutingOption;
  targetPort?: string;
  predictedWaitHrs: number;
  etaShiftHrs: number; // + later / − earlier arrival shift
  estSavingsUsd: number;
  rationale: string;
  confidence: number;
  tier: "critical" | "high" | "medium" | "low";
}

// ---------------------------------------------------------------- 72h plan
export interface PlanShift {
  seq: number;
  label: string; // "Shift 01 · +0h → +6h"
  startHour: number;
  endHour: number;
  windowLabel: string; // human wall-clock window
  arrivals: { vesselName: string; carrier: string; zoneCode: string; etaHour: number }[];
  berthings: { vesselName: string; berthName: string; terminalCode: string; startHour: number; cranes: number }[];
  craneDeployment: Record<string, number>; // terminalCode → cranes working (avg over shift)
  congestionAlerts: { zoneCode: string; peakIndex: number; peakHour: number; level: "WATCH" | "WARN" | "CRIT" }[];
  routingActions: string[];
  checklist: string[];
  yardNote?: string;
}

export interface PlanSummary {
  generatedAt: string;
  horizonHours: number;
  totalArrivals: number;
  totalBerthings: number;
  totalMoves: number;
  craneHours: number;
  peakIndex: number;
  peakZone: string;
  riskLevel: "LOW" | "ELEVATED" | "HIGH" | "SEVERE";
  topActions: string[];
  idleBerthHoursPct: number;
  deferredCount: number;
}

export interface OpsPlanOutput {
  summary: PlanSummary;
  shifts: PlanShift[];
  text: string;
}
