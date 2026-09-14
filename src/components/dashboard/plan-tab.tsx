"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, fmtInt, type PlanResponse } from "@/lib/api";
import type { PlanShift, PlanSummary } from "@/lib/engine/types";
import { DashSkeleton, KpiCard, SectionHeader, SeverityBadge } from "@/components/dashboard/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  Anchor,
  Clock3,
  Container,
  Copy,
  Download,
  FileText,
  Hourglass,
  ListChecks,
  Loader2,
  Play,
  ShieldAlert,
  Ship,
  SquareCheck,
  Wrench,
} from "lucide-react";

type Plan = NonNullable<PlanResponse["plan"]>;

const ALERT_STYLES: Record<PlanShift["congestionAlerts"][number]["level"], string> = {
  WATCH: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  WARN: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  CRIT: "border-rose-500/40 bg-rose-500/10 text-rose-300",
};

const RISK_CLASS: Record<PlanSummary["riskLevel"], string> = {
  LOW: "text-teal-400",
  ELEVATED: "text-amber-400",
  HIGH: "text-orange-400",
  SEVERE: "text-rose-400",
};

// Heat-block tint for the strongest congestion alert within a shift.
const SHIFT_HEAT: Record<"WATCH" | "WARN" | "CRIT", string> = {
  WATCH: "bg-amber-500/20",
  WARN: "bg-orange-500/25",
  CRIT: "bg-rose-500/30",
};

type AlertLevel = "WATCH" | "WARN" | "CRIT";

function strongestAlert(shift: PlanShift): AlertLevel | null {
  if (shift.congestionAlerts.length === 0) return null;
  const order: Record<AlertLevel, number> = { WATCH: 0, WARN: 1, CRIT: 2 };
  return shift.congestionAlerts.reduce<AlertLevel>(
    (max, a) => (order[a.level] > order[max] ? a.level : max),
    "WATCH",
  );
}

function stripMv(name: string): string {
  return name.replace(/^M\/V\s+/, "");
}

