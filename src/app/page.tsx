"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { api, type OverviewResponse } from "@/lib/api";
import { SeverityBadge } from "@/components/dashboard/shared";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import OverviewTab from "@/components/dashboard/overview-tab";
import ForecastTab from "@/components/dashboard/forecast-tab";
import BerthTab from "@/components/dashboard/berth-tab";
import RoutingTab from "@/components/dashboard/routing-tab";
import PlanTab from "@/components/dashboard/plan-tab";
import BobTab from "@/components/dashboard/bob-tab";
import {
  Anchor,
  Bot,
  ClipboardList,
  LayoutDashboard,
  Moon,
  Radio,
  Route,
  Ship,
  Sun,
  TrendingUp,
} from "lucide-react";

const TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "forecast", label: "Forecast", icon: TrendingUp },
  { id: "berth", label: "Berth & Cranes", icon: Ship },
  { id: "routing", label: "Routing", icon: Route },
  { id: "plan", label: "72-Hr Plan", icon: ClipboardList },
  { id: "bob", label: "Bob AI", icon: Bot },
] as const;

type TabId = (typeof TABS)[number]["id"];

function UtcClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const raf = requestAnimationFrame(tick); // defer first tick out of the effect body
    const t = setInterval(tick, 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(t);
    };
  }, []);
  if (!now) return <span className="font-mono text-xs text-muted-foreground">--:--:-- UTC</span>;
  return (
    <span className="font-mono text-xs tabular-nums text-muted-foreground">
      {now.toISOString().slice(11, 19)} UTC
    </span>
  );
}

function DataAge({ iso }: { iso?: string }) {
  const [now, setNow] = useState<number>(0);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  if (!iso) return null;
  const ageS = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  const label = !now ? "just now" : ageS < 90 ? `${ageS}s ago` : `${Math.round(ageS / 60)}m ago`;
  return (
    <span
      className="hidden items-center gap-1.5 text-[11px] text-muted-foreground lg:inline-flex"
      title={`Engine data computed ${new Date(iso).toISOString()} — forecasts re-train on refresh`}
    >
      <span className="relative flex h-1.5 w-1.5" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-teal-400" />
      </span>
      data {label}
    </span>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // rAF-deferred so setState is not called synchronously in the effect body
    // (react-hooks/set-state-in-effect) — same pattern as UtcClock above.
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const isDark = resolvedTheme !== "light";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      title="Toggle light / dark theme"
      className="text-muted-foreground hover:text-foreground"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {mounted ? (
        isDark ? (
          <Sun className="h-4 w-4" aria-hidden />
        ) : (
          <Moon className="h-4 w-4" aria-hidden />
        )
      ) : (
        <Sun className="h-4 w-4 opacity-40" aria-hidden />
      )}
    </Button>
  );
}

function PortStatusBadge({ overview }: { overview?: OverviewResponse }) {
  if (!overview) return null;
  const peak = overview.kpis.peakForecastIndex;
  const level = peak >= 75 ? "CRIT" : peak >= 60 ? "HIGH" : peak >= 45 ? "ELEVATED" : "LOW";
  return (
    <div className="flex items-center gap-2">
      <Radio className="h-3.5 w-3.5 animate-pulse text-teal-400" aria-hidden />
      <span className="hidden text-xs text-muted-foreground sm:inline">Port status</span>
      <SeverityBadge level={level} />
    </div>
  );
}

export default function Page() {
  const [tab, setTab] = useState<TabId>("overview");
  const { data: overview } = useQuery({ queryKey: ["overview"], queryFn: api.overview });

  // Keyboard shortcuts: 1–6 jump between tabs, B jumps to Bob AI.
  // Ignored while typing in inputs/textareas/selects or content-editables.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)
      )
        return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= TABS.length) {
        setTab(TABS[n - 1].id);
      } else if (e.key === "b" || e.key === "B") {
        setTab("bob");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      {/* ----------------------------------------------------------- header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 shadow-lg shadow-teal-500/20">
              <Anchor className="h-5 w-5 text-white" aria-hidden />
            </div>
            <div>
              <div className="text-sm font-bold leading-tight tracking-tight">
                PortFlow <span className="text-teal-400">SBX</span>
              </div>
              <div className="text-[11px] leading-tight text-muted-foreground">
                San Pedro Bay Ops Center · Congestion → Optimiser → 72h Plan
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <DataAge iso={overview?.lastUpdated} />
            <UtcClock />
            <Separator orientation="vertical" className="hidden h-5 sm:block" />
            <PortStatusBadge overview={overview} />
            <Button
              size="sm"
              variant={tab === "bob" ? "default" : "outline"}
              className="gap-1.5"
              onClick={() => setTab("bob")}
            >
              <Bot className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Ask Bob</span>
            </Button>
            <ThemeToggle />
          </div>
        </div>
        {/* --------------------------------------------------------- tab nav */}
        <nav aria-label="Dashboard sections" className="border-t border-border/40">
          <div className="mx-auto flex w-full max-w-7xl gap-1 overflow-x-auto px-2 md:px-4" role="tablist">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={active}
                  title={`${t.label} — shortcut ${TABS.indexOf(t) + 1}`}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "relative flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors outline-none",
                    active ? "text-teal-300" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {t.label}
                  <kbd
                    className={cn(
                      "ml-0.5 hidden rounded border border-border/60 bg-muted/40 px-1 font-mono text-[9px] leading-4 text-muted-foreground lg:inline",
                      active && "border-teal-500/40 text-teal-300/80",
                    )}
                    aria-hidden
                  >
                    {TABS.indexOf(t) + 1}
                  </kbd>
                  {active ? (
                    <motion.span
                      layoutId="tab-underline"
                      className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-teal-400"
                      transition={{ type: "spring", stiffness: 400, damping: 32 }}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </nav>
      </header>

      {/* ------------------------------------------------------------ main */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 md:px-6 md:py-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            {tab === "overview" && <OverviewTab />}
            {tab === "forecast" && <ForecastTab />}
            {tab === "berth" && <BerthTab />}
            {tab === "routing" && <RoutingTab />}
            {tab === "plan" && <PlanTab />}
            {tab === "bob" && <BobTab />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* ---------------------------------------------------------- footer */}
      <footer className="mt-auto border-t border-border/60 bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-1.5 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground md:flex-row md:items-center md:justify-between md:px-6">
          <div>
            Terminal capacity: <span className="text-foreground/80">Port of Long Beach terminal fact sheets</span> (real,
            cited) · AIS pipeline: <span className="text-foreground/80">NOAA MarineCadastre AccessAIS</span> ·
            Vessel queue &amp; history: labelled <span className="text-amber-500/90">DEMO dataset</span>
          </div>
          <div className="font-mono">
            PortFlow SBX · Bob AI Hackathon L1 · model re-trains on refresh ·
            <span className="ml-1" title="Keyboard shortcuts">
              <kbd className="rounded border border-border/60 bg-muted/40 px-1 text-[10px]">1–6</kbd> tabs ·{" "}
              <kbd className="rounded border border-border/60 bg-muted/40 px-1 text-[10px]">B</kbd> Bob
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
