"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, carrierColor, fmtInt, type OptimiserRunResponse, type VesselsResponse } from "@/lib/api";
import { DashSkeleton, SectionHeader } from "@/components/dashboard/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  Anchor,
  CheckCircle2,
  Download,
  FlaskConical,
  Gauge,
  Info,
  Loader2,
  Play,
  RotateCcw,
  Ship,
  Wrench,
} from "lucide-react";

type Run = NonNullable<OptimiserRunResponse["run"]>;
type Assignment = Run["assignments"][number];
type Tone = "good" | "warn" | "bad" | "flat";

// 72h planning window + spill hours → GANTT scale is 0–96h.
const HORIZON_H = 96;
const WINDOW_H = 72;
const TERMINAL_ORDER = ["LBCT", "ITS", "PCT", "TTI"];
const TERMINAL_NAMES: Record<string, string> = {
  LBCT: "Long Beach Container Terminal",
  ITS: "International Transportation Service",
  PCT: "Pacific Container Terminal",
  TTI: "Total Terminals International",
};
const BAR_COLORS = ["bg-teal-500/80", "bg-emerald-500/80", "bg-amber-500/80", "bg-rose-500/80"];

function statusChip(status: string): string {
  if (status === "ANCHORAGE") return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  if (status === "DRIFTING") return "border-orange-500/40 bg-orange-500/10 text-orange-300";
  return "border-teal-500/40 bg-teal-500/10 text-teal-300"; // INBOUND
}

function stripMv(name: string): string {
  return name.replace(/^M\/V\s+/, "");
}

