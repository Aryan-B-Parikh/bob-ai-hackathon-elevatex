// Berth & Cranes tab. Owner: W4. (W3 adds tidal/incremental + extended scenarios.)
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Card, ErrorBox, Kpi, Loading, useAsync } from "../components/ui";

export default function BerthCranes() {
  const { data: terms } = useAsync(api.terminals);
  const { data: latest, loading } = useAsync(api.optimiseLatest);
  const [run, setRun] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [crane, setCrane] = useState(1.0);
  const [rate, setRate] = useState(28);
  const initial = useRef<any>(null);
  useEffect(() => { if (latest) initial.current = latest; }, [latest]);
  const opt = run ?? latest;

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
          {opt && <span className="muted text-xs">solver <b className="accent">{opt.solver}</b> · {opt.status} · {opt.solve_ms}ms · tidal_feasible {String(opt.tidal_feasible)}</span>}
        </div>
      </Card>

      {loading && <Loading what="Solving berth/crane plan" />}

      {opt && (
        <>
          <div className="grid md:grid-cols-4 gap-3">
            <Kpi label="Serviced" value={opt.metrics.serviced} sub={`FIFO ${opt.baseline.serviced} · deferred ${opt.metrics.deferred}`} />
            <Kpi label="Total wait" value={`${opt.metrics.total_wait_hours}h`} sub={`FIFO ${opt.baseline.total_wait_hours}h (Δ ${opt.deltas.wait_total}h)`} tone="var(--accent)" />
            <Kpi label="Weighted wait" value={`${opt.metrics.weighted_wait_hours}h`} sub={`FIFO ${opt.baseline.weighted_wait_hours}h`} />
            <Kpi label="Makespan" value={`${opt.metrics.makespan_hours}h`} sub={`FIFO ${opt.baseline.makespan_hours}h`} />
            <Kpi label="Berth util" value={`${opt.metrics.berth_util_pct}%`} sub={`FIFO ${opt.baseline.berth_util_pct}%`} />
            <Kpi label="Crane util" value={`${opt.metrics.crane_util_pct}%`} sub={`FIFO ${opt.baseline.crane_util_pct}%`} />
            <Kpi label="Moves served" value={Number(opt.metrics.total_moves).toLocaleString()} sub={`FIFO ${Number(opt.baseline.total_moves).toLocaleString()}`} />
            <Kpi label="Avg cranes/vessel" value={opt.metrics.avg_cranes_per_vessel} sub={`FIFO ${opt.baseline.avg_cranes_per_vessel}`} />
          </div>

          <Card>
            <h3 className="font-semibold mb-1">72h berth Gantt (CP-SAT assignments)</h3>
            <div className="muted text-xs mb-3">objective weights: {Object.entries(opt.weights || {}).map(([k, v]) => `${k}=${v}`).join(" · ")}</div>
            <div className="overflow-x-auto">
              <div style={{ minWidth: 900 }}>
                {Object.entries(
                  (opt.assignments || []).reduce((acc: any, a: any) => {
                    (acc[`${a.terminal_code} ${a.berth_name}`] ||= []).push(a);
                    return acc;
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
                            background: "rgba(45,212,191,0.35)", border: "1px solid #2dd4bf", borderRadius: 4,
                            color: "#e6edf7", overflow: "hidden",
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
            {!!opt.deferred.length && <div className="muted text-xs mt-2">Deferred: {opt.deferred.map((d: any) => d.vessel_name).join(", ")}</div>}
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
                <div className="text-xs mt-2">{t.deepsea_berths} berths · {t.gantry_cranes} STS · {Number(t.berth_length_ft).toLocaleString()} ft{t.capacity_teu_m ? ` · ${t.capacity_teu_m}M TEU/yr` : ""}</div>
                <div className="text-xs mt-1">cranes: <span className="accent">{t.cranes.filter((c: any) => c.status === "AVAILABLE").length} available</span>
                  {t.cranes.some((c: any) => c.status !== "AVAILABLE") && <span className="muted"> · {t.cranes.filter((c: any) => c.status !== "AVAILABLE").length} maint.</span>}
                </div>
                <div className="muted text-xs mt-1">yard {t.yard_zones.map((y: any) => `${y.code}:${y.util_pct}%`).join(" ")}</div>
                <div className="muted text-xs">gate {t.gate?.lanes} lanes · q {t.gate?.queue_len}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
