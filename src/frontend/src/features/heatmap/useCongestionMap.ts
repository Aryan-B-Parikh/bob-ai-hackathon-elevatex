import { useState, useMemo } from "react";
import { useOverview, useTerminals, useVessels } from "../../hooks";
import type { EnrichedTerminal, MapFilterState, AnchorageZone, VesselItem } from "./types";

const ANCHORAGE_GEOMETRY: Record<string, { name: string; lat: number; lon: number }> = {
  "San Pedro Anchorage A (Outer Harbor)": { name: "San Pedro Anchorage A (Outer Harbor)", lat: 33.722, lon: -118.225 },
  "San Pedro Anchorage B (Long Beach Outer)": { name: "San Pedro Anchorage B (Long Beach Outer)", lat: 33.715, lon: -118.195 },
  "San Pedro Anchorage C (Deepwater Holding)": { name: "San Pedro Anchorage C (Deepwater Holding)", lat: 33.705, lon: -118.165 },
};

export function useCongestionMap() {
  const { data: overview, isLoading: overviewLoading, error: overviewError } = useOverview();
  const { data: terminalsData, isLoading: terminalsLoading, error: terminalsError } = useTerminals();
  const { data: vesselsData, isLoading: vesselsLoading } = useVessels();

  const [filterState, setFilterState] = useState<MapFilterState>({
    horizon: 72, selectedTerminalCode: null, severityFilter: "ALL", mode: "CURRENT",
    layers: { heatmap: true, markers: true, anchorage: true, fairway: true },
  });

  const enrichedTerminals: EnrichedTerminal[] = useMemo(() => {
    if (!terminalsData?.terminals || !overview?.zones) return [];
    return terminalsData.terminals.map((term: any) => {
      const zone = overview.zones.find((z: any) => z.zone_code === term.zone_code);
      const hotspot = overview.hotspots?.ranked?.find((h: any) => h.zone_code === term.zone_code);
      const anomaly = overview.anomalies?.find((a: any) => a.zone_code === term.zone_code);
      const currentIndex = zone?.current_index ?? 50.0;
      const peakIndex = zone?.peak_index ?? currentIndex;
      const activeScore = filterState.mode === "FORECAST" ? peakIndex : currentIndex;
      let level = "LOW";
      if (activeScore >= 80) level = "CRITICAL"; else if (activeScore >= 60) level = "HIGH"; else if (activeScore >= 40) level = "ELEVATED";
      return {
        ...term, current_index: currentIndex, peak_index: peakIndex, peak_hour: zone?.peak_hour ?? 16,
        queue_now: zone?.queue_now ?? 0, wait_now: zone?.wait_now ?? 0, yard_util_pct: zone?.yard_util_pct ?? 0,
        level, risk_score: hotspot?.risk_score, binding_constraint: hotspot?.binding_constraint,
        confidence: hotspot?.confidence, has_anomaly: anomaly?.is_anomaly ?? false,
        anomaly_kind: anomaly?.kind, recent_index: zone?.recent_index ?? [],
      };
    });
  }, [terminalsData, overview, filterState.mode]);

  const filteredTerminals = useMemo(() => enrichedTerminals.filter((t) => {
    if (filterState.selectedTerminalCode && t.code !== filterState.selectedTerminalCode) return false;
    if (filterState.severityFilter !== "ALL" && t.level !== filterState.severityFilter) return false;
    return true;
  }), [enrichedTerminals, filterState.selectedTerminalCode, filterState.severityFilter]);

  const selectedTerminal = useMemo(() => !filterState.selectedTerminalCode ? null : enrichedTerminals.find((t) => t.code === filterState.selectedTerminalCode) || null,
    [enrichedTerminals, filterState.selectedTerminalCode]);

  const terminalVessels: VesselItem[] = useMemo(() => {
    if (!vesselsData?.vessels || !selectedTerminal) return [];
    return vesselsData.vessels.filter((v: any) => v.dest_zone_code === selectedTerminal.zone_code);
  }, [vesselsData, selectedTerminal]);

  const anchorages: AnchorageZone[] = useMemo(() => {
    const rows = (overview as any)?.anchorages ?? [];
    return rows.map((row: any, i: number) => {
      const geometry = ANCHORAGE_GEOMETRY[row.name] ?? { name: row.name ?? `Anchorage ${i + 1}`, lat: row.lat ?? 33.71, lon: row.lon ?? -118.20 };
      return { code: row.code ?? `ANCH-${i + 1}`, name: geometry.name, lat: geometry.lat, lon: geometry.lon,
               vessels_count: Number(row.vessels_count ?? 0), avg_wait_hours: Number(row.avg_wait_hours ?? 0) };
    });
  }, [overview]);

  const setSelectedTerminalCode = (code: string | null) => setFilterState((prev) => ({ ...prev, selectedTerminalCode: code }));
  const setHorizon = (horizon: 24 | 48 | 72) => setFilterState((prev) => ({ ...prev, horizon }));
  const setSeverityFilter = (severity: MapFilterState["severityFilter"]) => setFilterState((prev) => ({ ...prev, severityFilter: severity }));
  const setMode = (mode: "CURRENT" | "FORECAST") => setFilterState((prev) => ({ ...prev, mode }));
  const toggleLayer = (layer: keyof MapFilterState["layers"]) => setFilterState((prev) => ({ ...prev, layers: { ...prev.layers, [layer]: !prev.layers[layer] } }));

  return { terminals: enrichedTerminals, filteredTerminals, selectedTerminal, terminalVessels, anchorages, filterState,
    setSelectedTerminalCode, setHorizon, setSeverityFilter, setMode, toggleLayer,
    isLoading: overviewLoading || terminalsLoading || vesselsLoading, error: overviewError || terminalsError };
}
