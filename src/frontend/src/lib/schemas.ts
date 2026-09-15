import { z } from "zod";

// Critical API Boundary Schemas

export const HealthResponseSchema = z.object({
  status: z.string(),
});

export const KpiSchema = z.object({
  port_index_now: z.number(),
  peak_forecast_index: z.number(),
  peak_forecast_hour: z.number(),
  vessels_at_anchor: z.number(),
  vessels_inbound: z.number(),
  avg_anchorage_wait: z.number(),
  max_anchored_hours: z.number(),
  berth_util_pct: z.number(),
  crane_util_pct: z.number(),
  moves_pending: z.union([z.number(), z.string()]),
  daily_fleet_burn_usd: z.union([z.number(), z.string()]),
  arrivals_next24: z.number(),
});

export const ZoneSchema = z.object({
  zone_code: z.string(),
  label: z.string(),
  level: z.string(),
  current_index: z.number(),
  peak_index: z.number(),
  peak_hour: z.number(),
  queue_now: z.number(),
  wait_now: z.number(),
  yard_util_pct: z.number(),
  recent_index: z.array(z.number()),
});

export const OverviewResponseSchema = z.object({
  t0: z.string(),
  dataset: z.object({
    source: z.string(),
    note: z.string().optional(),
  }),
  kpis: KpiSchema,
  zones: z.array(ZoneSchema),
  alerts: z.array(
    z.object({
      severity: z.string(),
      title: z.string(),
      detail: z.string(),
    })
  ),
  anomalies: z.array(
    z.object({
      zone_code: z.string(),
      kind: z.string(),
      score: z.number(),
      is_anomaly: z.boolean(),
      sample_size: z.number(),
    })
  ),
  hotspots: z.object({
    ranked: z.array(
      z.object({
        zone_code: z.string(),
        risk_score: z.number(),
        binding_constraint: z.string(),
        confidence: z.string(),
      })
    ),
  }),
});

export const ForecastPointSchema = z.object({
  hour: z.number(),
  t_forecast: z.string().optional(),
  point_index: z.number(),
  q10: z.number().optional(),
  q90: z.number().optional(),
});

export const ForecastResponseSchema = z.object({
  t0: z.string(),
  dataset_source: z.string(),
  summary: z.record(z.string(), z.any()).optional(),
  series: z.array(ForecastPointSchema).optional(),
});

export const QualityResponseSchema = z.object({
  terminals: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      completeness_pct: z.number().nullable(),
      missing: z.array(z.string()),
    })
  ),
  rules_version: z.string(),
  stub: z.boolean().optional(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type OverviewResponse = z.infer<typeof OverviewResponseSchema>;
export type ForecastResponse = z.infer<typeof ForecastResponseSchema>;
export type QualityResponse = z.infer<typeof QualityResponseSchema>;
