// Forecast tab. Owner: W4. (W2 adds weather_used / confidence; W4 adds the heatmap here.)
import { useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import { Card, ErrorBox, Loading, useAsync } from "../components/ui";

const ZONES = ["Z-PORT", "Z-LBCT", "Z-ITS", "Z-PCT", "Z-TTI"];

export default function Forecast() {
  const [zone, setZone] = useState("Z-PORT");
  const { data, err, loading } = useAsync(() => api.forecast(zone), [zone]);
  if (loading) return <Loading what="Forecasting" />;
  if (err) return <ErrorBox err={err} />;
  const s = data.selected;
  const chart = s.points.map((p: any) => ({ ...p, label: `+${p.hour}h`, band: [p.lo, p.hi] }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <label className="muted text-sm">Zone</label>
        <select
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          aria-label="Select Forecast Zone"
          className="bg-[var(--bg-surface-elevated)] border border-[var(--border-default)] rounded-md px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--brand)]"
        >
          {ZONES.map((z) => (
            <option key={z} value={z} className="bg-[var(--bg-surface-elevated)] text-[var(--text-primary)]">
              {z}
            </option>
          ))}
        </select>
        <span className="muted text-xs">LightGBM quantile bands (80%)</span>
        <span className="chip muted text-xs">weather_used: {String(data.weather_used)} · confidence {data.confidence}</span>
      </div>

      <Card>
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1 sm:gap-2 mb-2">
          <h3 className="font-semibold text-sm sm:text-base">{s.zone_name} — 72h congestion forecast</h3>
          <div className="text-xs sm:text-sm muted">
            now <b className="accent">{s.current.index}</b> · peak <b style={{ color: "var(--warn)" }}>{s.peak.index}</b> @ +{s.peak.hour}h · avg {s.avg_index}
          </div>
        </div>
        <div className="h-[260px] sm:h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart} margin={{ top: 8, right: 16, bottom: 4, left: -10 }}>
              <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
              <XAxis dataKey="label" interval={11} tick={{ fill: "var(--text-muted)", fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fill: "var(--text-muted)", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "var(--bg-surface-elevated)", border: "1px solid var(--border-default)", color: "var(--text-primary)", borderRadius: "8px" }} />
              <Area dataKey="band" stroke="none" fill="var(--accent)" fillOpacity={0.16} />
              <Line dataKey="index" stroke="var(--status-warning)" dot={false} strokeWidth={2} name="index" />
              <ReferenceLine x="+1h" stroke="var(--text-muted)" strokeDasharray="4 4" label={{ value: "now", fill: "var(--text-muted)", fontSize: 10 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <h3 className="font-semibold mb-2">Model card</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[280px]"><tbody>
              <tr><td className="muted">Algorithm</td><td>{s.model.algorithm}</td></tr>
              <tr><td className="muted">Model version</td><td className="mono">{s.model.model_version}</td></tr>
              <tr><td className="muted">Training rows</td><td>{s.model.training_rows}</td></tr>
              <tr><td className="muted">Holdout</td><td>{s.model.holdout_hours}h</td></tr>
              <tr><td className="muted">MAE ≤24h / ≤72h</td><td>{s.model.mae24} / {s.model.mae72}</td></tr>
              <tr><td className="muted">R² / skill vs persistence</td><td>{s.model.r2} / {s.model.skill_pct}%</td></tr>
            </tbody></table>
          </div>
          <div className="muted text-xs mt-2">Top features: {s.model.top_features?.map((f: any) => `${f.feature} (${f.gain})`).join(", ")}</div>
        </Card>
        <Card>
          <h3 className="font-semibold mb-2">Bottleneck attribution (risk score)</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[380px]">
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
          </div>
        </Card>
      </div>

      <Card>
        <h3 className="font-semibold mb-2">Per-horizon validation (multi-origin residuals)</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[320px]">
            <thead><tr><th>Horizon</th><th>MAE</th><th>σ</th><th>Bias</th><th>n</th></tr></thead>
            <tbody>
              {s.validation.buckets.map((b: any) => (
                <tr key={b.label}><td>{b.label}</td><td className="mono">{b.mae}</td><td className="mono">{b.sigma}</td><td className="mono">{b.bias}</td><td className="muted">{b.n}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="muted text-xs mt-2">Drivers: {s.drivers.map((d: any) => d.label).join(" · ")}</div>
      </Card>
    </div>
  );
}
