// ============================================================================
// Engine context: loads DB data, shapes engine inputs, caches briefly.
// Single shared "now" (t0) so every module reasons about the same model time.
// ============================================================================
import { db } from "@/lib/db";
import type { BerthInfo, HistoryPoint, TerminalInfo, VesselInfo } from "./types";

export interface EngineContext {
  t0: Date;
  terminals: TerminalInfo[];
  berths: BerthInfo[];
  vessels: VesselInfo[];
  history: Record<string, HistoryPoint[]>; // zoneCode → hourly, oldest → newest
  latestTs: Date;
}

export const ZONES = ["Z-PORT", "Z-LBCT", "Z-ITS", "Z-PCT", "Z-TTI"] as const;
export const ZONE_LABELS: Record<string, string> = {
  "Z-PORT": "San Pedro Bay (port-wide)",
  "Z-LBCT": "LBCT · Pier E",
  "Z-ITS": "ITS · Pier G",
  "Z-PCT": "PCT · Pier J",
  "Z-TTI": "TTI · Pier T",
};

let cache: { ctx: EngineContext; at: number } | null = null;
const TTL_MS = 60_000;

export async function getEngineContext(force = false): Promise<EngineContext> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.ctx;

  const [terminals, berths, vessels, readings] = await Promise.all([
    db.terminal.findMany({ orderBy: { code: "asc" } }),
    db.berth.findMany({ orderBy: { seq: "asc" } }),
    db.vessel.findMany({ orderBy: { anchoredHours: "desc" } }),
    // hoursAgo asc → index 0 = oldest … last = "now" (hoursAgo 0)
    db.congestionReading.findMany({ orderBy: { hoursAgo: "asc" } }),
  ]);

  const latestTs = readings.length ? readings[0].ts : new Date();

  const byZone: Record<string, HistoryPoint[]> = {};
  for (const r of readings) {
    // rows are ordered hoursAgo desc → oldest first
    (byZone[r.zoneCode] ??= []).push({
      ts: r.ts.toISOString(),
      queueCount: r.queueCount,
      avgWaitHrs: r.avgWaitHrs,
      index: r.index,
    });
  }

  const terminalInfo: TerminalInfo[] = terminals.map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    pier: t.pier,
    berthLengthFt: t.berthLengthFt,
    deepseaBerths: t.deepseaBerths,
    gantryCranes: t.gantryCranes,
    capacityTeuM: t.capacityTeuM,
    zoneCode: t.zoneCode,
    note: t.note,
  }));

  const berthMap = new Map(terminals.map((t) => [t.id, t]));
  const berthInfo: BerthInfo[] = berths.map((b) => {
    const t = berthMap.get(b.terminalId)!;
    return {
      id: b.id,
      name: b.name,
      seq: b.seq,
      lengthFt: b.lengthFt,
      depthFt: b.depthFt,
      cranesMax: b.cranesMax,
      terminalCode: t.code,
      terminalName: t.name,
      pier: t.pier,
      zoneCode: t.zoneCode,
    };
  });

  const vesselInfo: VesselInfo[] = vessels.map((v) => ({
    id: v.id,
    mmsi: v.mmsi,
    name: v.name,
    carrier: v.carrier,
    vesselClass: v.vesselClass,
    loaFt: v.loaFt,
    beamFt: v.beamFt,
    draftFt: v.draftFt,
    teuCapacity: v.teuCapacity,
    importMoves: v.importMoves,
    exportMoves: v.exportMoves,
    originPort: v.originPort,
    reeferUnits: v.reeferUnits,
    status: v.status,
    anchorageZone: v.anchorageZone,
    etaHours: v.etaHours,
    anchoredHours: v.anchoredHours,
    destZoneCode: v.destZoneCode,
  }));

  const ctx: EngineContext = {
    t0: latestTs,
    terminals: terminalInfo,
    berths: berthInfo,
    vessels: vesselInfo,
    history: byZone,
    latestTs,
  };
  cache = { ctx, at: Date.now() };
  return ctx;
}

export function invalidateEngineContext() {
  cache = null;
}

export function zoneCapacity(ctx: EngineContext, zoneCode: string) {
  const termBerths = ctx.berths.filter((b) => b.zoneCode === zoneCode);
  if (zoneCode === "Z-PORT" || termBerths.length === 0) {
    return {
      berths: ctx.berths.length,
      cranes: ctx.terminals.reduce((a, t) => a + t.gantryCranes, 0),
      berthLengthFt: ctx.terminals.reduce((a, t) => a + t.berthLengthFt, 0),
    };
  }
  return {
    berths: termBerths.length,
    cranes: termBerths.reduce((a, b) => a + b.cranesMax, 0),
    berthLengthFt: ctx.terminals.find((t) => t.zoneCode === zoneCode)?.berthLengthFt ?? 0,
  };
}
