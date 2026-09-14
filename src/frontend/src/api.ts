// Typed-ish fetch client for the FastAPI gateway.

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

export const api = {
  overview: () => get("/api/overview"),
  forecast: (zone: string) => get(`/api/forecast?zone=${encodeURIComponent(zone)}`),
  terminals: () => get("/api/terminals"),
  vessels: () => get("/api/vessels"),
  anomalies: () => get("/api/anomalies"),
  hotspots: () => get("/api/hotspots"),
  routing: () => get("/api/routing"),
  plan: () => get("/api/plan"),
  optimiseLatest: () => get("/api/optimise/latest"),
  optimise: (body: { crane_factor: number; move_rate_per_crane_hour: number }) =>
    post("/api/optimise", body),
  scenario: (body: { crane_factor: number; move_rate_per_crane_hour: number }) =>
    post("/api/scenarios", body),
  bobHistory: () => get("/api/bob"),
  bob: (message: string) => post("/api/bob", { message }),
  exportUrl: (type: string) => `/api/export?type=${type}`,
};

export const fmtUsd = (n: number) => `$${Math.round(n).toLocaleString()}`;
export const fmtNum = (n: number) => Math.round(n).toLocaleString();
