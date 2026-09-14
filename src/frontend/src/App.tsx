import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api, fmtNum, fmtUsd } from "./api";

/* ------------------------------------------------------------------ atoms */
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`card p-4 ${className}`}>{children}</div>;
}
function Kpi({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: string }) {
  return (
    <div className="card-2 p-3">
      <div className="muted text-xs uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-semibold" style={tone ? { color: tone } : undefined}>{value}</div>
      {sub && <div className="muted text-xs mt-1">{sub}</div>}
    </div>
  );
}
function Level({ level }: { level: string }) {
  const map: Record<string, string> = { CRIT: "#fb7185", HIGH: "#fb923c", ELEVATED: "#fbbf24", LOW: "#2dd4bf" };
  return <span className="chip" style={{ color: map[level] ?? "#93a4bf", borderColor: map[level] ?? "#23324e" }}>{level}</span>;
}
function Sparkline({ data, color = "#2dd4bf" }: { data: number[]; color?: string }) {
  if (!data?.length) return null;
  const w = 160, h = 34, min = Math.min(...data), max = Math.max(...data), r = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / r) * h}`).join(" ");
  return (
    <svg width={w} height={h} role="img" aria-label="recent index trend">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}
function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn().then((d) => alive && (setData(d), setErr(null))).catch((e) => alive && setErr(String(e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, err, loading, setData };
}

/* ------------------------------------------------------------------ overview */
function Overview() {
  const { data, err, loading } = useAsync(api.overview);
  if (loading) return <div className="muted">Loading overview… (first call trains LightGBM + solves CP-SAT)</div>;
  if (err) return <div style={{ color: "var(--bad)" }}>{err}</div>;
  const k = data.kpis;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <Kpi label="Index now" value={k.port_index_now} tone="var(--accent)" />
        <Kpi label="72h peak" value={k.peak_forecast_index} sub={`at +${k.peak_forecast_hour}h`} tone="var(--warn)" />
        <Kpi label="At anchor" value={k.vessels_at_anchor} sub={`${k.vessels_inbound} inbound`} />
        <Kpi label="Avg anchorage wait" value={`${k.avg_anchorage_wait}h`} sub={`max ${k.max_anchored_hours}h`} />
        <Kpi label="Berth util" value={`${k.berth_util_pct}%`} />
        <Kpi label="Crane util" value={`${k.crane_util_pct}%`} />
        <Kpi label="Moves pending" value={fmtNum(k.moves_pending)} />
        <Kpi label="Fleet burn/day" value={fmtUsd(k.daily_fleet_burn_usd)} tone="var(--bad)" />
        <Kpi label="Arrivals next 24h" value={k.arrivals_next24} />
      </div>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Zone congestion — forecast peak &amp; binding resource</h3>
          <span className="muted text-xs">{data.dataset.source}: {data.dataset.note}</span>
        </div>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {data.zones.map((z: any) => {
            const h = data.hotspots.ranked.find((r: any) => r.zone_code === z.zone_code);
            return (
              <div key={z.zone_code} className="card-2 p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{z.label}</div>
                  <Level level={z.level} />
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <div>
                    <div className="text-xl font-semibold accent">{z.peak_index}</div>
                    <div className="muted text-xs">peak @ +{z.peak_hour}h · now {z.current_index}</div>
                    <div className="muted text-xs">q {z.queue_now} · wait {z.wait_now}h · yard {z.yard_util_pct}%</div>
                  </div>
                  <Sparkline data={z.recent_index} />
                </div>
                {h && (
                  <div className="muted text-xs mt-2">
                    risk {h.risk_score}/100 · binding <b className="accent">{h.binding_constraint}</b> · conf {h.confidence}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <h3 className="font-semibold mb-2">Alerts</h3>
          <ul className="space-y-2">
            {data.alerts.map((a: any, i: number) => (
              <li key={i} className="card-2 p-2">
                <span className="chip" style={{ color: a.severity === "crit" ? "var(--bad)" : a.severity === "warn" ? "var(--warn)" : "var(--muted)" }}>{a.severity}</span>
                <span className="ml-2 text-sm">{a.title}</span>
                <div className="muted text-xs mt-1">{a.detail}</div>
              </li>
            ))}
            {!data.alerts.length && <li className="muted text-sm">No active alerts.</li>}
          </ul>
        </Card>
        <Card>
          <h3 className="font-semibold mb-2">Anomaly detection (Isolation Forest)</h3>
          <table>
            <thead><tr><th>Zone</th><th>Kind</th><th>Score</th><th>Flagged</th><th>n</th></tr></thead>
            <tbody>
              {data.anomalies.map((a: any) => (
                <tr key={a.zone_code}>
                  <td>{a.zone_code}</td><td>{a.kind}</td><td className="mono">{a.score}</td>
                  <td>{a.is_anomaly ? <span style={{ color: "var(--bad)" }}>yes</span> : <span className="muted">no</span>}</td>
                  <td className="muted">{a.sample_size}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ forecast */
function Forecast() {
  const [zone, setZone] = useState("Z-PORT");
  const { data, err, loading } = useAsync(() => api.forecast(zone), [zone]);
  const zones = ["Z-PORT", "Z-LBCT", "Z-ITS", "Z-PCT", "Z-TTI"];
  if (loading) return <div className="muted">Forecasting…</div>;
  if (err) return <div style={{ color: "var(--bad)" }}>{err}</div>;
  const s = data.selected;
  const chart = s.points.map((p: any) => ({ ...p, label: `+${p.hour}h`, band: [p.lo, p.hi] }));
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="muted text-sm">Zone</label>
        <select value={zone} onChange={(e) => setZone(e.target.value)}
          className="card-2 px-3 py-1.5 text-sm" style={{ color: "var(--text)" }}>
          {zones.map((z) => <option key={z} value={z} style={{ color: "#000" }}>{z}</option>)}
        </select>
        <span className="muted text-xs">LightGBM quantile bands (80%)</span>
      </div>

      <Card>
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="font-semibold">{s.zone_name} — 72h congestion forecast</h3>
          <div className="text-sm muted">now <b className="accent">{s.current.index}</b> · peak <b style={{ color: "var(--warn)" }}>{s.peak.index}</b> @ +{s.peak.hour}h · avg {s.avg_index}</div>
        </div>
        <div style={{ height: 320 }}>
          <ResponsiveContainer>
            <ComposedChart data={chart} margin={{ top: 8, right: 16, bottom: 4, left: -10 }}>
              <CartesianGrid stroke="#23324e" strokeDasharray="3 3" />
              <XAxis dataKey="label" interval={11} tick={{ fill: "#93a4bf", fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fill: "#93a4bf", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "#0b1220", border: "1px solid #23324e", color: "#e6edf7" }} />
              <Area dataKey="band" stroke="none" fill="#2dd4bf" fillOpacity={0.16} />
              <Line dataKey="index" stroke="#fbbf24" dot={false} strokeWidth={2} name="index" />
              <ReferenceLine x="+1h" stroke="#93a4bf" strokeDasharray="4 4" label={{ value: "now", fill: "#93a4bf", fontSize: 10 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <h3 className="font-semibold mb-2">Model card</h3>
          <table>
            <tbody>
              <tr><td className="muted">Algorithm</td><td>{s.model.algorithm}</td></tr>
              <tr><td className="muted">Model version</td><td className="mono">{s.model.model_version}</td></tr>
              <tr><td className="muted">Training rows</td><td>{s.model.training_rows}</td></tr>
              <tr><td className="muted">Holdout</td><td>{s.model.holdout_hours}h</td></tr>
              <tr><td className="muted">MAE ≤24h / ≤72h</td><td>{s.model.mae24} / {s.model.mae72}</td></tr>
              <tr><td className="muted">R² / skill vs persistence</td><td>{s.model.r2} / {s.model.skill_pct}%</td></tr>
            </tbody>
          </table>
          <div className="muted text-xs mt-2">Top features: {s.model.top_features?.map((f: any) => `${f.feature} (${f.gain})`).join(", ")}</div>
        </Card>
        <Card>
          <h3 className="font-semibold mb-2">Bottleneck attribution (risk score)</h3>
          <table>
            <thead><tr><th>Zone</th><th>Risk</th><th>Binding</th><th>Conf</th><th>Evidence</th></tr></thead>
            <tbody>
              {data.hotspots.ranked.map((r: any) => (
                <tr key={r.zone_code}>
                  <td>{r.zone_code}</td><td className="mono">{r.risk_score}</td>
                  <td className="accent">{r.binding_constraint}</td><td className="muted">{r.confidence}</td>
                  <td className="muted text-xs">{r.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card>
        <h3 className="font-semibold mb-2">Per-horizon validation (multi-origin residuals)</h3>
        <table>
          <thead><tr><th>Horizon</th><th>MAE</th><th>σ</th><th>Bias</th><th>n</th></tr></thead>
          <tbody>
            {s.validation.buckets.map((b: any) => (
              <tr key={b.label}><td>{b.label}</td><td className="mono">{b.mae}</td><td className="mono">{b.sigma}</td><td className="mono">{b.bias}</td><td className="muted">{b.n}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="muted text-xs mt-2">Drivers: {s.drivers.map((d: any) => d.label).join(" · ")}</div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ berth & cranes */
function BerthCranes() {
  const { data: terms } = useAsync(api.terminals);
  const [run, setRun] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [crane, setCrane] = useState(1.0);
  const [rate, setRate] = useState(28);
  const initial = useRef<any>(null);
  const { data: latest } = useAsync(api.optimiseLatest);
  const opt = run ?? latest;
  useEffect(() => { if (latest) initial.current = latest; }, [latest]);

  async function apply() {
    setBusy(true);
    try { setRun(await api.optimise({ crane_factor: crane, move_rate_per_crane_hour: rate })); }
    finally { setBusy(false); }
  }

  const maxHour = 96;
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <div className="muted text-xs mb-1">Crane availability: <b className="accent">{Math.round(crane * 100)}%</b></div>
            <input type="range" min={0.5} max={1} step={0.05} value={crane} onChange={(e) => setCrane(+e.target.value)} className="w-56" />
          </div>
          <div>
            <div className="muted text-xs mb-1">STS productivity: <b className="accent">{rate} moves/crane-h</b></div>
            <input type="range" min={20} max={35} step={1} value={rate} onChange={(e) => setRate(+e.target.value)} className="w-56" />
          </div>
          <button onClick={apply} disabled={busy} className="chip" style={{ background: "var(--accent)", color: "#04231f", borderColor: "transparent", padding: "6px 14px" }}>
            {busy ? "Solving CP-SAT…" : "Run scenario"}
          </button>
          {opt && <span className="muted text-xs">solver <b className="accent">{opt.solver}</b> · {opt.status} · {opt.solve_ms}ms</span>}
        </div>
      </Card>

      {opt && (
        <>
          <div className="grid md:grid-cols-4 gap-3">
            <Kpi label="Serviced" value={`${opt.metrics.serviced}`} sub={`FIFO ${opt.baseline.serviced} · deferred ${opt.metrics.deferred}`} />
            <Kpi label="Total wait" value={`${opt.metrics.total_wait_hours}h`} sub={`FIFO ${opt.baseline.total_wait_hours}h (Δ ${opt.deltas.wait_total}h)`} tone="var(--accent)" />
            <Kpi label="Weighted wait" value={`${opt.metrics.weighted_wait_hours}h`} sub={`FIFO ${opt.baseline.weighted_wait_hours}h`} />
            <Kpi label="Makespan" value={`${opt.metrics.makespan_hours}h`} sub={`FIFO ${opt.baseline.makespan_hours}h`} />
            <Kpi label="Berth util" value={`${opt.metrics.berth_util_pct}%`} sub={`FIFO ${opt.baseline.berth_util_pct}%`} />
            <Kpi label="Crane util" value={`${opt.metrics.crane_util_pct}%`} sub={`FIFO ${opt.baseline.crane_util_pct}%`} />
            <Kpi label="Moves served" value={fmtNum(opt.metrics.total_moves)} sub={`FIFO ${fmtNum(opt.baseline.total_moves)}`} />
            <Kpi label="Avg cranes/vessel" value={opt.metrics.avg_cranes_per_vessel} sub={`FIFO ${opt.baseline.avg_cranes_per_vessel}`} />
          </div>

          <Card>
            <h3 className="font-semibold mb-1">72h berth Gantt (CP-SAT assignments)</h3>
            <div className="muted text-xs mb-3">objective weights: {Object.entries(opt.weights || {}).map(([k, v]) => `${k}=${v}`).join(" · ")}</div>
            <div className="overflow-x-auto">
              <div style={{ minWidth: 900 }}>
                {Object.entries(
                  (opt.assignments || []).reduce((acc: any, a: any) => {
                    (acc[`${a.terminal_code} ${a.berth_name}`] ||= []).push(a); return acc;
                  }, {})
                ).sort().map(([berth, list]: any) => (
                  <div key={berth} className="flex items-center gap-2 py-1">
                    <div className="mono text-xs" style={{ width: 110 }}>{berth}</div>
                    <div className="relative flex-1" style={{ height: 22, background: "#0e1729", border: "1px solid var(--line)", borderRadius: 6 }}>
                      {list.map((a: any, i: number) => (
                        <div key={i} title={`${a.vessel_name} · +${a.start_hour}→${a.end_hour}h · ${a.cranes} cranes`}
                          className="absolute top-0 h-full text-[10px] flex items-center justify-center"
                          style={{
                            left: `${(a.start_hour / maxHour) * 100}%`,
                            width: `${Math.max(1.2, ((a.end_hour - a.start_hour) / maxHour) * 100)}%`,
                            background: "rgba(45,212,191,0.35)", border: "1px solid #2dd4bf", borderRadius: 4, color: "#e6edf7", overflow: "hidden",
                          }}>
                          {a.vessel_name.replace("M/V ", "")} ×{a.cranes}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <h3 className="font-semibold mb-2">Assignments ({opt.assignments.length}) · deferred ({opt.deferred.length})</h3>
            <div className="overflow-x-auto max-h-80">
              <table>
                <thead><tr><th>Vessel</th><th>Berth</th><th>Terminal</th><th>Start</th><th>End</th><th>Cranes</th><th>Wait h</th></tr></thead>
                <tbody>
                  {opt.assignments.map((a: any) => (
                    <tr key={a.vessel_id}>
                      <td>{a.vessel_name}</td><td className="mono">{a.berth_name}</td><td>{a.terminal_code}</td>
                      <td className="mono">+{a.start_hour}h</td><td className="mono">+{a.end_hour}h</td>
                      <td>{a.cranes}</td><td className="mono">{a.wait_hours}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!!opt.deferred.length && (
              <div className="muted text-xs mt-2">Deferred: {opt.deferred.map((d: any) => d.vessel_name).join(", ")}</div>
            )}
          </Card>
        </>
      )}

      {terms && (
        <Card>
          <h3 className="font-semibold mb-2">Terminals — real POLB capacity, live yard &amp; crane state</h3>
          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
            {terms.terminals.map((t: any) => (
              <div key={t.code} className="card-2 p-3">
                <div className="font-medium">{t.code} · {t.pier}</div>
                <div className="muted text-xs">{t.name}</div>
                <div className="text-xs mt-2">
                  {t.deepsea_berths} berths · {t.gantry_cranes} STS · {fmtNum(t.berth_length_ft)} ft
                  {t.capacity_teu_m ? ` · ${t.capacity_teu_m}M TEU/yr` : ""}
                </div>
                <div className="text-xs mt-1">
                  cranes: <span className="accent">{t.cranes.filter((c: any) => c.status === "AVAILABLE").length} available</span>
                  {t.cranes.some((c: any) => c.status !== "AVAILABLE") && <span className="muted"> · {t.cranes.filter((c: any) => c.status !== "AVAILABLE").length} maint.</span>}
                </div>
                <div className="muted text-xs mt-1">
                  yard {t.yard_zones.map((y: any) => `${y.code}:${y.util_pct}%`).join(" ")}
                </div>
                <div className="muted text-xs">gate {t.gate?.lanes} lanes · q {t.gate?.queue_len}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ routing */
function Routing() {
  const { data, err, loading } = useAsync(api.routing);
  const [filter, setFilter] = useState("ALL");
  if (loading) return <div className="muted">Loading routing…</div>;
  if (err) return <div style={{ color: "var(--bad)" }}>{err}</div>;
  const recs = data.recommendations.filter((r: any) => filter === "ALL" || r.option === filter);
  const optColors: any = { DIVERT: "var(--bad)", SLOW_STEAM: "var(--warn)", PRIORITY_WINDOW: "var(--accent)", HOLD: "var(--muted)" };
  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-5 gap-3">
        <Kpi label="Total savings" value={fmtUsd(data.total_savings_usd)} tone="var(--accent)" />
        {Object.entries(data.counts).map(([k, v]) => <Kpi key={k} label={k} value={v as number} />)}
      </div>
      <div className="flex gap-2 flex-wrap">
        {["ALL", ...Object.keys(data.counts)].map((f) => (
          <button key={f} className="chip" onClick={() => setFilter(f)}
            style={{ borderColor: filter === f ? "var(--accent)" : "var(--line)", color: filter === f ? "var(--accent)" : "var(--text)" }}>{f}</button>
        ))}
      </div>
      <div className="grid lg:grid-cols-2 gap-3">
        {recs.map((r: any, i: number) => (
          <div key={i} className="card-2 p-3">
            <div className="flex items-center justify-between">
              <div className="font-medium">{r.vessel_name} <span className="muted text-xs">· {r.carrier}</span></div>
              <span className="chip" style={{ color: optColors[r.option], borderColor: optColors[r.option] }}>{r.option}</span>
            </div>
            <div className="text-xs mt-2">predicted wait <b>{r.predicted_wait_hours}h</b>{r.target_port ? ` → ${r.target_port}` : ""} · savings <b className="accent">{fmtUsd(r.est_savings_usd)}</b> · conf {r.confidence}{r.sustained ? " · sustained" : ""}</div>
            <div className="muted text-xs mt-2">{r.rationale}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ plan */
function Plan() {
  const { data, err, loading } = useAsync(api.plan);
  if (loading) return <div className="muted">Building 72h plan…</div>;
  if (err) return <div style={{ color: "var(--bad)" }}>{err}</div>;
  const s = data.summary;
  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-4 xl:grid-cols-6 gap-3">
        <Kpi label="Risk" value={s.risk_level} tone={s.risk_level === "SEVERE" ? "var(--bad)" : "var(--warn)"} />
        <Kpi label="Arrivals" value={s.total_arrivals} />
        <Kpi label="Berthings" value={s.total_berthings} />
        <Kpi label="Moves" value={fmtNum(s.total_moves)} />
        <Kpi label="Crane-hours" value={fmtNum(s.crane_hours)} />
        <Kpi label="Deferred" value={s.deferred_count} />
      </div>
      <Card>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Top actions</h3>
          <a className="chip accent" href={api.exportUrl("assignments")} target="_blank" rel="noreferrer">Export assignments CSV</a>
        </div>
        <ol className="list-decimal ml-5 text-sm mt-2 space-y-1">{s.top_actions.map((a: string, i: number) => <li key={i}>{a}</li>)}</ol>
      </Card>
      <div className="grid lg:grid-cols-2 gap-3">
        {data.shifts.map((sh: any) => (
          <div key={sh.seq} className="card-2 p-3">
            <div className="flex items-center justify-between">
              <div className="font-medium">{sh.label}</div>
              <span className="muted text-xs">{sh.window_label}</span>
            </div>
            <div className="text-xs mt-2">
              <b>Arrivals:</b> {sh.arrivals.length ? sh.arrivals.map((a: any) => `${a.vessel_name.replace("M/V ", "")}@+${a.eta_hour}h`).join(", ") : "none"}
            </div>
            {!!sh.berthings.length && <div className="text-xs mt-1"><b>Berthings:</b> {sh.berthings.map((b: any) => `${b.vessel_name}→${b.berth_name} (${b.cranes}c)`).join(", ")}</div>}
            {!!sh.congestion_alerts.length && <div className="text-xs mt-1"><b>Alerts:</b> {sh.congestion_alerts.map((a: any) => `${a.level} ${a.zone_code} ${a.peak_index}@+${a.peak_hour}h`).join(" · ")}</div>}
            {!!sh.routing_actions.length && <div className="text-xs mt-1"><b>Routing:</b> {sh.routing_actions.join(" ")}</div>}
            <ul className="text-xs muted mt-2 list-disc ml-4">{sh.checklist.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ bob */
function Bob() {
  const [msgs, setMsgs] = useState<{ role: string; content: string; actions?: string[]; mode?: string }[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);
  async function send(q?: string) {
    const message = (q ?? text).trim();
    if (!message) return;
    setMsgs((m) => [...m, { role: "user", content: message }]);
    setText(""); setBusy(true);
    try {
      const r = await api.bob(message);
      setMsgs((m) => [...m, { role: "assistant", content: r.content, actions: r.actions, mode: r.mode }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: `error: ${e}` }]);
    } finally { setBusy(false); }
  }
  const quick = [
    "what is the congestion outlook for the next 72 hours?",
    "which terminal is the hotspot and what is binding it?",
    "how does the CP-SAT optimiser compare to FIFO?",
    "which vessels should divert and what would we save?",
  ];
  return (
    <div className="grid lg:grid-cols-[1fr_260px] gap-4">
      <Card className="flex flex-col" >
        <h3 className="font-semibold mb-2">Bob — engine-grounded ops assistant</h3>
        <div className="flex-1 space-y-3 overflow-y-auto pr-1" style={{ maxHeight: "58vh" }}>
          {!msgs.length && <div className="muted text-sm">Ask about congestion, hotspots, the optimiser, routing or the 72h plan. Every answer is produced by actually running the engines; mode shows llm vs deterministic fallback.</div>}
          {msgs.map((m, i) => (
            <div key={i} className={`card-2 p-2 ${m.role === "user" ? "ml-10" : "mr-10"}`}>
              <div className="text-xs muted">{m.role}{m.mode ? ` · ${m.mode}` : ""}</div>
              <div className="text-sm whitespace-pre-wrap">{m.content}</div>
              {!!m.actions?.length && <div className="mt-1 flex flex-wrap gap-1">{m.actions.map((a) => <span key={a} className="chip muted text-[10px]">{a}</span>)}</div>}
            </div>
          ))}
          {busy && <div className="muted text-sm">Bob is running the engines…</div>}
          <div ref={endRef} />
        </div>
        <div className="flex gap-2 mt-3">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="e.g. what's the congestion outlook for the next 72 hours?"
            className="card-2 flex-1 px-3 py-2 text-sm" style={{ color: "var(--text)" }} />
          <button onClick={() => send()} disabled={busy} className="chip" style={{ background: "var(--accent)", color: "#04231f", borderColor: "transparent" }}>Ask</button>
        </div>
      </Card>
      <Card>
        <h3 className="font-semibold mb-2 text-sm">Quick prompts</h3>
        <div className="space-y-2">
          {quick.map((q) => <button key={q} onClick={() => send(q)} className="chip block w-full text-left text-xs">{q}</button>)}
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ shell */
const TABS = [
  { id: "overview", label: "Overview", el: <Overview /> },
  { id: "forecast", label: "Forecast", el: <Forecast /> },
  { id: "berth", label: "Berth & Cranes", el: <BerthCranes /> },
  { id: "routing", label: "Routing", el: <Routing /> },
  { id: "plan", label: "72-Hr Plan", el: <Plan /> },
  { id: "bob", label: "Bob AI", el: <Bob /> },
];

export default function App() {
  const [tab, setTab] = useState("overview");
  const current = useMemo(() => TABS.find((t) => t.id === tab) ?? TABS[0], [tab]);
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10" style={{ background: "rgba(11,18,32,0.92)", borderBottom: "1px solid var(--line)", backdropFilter: "blur(6px)" }}>
        <div className="mx-auto max-w-[1500px] px-5 py-3 flex flex-wrap items-center gap-4">
          <div>
            <div className="font-semibold">PortFlow SBX</div>
            <div className="muted text-[11px]">San Pedro Bay · LightGBM forecast · CP-SAT optimiser · SimPy ops layer</div>
          </div>
          <nav className="flex gap-1 flex-wrap">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} className="px-3 py-1.5 rounded-md text-sm"
                style={{ background: tab === t.id ? "var(--panel-2)" : "transparent", color: tab === t.id ? "var(--accent)" : "var(--text)", border: "1px solid", borderColor: tab === t.id ? "var(--line)" : "transparent" }}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] px-5 py-5">{current.el}</main>
      <footer className="mx-auto max-w-[1500px] px-5 py-6 muted text-xs">
        Forecast: LightGBM (quantile bands) · Anomalies: scikit-learn Isolation Forest · Optimiser: OR-Tools CP-SAT (BAP/QCAP) ·
        Simulation: SimPy · API: FastAPI · DB: PostgreSQL. Terminal capacity: real Port of Long Beach fact sheets; vessel/history layer: labelled DEMO_AIS.
      </footer>
    </div>
  );
}
