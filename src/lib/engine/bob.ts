// ============================================================================
// Bob — the load-bearing AI ops-assistant layer (Bob AI Hackathon requirement).
//
// Bob is NOT cosmetic: every answer is produced by (1) detecting the operator's
// intent, (2) actually invoking the forecasting / optimiser / routing / plan
// engines via the pipeline module, (3) grounding the LLM strictly in the JSON
// those engines returned, and (4) reporting which tools were called.
// If the LLM is unavailable, Bob degrades to a deterministic answer built from
// the same engine output — the numbers are always engine-computed.
// ============================================================================
import ZAI from "z-ai-web-dev-sdk";
import { getEngineContext } from "./context";
import {
  buildOpsPlanOutput,
  buildOverview,
  runForecasts,
  runOptimiser,
  runRouting,
} from "./pipeline";
import type { OverviewData } from "./pipeline";

export interface BobAction {
  tool: string;
  detail: string;
}

export interface BobAnswer {
  content: string;
  actions: BobAction[];
  mode: "llm" | "deterministic";
}

type Intent = "plan" | "optimise" | "routing" | "forecast" | "vessel" | "status";

function detectIntent(message: string): Intent {
  const m = message.toLowerCase();
  if (/(72|plan|shift|handover|checklist)/.test(m)) return "plan";
  if (/(berth|assign|optimi|crane|schedule|slot|gantt)/.test(m)) return "optimise";
  if (/(divert|routing|reroute|slow.?steam|alternate|priority window)/.test(m)) return "routing";
  if (/(vessel|ship|m\/v|anchored|waiting|queue position)/.test(m) && /(status|where|how long|detail)/.test(m))
    return "vessel";
  if (/(congestion|outlook|forecast|hotspot|peak|next|predict)/.test(m)) return "forecast";
  return "status";
}

// ---------------------------------------------------------------- data packs
interface DataPack {
  actions: BobAction[];
  payload: string;
}

async function packStatus(): Promise<{ pack: DataPack; overview: OverviewData }> {
  const { overview } = await buildOverview();
  return {
    pack: {
      actions: [{ tool: "overview.get", detail: "Computed live KPIs and zone status" }],
      payload: JSON.stringify(overview, null, 1).slice(0, 4200),
    },
    overview,
  };
}

async function packForecast(): Promise<DataPack> {
  const ctx = await getEngineContext();
  const forecasts = await runForecasts(ctx);
  const compact = Object.values(forecasts).map((f) => ({
    zone: f.zoneName,
    now: f.current,
    peak: f.peak,
    avgIndex: f.avgIndex,
    drivers: f.drivers.map((d) => d.label),
    model: {
      algorithm: f.model.algorithm,
      mae24: f.model.mae24,
      mae72: f.model.mae72,
      r2: f.model.r2,
      skillVsPersistencePct: f.model.skillPct,
      trainingRows: f.model.trainingRows,
    },
    next12h: f.points.slice(0, 12).map((p) => p.index),
  }));
  return {
    actions: [
      { tool: "forecast.run", detail: `Trained + ran schedule-aware ridge models for ${compact.length} zones` },
    ],
    payload: JSON.stringify(compact, null, 1).slice(0, 4200),
  };
}

async function packOptimise(): Promise<DataPack> {
  const ctx = await getEngineContext();
  const forecasts = await runForecasts(ctx);
  const out = runOptimiser(ctx, forecasts);
  const compact = {
    metrics: out.metrics,
    baselineFIFO: out.baseline,
    deltas: out.deltas,
    deferred: out.deferred,
    firstAssignments: out.assignments.slice(0, 12).map((a) => ({
      vessel: a.vesselName,
      berth: `${a.pier} ${a.berthName}`,
      start: `+${a.startHour}h`,
      end: `+${a.endHour}h`,
      cranes: a.cranes,
      wait: `${a.waitHours}h`,
    })),
  };
  return {
    actions: [{ tool: "optimiser.run", detail: `Assigned ${out.metrics.serviced} vessels across ${ctx.berths.length} berths` }],
    payload: JSON.stringify(compact, null, 1).slice(0, 4200),
  };
}