function signed(n: number, digits = 0, suffix = ""): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}${suffix}`;
}

function pctDelta(opt: number, base: number): number {
  if (base === 0) return opt === 0 ? 0 : 100;
  return ((opt - base) / base) * 100;
}

// Throughput/util metrics: higher is better. Wait metrics: lower is better
// (a higher wait vs FIFO is an accepted trade-off in this oversubscribed port).
function cmpHigher(opt: number, base: number): Tone {
  return opt > base ? "good" : opt < base ? "bad" : "flat";
}
function cmpLower(opt: number, base: number): Tone {
  return opt < base ? "good" : opt > base ? "warn" : "flat";
}

function terminalSort(code: string): number {
  const i = TERMINAL_ORDER.indexOf(code);
  return i === -1 ? TERMINAL_ORDER.length : i;
}

// ------------------------------------------------ comparison card (in-file atom)
function CompareCard({
  label,
  value,
  baseline,
  deltaText,
  tone,
}: {
  label: string;
  value: string;
  baseline: string;
  deltaText: string;
  tone: Tone;
}) {
  const chip = {
    good: "border-teal-500/40 bg-teal-500/10 text-teal-300",
    warn: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    bad: "border-rose-500/40 bg-rose-500/10 text-rose-300",
    flat: "border-border/60 bg-muted/40 text-muted-foreground",
  }[tone];
  const valueColor =
    tone === "good" ? "text-teal-400" : tone === "bad" ? "text-rose-400" : "text-foreground";
  return (
    <Card className="border-border/60 bg-card/70">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          <span
            className={cn(
              "rounded-full border px-1.5 py-px font-mono text-[10px] tabular-nums",
              chip,
            )}
          >
            {deltaText}
          </span>
        </div>
        <div className={cn("mt-2 font-mono text-2xl font-semibold tabular-nums", valueColor)}>
          {value}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          FIFO baseline <span className="font-mono tabular-nums">{baseline}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ GANTT bits
function HourRuler() {
  return (
    <div className="flex items-center gap-2" aria-hidden>
      <div className="w-20 shrink-0" />
      <div className="relative h-4 flex-1">
        {Array.from({ length: 9 }, (_, i) => i * 12).map((h) => (
          <div
            key={h}
            className={cn(
              "absolute top-0 font-mono text-[10px] text-muted-foreground",
              h === 0 ? "left-0" : h === HORIZON_H ? "right-0" : "-translate-x-1/2",
            )}
            style={h % HORIZON_H === 0 ? undefined : { left: `${(h / HORIZON_H) * 100}%` }}
          >
            {h}h
          </div>
        ))}
      </div>
    </div>
  );
}

function TerminalGantt({ code, list }: { code: string; list: Assignment[] }) {
  // Berth rows keyed by `${pier} ${berthName}` so labels stay unique per pier.
  const rowMap = new Map<string, Assignment[]>();
  for (const a of list) {
    const key = `${a.pier} ${a.berthName}`;
    const arr = rowMap.get(key);
    if (arr) arr.push(a);
    else rowMap.set(key, [a]);
  }
  const rows = [...rowMap.entries()]
    .sort((x, y) => x[0].localeCompare(y[0]))
    .map(([key, arr]) => ({ key, arr: [...arr].sort((x, y) => x.startHour - y.startHour) }));
  const vessels = new Set(list.map((a) => a.vesselId)).size;

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold tracking-widest text-teal-300">{code}</span>
        <span className="text-xs text-muted-foreground">
          {TERMINAL_NAMES[code] ?? code} · Pier {list[0]?.pier ?? "?"} · {rows.length} berths ·{" "}
          {vessels} vessels
        </span>
      </div>
      <div className="space-y-1">
        {rows.map((row) => (
          <div
            key={row.key}
            className="flex items-center gap-2 rounded px-1 -mx-1 transition-colors hover:bg-muted/30"
          >
            <div
              className="w-20 shrink-0 truncate font-mono text-xs text-muted-foreground"
              title={row.key}
            >
              {row.arr[0]?.berthName ?? "?"}
            </div>
            <div className="relative h-8 flex-1 overflow-hidden rounded bg-muted/40">
              {/* now line at t0 */}
              <div className="absolute inset-y-0 left-0 z-10 w-px bg-teal-400/80" aria-hidden />
              {row.arr.map((a) => (
                <div
                  key={`${a.vesselId}-${a.startHour}`}
                  className={cn(
                    "absolute inset-y-0 flex items-center px-1.5 text-[10px] text-white/95 transition-all",
                    "hover:z-20 hover:ring-2 hover:ring-white/50 hover:brightness-110 cursor-default",
                    carrierColor(a.carrier),
                  )}
                  style={{
                    left: `${(a.startHour / HORIZON_H) * 100}%`,
                    width: `${Math.max(1.2, ((a.endHour - a.startHour) / HORIZON_H) * 100)}%`,
                  }}
                  title={`${a.vesselName} · ${a.carrier}\n${a.startHour}h→${a.endHour}h · ${a.cranes} cranes · ${a.moves} TEU · wait ${a.waitHours}h`}
                >
                  <span className="truncate">
                    {stripMv(a.vesselName)} ×{a.cranes}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- main tab
export default function BerthTab() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["latestRun"],
    queryFn: api.latestRun,
  });
  const { data: vesselsData } = useQuery({ queryKey: ["vessels"], queryFn: api.vessels });

  const [cranePct, setCranePct] = useState(100);
  const [moveRate, setMoveRate] = useState(28);
  const [selectedVesselId, setSelectedVesselId] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: api.runOptimiser,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["latestRun"] });
      toast.success(`Optimiser run complete — ${res.run?.metrics.serviced ?? 0} vessels assigned`);
    },
    onError: () => toast.error("Optimiser run failed — check server logs"),
  });

  const scenarioMutation = useMutation({
    mutationFn: () =>
      api.runScenario({
        craneFactor: cranePct < 100 ? cranePct / 100 : undefined,
        moveRatePerCraneHour: moveRate !== 28 ? moveRate : undefined,
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["latestRun"] });
      toast.success(
        `Scenario applied — ${res.run?.metrics.serviced ?? 0} serviced, ${fmtInt(res.run?.metrics.totalMoves ?? 0)} TEU in window`,
      );
    },
    onError: () => toast.error("Scenario run failed — check server logs"),
  });

  const run = data?.run ?? null;
  const scenarioActive =
    !!run && (run.params.craneFactor !== undefined || run.params.moveRatePerCraneHour !== 28);
  // dirty = sliders differ from the APPLIED run params (not just from defaults)
  const dirtyScenario =
    !!run &&
    (cranePct !== Math.round((run.params.craneFactor ?? 1) * 100) ||
      moveRate !== run.params.moveRatePerCraneHour);

  const runButton = (
    <div className="flex items-center gap-2">
      {scenarioActive ? (
        <Badge
          variant="outline"
          className="border-amber-500/40 bg-amber-500/10 font-mono text-[10px] text-amber-300"
        >
          <FlaskConical className="mr-1 h-3 w-3" aria-hidden />
          SCENARIO {run?.params.craneFactor !== undefined ? `· ${Math.round((run.params.craneFactor ?? 1) * 100)}% cranes` : ""}
          {run?.params.moveRatePerCraneHour !== 28 ? ` · ${run?.params.moveRatePerCraneHour} mv/h` : ""}
        </Badge>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        asChild
      >
        <a href={api.exportCsv("assignments")} download>
          <Download className="h-4 w-4" aria-hidden />
          CSV
        </a>
      </Button>
      <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        {mutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Play className="h-4 w-4" aria-hidden />
        )}
        Run optimiser
      </Button>
    </div>
  );

  if (isLoading) return <DashSkeleton rows={4} />;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Berth & crane optimiser"
        desc="Greedy + local-search vessel→berth→crane assignment across POLB terminals, benchmarked against FIFO"
        icon={Anchor}
        right={runButton}
      />

      {/* what-if scenario simulator */}
      <Card className="border-amber-500/20 bg-card/70">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
            <FlaskConical className="h-4 w-4 text-amber-400" aria-hidden />
            What-if scenario
            <span className="text-xs font-normal text-muted-foreground">
              impair capacity and re-run the optimiser live — both optimised and FIFO re-compute
            </span>
            {dirtyScenario ? (
              <Badge variant="outline" className="ml-auto border-amber-500/40 bg-amber-500/10 font-mono text-[10px] text-amber-300">
                unapplied changes
              </Badge>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div>
            <div className="mb-2 flex items-baseline justify-between text-xs">
              <span className="font-medium">Crane availability</span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {cranePct}% {cranePct < 100 ? `(${fmtInt(62 * (cranePct / 100))} of 62 cranes)` : ""}
              </span>
            </div>
            <Slider
              value={[cranePct]}
              min={50}
              max={100}
              step={5}
              onValueChange={(v) => setCranePct(v[0] ?? 100)}
              aria-label="Crane availability percent"
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              100% = full fleet · 80% ≈ one crane outage per terminal pair
            </p>
          </div>
          <div>
            <div className="mb-2 flex items-baseline justify-between text-xs">
              <span className="font-medium">Crane productivity</span>
              <span className="font-mono tabular-nums text-muted-foreground">{moveRate} moves/crane-h</span>
            </div>
            <Slider
              value={[moveRate]}
              min={20}
              max={35}
              step={1}
              onValueChange={(v) => setMoveRate(v[0] ?? 28)}
              aria-label="Crane productivity moves per hour"
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              28 = nominal STS rate · 20 = high wind / labour slowdown
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={dirtyScenario ? "default" : "secondary"}
              onClick={() => scenarioMutation.mutate()}
              disabled={scenarioMutation.isPending}
            >
              {scenarioMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <FlaskConical className="h-4 w-4" aria-hidden />
              )}
              Apply
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCranePct(100);
                setMoveRate(28);
                if (scenarioActive) mutation.mutate();
              }}
              disabled={mutation.isPending || scenarioMutation.isPending}
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {isError || !data ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Failed to load the optimiser run. Check that the dev server and database are running.
          </CardContent>
        </Card>
      ) : !run ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-teal-500/30 bg-teal-500/10">
              <Ship className="h-6 w-6 text-teal-300" aria-hidden />
            </div>
            <div>
              <div className="text-base font-semibold">No optimiser run yet</div>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Assign waiting vessels to berths and cranes across the four POLB terminals, then
                compare throughput and wait times against a FIFO baseline.
              </p>
            </div>
            {runButton}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* metrics comparison */}
          <section aria-label="Optimised vs FIFO baseline">
            <SectionHeader
              title="Optimised vs FIFO baseline"
              desc={`Run ${new Date(run.createdAt).toLocaleString()} · green = improvement · amber = accepted wait trade-off`}
            />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <CompareCard
                label="Serviced"
                value={fmtInt(run.metrics.serviced)}
                baseline={fmtInt(run.baseline.serviced)}
                deltaText={signed(run.metrics.serviced - run.baseline.serviced)}
                tone={cmpHigher(run.metrics.serviced, run.baseline.serviced)}
              />
              <CompareCard
                label="Moves in window"
                value={fmtInt(run.metrics.totalMoves)}
                baseline={fmtInt(run.baseline.totalMoves)}
                deltaText={signed(pctDelta(run.metrics.totalMoves, run.baseline.totalMoves), 1, "%")}
                tone={cmpHigher(run.metrics.totalMoves, run.baseline.totalMoves)}
              />
              <CompareCard
                label="Total wait h"
                value={fmtInt(run.metrics.totalWaitHours)}
                baseline={fmtInt(run.baseline.totalWaitHours)}
                deltaText={signed(
                  pctDelta(run.metrics.totalWaitHours, run.baseline.totalWaitHours),
                  1,
                  "%",
                )}
                tone={cmpLower(run.metrics.totalWaitHours, run.baseline.totalWaitHours)}
              />
              <CompareCard
                label="Avg wait h"
                value={run.metrics.avgWaitHours.toFixed(1)}
                baseline={run.baseline.avgWaitHours.toFixed(1)}
                deltaText={signed(
                  pctDelta(run.metrics.avgWaitHours, run.baseline.avgWaitHours),
                  1,
                  "%",
                )}
                tone={cmpLower(run.metrics.avgWaitHours, run.baseline.avgWaitHours)}
              />
              <CompareCard
                label="Max wait h"
                value={fmtInt(run.metrics.maxWaitHours)}
                baseline={fmtInt(run.baseline.maxWaitHours)}
                deltaText={signed(
                  pctDelta(run.metrics.maxWaitHours, run.baseline.maxWaitHours),
                  1,
                  "%",
                )}
                tone={cmpLower(run.metrics.maxWaitHours, run.baseline.maxWaitHours)}
              />
              <CompareCard
                label="Weighted wait h"
                value={fmtInt(run.metrics.weightedWaitHours)}
                baseline={fmtInt(run.baseline.weightedWaitHours)}
                deltaText={signed(
                  pctDelta(run.metrics.weightedWaitHours, run.baseline.weightedWaitHours),
                  1,
                  "%",
                )}
                tone={cmpLower(run.metrics.weightedWaitHours, run.baseline.weightedWaitHours)}
              />
              <CompareCard
                label="Berth util %"
                value={`${run.metrics.berthUtilPct.toFixed(1)}%`}
                baseline={`${run.baseline.berthUtilPct.toFixed(1)}%`}
                deltaText={signed(
                  run.metrics.berthUtilPct - run.baseline.berthUtilPct,
                  1,
                  "pt",
                )}
                tone={cmpHigher(run.metrics.berthUtilPct, run.baseline.berthUtilPct)}
              />
              <CompareCard
                label="Crane util %"
                value={`${run.metrics.craneUtilPct.toFixed(1)}%`}
                baseline={`${run.baseline.craneUtilPct.toFixed(1)}%`}
                deltaText={signed(
                  run.metrics.craneUtilPct - run.baseline.craneUtilPct,
                  1,
                  "pt",
                )}
                tone={cmpHigher(run.metrics.craneUtilPct, run.baseline.craneUtilPct)}
              />
            </div>
            <Alert className="mt-3 border-border/60 bg-card/70">
              <Info className="h-4 w-4 text-teal-400" aria-hidden />
              <AlertTitle>Reading this honestly</AlertTitle>
              <AlertDescription className="text-xs leading-relaxed">
                San Pedro Bay is ~3× oversubscribed in this crisis scenario — no schedule can service
                every vessel inside 72 hours. The optimiser therefore maximises throughput (moves,
                serviced vessels) and protects long-waiting, large and reefer vessels; total and
                average wait can rise versus FIFO as an accepted trade-off for moving more cargo
                sooner. Vessels deferred beyond the horizon are handed to the Routing tab for
                divert / slow-steam recommendations. All figures are engine-computed deltas (optimiser
                metrics vs FIFO baseline).
              </AlertDescription>
            </Alert>
          </section>

          {/* GANTT */}
          <Card className="border-border/60 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                <Gauge className="h-4 w-4 text-teal-400" aria-hidden />
                72h berth schedule
                <span className="ml-auto font-mono text-[10px] font-normal text-muted-foreground">
                  scale 0–96h (incl. spill) · teal line = now
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="overflow-x-auto pb-1">
                <div className="min-w-[900px] space-y-5">
                  <HourRuler />
                  {[...new Set(run.assignments.map((a) => a.terminalCode))]
                    .sort((x, y) => terminalSort(x) - terminalSort(y))
                    .map((code) => (
                      <TerminalGantt
                        key={code}
                        code={code}
                        list={run.assignments.filter((a) => a.terminalCode === code)}
                      />
                    ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/40 pt-3">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Carriers
                </span>
                {[...new Set(run.assignments.map((a) => a.carrier))].map((c) => (
                  <span
                    key={c}
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <span
                      className={cn("h-2.5 w-2.5 rounded-full", carrierColor(c))}
                      aria-hidden
                    />
                    {c}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* deferred + crane deployment */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="border-border/60 bg-card/70 lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Ship className="h-4 w-4 text-amber-400" aria-hidden />
                  Deferred vessels
                  <Badge variant="outline" className="ml-auto font-mono text-[10px]">
                    {run.deferred.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {run.deferred.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-teal-300">
                    <CheckCircle2 className="h-4 w-4" aria-hidden />
                    All vessels serviced within the window.
                  </div>
                ) : (
                  <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                    {run.deferred.map((d) => (
                      <div
                        key={d.vesselId}
                        className="rounded-md border border-border/50 bg-muted/20 px-2.5 py-1.5"
                      >
                        <div className="text-sm font-medium leading-tight">{d.vesselName}</div>
                        <div className="text-xs text-muted-foreground">{d.reason}</div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/70">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Wrench className="h-4 w-4 text-teal-400" aria-hidden />
                  Crane deployment (72h window)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(() => {
                  const hours = new Map<string, number>();
                  for (const a of run.assignments) {
                    const span = Math.max(0, Math.min(a.endHour, WINDOW_H) - a.startHour);
                    hours.set(a.terminalCode, (hours.get(a.terminalCode) ?? 0) + a.cranes * span);
                  }
                  const entries = [...hours.entries()].sort(
                    (x, y) => terminalSort(x[0]) - terminalSort(y[0]),
                  );
                  const max = Math.max(1, ...entries.map(([, v]) => v));
                  return entries.map(([code, h], i) => (
                    <div key={code}>
                      <div className="mb-1 flex items-baseline justify-between text-xs">
                        <span className="font-mono font-medium">{code}</span>
                        <span className="font-mono text-muted-foreground">{fmtInt(h)} cr-h</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn("h-full rounded-full", BAR_COLORS[i % BAR_COLORS.length])}
                          style={{ width: `${(h / max) * 100}%` }}
                        />
                      </div>
                    </div>
                  ));
                })()}
              </CardContent>
            </Card>
          </div>

          {/* vessel queue roster + detail dialog */}
          <VesselRoster
            vessels={vesselsData?.vessels ?? []}
            selectedId={selectedVesselId}
            onSelect={setSelectedVesselId}
          />
          {(() => {
            const v = vesselsData?.vessels.find((x) => x.id === selectedVesselId);
            return v ? (
              <Dialog open onOpenChange={(o) => !o && setSelectedVesselId(null)}>
                <DialogContent className="max-w-lg border-border/60 bg-card">
                  <DialogHeader>
                    <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
                      {v.name}
                      <Badge variant="outline" className={cn("font-mono text-[10px]", statusChip(v.status))}>
                        {v.status}
                      </Badge>
                      {v.inPlan ? null : (
                        <Badge variant="outline" className="border-rose-500/40 bg-rose-500/10 font-mono text-[10px] text-rose-300">
                          DEFERRED
                        </Badge>
                      )}
                    </DialogTitle>
                    <DialogDescription>
                      {v.carrier} · {v.vesselClass.replace("_", "-")} · from {v.originPort}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    {[
                      ["MMSI", v.mmsi],
                      ["LOA / beam", `${v.loaFt} ft / ${v.beamFt} ft`],
                      ["Draft", `${v.draftFt} ft`],
                      ["TEU capacity", fmtInt(v.teuCapacity)],
                      ["Import moves", fmtInt(v.importMoves)],
                      ["Export moves", fmtInt(v.exportMoves)],
                      ["Reefer units", String(v.reeferUnits)],
                      ["Anchorage", v.anchorageZone],
                      ["Anchored", `${v.anchoredHours.toFixed(0)} h`],
                      ["Ready to berth", v.etaHours <= 0 ? "now" : `+${v.etaHours.toFixed(1)} h`],
                      ["Destination", v.destZoneCode.replace("Z-", "")],
                      ["Plan", v.assignedBerth ? `${v.assignedBerth} @ +${v.startHour}h · ${v.cranes} cranes · wait ${v.waitHours}h` : "not scheduled in 72h window"],
                    ].map(([k, val]) => (
                      <div key={k} className={k === "Plan" ? "col-span-2" : undefined}>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</div>
                        <div className="font-mono text-[13px] tabular-nums">{val}</div>
                      </div>
                    ))}
                  </div>
                </DialogContent>
              </Dialog>
            ) : null;
          })()}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------- vessel roster
function VesselRoster({
  vessels,
  selectedId,
  onSelect,
}: {
  vessels: VesselsResponse["vessels"];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const sorted = useMemo(
    () =>
      [...vessels].sort(
        (a, b) => b.anchoredHours - a.anchoredHours || a.etaHours - b.etaHours,
      ),
    [vessels],
  );
  return (
    <Card className="border-border/60 bg-card/70">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Ship className="h-4 w-4 text-teal-400" aria-hidden />
          Vessel queue roster
          <Badge variant="outline" className="ml-auto font-mono text-[10px]">
            {vessels.length} vessels
          </Badge>
          <Button size="sm" variant="outline" asChild className="ml-2 h-7 px-2 text-xs">
            <a href={api.exportCsv("vessels")} download>
              <Download className="mr-1 h-3 w-3" aria-hidden />
              CSV
            </a>
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-80 overflow-y-auto rounded-md border border-border/40">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-[10px] uppercase tracking-wider">Vessel</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">Status</TableHead>
                <TableHead className="text-right text-[10px] uppercase tracking-wider">Anchored</TableHead>
                <TableHead className="text-right text-[10px] uppercase tracking-wider">Moves</TableHead>
                <TableHead className="text-right text-[10px] uppercase tracking-wider">Reefer</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">Plan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((v) => (
                <TableRow
                  key={v.id}
                  onClick={() => onSelect(v.id)}
                  className={cn(
                    "cursor-pointer text-[13px]",
                    selectedId === v.id ? "bg-teal-500/10" : "hover:bg-muted/40",
                  )}
                >
                  <TableCell>
                    <div className="font-medium leading-tight">{stripMv(v.name)}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {v.vesselClass.replace("_", "-")} · {v.loaFt} ft · {v.destZoneCode.replace("Z-", "")}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("font-mono text-[10px]", statusChip(v.status))}>
                      {v.status === "ANCHORAGE" ? "ANCHOR" : v.status === "DRIFTING" ? "DRIFT" : "INBOUND"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {v.anchoredHours > 0 ? `${v.anchoredHours.toFixed(0)}h` : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtInt(v.importMoves + v.exportMoves)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{v.reeferUnits}</TableCell>
                  <TableCell className="text-xs">
                    {v.assignedBerth ? (
                      <span className="font-mono text-teal-300">
                        {v.assignedBerth} @ +{v.startHour}h
                      </span>
                    ) : (
                      <span className="text-rose-300/80">deferred</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Click a row for full vessel details · roster reflects the latest optimiser run
        </p>
      </CardContent>
    </Card>
  );
}
