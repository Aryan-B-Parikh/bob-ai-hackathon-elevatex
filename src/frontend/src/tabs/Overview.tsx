// Overview tab. Owner: W4.
import { api } from "../api";
import { Card, ErrorBox, Kpi, Level, Loading, Sparkline, useAsync } from "../components/ui";

export default function Overview() {
  const { data, err, loading } = useAsync(api.overview);
  if (loading) return <Loading what="Loading overview" />;
  if (err) return <ErrorBox err={err} />;
  const k = data.kpis;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <Kpi label="Index now" value={k.port_index_now} tone="var(--accent)" />
        <Kpi label="72h peak" value={k.peak_forecast_index} sub={`at +${k.peak_forecast_hour}h`} tone="var(--warn)" />
        <Kpi label="At anchor" value={k.vessels_at_anchor} sub={`${k.vessels_inbound} inbound`} />
        <Kpi label="Avg anchorage wait" value={`${k.avg_anchorage_wait}h`} sub={`max ${k.max_anchored_hours}h`} />
        <Kpi label="Berth util" value={`${k.berth_util_pct}%`} />
        <Kpi label="Crane util" value={`${k.crane_util_pct}%`} />
        <Kpi label="Moves pending" value={Number(k.moves_pending).toLocaleString()} />
        <Kpi label="Fleet burn/day" value={`$${Number(k.daily_fleet_burn_usd).toLocaleString()}`} tone="var(--bad)" />
        <Kpi label="Arrivals next 24h" value={k.arrivals_next24} />
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="font-semibold text-sm sm:text-base">Zone congestion — forecast peak &amp; binding resource</h3>
          <span className="muted text-xs font-mono">{data.dataset.source}</span>
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
                <div className="mt-2 flex items-end justify-between gap-2">
                  <div>
                    <div className="text-xl font-semibold accent font-mono">{z.peak_index}</div>
                    <div className="muted text-xs">peak @ +{z.peak_hour}h · now {z.current_index}</div>
                    <div className="muted text-xs">q {z.queue_now} · wait {z.wait_now}h · yard {z.yard_util_pct}%</div>
                  </div>
                  <Sparkline data={z.recent_index} />
                </div>
                {h && (
                  <div className="muted text-xs mt-2 pt-2 border-t border-[var(--border-subtle)]">
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
            {!data.alerts.length && <li className="muted text-sm py-4 text-center">No active alerts detected.</li>}
          </ul>
        </Card>
        <Card>
          <h3 className="font-semibold mb-2">Anomaly detection (Isolation Forest)</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[360px]">
              <thead><tr><th>Zone</th><th>Kind</th><th>Score</th><th>Flagged</th><th>n</th></tr></thead>
              <tbody>
                {data.anomalies.map((a: any) => (
                  <tr key={a.zone_code}>
                    <td>{a.zone_code}</td><td>{a.kind}</td><td className="mono">{a.score}</td>
                    <td>{a.is_anomaly ? <span style={{ color: "var(--bad)" }}>yes</span> : <span className="muted">no</span>}</td>
                    <td className="muted">{a.sample_size}</td>
                  </tr>
                ))}
                {!data.anomalies.length && (
                  <tr>
                    <td colSpan={5} className="muted text-center py-4">No spatial anomalies flagged.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