async function packRouting(): Promise<DataPack> {
  const ctx = await getEngineContext();
  const forecasts = await runForecasts(ctx);
  const opt = runOptimiser(ctx, forecasts);
  const recs = runRouting(ctx, forecasts, opt);
  const top = recs.filter((r) => r.option !== "HOLD");
  return {
    actions: [{ tool: "routing.recommend", detail: `${top.length} actionable recommendations` }],
    payload: JSON.stringify(
      {
        summary: {
          actionable: top.length,
          totalSavingsUsd: top.reduce((a, r) => a + r.estSavingsUsd, 0),
        },
        top: top.slice(0, 8),
      },
      null,
      1,
    ).slice(0, 4200),
  };
}

async function packPlan(): Promise<DataPack> {
  const ctx = await getEngineContext();
  const forecasts = await runForecasts(ctx);
  const opt = runOptimiser(ctx, forecasts);
  const routing = runRouting(ctx, forecasts, opt);
  const plan = buildOpsPlanOutput(ctx, forecasts, opt, routing);
  return {
    actions: [
      { tool: "forecast.run", detail: "72h congestion forecast" },
      { tool: "optimiser.run", detail: `${opt.metrics.serviced} berth assignments` },
      { tool: "routing.recommend", detail: `${routing.filter((r) => r.option !== "HOLD").length} routing actions` },
      { tool: "plan.generate", detail: `12 × 6h shifts, risk ${plan.summary.riskLevel}` },
    ],
    payload: JSON.stringify({ summary: plan.summary, firstShifts: plan.shifts.slice(0, 3) }, null, 1).slice(0, 4200),
  };
}

async function packVessel(message: string): Promise<DataPack> {
  const ctx = await getEngineContext();
  const m = message.toLowerCase();
  const matches = ctx.vessels.filter((v) =>
    m.includes(v.name.toLowerCase().replace("m/v ", "").trim()) || m.includes(v.name.toLowerCase()),
  );
  const list = matches.length ? matches : ctx.vessels.slice(0, 5);
  return {
    actions: [{ tool: "vessels.query", detail: `${list.length} vessel record(s)` }],
    payload: JSON.stringify(list, null, 1).slice(0, 3600),
  };
}

// ---------------------------------------------------------------- prompt
const SYSTEM_PROMPT = `You are Bob, the AI port-operations assistant embedded in PortFlow SBX — a Container Congestion Predictor & Port Operations Optimiser for San Pedro Bay (Ports of Long Beach / Los Angeles).

You help shift supervisors and port operators with:
1. Congestion hotspot prediction (schedule-aware ridge-regression forecast, 72h horizon)
2. Berth & crane assignment optimisation (greedy + local search, real POLB terminal constraints)
3. Alternate routing recommendations (divert / slow-steam / priority window, cost-based rules)
4. The 72-hour operations plan (12 × 6h shifts)

STRICT RULES:
- Use ONLY the numbers in the ENGINE DATA block provided. Never invent figures.
- Be concise and operational: short bullets, bold key numbers, no preamble.
- If the data shows a risk (peak congestion index ≥ 75, wait ≥ 48h), say it plainly and name the vessels/zones involved.
- When tools were called, you may reference them as "ran the forecasting engine", etc.
- Distances/costs come from the engine's documented cost model ($32k/day ship operating cost).`;

async function callLLM(message: string, dataPayload: string, history: { role: string; content: string }[]): Promise<string> {
  const zai = await ZAI.create();
  const msgs: { role: string; content: string }[] = [
    {
      role: "assistant",
      content: `${SYSTEM_PROMPT}\n\n=== ENGINE DATA (live, just computed) ===\n${dataPayload}\n=== END ENGINE DATA ===`,
    },
    ...history.slice(-6).map((h) => ({ role: h.role === "user" ? "user" : "assistant", content: h.content })),
    { role: "user", content: message },
  ];
  const completion = await zai.chat.completions.create({
    messages: msgs as never,
    thinking: { type: "disabled" },
  });
  const content = completion.choices[0]?.message?.content;
  if (!content || !content.trim()) throw new Error("empty LLM response");
  return content.trim();
}

