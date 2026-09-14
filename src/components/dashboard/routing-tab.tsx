"use client";

// Routing tab — alternate routing recommendations (DIVERT / SLOW_STEAM /
// PRIORITY_WINDOW / HOLD) with cost-model savings and local accept/dismiss.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, fmtUsd } from "@/lib/api";
import type { RoutingOption, RoutingRec } from "@/lib/engine/types";
import { DashSkeleton, KpiCard, SectionHeader } from "@/components/dashboard/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DollarSign, Download, Route, Timer, Waves } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Filter = "ALL" | RoutingOption;

const OPTION_LABEL: Record<RoutingOption, string> = {
  DIVERT: "Divert",
  SLOW_STEAM: "Slow-steam",
  PRIORITY_WINDOW: "Priority window",
  HOLD: "Hold",
};

const OPTION_BADGE: Record<RoutingOption, string> = {
  DIVERT: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  SLOW_STEAM: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  PRIORITY_WINDOW: "border-teal-500/40 bg-teal-500/10 text-teal-300",
  HOLD: "",
};

const recKey = (r: RoutingRec) => `${r.vesselId}:${r.option}`;

export default function RoutingTab() {
  const { data, isLoading, isError } = useQuery({ queryKey: ["routing"], queryFn: api.routing });
  const [filter, setFilter] = useState<Filter>("ALL");
  // locally decided recs (accepted/dismissed) — hidden from the list, no backend call
  const [decided, setDecided] = useState<Set<string>>(new Set());

  if (isLoading) return <DashSkeleton rows={3} />;
  if (isError || !data)
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Failed to load routing recommendations. Check that the dev server and database are running.
        </CardContent>
      </Card>
    );

  const { summary, recommendations } = data;

  function decide(r: RoutingRec, action: "accept" | "dismiss") {
    setDecided((prev) => {
      const next = new Set(prev);
      next.add(recKey(r));
      return next;
    });
    toast(
      `${action === "accept" ? "Accepted" : "Dismissed"} ${OPTION_LABEL[r.option].toLowerCase()} recommendation for ${r.vesselName}`,
    );
  }

  const filters: { value: Filter; label: string; count: number }[] = [
    { value: "ALL", label: "All", count: recommendations.length },
    { value: "DIVERT", label: "Divert", count: summary.divert },
    { value: "SLOW_STEAM", label: "Slow-steam", count: summary.slowSteam },
    { value: "PRIORITY_WINDOW", label: "Priority window", count: summary.priority },
    { value: "HOLD", label: "Hold", count: summary.hold },
  ];

  const visible = recommendations.filter(
    (r) => (filter === "ALL" || r.option === filter) && !decided.has(recKey(r)),
  );

  return (
    <div className="space-y-6">
      {/* KPI grid */}
      <section aria-label="Routing KPIs">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            icon={Route}
            label="Divert candidates"
            value={String(summary.divert)}
            sub="vessels with viable alternate ports"
            tone="bad"
          />
          <KpiCard
            icon={Waves}
            label="Slow-steam orders"
            value={String(summary.slowSteam)}
            sub="reduce speed to shift ETA off peak"
            tone="warn"
          />
          <KpiCard
            icon={Timer}
            label="Priority windows"
            value={String(summary.priority)}
            sub="granted berthing priority slots"
            tone="good"
          />
          <KpiCard
            icon={DollarSign}
            label="Est. total savings"
            value={fmtUsd(summary.totalSavingsUsd)}
            sub="ops cost + reefer risk avoided"
            tone="good"
          />
        </div>
      </section>

      {/* recommendation list */}
      <section aria-label="Routing recommendations">
        <SectionHeader
          title="Recommendations"
          desc="Tiered per-vessel actions from the rule engine — divert, slow-steam, priority window, or hold at anchor"
          right={
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" asChild>
                <a href={api.exportCsv("routing")} download>
                  <Download className="h-4 w-4" aria-hidden />
                  CSV
                </a>
              </Button>
              <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={filter}
              onValueChange={(v) => v && setFilter(v as Filter)}
              className="flex-wrap"
              aria-label="Filter recommendations"
            >
              {filters.map((f) => (
                <ToggleGroupItem key={f.value} value={f.value} className="font-mono text-xs">
                  {f.label} ({f.count})
                </ToggleGroupItem>
              ))}
              </ToggleGroup>
            </div>
          }
        />

        <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
          {visible.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
              No recommendations in this class — queue is clear.
            </div>
          ) : (
            visible.map((r) => (
              <Card key={recKey(r)} className="border-border/60 bg-card/70">
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className={cn("font-mono text-[10px] tracking-wide", OPTION_BADGE[r.option])}
                        >
                          {OPTION_LABEL[r.option].toUpperCase()}
                        </Badge>
                        <span className="text-sm font-semibold leading-tight">{r.vesselName}</span>
                        <span className="text-xs text-muted-foreground">{r.carrier}</span>
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {r.vesselClass}
                        </Badge>
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {r.destZoneCode}
                        </Badge>
                      </div>
                      <p className="text-sm leading-relaxed text-muted-foreground">{r.rationale}</p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                        <span>
                          predicted wait{" "}
                          <span className="font-mono font-medium text-foreground">
                            {r.predictedWaitHrs.toFixed(0)}h
                          </span>
                        </span>
                        {r.targetPort ? (
                          <span>
                            target{" "}
                            <span className="font-mono font-medium text-foreground">{r.targetPort}</span>
                          </span>
                        ) : null}
                        <span>
                          ETA shift{" "}
                          <span className="font-mono font-medium text-foreground">
                            {r.etaShiftHrs >= 0 ? "+" : ""}
                            {r.etaShiftHrs.toFixed(0)}h
                          </span>
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <div
                        className={cn(
                          "font-mono text-xl font-semibold tabular-nums",
                          r.option === "HOLD" ? "text-muted-foreground" : "text-teal-400",
                        )}
                      >
                        {r.option === "HOLD" ? "—" : fmtUsd(r.estSavingsUsd)}
                      </div>
                      <div className="flex items-center gap-2" title={`Confidence ${Math.round(r.confidence * 100)}%`}>
                        <Progress
                          value={r.confidence * 100}
                          className="h-1.5 w-24"
                          aria-label={`Confidence for ${r.vesselName}`}
                        />
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {Math.round(r.confidence * 100)}%
                        </span>
                      </div>
                      {r.option !== "HOLD" ? (
                        <div className="mt-1 flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2.5 text-xs"
                            onClick={() => decide(r, "accept")}
                          >
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2.5 text-xs text-muted-foreground"
                            onClick={() => decide(r, "dismiss")}
                          >
                            Dismiss
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
          Cost model: $32k/day vessel operating cost · alternate ports Oakland, Seattle-Tacoma, Prince Rupert,
          Ensenada · reefer spoilage exposure $180/unit — see docs/solution-overview.md.
        </p>
      </section>
    </div>
  );
}
