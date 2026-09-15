// 72-Hr Plan tab. Owner: W4. (W3 adds summary.confidence_by_bucket.)
import { api } from "../api";
import { Card, ErrorBox, Kpi, Loading, useAsync } from "../components/ui";

export default function Plan() {
  const { data, err, loading } = useAsync(api.plan);
  if (loading) return <Loading what="Building 72h plan" />;
  if (err) return <ErrorBox err={err} />;
  const s = data.summary;
  const conf = s.confidence_by_bucket ?? {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <Kpi label="Risk" value={s.risk_level} tone={s.risk_level === "SEVERE" ? "var(--bad)" : "var(--warn)"} />
        <Kpi label="Arrivals" value={s.total_arrivals} />
        <Kpi label="Berthings" value={s.total_berthings} />
        <Kpi label="Moves" value={Number(s.total_moves).toLocaleString()} />
        <Kpi label="Crane-hours" value={Number(s.crane_hours).toLocaleString()} />
        <Kpi label="Deferred" value={s.deferred_count} />
      </div>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Top actions</h3>
          <a className="chip accent" href={api.exportUrl("assignments")} target="_blank" rel="noreferrer">Export assignments CSV</a>
        </div>
        <ol className="list-decimal ml-5 text-sm mt-2 space-y-1">{s.top_actions.map((a: string, i: number) => <li key={i}>{a}</li>)}</ol>
        {Object.keys(conf).length > 0 && (
          <div className="muted text-xs mt-2">
            confidence by bucket: {Object.entries(conf).map(([k, v]) => `${k}=${v}`).join(" · ")}
          </div>
        )}
      </Card>
      <div className="grid lg:grid-cols-2 gap-3">
        {data.shifts.map((sh: any) => (
          <div key={sh.seq} className="card-2 p-3">
            <div className="flex items-center justify-between">
              <div className="font-medium">{sh.label}</div>
              <span className="muted text-xs">{sh.window_label}</span>
            </div>
            <div className="text-xs mt-2"><b>Arrivals:</b> {sh.arrivals.length ? sh.arrivals.map((a: any) => `${a.vessel_name.replace("M/V ", "")}@+${a.eta_hour}h`).join(", ") : "none"}</div>
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