// 72-hour strip: berthing dots lane + congestion heat blocks + arrival ticks.
// Click any element to smooth-scroll to the owning shift card below.
function ShiftStrip({ plan }: { plan: Plan }) {
  const scrollTo = (seq: number) =>
    document.getElementById(`shift-card-${seq}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const berthings = plan.shifts.flatMap((s) =>
    s.berthings.map((b, i) => ({ ...b, seq: s.seq, key: `b-${s.seq}-${i}` })),
  );
  const arrivals = plan.shifts.flatMap((s) =>
    s.arrivals.map((a, i) => ({ ...a, seq: s.seq, key: `a-${s.seq}-${i}` })),
  );

  return (
    <Card className="scroll-mt-40 border-border/60 bg-card/70">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Clock3 className="h-4 w-4 text-teal-400" aria-hidden />
          72-hour strip — berthings, congestion heat &amp; arrivals
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        <div className="overflow-x-auto pb-1">
          <div className="min-w-[640px]">
            {/* day bands */}
            <div className="mb-1 flex text-[9px] font-medium uppercase tracking-widest text-muted-foreground">
              <span className="flex-1 text-center">Day 1 · +0–24h</span>
              <span className="flex-1 text-center">Day 2 · +24–48h</span>
              <span className="flex-1 text-center">Day 3 · +48–72h</span>
            </div>

            {/* berthing lane */}
            <div
              className="relative h-4 rounded-md border border-border/40 bg-muted/20"
              role="img"
              aria-label={`${berthings.length} planned berthings across 72 hours`}
            >
              {berthings.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => scrollTo(b.seq)}
                  title={`Berthing: ${stripMv(b.vesselName)} → ${b.berthName} · ${b.cranes} cranes @ +${b.startHour}h — click for Shift ${String(b.seq).padStart(2, "0")}`}
                  aria-label={`Berthing ${stripMv(b.vesselName)} at ${b.berthName} at plus ${b.startHour} hours`}
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-teal-400 shadow transition-transform hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
                  style={{
                    left: `${(Math.min(Math.max(b.startHour, 0), 72) / 72) * 100}%`,
                    width: `${Math.min(6 + b.cranes * 1.1, 14)}px`,
                    height: `${Math.min(6 + b.cranes * 1.1, 14)}px`,
                  }}
                />
              ))}
            </div>

            {/* congestion heat blocks */}
            <div className="my-1 flex h-11 overflow-hidden rounded-md border border-border/50">
              {plan.shifts.map((s) => {
                const lvl = strongestAlert(s);
                return (
                  <button
                    key={s.seq}
                    type="button"
                    onClick={() => scrollTo(s.seq)}
                    title={`Shift ${String(s.seq).padStart(2, "0")} · ${s.windowLabel} — ${s.berthings.length} berthings, ${s.arrivals.length} arrivals${lvl ? `, ${lvl} alert` : ""} — click to open`}
                    className={cn(
                      "group flex flex-1 flex-col justify-end border-r border-border/30 px-1.5 pb-1 text-left outline-none transition-colors last:border-r-0 hover:bg-foreground/10 focus-visible:bg-foreground/10",
                      lvl ? SHIFT_HEAT[lvl] : "bg-muted/25",
                    )}
                  >
                    <span className="font-mono text-[10px] font-semibold leading-none text-foreground/80">
                      S{String(s.seq).padStart(2, "0")}
                    </span>
                    <span className="mt-0.5 text-[8.5px] leading-none text-muted-foreground">
                      {s.berthings.length} bth · {s.arrivals.length} arr
                    </span>
                  </button>
                );
              })}
            </div>

            {/* arrivals lane */}
            <div
              className="relative h-4 rounded-md border border-border/40 bg-muted/20"
              role="img"
              aria-label={`${arrivals.length} inbound arrivals across 72 hours`}
            >
              {arrivals.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => scrollTo(a.seq)}
                  title={`Arrival: ${stripMv(a.vesselName)} → ${a.zoneCode} @ +${a.etaHour}h — click for Shift ${String(a.seq).padStart(2, "0")}`}
                  aria-label={`Arrival ${stripMv(a.vesselName)} to ${a.zoneCode} at plus ${a.etaHour} hours`}
                  className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 text-amber-400 transition-transform hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                  style={{ left: `${(Math.min(Math.max(a.etaHour, 0), 72) / 72) * 100}%` }}
                >
                  <svg viewBox="0 0 10 10" className="h-full w-full fill-current" aria-hidden>
                    <path d="M0 2 L10 2 L5 9 Z" />
                  </svg>
                </button>
              ))}
            </div>

            {/* hour axis */}
            <div className="mt-1 flex justify-between font-mono text-[9px] text-muted-foreground">
              {[0, 12, 24, 36, 48, 60, 72].map((h) => (
                <span key={h}>+{h}h</span>
              ))}
            </div>
          </div>
        </div>

        {/* legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-background bg-teal-400" aria-hidden /> berthing
            (size = cranes)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 text-amber-400" aria-hidden>
              <svg viewBox="0 0 10 10" className="h-full w-full fill-current"><path d="M0 2 L10 2 L5 9 Z" /></svg>
            </span>
            arrival
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-sm bg-amber-500/20 ring-1 ring-inset ring-amber-500/40" aria-hidden /> WATCH
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-sm bg-orange-500/25 ring-1 ring-inset ring-orange-500/40" aria-hidden /> WARN
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-sm bg-rose-500/30 ring-1 ring-inset ring-rose-500/40" aria-hidden /> CRIT
          </span>
          <span className="ml-auto italic">click a block, dot or tick to jump to the shift card</span>
        </div>
      </CardContent>
    </Card>
  );
}

// One quadrant of a shift card: label + list of lines (or "—").
function ShiftCell({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-2.5">
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground/70">—</div>
      ) : (
        <ul className="space-y-1">
          {items.map((t, i) => (
            <li key={i} className="text-xs leading-snug">
              {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ShiftCard({
  shift,
  done,
  onToggle,
}: {
  shift: PlanShift;
  done: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <Card id={`shift-card-${shift.seq}`} className="scroll-mt-40 border-border/60 bg-card/70">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-sm">Shift {String(shift.seq).padStart(2, "0")}</CardTitle>
          <span className="text-xs text-muted-foreground">{shift.windowLabel}</span>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {shift.congestionAlerts.map((a, i) => (
              <Badge
                key={i}
                variant="outline"
                className={cn("font-mono text-[10px]", ALERT_STYLES[a.level])}
              >
                {a.level} {a.zoneCode} {a.peakIndex} @ +{a.peakHour}h
              </Badge>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ShiftCell
            label="Arrivals"
            items={shift.arrivals.map(
              (a) => `${stripMv(a.vesselName)} → ${a.zoneCode.replace("Z-", "")} @ +${a.etaHour}h`,
            )}
          />
          <ShiftCell
            label="Berthings"
            items={shift.berthings.map(
              (b) => `${b.berthName} · ${stripMv(b.vesselName)} · ${b.cranes} cr`,
            )}
          />
          <ShiftCell
            label="Cranes"
            items={Object.entries(shift.craneDeployment).map(
              ([code, n]) => `${code} ${Math.round(n)}`,
            )}
          />
          <ShiftCell label="Routing actions" items={shift.routingActions} />
        </div>

        {shift.checklist.length > 0 ? (
          <div className="space-y-0.5 border-t border-border/40 pt-2.5">
            {shift.checklist.map((item, i) => {
              const key = `${shift.seq}:${i}`;
              const checked = done.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onToggle(key)}
                  aria-pressed={checked}
                  className={cn(
                    "flex w-full items-start gap-2 rounded px-1 py-0.5 text-left text-xs transition-colors hover:bg-muted/40",
                    checked && "text-muted-foreground line-through",
                  )}
                >
                  <SquareCheck
                    className={cn(
                      "mt-0.5 h-3.5 w-3.5 shrink-0",
                      checked ? "text-teal-400" : "text-muted-foreground/50",
                    )}
                    aria-hidden
                  />
                  <span className="leading-snug">{item}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {shift.yardNote ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs leading-snug text-amber-200">
            Yard note: {shift.yardNote}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function PlanTab() {
  const queryClient = useQueryClient();
  const [done, setDone] = useState<Set<string>>(new Set());

  // GET /api/plan returns 404 when no plan exists — treat that as "no plan".
  const { data, isLoading } = useQuery({
    queryKey: ["plan"],
    queryFn: () => api.latestPlan().catch(() => ({ plan: null }) as PlanResponse),
  });

  const planMutation = useMutation({
    mutationFn: api.generatePlan,
    onSuccess: (res) => {
      queryClient.setQueryData<PlanResponse>(["plan"], { plan: res.plan });
      toast.success("72-hour plan generated");
    },
    onError: () => toast.error("Plan generation failed"),
  });

  const plan = data?.plan ?? null;

  const toggle = (key: string) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const copyText = () => {
    if (!plan) return;
    navigator.clipboard
      .writeText(plan.text)
      .then(() => toast.success("copied"))
      .catch(() => toast.error("Clipboard unavailable"));
  };

  const downloadText = () => {
    if (!plan) return;
    const blob = new Blob([plan.text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "72h-operations-plan.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <DashSkeleton rows={5} />;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="72-hour operations plan"
        desc="12 six-hour shifts fusing forecast, optimiser and routing output"
        icon={FileText}
        right={
          <div className="flex flex-wrap gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={!plan}>
                  <FileText className="h-4 w-4" aria-hidden />
                  Raw text
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle>Raw plan text</DialogTitle>
                  <DialogDescription>
                    Human-readable 72-hour operations plan exactly as generated by the engine.
                  </DialogDescription>
                </DialogHeader>
                <pre className="max-h-[60vh] overflow-auto rounded-md border border-border/60 bg-muted/30 p-3 font-mono text-xs leading-relaxed">
                  {plan?.text}
                </pre>
                <DialogFooter>
                  <Button variant="outline" size="sm" onClick={copyText} disabled={!plan}>
                    <Copy className="h-4 w-4" aria-hidden />
                    Copy
                  </Button>
                  <Button size="sm" onClick={downloadText} disabled={!plan}>
                    <Download className="h-4 w-4" aria-hidden />
                    Download
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button
              size="sm"
              onClick={() => planMutation.mutate()}
              disabled={planMutation.isPending}
            >
              {planMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Play className="h-4 w-4" aria-hidden />
              )}
              Regenerate plan
            </Button>
          </div>
        }
      />

      {!plan ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-teal-500/30 bg-teal-500/10">
              <FileText className="h-6 w-6 text-teal-300" aria-hidden />
            </div>
            <div>
              <div className="text-base font-semibold">No plan generated yet</div>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Generate a 72-hour port operations plan: shift-by-shift arrivals, berthings, crane
                deployment, congestion alerts and checklists.
              </p>
            </div>
            <Button onClick={() => planMutation.mutate()} disabled={planMutation.isPending}>
              {planMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Play className="h-4 w-4" aria-hidden />
              )}
              Generate 72-hour plan
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* summary KPIs */}
          <section aria-label="Plan summary">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
              <Card className="border-border/60 bg-card/70">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Risk level
                    </span>
                    <ShieldAlert
                      className={cn("h-4 w-4 shrink-0", RISK_CLASS[plan.summary.riskLevel])}
                      aria-hidden
                    />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span
                      className={cn(
                        "font-mono text-2xl font-semibold tabular-nums",
                        RISK_CLASS[plan.summary.riskLevel],
                      )}
                    >
                      {plan.summary.riskLevel}
                    </span>
                    <SeverityBadge level={plan.summary.riskLevel} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    peak {plan.summary.peakIndex} @ {plan.summary.peakZone}
                  </div>
                </CardContent>
              </Card>
              <KpiCard
                icon={Ship}
                label="Arrivals"
                value={String(plan.summary.totalArrivals)}
                sub="inbound arrivals in 72h"
              />
              <KpiCard
                icon={Anchor}
                label="Berthings"
                value={String(plan.summary.totalBerthings)}
                sub="planned berth starts"
              />
              <KpiCard
                icon={Container}
                label="Moves"
                value={fmtInt(plan.summary.totalMoves)}
                sub="planned TEU moves"
              />
              <KpiCard
                icon={Wrench}
                label="Crane-hours"
                value={fmtInt(plan.summary.craneHours)}
                sub="Σ cranes × shift hours"
              />
              <KpiCard
                icon={Hourglass}
                label="Idle berth-hours %"
                value={`${plan.summary.idleBerthHoursPct.toFixed(1)}%`}
                sub="unused berth capacity"
                tone={plan.summary.idleBerthHoursPct >= 20 ? "warn" : "good"}
              />
            </div>
          </section>

          {/* top actions */}
          <Card className="border-border/60 bg-card/70">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ListChecks className="h-4 w-4 text-teal-400" aria-hidden />
                Top actions
              </CardTitle>
            </CardHeader>
            <CardContent>
              {plan.summary.topActions.length === 0 ? (
                <div className="text-sm text-muted-foreground">—</div>
              ) : (
                <ol className="space-y-2">
                  {plan.summary.topActions.map((a, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span className="mt-px font-mono text-xs font-semibold text-teal-300">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="leading-snug">{a}</span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          {/* shift timeline */}
          <section aria-label="Shift timeline">
            <SectionHeader
              title="Shift timeline"
              desc="Tick checklist items as your teams execute each 6-hour window"
            />
            <div className="space-y-3">
              <ShiftStrip plan={plan} />
              {plan.shifts.map((s) => (
                <ShiftCard key={s.seq} shift={s} done={done} onToggle={toggle} />
              ))}
            </div>
          </section>
        </>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Plan fuses forecast + optimiser + routing; regenerate after changing any input.
      </p>
    </div>
  );
}
