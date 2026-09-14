// Typed fetch client for the FastAPI gateway. See docs/api-contract.md.
import type { QualityResponse, ScenarioExtendedRequest, ScenarioExtendedResponse, TidesResponse, UploadResponse, WeatherResponse } from "./types";

export async function get<T = any>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

export async function post<T = any>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

export async function upload<T = any>(path: string, file: File): Promise<T> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(path, { method: "POST", body: fd });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

export const api = {
  // --- existing ---
  overview: () => get("/api/overview"),
  forecast: (zone: string) => get(`/api/forecast?zone=${encodeURIComponent(zone)}`),
  terminals: () => get("/api/terminals"),
  vessels: () => get("/api/vessels"),
  hotspots: () => get("/api/hotspots"),
  routing: () => get("/api/routing"),
  plan: () => get("/api/plan"),
  optimiseLatest: () => get("/api/optimise/latest"),
  optimise: (body: { crane_factor: number; move_rate_per_crane_hour: number; incremental?: boolean; tidal?: boolean }) =>
    post("/api/optimise", body),
  tides: (hours = 72) => get<TidesResponse>(`/api/tides?hours=${hours}`),
  bobHistory: () => get("/api/bob"),
  bob: (message: string) => post("/api/bob", { message }),
  exportUrl: (type: string) => `/api/export?type=${type}`,

  // --- Phase 0 stubs (W1/W2/W3 implement) ---
  anomalies: () => get("/api/anomalies"),
  quality: () => get<QualityResponse>("/api/quality"),
  weather: (hours = 72) => get<WeatherResponse>(`/api/weather?hours=${hours}`),
  uploadSchedule: (file: File) => upload<UploadResponse>("/api/vessels/upload", file),
  scenario: (body: { crane_factor: number; move_rate_per_crane_hour: number }) => post("/api/scenarios", body),
  scenarioExtended: (body: ScenarioExtendedRequest) => post<ScenarioExtendedResponse>("/api/scenarios/extended", body),
  scenarioRollback: (id: number) => post<{ restored: boolean }>(`/api/scenarios/${id}/rollback`),
};

export const fmtUsd = (n: number) => `$${Math.round(n).toLocaleString()}`;
export const fmtNum = (n: number) => Math.round(n).toLocaleString();
