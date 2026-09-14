"use client";

// Shared dashboard UI atoms for the PortFlow SBX ops center.
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Info,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";

export function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "default",
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "good" | "warn" | "bad";
  className?: string;
}) {
  const toneRing = {
    default: "text-foreground",
    good: "text-teal-400",
    warn: "text-amber-400",
    bad: "text-rose-400",
  }[tone];
  return (
    <Card
      className={cn(
        "group border-border/60 bg-card/70 backdrop-blur transition-all duration-200",
        "hover:-translate-y-0.5 hover:border-teal-500/30 hover:shadow-lg hover:shadow-teal-500/10",
        className,
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          <span
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/50 ring-1 ring-inset ring-border/60 transition-all group-hover:bg-background group-hover:opacity-100",
            )}
          >
            <Icon className={cn("h-4 w-4", toneRing)} aria-hidden />
          </span>
        </div>
        <div className={cn("mt-2 font-mono text-2xl font-semibold tabular-nums transition-colors", toneRing)}>{value}</div>
        {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (!values.length) return null;
  const W = 120;
  const H = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1e-6, max - min);
  const pts = values
    .map((v, i) => `${((i / Math.max(1, values.length - 1)) * W).toFixed(1)},${(H - ((v - min) / span) * (H - 4) - 2).toFixed(1)}`)
    .join(" ");
  const last = values[values.length - 1];
  // Theme-token strokes adapt to light/dark via the --chart-* variables.
  const stroke = last >= 60 ? "var(--chart-3)" : last >= 45 ? "var(--chart-2)" : "var(--chart-1)";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("h-7 w-full", className)} preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

export function SeverityBadge({ level }: { level: "LOW" | "ELEVATED" | "HIGH" | "CRIT" | "SEVERE" }) {
  const map = {
    LOW: "border-teal-500/40 bg-teal-500/10 text-teal-300",
    ELEVATED: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    HIGH: "border-orange-500/40 bg-orange-500/10 text-orange-300",
    CRIT: "border-rose-500/40 bg-rose-500/10 text-rose-300",
    SEVERE: "border-rose-500/60 bg-rose-500/20 text-rose-200",
  } as const;
  return (
    <Badge variant="outline" className={cn("font-mono text-[10px] tracking-wide", map[level])}>
      {level}
    </Badge>
  );
}

export function levelOfIndex(index: number): "LOW" | "ELEVATED" | "HIGH" | "CRIT" {
  return index >= 75 ? "CRIT" : index >= 60 ? "HIGH" : index >= 45 ? "ELEVATED" : "LOW";
}

export function TrendArrow({ trend }: { trend: "rising" | "falling" | "flat" }) {
  if (trend === "rising")
    return (
      <span className="inline-flex items-center gap-0.5 text-rose-400">
        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /> rising
      </span>
    );
  if (trend === "falling")
    return (
      <span className="inline-flex items-center gap-0.5 text-teal-400">
        <ArrowDownRight className="h-3.5 w-3.5" aria-hidden /> falling
      </span>
    );
  return (
    <span className="inline-flex items-center gap-0.5 text-muted-foreground">
      <ArrowRight className="h-3.5 w-3.5" aria-hidden /> flat
    </span>
  );
}

export function SectionHeader({
  title,
  desc,
  icon: Icon,
  right,
}: {
  title: string;
  desc?: string;
  icon?: LucideIcon;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          {Icon ? <Icon className="h-5 w-5 text-teal-400" aria-hidden /> : null}
          {title}
        </h2>
        {desc ? <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function AlertRow({
  severity,
  title,
  detail,
}: {
  severity: "info" | "warn" | "crit";
  title: string;
  detail: string;
}) {
  const icon =
    severity === "crit" ? (
      <ShieldAlert className="h-4 w-4 shrink-0 text-rose-400" aria-hidden />
    ) : severity === "warn" ? (
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
    ) : (
      <Info className="h-4 w-4 shrink-0 text-teal-400" aria-hidden />
    );
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-card/60 p-3">
      {icon}
      <div className="min-w-0">
        <div className="text-sm font-medium leading-tight">{title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

export function IndexBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const color = pct >= 75 ? "bg-rose-500" : pct >= 60 ? "bg-orange-500" : pct >= 45 ? "bg-amber-500" : "bg-teal-500";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="presentation">
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function DashSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-32" />
      ))}
    </div>
  );
}
