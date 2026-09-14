import { getEngineContext, type EngineContext } from "./context";
import { runForecasts, runOptimiser } from "./pipeline";
import type { OptimiserOutput } from "./types";
import { db } from "@/lib/db";

/**
 * Returns the latest persisted optimiser run if it is fresh (same model time
 * t0 within 10 minutes); otherwise runs the optimiser on the current context
 * (without persisting — snapshot for read-only views).
 */
export async function getOptimiserRunOrRun(
  ctx: EngineContext,
): Promise<OptimiserOutput | null> {
  try {
    const run = await db.optimiserRun.findFirst({ orderBy: { createdAt: "desc" } });
    if (run) {
      const age = Date.now() - run.createdAt.getTime();
      if (age < 10 * 60_000) {
        return {
          runId: run.id,
          createdAt: run.createdAt.toISOString(),
          horizonHours: JSON.parse(run.paramsJson).horizonHours ?? 72,
          assignments: JSON.parse(run.assignmentsJson),
          deferred: JSON.parse(run.deferredJson),
          metrics: JSON.parse(run.metricsJson),
          baseline: JSON.parse(run.baselineJson),
          deltas: JSON.parse(run.deltasJson),
          params: JSON.parse(run.paramsJson),
        };
      }
    }
  } catch {
    // fall through to live computation
  }
  const forecasts = await runForecasts(ctx);
  return runOptimiser(ctx, forecasts);
}
