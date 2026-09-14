"use client";

import { useQuery } from "@tanstack/react-query";
import { api, fmtInt, fmtUsd } from "@/lib/api";
import {
  AlertRow,
  DashSkeleton,
  IndexBar,
  KpiCard,
  SectionHeader,
  SeverityBadge,
  Sparkline,
  TrendArrow,
} from "@/components/dashboard/shared";
import BayMap from "@/components/dashboard/bay-map";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Anchor,
  Container,
  DollarSign,
  Gauge,
  Map as MapIcon,
  Ship,
  Timer,
  TrendingUp,
  Warehouse,
} from "lucide-react";

export default function OverviewTab() {
  const { data, isLoading, isError } = useQuery({ queryKey: ["overview"], queryFn: api.overview });

  if (isLoading) return <DashSkeleton rows={3} />;
  if (isError || !data)
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Failed to load overview. Check that the dev server and database are running.
        </CardContent>
      </Card>
    );

  const k = data.kpis;

  return (
    <div className="space-y-6">
      {/* KPI grid */}
      <section aria-label="Key performance indicators">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            icon={Anchor}
            label="Vessels at anchor"
            value={String(k.vesselsAtAnchor)}
            sub={`${k.vesselsInbound} inbound · max wait ${k.maxAnchoredHours}h`}
            tone={k.vesselsAtAnchor > 20 ? "bad" : "warn"}
          />
          <KpiCard
            icon={Timer}
            label="Avg anchorage wait"
            value={`${k.avgAnchorageWait.toFixed(0)}h`}
            sub="waiting fleet mean dwell"
            tone={k.avgAnchorageWait >= 48 ? "bad" : k.avgAnchorageWait >= 24 ? "warn" : "good"}
          />
          <KpiCard
            icon={Gauge}
            label="Congestion index now"
            value={`${k.portIndexNow.toFixed(0)}/100`}
            sub={`forecast peak ${k.peakForecastIndex.toFixed(0)} at +${k.peakForecastHour}h`}
            tone={k.peakForecastIndex >= 75 ? "bad" : k.peakForecastIndex >= 60 ? "warn" : "good"}
          />
          <KpiCard
            icon={DollarSign}
            label="Waiting-fleet burn"
            value={fmtUsd(k.dailyFleetBurnUsd) + "/day"}
            sub="$32k/day ship operating cost"
            tone="warn"
          />
          <KpiCard
            icon={Ship}
            label="Arrivals next 24h"
            value={String(k.arrivalsNext24)}
            sub="inbound vessels becoming ready"
          />
          <KpiCard
            icon={Container}
            label="Moves pending"
            value={fmtInt(k.movesPending)}
            sub="import + export TEU in queue"
            tone="warn"
          />
          <KpiCard
            icon={Warehouse}
            label="Berth utilisation"
            value={`${k.berthUtilPct.toFixed(0)}%`}
            sub="next 24h, optimiser plan"
            tone={k.berthUtilPct >= 95 ? "bad" : "good"}
          />
          <KpiCard
            icon={Gauge}
            label="Crane utilisation"
            value={`${k.craneUtilPct.toFixed(0)}%`}
            sub="62 STS cranes port-wide"
            tone={k.craneUtilPct >= 95 ? "bad" : "good"}
          />
        </div>
      </section>

      {/* San Pedro Bay congestion map */}
      <section aria-label="San Pedro Bay congestion map">
        <SectionHeader
          title="San Pedro Bay — live congestion map"
          desc="Anchorage queues and congestion index per terminal zone; hover or focus a pier for details"
          icon={MapIcon}
        />
        <Card className="border-border/60 bg-card/70">
          <CardContent className="p-4">
            <BayMap zones={data.zones} />
          </CardContent>
        </Card>
      </section>

      {/* zone status */}
      <section aria-label="Zone congestion status">
        <SectionHeader
          title="Zone congestion status"
          desc="Composite congestion index per terminal zone (60% queue vs capacity + 40% wait vs 72h threshold)"
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.zones.map((z) => (
            <Card key={z.zoneCode} className="border-border/60 bg-card/70">
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-semibold">{z.label}</CardTitle>
                <SeverityBadge level={z.level} />
              </CardHeader>
              <CardContent className="space-y-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="font-mono text-2xl font-semibold tabular-nums">
                    {z.currentIndex.toFixed(0)}
                    <span className="text-sm font-normal text-muted-foreground">/100</span>
                  </div>
                  <TrendArrow trend={z.trend} />
                </div>
                <IndexBar value={z.currentIndex} />
                {z.recentIndex.length > 4 ? (
                  <div className="pt-0.5">
                    <Sparkline values={z.recentIndex} />
                    <div className="mt-0.5 text-[10px] text-muted-foreground">last 48h observed index</div>
                  </div>
                ) : null}
                <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  <div>
                    <div className="font-mono text-foreground">{z.queueNow}</div>
                    queue
                  </div>
                  <div>
                    <div className="font-mono text-foreground">{z.waitNow.toFixed(0)}h</div>
                    avg wait
                  </div>
                  <div>
                    <div className="font-mono text-foreground">
                      {z.peakIndex.toFixed(0)} @ +{z.peakHour}h
                    </div>
                    72h peak
                  </div>
                </div>
                <div className="border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
                  {z.berths} berths · {z.cranes} cranes
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* arrivals timeline */}
        <Card className="border-border/60 bg-card/70">
          <CardHeader>
            <CardTitle className="text-sm">Inbound arrivals — next 72h</CardTitle>
          </CardHeader>
          <CardContent className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.arrivalsTimeline} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                <XAxis
                  dataKey="hour"
                  tick={{ fontSize: 10, fill: "currentColor" }}
                  ticks={[1, 12, 24, 36, 48, 60, 72]}
                  stroke="currentColor"
                  strokeOpacity={0.2}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "currentColor" }} stroke="currentColor" strokeOpacity={0.2} />
                <Tooltip
                  cursor={{ fill: "rgba(128,128,128,0.08)" }}
                  contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  labelFormatter={(h) => `+${h}h`}
                />
                <Bar dataKey="count" name="arrivals" radius={[3, 3, 0, 0]}>
                  {data.arrivalsTimeline.map((d) => (
                    <Cell key={d.hour} fill={d.hour <= 24 ? "var(--chart-2)" : "var(--chart-1)"} fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* alerts */}
        <Card className="border-border/60 bg-card/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <TrendingUp className="h-4 w-4 text-amber-400" aria-hidden />
              Operational alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {data.alerts.length === 0 ? (
              <div className="text-sm text-muted-foreground">No active alerts — all zones below threshold.</div>
            ) : (
              data.alerts.map((a, i) => (
                <AlertRow key={i} severity={a.severity} title={a.title} detail={a.detail} />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">{data.dataset.note}</p>
    </div>
  );
}
