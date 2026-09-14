"use client";

// Forecast tab — 72h schedule-aware congestion forecast per zone.
// KPIs → history/forecast composed chart → hotspot ranking → model proof → drivers.
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, fmtInt } from "@/lib/api";
import {
  DashSkeleton,
  IndexBar,
  KpiCard,
  SectionHeader,
  SeverityBadge,
  levelOfIndex,
} from "@/components/dashboard/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, Cpu, FlaskConical, Gauge, ListOrdered, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ForecastValidation } from "@/lib/engine/types";

type Metric = "index" | "wait" | "queue";

// One row per hour across observed history + forecast horizon. Splitting
// observed vs forecast into separate keys draws two line segments with a gap
// at the "now" boundary (solid amber observed, dashed teal forecast).
interface ChartRow {
  t: string;
  kind: "history" | "forecast";
  indexHist: number | null;
  indexFc: number | null;
  band: [number, number] | null;
  waitHist: number | null;
  waitFc: number | null;
  queueHist: number | null;
  queueFc: number | null;
}

// Theme-token strokes (adapt to light/dark instead of hard-coded dark-mode hexes).
const AMBER = "var(--chart-2)";
const TEAL = "var(--chart-1)";

/** ISO ts → compact hour label, e.g. "08/31 04h" (UTC, matches engine ts). */
function tsLabel(ts: string): string {
  const d = new Date(ts);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  return `${mm}/${dd} ${hh}h`;
}

function toneForIndex(index: number): "good" | "warn" | "bad" {
  const level = levelOfIndex(index);
  return level === "CRIT" ? "bad" : level === "LOW" ? "good" : "warn";
}

function ModelStat({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={cn("rounded-lg border border-border/60 bg-muted/30 p-2.5", wide && "col-span-2 sm:col-span-4")}>
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold leading-snug tabular-nums">{value}</div>
    </div>
  );
}

/** Signed forecast bias: + = model under-forecasts (risk, amber), − = over-forecasts (teal). */
function biasToneClass(bias: number): string {
  if (Math.abs(bias) < 1) return "text-muted-foreground";
  return bias > 0 ? "text-amber-400" : "text-teal-400";
}

// Axis-less histogram of signed validation residuals (actual − forecast):
// ~19 equal bins from min→max, teal bars at 60% opacity, dashed zero line.
function ResidualHistogram({ residuals }: { residuals: number[] }) {
  if (!residuals.length) {
    return (
      <div className="flex h-24 items-center justify-center rounded-lg border border-border/60 bg-muted/30 text-xs text-muted-foreground">
        No residuals recorded
      </div>
    );
  }
  const W = 320;
  const H = 96;
  const BINS = 19;
  const min = Math.min(...residuals);
  const max = Math.max(...residuals);
  const span = Math.max(1e-6, max - min);
  const counts = new Array<number>(BINS).fill(0);
  for (const r of residuals) {
    const bi = Math.min(BINS - 1, Math.max(0, Math.floor(((r - min) / span) * BINS)));
    counts[bi] += 1;
  }
  const maxCount = Math.max(...counts, 1);
  const binW = W / BINS;
  const zeroX = min <= 0 && max >= 0 ? ((0 - min) / span) * W : null;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-24 w-full"
      role="img"
      aria-label={`Histogram of ${residuals.length} signed forecast residuals (index pts), ${BINS} bins from ${min.toFixed(1)} to ${max.toFixed(1)} index points`}
    >
      {zeroX !== null ? (
        <line x1={zeroX} x2={zeroX} y1={0} y2={H} stroke="currentColor" strokeOpacity={0.4} strokeDasharray="3 3" />
      ) : null}
      {counts.map((c, i) => {
        if (!c) return null;
        const h = Math.max(2, (c / maxCount) * (H - 4));
        return (
          <rect
            key={i}
            x={i * binW + 1}
            y={H - h}
            width={Math.max(1.5, binW - 2)}
            height={h}
            fill={TEAL}
            fillOpacity={0.6}
            rx={1.5}
          />
        );
      })}
    </svg>
  );
}

