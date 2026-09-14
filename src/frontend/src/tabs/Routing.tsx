// Routing tab. Owner: W4. (W3 adds in-port alternates to option_detail.)
import { useState } from "react";
import { api } from "../api";
import { Card, ErrorBox, Kpi, Loading, useAsync } from "../components/ui";

export default function Routing() {
  const { data, err, loading } = useAsync(api.routing);
  const [filter, setFilter] = useState("ALL");
  if (loading) return <Loading what="Loading routing" />;
  if (err) return <ErrorBox err={err} />;
  const recs = data.recommendations.filter((r: any) => filter === "ALL" || r.option === filter);
  const colors: any = { DIVERT: "var(--bad)", SLOW_STEAM: "var(--warn)", PRIORITY_WINDOW: "var(--accent)", HOLD: "var(--muted)" };
  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-5 gap-3">
        <Kpi label="Total savings" value={`$${Number(data.total_savings_usd).toLocaleString()}`} tone="var(--accent)" />
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
              <span className="chip" style={{ color: colors[r.option], borderColor: colors[r.option] }}>{r.option}</span>
            </div>
            <div className="text-xs mt-2">
              predicted wait <b>{r.predicted_wait_hours}h</b>{r.target_port ? ` → ${r.target_port}` : ""} ·
              savings <b className="accent">${Number(r.est_savings_usd).toLocaleString()}</b> · conf {r.confidence}{r.sustained ? " · sustained" : ""}
            </div>
            <div className="muted text-xs mt-2">{r.rationale}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
