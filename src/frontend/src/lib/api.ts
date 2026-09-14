// Centralized API client for the FastAPI gateway with Zod validation.
import type { QualityResponse, ScenarioExtendedRequest, ScenarioExtendedResponse, UploadResponse, WeatherResponse } from "../types";
import { OverviewResponseSchema } from "./schemas";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public endpoint: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function get<T = any>(path: string): Promise<T> {
  try {
    const r = await fetch(path);
    if (!r.ok) {
      throw new ApiError(`Request failed with status ${r.status}`, r.status, path);
    }
    return await r.json();
  } catch (err: any) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(err?.message || `Unable to reach ${path}`, 0, path);
  }
}

export async function post<T = any>(path: string, body?: unknown): Promise<T> {
  try {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) {
      throw new ApiError(`POST ${path} failed with status ${r.status}`, r.status, path);
    }
    return await r.json();
  } catch (err: any) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(err?.message || `Unable to execute POST ${path}`, 0, path);
  }
}

export async function upload<T = any>(path: string, file: File): Promise<T> {
  try {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(path, { method: "POST", body: fd });
    if (!r.ok) {
      throw new ApiError(`Upload to ${path} failed with status ${r.status}`, r.status, path);
    }
    return await r.json();
  } catch (err: any) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(err?.message || `Failed to upload file to ${path}`, 0, path);
  }
}

export const api = {
  // Operational Endpoints
  overview: async () => {
    const raw = await get("/api/overview");
    const parsed = OverviewResponseSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn("Overview payload schema warning:", parsed.error);
    }
    return raw;
  },
  forecast: (zone: string) => get(`/api/forecast?zone=${encodeURIComponent(zone)}`),
  terminals: () => get("/api/terminals"),
  vessels: () => get("/api/vessels"),
  hotspots: () => get("/api/hotspots"),
  routing: () => get("/api/routing"),
  plan: () => get("/api/plan"),
  optimiseLatest: () => get("/api/optimise/latest"),
  optimise: (body: { crane_factor: number; move_rate_per_crane_hour: number; incremental?: boolean }) =>
    post("/api/optimise", body),
  bobHistory: () => get("/api/bob"),
  bob: (message: string) => post("/api/bob", { message }),
  exportUrl: (type: string) => `/api/export?type=${type}`,

  // Telemetry & Phase 0/1 Endpoints
  health: () => get<{ status: string }>("/health"),
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
