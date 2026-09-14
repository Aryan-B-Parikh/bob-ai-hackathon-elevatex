// Berth & Cranes tab. Owner: W4. (W3 adds tidal/incremental + extended scenarios.)
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { Card, ErrorBox, Kpi, Loading, useAsync } from "../components/ui";

export default function BerthCranes() {
  const { data: terms } = useAsync(api.terminals);
  const { data: latest, loading } = useAsync(api.optimiseLatest);
  const [run, setRun] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [crane, setCrane] = useState(1.0);
  const [rate, setRate] = useState(28);
  const [useTidal, setUseTidal] = useState(true);
  const [useIncremental, setUseIncremental] = useState(false);
  // W3 demo evidence: remember the last cold and warm solve so the speed-up is visible,
  // not just asserted. A warm start needs a cached solution, so the first run is always cold.
  const [coldMs, setColdMs] = useState<number | null>(null);
  const [warmMs, setWarmMs] = useState<number | null>(null);
  // tide curve is fetched across the full Gantt span (maxHour) so the shading does not
  // stop short of the chart; the endpoint accepts 24..168h.
  const { data: tideData } = useAsync(() => api.tides(96), []);
  const initial = useRef<any>(null);
  useEffect(() => { if (latest) initial.current = latest; }, [latest]);
  const opt = run ?? latest;

  async function apply() {
    setBusy(true);
    try {
      const out = await api.optimise({
        crane_factor: crane, move_rate_per_crane_hour: rate,
        tidal: useTidal, incremental: useIncremental,
      });
      setRun(out);
      // label by what the solver actually did, not by what we asked for — the backend
      // declines to warm-start when the problem instance changed (crane slider moved).
      if (out?.incremental) setWarmMs(out.solve_ms); else setColdMs(out?.solve_ms ?? null);
    } finally { setBusy(false); }
  }

  const maxHour = 96;

  // W3: high-water bands per berth — contiguous hours where the modelled tide sits
  // above the charted (mean) depth. Deep-draft vessels can only berth inside these.
  const bands = useMemo(() => {
    const out: Record<string, [number, number][]> = {};
    for (const b of (tideData?.berths as any[]) ?? []) {
      const open = b.curve.filter((p: any) => p.depth_ft >= b.design_depth_ft);
      const runs: [number, number][] = [];
      for (const p of open) {
        const last = runs[runs.length - 1];
        if (last && p.hour === last[1] + 1) last[1] = p.hour;
        else runs.push([p.hour, p.hour]);
      }
      out[b.berth_name] = runs;
    }
    return out;
  }, [tideData]);

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
          <div className="flex flex-col gap-1">
            <label className="text-xs flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={useTidal} onChange={(e) => setUseTidal(e.target.checked)} />
              <span>Tidal windows <span className="muted">(deep-draft berthing)</span></span>
            </label>
            <label className="text-xs flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={useIncremental} onChange={(e) => setUseIncremental(e.target.checked)} />
              <span>Incremental re-solve <span className="muted">(warm start)</span></span>
            </label>
            {coldMs != null && warmMs != null && (
              <div className="text-[10px] muted">
                cold {coldMs}ms → warm <b className="accent">{warmMs}ms</b>
                {coldMs > 0 && <> ({Math.max(0, Math.round((1 - warmMs / coldMs) * 100))}% faster)</>}
              </div>
            )}
            {useIncremental && opt && !opt.incremental && (
              <div className="text-[10px]" style={{ color: "var(--warn)" }}>
                cold solve — no cached plan for this instance yet
              </div>
            )}
          </div>
          <button onClick={apply} disabled={busy} className="chip" style={{ background: "var(--accent)", color: "#04231f", borderColor: "transparent", padding: "6px 14px" }}>
            {busy ? "Solving CP-SAT…" : "Run scenario"}
          </button>
          {opt && (
            <span className="muted text-xs">
              solver <b className="accent">{opt.solver}</b> · {opt.status} · {opt.solve_ms}ms
              {opt.gap_pct != null && <> · gap {opt.gap_pct}%</>}
              {" · "}
              <b style={{ color: opt.tidal_feasible ? "var(--accent)" : "var(--bad)" }}>
                tidal {opt.tidal_feasible ? "feasible" : "VIOLATED"}
              </b>
              {opt.incremental && <> · <b className="accent">warm-started</b></>}
            </span>
          )}
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
            <div className="flex items-baseline justify-between flex-wrap gap-2">
              <h3 className="font-semibold mb-1">72h berth Gantt (CP-SAT assignments)</h3>
              {useTidal && !!tideData && (
                <span className="muted text-xs">
                  shaded = high water (depth ≥ charted) · period {tideData.period_hours}h · amplitude {tideData.amplitude_ft}ft
                </span>
              )}
            </div>
            <div className="muted text-xs mb-3">objective weights: {Object.entries(opt.weights || {}).map(([k, v]) => `${k}=${v}`).join(" · ")}</div>
            <div className="overflow-x-auto">
              <div style={{ minWidth: 900 }}>
                {Object.entries(
                  (opt.assignments || []).reduce((acc: any, a: any) => {
                    (acc[`${a.terminal_code} ${a.berth_name}`] ||= []).push(a);
                    return acc;
                  }, {})
                ).sort().map(([berth, list]: any) => {
                  const berthName = String(berth).split(" ").slice(1).join(" ");
                  const runs = bands[berthName] ?? [];
                  return (
                    <div key={berth} className="flex items-center gap-2 py-1">
                      <div className="mono text-xs" style={{ width: 110 }}>{berth}</div>
                      <div className="relative flex-1" style={{ height: 22, background: "#0e1729", border: "1px solid var(--line)", borderRadius: 6 }}>
                        {useTidal && runs.map(([a, b]: [number, number], i: number) => (
                          <div key={`t${i}`} title={`high water +${a}→${b}h`}
                            className="absolute top-0 h-full"
                            style={{
                              left: `${(a / maxHour) * 100}%`,
                              width: `${((b - a + 1) / maxHour) * 100}%`,
                              background: "rgba(96,165,250,0.13)",
                              borderLeft: "1px dashed rgba(96,165,250,0.4)",
                            }} />
                        ))}
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
                  );
                })}
              </div>
            </div>
          </Card>

          {useTidal && !!tideData && (
            <Card>
              <h3 className="font-semibold mb-2">Tidal windows — next high water per berth</h3>
              <div className="muted text-xs mb-3">
                Semidiurnal harmonic model (12.42h, ±{tideData.amplitude_ft}ft) over charted depth, seeded into the
                tidal_window table. Deep-draft vessels (draft + {tideData.under_keel_margin_ft}ft under-keel margin &gt; charted depth)
                may only berth inside these windows.
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                {(tideData.berths as any[]).map((b) => {
                  const runs = bands[b.berth_name] ?? [];
                  const first = runs[0];
                  return (
                    <div key={b.berth_id} className="card-2 p-2">
                      <div className="mono text-xs">{b.berth_name}</div>
                      <div className="muted text-[10px]">charted {b.design_depth_ft}ft</div>
                      <div className="text-xs mt-1">
                        {first
                          ? <>high water <b className="accent">+{first[0]}→{first[1]}h</b> <span className="muted">({runs.length} windows/{maxHour}h)</span></>
                          : <span className="muted">always afloat</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

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