// ---------------------------------------------------------------- fallback
function deterministicAnswer(intent: Intent, pack: DataPack, overview: OverviewData): string {
  const k = overview.kpis;
  const lines: string[] = [];
  const topZones = [...overview.zones]
    .filter((z) => z.zoneCode !== "Z-PORT")
    .sort((a, b) => b.peakIndex - a.peakIndex)
    .slice(0, 2);
  switch (intent) {
    case "forecast":
      lines.push(
        `**72h congestion outlook (forecasting engine)**`,
        `Port-wide now: index **${k.portIndexNow}/100**, ${k.vesselsAtAnchor} vessels waiting, avg wait **${k.avgAnchorageWait}h**.`,
        `Forecast peak: **${k.peakForecastIndex}/100 at +${k.peakForecastHour}h**.`,
        ...topZones.map(
          (z) => `• ${z.label}: now ${z.currentIndex.toFixed(0)} → peak **${z.peakIndex.toFixed(0)} @ +${z.peakHour}h** (${z.trend}).`,
        ),
        `Model: schedule-aware ridge regression; validate on 48h holdout (see Forecast tab for MAE/R²).`,
      );
      break;
    case "optimise":
      lines.push(
        `**Berth & crane optimisation (optimiser engine)**`,
        `Berth utilisation next 24h: **${k.berthUtilPct}%**, crane utilisation **${k.craneUtilPct}%**.`,
        `Open the Berth & Cranes tab to run the optimiser and compare vs FIFO baseline.`,
      );
      break;
    case "routing":
      lines.push(
        `**Alternate routing (rule engine, $32k/day cost model)**`,
        `Waiting fleet burn: **$${k.dailyFleetBurnUsd.toLocaleString()}/day** across ${k.vesselsAtAnchor} vessels.`,
        `Open the Routing tab for vessel-level divert / slow-steam / priority-window recommendations.`,
      );
      break;
    case "plan":
      lines.push(
        `**72-hour operations plan (all engines)**`,
        `Risk level and 12 × 6h shift cards are in the 72-Hr Plan tab — hit **Regenerate plan** there.`,
        `Port peak forecast **${k.peakForecastIndex} @ +${k.peakForecastHour}h**; ${k.arrivalsNext24} arrivals in the next 24h.`,
      );
      break;
    default:
      lines.push(
        `**San Pedro Bay status**`,
        `• Waiting: **${k.vesselsAtAnchor}** vessels (inbound ${k.vesselsInbound}), avg anchorage wait **${k.avgAnchorageWait}h**.`,
        `• Congestion index now **${k.portIndexNow}/100**, forecast peak **${k.peakForecastIndex} @ +${k.peakForecastHour}h**.`,
        `• Moves pending: **${k.movesPending.toLocaleString()} TEU**; fleet burn **$${k.dailyFleetBurnUsd.toLocaleString()}/day**.`,
        `• Hotspots: ${topZones.map((z) => `${z.label} (peak ${z.peakIndex.toFixed(0)})`).join(", ")}.`,
      );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- entry
export async function bobAnswer(
  message: string,
  history: { role: string; content: string }[] = [],
): Promise<BobAnswer> {
  const intent = detectIntent(message);
  let pack: DataPack;
  let overview: OverviewData;
  try {
    if (intent === "status" || intent === "vessel") {
      const s = await packStatus();
      pack = s.pack;
      overview = s.overview;
      if (intent === "vessel") pack = { ...(await packVessel(message)) };
    } else {
      const s = await packStatus();
      overview = s.overview;
      pack =
        intent === "forecast"
          ? await packForecast()
          : intent === "optimise"
            ? await packOptimise()
            : intent === "routing"
              ? await packRouting()
              : await packPlan();
    }
  } catch (e) {
    console.error("[bob] engine failure", e);
    const s = await packStatus();
    return {
      content: deterministicAnswer("status", s.pack, s.overview),
      actions: [{ tool: "overview.get", detail: "fallback: KPI snapshot only" }],
      mode: "deterministic",
    };
  }

  try {
    const content = await callLLM(message, pack.payload, history);
    return { content, actions: pack.actions, mode: "llm" };
  } catch (e) {
    console.error("[bob] llm failure — deterministic fallback", e);
    return { content: deterministicAnswer(intent, pack, overview), actions: pack.actions, mode: "deterministic" };
  }
}