export default function ForecastTab() {
  const [zone, setZone] = useState("Z-PORT");
  const [metric, setMetric] = useState<Metric>("index");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["forecast", zone],
    queryFn: () => api.forecast(zone),
    placeholderData: keepPreviousData,
  });

  if (isLoading) return <DashSkeleton rows={3} />;
  if (isError || !data)
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Failed to load forecast. Check that the dev server and database are running.
        </CardContent>
      </Card>
    );

  const sel = data.selected;
  const m = sel.model;
  // validation is added by the engine (spread into `selected` by the API route);
  // api.ts mirrors the response without it, so read it through the engine type.
  const validation = (sel as { validation?: ForecastValidation }).validation;

  // history (last 96h) + forecast (72h) merged on one time axis
  const chartData: ChartRow[] = [
    ...sel.history.map<ChartRow>((h) => ({
      t: tsLabel(h.ts),
      kind: "history",
      indexHist: h.index,
      indexFc: null,
      band: null,
      waitHist: h.avgWaitHrs,
      waitFc: null,
      queueHist: h.queueCount,
      queueFc: null,
    })),
    ...sel.points.map<ChartRow>((p) => ({
      t: tsLabel(p.ts),
      kind: "forecast",
      indexHist: null,
      indexFc: p.index,
      band: [p.lo, p.hi],
      waitHist: null,
      waitFc: p.wait,
      queueHist: null,
      queueFc: p.queue,
    })),
  ];
  const boundaryX = chartData[sel.history.length - 1]?.t;

  const lineKeys =
    metric === "index"
      ? { hist: "indexHist", fc: "indexFc" }
      : metric === "wait"
        ? { hist: "waitHist", fc: "waitFc" }
        : { hist: "queueHist", fc: "queueFc" };
  const yDomain: [number, number] | ["auto", "auto"] = metric === "index" ? [0, 100] : ["auto", "auto"];

  const isTerminal = sel.zoneCode !== "Z-PORT";
  const rank = isTerminal && sel.hotspotRank > 0 ? sel.hotspotRank : null;
  const ranked = data.zones
    .filter((z) => z.zoneCode !== "Z-PORT")
    .sort((a, b) => b.peakIndex - a.peakIndex);

  return (
    <div className="space-y-6">
      {/* zone picker */}
      <SectionHeader
        title="Congestion forecast"
        desc="Schedule-aware 72-hour rollout per terminal zone — observed history vs recursive forecast"
        right={
          <Select value={zone} onValueChange={setZone}>
            <SelectTrigger className="w-full sm:w-[280px]" aria-label="Select forecast zone">
              <SelectValue placeholder="Select zone" />
            </SelectTrigger>
            <SelectContent>
              {data.zones.map((z) => (
                <SelectItem key={z.zoneCode} value={z.zoneCode}>
                  {z.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {/* KPI grid */}
      <section aria-label="Forecast KPIs">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            icon={Gauge}
            label="Index now"
            value={`${sel.current.index.toFixed(0)}/100`}
            sub={`queue ${sel.current.queue} vessels · avg wait ${sel.current.wait.toFixed(0)}h`}
            tone={toneForIndex(sel.current.index)}
          />
          <KpiCard
            icon={TrendingUp}
            label="72h peak"
            value={`${sel.peak.index.toFixed(0)}/100`}
            sub={`@ +${sel.peak.hour}h into horizon`}
            tone={toneForIndex(sel.peak.index)}
          />
          <KpiCard
            icon={Activity}
            label="72h avg"
            value={`${sel.avgIndex.toFixed(0)}/100`}
            sub="mean index across the 72h rollout"
            tone={toneForIndex(sel.avgIndex)}
          />
          <KpiCard
            icon={ListOrdered}
            label="Hotspot rank"
            value={rank ? `#${rank} of 4` : "port-wide"}
            sub={rank ? "by 72h peak congestion index" : "aggregate of 4 terminals"}
            tone={rank === 1 ? "bad" : rank && rank <= 2 ? "warn" : "default"}
          />
        </div>
      </section>

      {/* main chart */}
      <Card className="border-border/60 bg-card/70">
        <CardHeader className="flex-row items-center justify-between space-y-0 gap-3">
          <CardTitle className="text-sm">History &amp; 72h forecast — {sel.zoneName}</CardTitle>
          <Tabs value={metric} onValueChange={(v) => setMetric(v as Metric)}>
            <TabsList aria-label="Chart metric">
              <TabsTrigger value="index">Index</TabsTrigger>
              <TabsTrigger value="wait">Wait (h)</TabsTrigger>
              <TabsTrigger value="queue">Queue</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded bg-[var(--chart-2)]" aria-hidden /> observed
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0 w-4 border-t-2 border-dashed border-[var(--chart-1)]" aria-hidden /> forecast
            </span>
            {metric === "index" ? (
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-2.5 w-4 rounded-sm bg-[var(--chart-1)]/15 ring-1 ring-inset ring-[var(--chart-1)]/30"
                  aria-hidden
                />{" "}
                80% band
              </span>
            ) : null}
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.12} vertical={false} />
                <XAxis
                  dataKey="t"
                  interval={11}
                  tick={{ fontSize: 10, fill: "currentColor" }}
                  stroke="currentColor"
                  strokeOpacity={0.2}
                  tickMargin={6}
                />
                <YAxis
                  domain={yDomain}
                  allowDecimals={metric !== "queue"}
                  tick={{ fontSize: 10, fill: "currentColor" }}
                  stroke="currentColor"
                  strokeOpacity={0.2}
                />
                <Tooltip
                  cursor={{ fill: "rgba(128,128,128,0.08)" }}
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                {boundaryX ? (
                  <ReferenceLine
                    x={boundaryX}
                    stroke="currentColor"
                    strokeOpacity={0.35}
                    strokeDasharray="4 4"
                    label={{ value: "now", position: "insideTopLeft", fontSize: 10, fill: "currentColor", opacity: 0.6 }}
                  />
                ) : null}
                {metric === "index" ? (
                  <Area
                    type="monotone"
                    dataKey="band"
                    name="80% band"
                    stroke="none"
                    fill={TEAL}
                    fillOpacity={0.15}
                    isAnimationActive={false}
                  />
                ) : null}
                <Line
                  type="monotone"
                  dataKey={lineKeys.hist}
                  name="observed"
                  stroke={AMBER}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey={lineKeys.fc}
                  name="forecast"
                  stroke={TEAL}
                  strokeWidth={2}
                  strokeDasharray="5 3"
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* hotspot ranking */}
        <Card className="border-border/60 bg-card/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ListOrdered className="h-4 w-4 text-amber-400" aria-hidden />
              72h hotspot ranking
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead className="text-right">Now</TableHead>
                  <TableHead className="text-right">Peak</TableHead>
                  <TableHead className="text-right">Avg</TableHead>
                  <TableHead>Level</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ranked.map((z, i) => (
                  <TableRow
                    key={z.zoneCode}
                    className={cn(z.zoneCode === sel.zoneCode && "bg-teal-500/10 hover:bg-teal-500/15")}
                  >
                    <TableCell className="font-mono text-xs tabular-nums">{i + 1}</TableCell>
                    <TableCell>
                      <div className="text-sm font-medium leading-tight">{z.label}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{z.zoneCode}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {z.currentIndex.toFixed(0)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {z.peakIndex.toFixed(0)}
                      <span className="ml-1 text-[10px] text-muted-foreground">@ +{z.peakHour}h</span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {z.avgIndex.toFixed(0)}
                    </TableCell>
                    <TableCell>
                      <div className="flex w-20 flex-col items-start gap-1.5">
                        <SeverityBadge level={levelOfIndex(z.peakIndex)} />
                        <IndexBar value={z.peakIndex} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* model proof */}
        <Card className="border-border/60 bg-card/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Cpu className="h-4 w-4 text-teal-400" aria-hidden />
              Forecasting model — schedule-aware ridge regression
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <ModelStat label="Algorithm" value={m.algorithm} wide />
              <ModelStat label="Training rows" value={fmtInt(m.trainingRows)} />
              <ModelStat label="Holdout" value={`${m.holdoutHours}h`} />
              <ModelStat label="MAE ≤ 24h" value={`${m.mae24.toFixed(1)} pts`} />
              <ModelStat label="MAE ≤ 72h" value={`${m.mae72.toFixed(1)} pts`} />
              <ModelStat label="R² (1-step)" value={m.r2.toFixed(2)} />
              <ModelStat
                label="Skill vs persistence"
                value={`${m.skillPct >= 0 ? "+" : ""}${m.skillPct.toFixed(0)}%`}
              />
              <ModelStat label="MAPE" value={`${m.mapePct.toFixed(1)}%`} />
            </div>
            <div className="space-y-1.5">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Model features
              </div>
              <div className="flex flex-wrap gap-1.5">
                {m.features.map((f) => (
                  <Badge key={f} variant="outline" className="font-mono text-[10px] font-normal text-muted-foreground">
                    {f}
                  </Badge>
                ))}
              </div>
            </div>
            <p className="border-t border-border/40 pt-2 text-[11px] leading-relaxed text-muted-foreground">
              Trained on 336h hourly history + live ETA arrival schedule; recursive damped rollout with empirical 80%
              bands.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* model validation — per-horizon residual diagnostics (hidden if engine data missing) */}
      {validation ? (
        <Card className="border-border/60 bg-card/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <FlaskConical className="h-4 w-4 text-teal-400" aria-hidden />
              Model validation — per-horizon residual diagnostics
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              {/* per-bucket error profile */}
              <div>
                <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Error by horizon bucket
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Horizon</TableHead>
                      <TableHead className="text-right">MAE (idx pts)</TableHead>
                      <TableHead className="text-right">σ (band width driver)</TableHead>
                      <TableHead className="text-right">Bias</TableHead>
                      <TableHead className="text-right">Samples n</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {validation.buckets.map((b) => (
                      <TableRow key={b.label}>
                        <TableCell className="font-mono text-xs tabular-nums">{b.label}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{b.mae.toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{b.sigma.toFixed(2)}</TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-mono text-xs font-medium tabular-nums",
                            biasToneClass(b.bias),
                          )}
                        >
                          {b.bias > 0 ? "+" : ""}
                          {b.bias.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{fmtInt(b.n)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {/* residual distribution */}
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Residual distribution (actual − forecast)
                  </div>
                  <Badge variant="outline" className="font-mono text-[10px] font-normal text-muted-foreground">
                    idx pts
                  </Badge>
                </div>
                <ResidualHistogram residuals={validation.residuals} />
                <div className="flex justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
                  <span>{Math.min(...(validation.residuals.length ? validation.residuals : [0])).toFixed(1)}</span>
                  <span>0</span>
                  <span>{Math.max(...(validation.residuals.length ? validation.residuals : [0])).toFixed(1)}</span>
                </div>
              </div>
            </div>
            <p className="border-t border-border/40 pt-2 text-[11px] leading-relaxed text-muted-foreground">
              Validation: {validation.origins} recursive multi-origin rollouts over the final {m.holdoutHours}h; MAE/bias
              per horizon bucket; σ drives the 80% band (±1.2816σ).
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* drivers */}
      <Card className="border-border/60 bg-card/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Activity className="h-4 w-4 text-amber-400" aria-hidden />
            Forecast drivers — {sel.zoneName}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2">
            {sel.drivers.map((d) => (
              <div key={d.label} className="rounded-lg border border-border/60 bg-card/60 p-3">
                <div className="text-sm font-medium leading-tight">{d.label}</div>
                <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{d.detail}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
