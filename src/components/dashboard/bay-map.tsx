"use client";

// San Pedro Bay schematic congestion map — stylised, not to nautical scale.
// Renders the four POLB container-terminal zones (real berth/crane facts) with
// their live anchorage queue + congestion index from the overview engine
// snapshot. Level colours reuse the dashboard badge conventions so light/dark
// themes stay in sync via the html:not(.dark) token remap in globals.css.
import { useMemo, useState } from "react";
import type { OverviewResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

type Zone = OverviewResponse["zones"][number];

// Schematic geometry per terminal zone (viewBox 820×470). Left→right follows
// the real POLB waterfront order: LBCT (Pier E) → ITS (Pier G) → PCT (Pier J,
// Terminal Island) → TTI (Pier T). Positions are illustrative, documented as
// such in the card caption.
const BAY_W = 820;
const BAY_H = 470;
const LAYOUT: Record<string, { x: number; pier: string; pierName: string }> = {
  "Z-LBCT": { x: 118, pier: "Pier E", pierName: "LBCT" },
  "Z-ITS": { x: 300, pier: "Pier G", pierName: "ITS" },
  "Z-PCT": { x: 482, pier: "Pier J", pierName: "PCT" },
  "Z-TTI": { x: 664, pier: "Pier T", pierName: "TTI" },
};
const ANCH_W = 148;
const ANCH_H = 92;
const ANCH_Y = 248;

// Level → tailwind class tokens (kept static so the JIT sees every variant).
const LEVEL_FILL: Record<Zone["level"], string> = {
  LOW: "fill-teal-500",
  ELEVATED: "fill-amber-500",
  HIGH: "fill-orange-500",
  CRIT: "fill-rose-500",
};
const LEVEL_STROKE: Record<Zone["level"], string> = {
  LOW: "stroke-teal-400",
  ELEVATED: "stroke-amber-400",
  HIGH: "stroke-orange-400",
  CRIT: "stroke-rose-400",
};
const LEVEL_TEXT: Record<Zone["level"], string> = {
  LOW: "text-teal-300",
  ELEVATED: "text-amber-300",
  HIGH: "text-orange-300",
  CRIT: "text-rose-300",
};

// Deterministic pseudo-random scatter for vessel dots (stable across renders).
function dotPositions(zoneCode: string, count: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let seed = 0;
  for (const ch of zoneCode) seed = (seed * 31 + ch.charCodeAt(0)) % 9973;
  const n = Math.min(count, 14);
  for (let i = 0; i < n; i++) {
    seed = (seed * 137 + 71) % 9973;
    const fx = (seed % 100) / 100;
    seed = (seed * 137 + 71) % 9973;
    const fy = (seed % 100) / 100;
    out.push({
      x: 14 + fx * (ANCH_W - 28),
      y: 20 + fy * (ANCH_H - 34),
    });
  }
  return out;
}

function bubbleR(queue: number): number {
  return 12 + Math.sqrt(Math.max(0, queue)) * 3.2; // queue 0 → 12, 20 → ~26
}

export function BayMap({
  zones,
  className,
}: {
  zones: OverviewResponse["zones"];
  className?: string;
}) {
  const [hover, setHover] = useState<{ zone: Zone; ax: number; ay: number } | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  const terminals = useMemo(
    () => zones.filter((z) => z.zoneCode !== "Z-PORT" && LAYOUT[z.zoneCode]),
    [zones],
  );
  const port = useMemo(() => zones.find((z) => z.zoneCode === "Z-PORT"), [zones]);
  const hotspot = useMemo(
    () =>
      terminals.reduce<Zone | null>(
        (best, z) => (!best || z.peakIndex > best.peakIndex ? z : best),
        null,
      ),
    [terminals],
  );

  if (terminals.length === 0) return null;

  return (
    <div className={cn("overflow-x-auto", className)}>
      <div className="relative min-w-[600px]">
        <svg
          viewBox={`0 0 ${BAY_W} ${BAY_H}`}
          className="h-auto w-full"
          role="img"
          aria-label={`Stylised congestion map of San Pedro Bay. ${terminals
            .map((z) => `${z.label}: index ${z.currentIndex.toFixed(0)}, queue ${z.queueNow}.`)
            .join(" ")}`}
        >
          {/* ------------------------------------------------------ water */}
          <rect x={0} y={0} width={BAY_W} height={BAY_H} className="fill-teal-500/5" rx={12} />
          {/* faint nautical grid */}
          {Array.from({ length: 8 }).map((_, i) => (
            <line
              key={`v${i}`}
              x1={(i + 1) * (BAY_W / 9)}
              y1={0}
              x2={(i + 1) * (BAY_W / 9)}
              y2={BAY_H}
              className="stroke-foreground/5"
              strokeWidth={1}
            />
          ))}
          {Array.from({ length: 4 }).map((_, i) => (
            <line
              key={`h${i}`}
              x1={0}
              y1={(i + 1) * (BAY_H / 5)}
              x2={BAY_W}
              y2={(i + 1) * (BAY_H / 5)}
              className="stroke-foreground/5"
              strokeWidth={1}
            />
          ))}
          {/* wave accents */}
          {[
            "M 60 392 q 14 -7 28 0 t 28 0",
            "M 620 180 q 14 -7 28 0 t 28 0",
            "M 320 425 q 14 -7 28 0 t 28 0",
          ].map((d, i) => (
            <path key={i} d={d} className="fill-none stroke-foreground/10" strokeWidth={1.5} strokeLinecap="round" />
          ))}

          {/* ------------------------------------------------- land + coast */}
          <path
            d="M 0 0 H 820 V 128 Q 740 148 664 140 Q 560 128 482 142 Q 400 152 300 138 Q 200 128 118 144 Q 50 154 0 138 Z"
            className="fill-foreground/10"
          />
          <path
            d="M 0 138 Q 50 154 118 144 Q 200 128 300 138 Q 400 152 482 142 Q 560 128 664 140 Q 740 148 820 128"
            className="fill-none stroke-foreground/25"
            strokeWidth={1.5}
          />
          <text x={22} y={40} className="fill-foreground/45 text-[13px] font-semibold tracking-[0.18em]">
            PORT OF LONG BEACH
          </text>
          <text x={22} y={60} className="fill-foreground/30 text-[10px] tracking-[0.14em]">
            SAN PEDRO BAY · TERMINAL ZONES (SCHEMATIC)
          </text>
          <text x={BAY_W - 20} y={BAY_H - 18} textAnchor="end" className="fill-foreground/30 text-[11px] italic">
            Pacific Ocean
          </text>

          {/* ------------------------------------------------- breakwater */}
          <path
            d="M 36 442 Q 410 372 784 442"
            className="fill-none stroke-foreground/30"
            strokeWidth={2}
            strokeDasharray="10 7"
          />
          <text x={410} y={448} textAnchor="middle" className="fill-foreground/30 text-[10px] tracking-[0.12em]">
            SAN PEDRO BREAKWATER
          </text>

          {/* ------------------------------------------ piers + anchorages */}
          {terminals.map((z) => {
            const geo = LAYOUT[z.zoneCode];
            const ax = geo.x + 45 - ANCH_W / 2; // anchorage box centred under pier
            const ay = ANCH_Y;
            const isHot = hotspot?.zoneCode === z.zoneCode;
            const dimmed = focus !== null && focus !== z.zoneCode;
            const hovered = hover?.zone.zoneCode === z.zoneCode;
            return (
              <g
                key={z.zoneCode}
                role="button"
                tabIndex={0}
                aria-label={`${z.label}: congestion ${z.currentIndex.toFixed(0)} of 100, ${z.queueNow} vessels at anchor, average wait ${z.waitNow.toFixed(0)} hours`}
                className={cn("cursor-pointer outline-none transition-opacity", dimmed && "opacity-40")}
                onFocus={() => setFocus(z.zoneCode)}
                onBlur={() => setFocus(null)}
                onMouseEnter={() => setHover({ zone: z, ax, ay })}
                onMouseLeave={() => setHover((h) => (h && h.zone.zoneCode === z.zoneCode ? null : h))}
                onClick={() => setFocus(focus === z.zoneCode ? null : z.zoneCode)}
              >
                {/* anchorage box */}
                <rect
                  x={ax}
                  y={ay}
                  width={ANCH_W}
                  height={ANCH_H}
                  rx={10}
                  className={cn(
                    "fill-none stroke-dashed",
                    LEVEL_STROKE[z.level],
                    hovered && "stroke-[2.5]",
                  )}
                  strokeOpacity={0.55}
                  strokeWidth={2}
                  strokeDasharray="7 5"
                />
                <text
                  x={ax + 10}
                  y={ay + 18}
                  className={cn("text-[10px] font-semibold tracking-[0.12em]", LEVEL_TEXT[z.level])}
                >
                  ANCHORAGE
                </text>

                {/* vessel dots */}
                {dotPositions(z.zoneCode, z.queueNow).map((p, i) => (
                  <circle
                    key={i}
                    cx={ax + p.x}
                    cy={ay + p.y}
                    r={2.6}
                    className={cn(LEVEL_FILL[z.level])}
                    fillOpacity={0.65}
                  />
                ))}

                {/* queue bubble */}
                {z.queueNow > 0 ? (
                  <>
                    <circle
                      cx={ax + ANCH_W / 2}
                      cy={ay + ANCH_H - 16}
                      r={bubbleR(z.queueNow)}
                      className={cn(LEVEL_FILL[z.level])}
                      fillOpacity={0.16}
                    />
                    <circle
                      cx={ax + ANCH_W / 2}
                      cy={ay + ANCH_H - 16}
                      r={bubbleR(z.queueNow)}
                      className={cn("fill-none", LEVEL_STROKE[z.level])}
                      strokeOpacity={0.5}
                      strokeWidth={1.5}
                    />
                    <text
                      x={ax + ANCH_W / 2}
                      y={ay + ANCH_H - 12}
                      textAnchor="middle"
                      className={cn("font-mono text-[11px] font-semibold", LEVEL_TEXT[z.level])}
                    >
                      {z.queueNow}
                    </text>
                  </>
                ) : null}

                {/* hotspot pulse ring */}
                {isHot ? (
                  <>
                    <circle
                      cx={ax + ANCH_W / 2}
                      cy={ay + ANCH_H / 2}
                      r={ANCH_H / 2 + 6}
                      className="animate-pulse fill-none stroke-rose-400"
                      strokeOpacity={0.5}
                      strokeWidth={1.5}
                    />
                    <g transform={`translate(${ax + ANCH_W - 4}, ${ay + 6})`}>
                      <rect x={-92} y={0} width={96} height={16} rx={8} className="fill-rose-500/20" />
                      <text x={-44} y={11} textAnchor="middle" className="fill-rose-300 text-[9px] font-semibold tracking-wide">
                        PEAK {z.peakIndex.toFixed(0)} @ +{z.peakHour}h
                      </text>
                    </g>
                  </>
                ) : null}

                {/* pier */}
                <rect
                  x={geo.x}
                  y={118}
                  width={90}
                  height={58}
                  rx={4}
                  className={cn(
                    "fill-foreground/20 transition-colors",
                    hovered && "fill-foreground/30",
                  )}
                  stroke={hovered ? undefined : undefined}
                />
                {/* pier level edge */}
                <rect x={geo.x} y={172} width={90} height={4} rx={2} className={cn(LEVEL_FILL[z.level])} fillOpacity={0.9} />
                <text x={geo.x + 45} y={136} textAnchor="middle" className="fill-foreground/85 font-mono text-[12px] font-bold">
                  {geo.pierName}
                </text>
                <text x={geo.x + 45} y={150} textAnchor="middle" className="fill-foreground/45 text-[9px] tracking-wider">
                  {geo.pier} · {z.berths} berths · {z.cranes} cr
                </text>
                <text
                  x={geo.x + 45}
                  y={196}
                  textAnchor="middle"
                  className={cn("font-mono text-[13px] font-semibold", LEVEL_TEXT[z.level])}
                >
                  {z.currentIndex.toFixed(0)}
                  <tspan className="fill-foreground/40 text-[9px]">/100</tspan>
                </text>
                <text x={geo.x + 45} y={210} textAnchor="middle" className="fill-foreground/40 text-[9px]">
                  {z.trend === "rising" ? "▲" : z.trend === "falling" ? "▼" : "■"} {z.waitNow.toFixed(0)}h avg wait
                </text>
              </g>
            );
          })}
        </svg>

        {/* --------------------------------------------- hover tooltip */}
        {hover ? (
          <div
            className="pointer-events-none absolute z-10 w-52 rounded-lg border border-border/70 bg-popover/95 p-2.5 text-xs shadow-xl backdrop-blur"
            style={{
              left: `${Math.min(78, Math.max(2, ((hover.ax + ANCH_W / 2) / BAY_W) * 100))}%`,
              top: `${Math.min(72, Math.max(2, ((hover.ay - 8) / BAY_H) * 100))}%`,
              transform: "translate(-50%, -100%)",
            }}
            role="tooltip"
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-semibold">{hover.zone.label}</span>
              <span className={cn("font-mono text-[10px] font-semibold", LEVEL_TEXT[hover.zone.level])}>
                {hover.zone.level}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
              <dt>index</dt>
              <dd className="text-right text-foreground">{hover.zone.currentIndex.toFixed(0)}/100</dd>
              <dt>queue</dt>
              <dd className="text-right text-foreground">{hover.zone.queueNow}</dd>
              <dt>avg wait</dt>
              <dd className="text-right text-foreground">{hover.zone.waitNow.toFixed(0)}h</dd>
              <dt>72h peak</dt>
              <dd className="text-right text-foreground">
                {hover.zone.peakIndex.toFixed(0)} @ +{hover.zone.peakHour}h
              </dd>
            </dl>
          </div>
        ) : null}

        {/* ------------------------------------------------------ legend */}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-teal-500/80" aria-hidden /> LOW
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500/80" aria-hidden /> ELEVATED
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-orange-500/80" aria-hidden /> HIGH
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-500/80" aria-hidden /> CRIT
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full border border-foreground/40" aria-hidden /> bubble = vessels
            at anchor
          </span>
          <span className="ml-auto italic">
            Stylised schematic — not to nautical scale. Piers left→right follow the real POLB waterfront (E → G → J → T).
          </span>
        </div>

        {/* --------------------------------------------- port-wide chip */}
        {port ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/40 px-1 pt-2 text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">{port.label}:</span>
            <span className="font-mono text-foreground">
              {port.currentIndex.toFixed(0)}/100 now · peak {port.peakIndex.toFixed(0)} @ +{port.peakHour}h
            </span>
            <span>·</span>
            <span className="font-mono">{port.queueNow} vessels queued</span>
            <span>·</span>
            <span className="font-mono">{port.waitNow.toFixed(0)}h avg wait</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default BayMap;
