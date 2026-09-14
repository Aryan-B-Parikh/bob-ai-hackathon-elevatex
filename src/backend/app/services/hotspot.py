"""Hotspot / bottleneck detector — resource attribution + composite risk score.

Implements Module G of the requirements doc:
  * identifies which RESOURCE is the binding constraint (berth / crane / yard / gate),
    not merely "the busiest berth"
  * composite Congestion Risk Score = w1*queue + w2*utilisation + w3*throughput variance
    + w4*forecast uncertainty + w5*disruption signal  (weights in reference.RISK_WEIGHTS)
  * ranks hotspots and marks the single most actionable one for the current shift
  * degrades gracefully (lower confidence) when input data is incomplete
"""

from __future__ import annotations

import numpy as np

from .. import reference as ref


def _pressure(ctx, zone_code: str, fpoint) -> dict[str, float]:
    """Normalised pressure 0..1 on each resource for a forecast point."""
    term = next((t for t in ctx.terminals if t.zone_code == zone_code), None)
    berths = [b for b in ctx.berths if b.zone_code == zone_code]
    total_cranes = sum(b.cranes_max for b in berths) or 1
    avail_cranes = ctx.cranes.get(term.code, total_cranes) if term else total_cranes
    # berth pressure: queue relative to a healthy queue-per-berth ratio
    berth = min(1.0, fpoint.queue / max(1.0, len(berths) * 3.5))
    # crane pressure: cranes needed (≈3 per working vessel) vs available
    crane = min(1.0, (fpoint.queue * 3.0) / max(1.0, avail_cranes))
    # yard pressure: forecast yard utilisation
    yard = min(1.0, (fpoint.yard_util or 0.0) / 100.0)
    # gate pressure: current gate queue relative to lane throughput capacity
    gate_q = ctx.gate_queue.get(term.code, 0) if term else 0
    gate = min(1.0, gate_q / 60.0)
    return {"BERTH": berth, "CRANE": crane, "YARD": yard, "GATE": gate}


def compute_hotspots(ctx, forecasts: dict, anomalies: list[dict]) -> dict:
    """Return {'ranked': [...], 'most_actionable': {...}} for the current shift."""
    anom_by_zone = {a["zone_code"]: a for a in anomalies}
    ranked: list[dict] = []

    for zone_code, fc in forecasts.items():
        if zone_code == "Z-PORT":
            continue
        peak = max(fc.points, key=lambda p: p.index)
        recent = ctx.history.get(zone_code, [])[-24:]
        idx_std = float(np.std([h.index for h in recent])) if recent else 0.0
        press = _pressure(ctx, zone_code, peak)
        binding = max(press, key=press.get)
        anom = anom_by_zone.get(zone_code)
        disruption = 1.0 if (anom and anom["is_anomaly"]) else 0.0
        band = max(0.0, peak.hi - peak.lo)

        comp = {
            "queue": min(1.0, peak.queue / 30.0),
            "utilisation": max(press.values()),
            "variance": min(1.0, idx_std / 25.0),
            "uncertainty": min(1.0, band / 100.0),
            "disruption": disruption,
        }
        w = ref.RISK_WEIGHTS
        risk = 100.0 * (
            w["queue"] * comp["queue"] + w["utilisation"] * comp["utilisation"]
            + w["variance"] * comp["variance"] + w["uncertainty"] * comp["uncertainty"]
            + w["disruption"] * comp["disruption"]
        )
        # confidence degrades with sparse/incomplete input
        confidence = 0.9
        if len(recent) < 48:
            confidence -= 0.25
        if anom and anom["kind"] == "DATA_ERROR":
            confidence -= 0.2
        if any(v.unresolved for v in ctx.vessels if v.dest_zone_code == zone_code):
            confidence -= 0.1

        ranked.append({
            "zone_code": zone_code,
            "zone_name": fc.zone_name,
            "peak_hour": peak.hour,
            "peak_index": peak.index,
            "risk_score": round(risk, 1),
            "binding_constraint": binding,
            "resource_pressure": {k: round(v, 3) for k, v in press.items()},
            "components": {k: round(v, 3) for k, v in comp.items()},
            "weights": w,
            "confidence": round(max(0.3, confidence), 2),
            "explanation": (
                f"Risk {risk:.0f}/100 at +{peak.hour}h; binding resource = {binding} "
                f"(pressure {press[binding]:.2f}). "
                + (f"Disruption signal: {anom['kind']}." if disruption else "No disruption signal.")
            ),
        })

    ranked.sort(key=lambda r: r["risk_score"], reverse=True)
    return {
        "ranked": ranked,
        "most_actionable": ranked[0] if ranked else None,
        "method": "composite risk score (w1..w5) + resource pressure attribution",
    }
