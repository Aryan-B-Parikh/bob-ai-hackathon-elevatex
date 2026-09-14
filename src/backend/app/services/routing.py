"""Alternate routing / diversion recommender (rule engine + documented cost model).

Module I: DIVERT / SLOW_STEAM / PRIORITY_WINDOW / HOLD. A diversion is only
recommended when congestion is *sustained* (>= SUSTAINED_HOURS consecutive
forecast hours above the threshold), not on a single noisy forecast point.
"""

from __future__ import annotations

from .. import reference as ref

DIVERT_WAIT_H = 48.0
SLOW_STEAM_WAIT_H = 18.0
PRIORITY_WAIT_H = 10.0
REEFFER_PRIORITY_MIN = 200
SUSTAINED_HOURS = 3


def _predicted_wait(ctx, forecasts, assignment_by_vessel, v) -> tuple[float, bool]:
    a = assignment_by_vessel.get(v.id)
    zone = a["zone_code"] if a else v.dest_zone_code
    fc = forecasts.get(zone) or forecasts.get("Z-PORT")
    if fc is None:
        return v.anchored_hours, False
    start = int(max(1, min(72, round(a["start_hour"] if a else max(1, v.eta_hours)))))
    wait = fc.points[start - 1].wait
    # sustained check: consecutive hours at/above the divert threshold
    above = sum(1 for p in fc.points[start - 1:start - 1 + SUSTAINED_HOURS] if p.wait >= DIVERT_WAIT_H)
    sustained = above >= min(SUSTAINED_HOURS, len(fc.points) - (start - 1))
    if a is None:
        return max(wait, 78.0), True   # couldn't be slotted within the horizon → prime divert candidate
    return wait, sustained


def _best_window(fc) -> tuple[int, float] | None:
    """Hour with the lowest forecast anchorage wait inside the horizon."""
    if not fc or not fc.points:
        return None
    p = min(fc.points, key=lambda x: x.wait)
    return p.hour, p.wait


def _best_in_port_alternative(ctx, forecasts: dict, v, current_wait: float,
                              min_saving_h: float = 12.0):
    """Cheapest *in-port* terminal for this vessel (Module I): another POLB terminal
    with a materially lower predicted wait where a berth physically fits.

    Returns (zone_code, wait_hours, saving_hours) or None.
    """
    best = None
    for zone, fc in forecasts.items():
        if zone == "Z-PORT" or zone == v.dest_zone_code:
            continue
        fits = [b for b in ctx.berths
                if b.zone_code == zone and v.loa_ft <= b.length_ft and v.draft_ft <= b.depth_ft]
        if not fits:
            continue                       # vessel too large/deep for that terminal
        w = _best_window(fc)
        if not w:
            continue
        wait_alt = w[1]
        if current_wait - wait_alt >= min_saving_h and (best is None or wait_alt < best[1]):
            best = (zone, wait_alt, round(current_wait - wait_alt, 1))
    return best


def _option_detail(ctx, forecasts: dict, v, wait: float, rule: str) -> dict:
    """Explainability payload stored on the recommendation (frozen column `option_detail`)."""
    fc = forecasts.get(v.dest_zone_code) or forecasts.get("Z-PORT")
    window = _best_window(fc)
    alt = _best_in_port_alternative(ctx, forecasts, v, wait)
    return {
        "rule": rule,
        "berthing_window": ({"hour": window[0], "wait_hours": round(window[1], 1)} if window else None),
        "alternate_terminal": ({"zone_code": alt[0], "wait_hours": round(alt[1], 1),
                                "savings_hours": alt[2]} if alt else None),
    }


def recommend_routing(ctx, forecasts: dict, optimiser_out: dict | None) -> list[dict]:
    assignment_by_vessel = {a["vessel_id"]: a for a in (optimiser_out or {}).get("assignments", [])}
    recs: list[dict] = []

    for v in ctx.vessels:
        wait, sustained = _predicted_wait(ctx, forecasts, assignment_by_vessel, v)
        base = {
            "vessel_id": v.id, "vessel_name": v.name, "carrier": v.carrier,
            "vessel_class": v.vessel_class, "dest_zone_code": v.dest_zone_code,
            "status": v.status, "predicted_wait_hours": round(wait, 1),
        }

        def _detail(rule: str) -> dict:
            return _option_detail(ctx, forecasts, v, wait, rule)
        # ------------------------------------------------------------------ DIVERT
        if wait >= DIVERT_WAIT_H and sustained:
            candidates = [p for p in ref.ALT_PORTS if v.loa_ft <= p["max_loa_ft"] and p["availability"] != "low"]
            best = None
            for p in candidates:
                shift = max(0.0, p["transit_hours"] + ref.AVAILABILITY_BUFFER_HOURS[p["availability"]] - wait)
                wait_avoided = max(0.0, wait - shift)
                savings = (wait_avoided / 24) * ref.DAILY_OP_COST_USD - (shift / 24) * ref.DAILY_OP_COST_USD * 0.35
                if best is None or savings > best[1]:
                    best = (p, savings, shift, wait_avoided)
            if best and best[1] > 0:
                p, savings, shift, wait_avoided = best
                recs.append({**base, "option": "DIVERT", "target_port": p["name"], "eta_shift_hours": round(shift, 1),
                             "est_savings_usd": round(savings), "confidence": 0.82, "tier": "critical", "sustained": True,
                             "option_detail": _detail("divert: wait>=48h AND sustained>=3h"),
                             "rationale": (f"Predicted {wait:.0f}h wait vs {p['transit_hours']}h transit to {p['name']} "
                                           f"({p['availability']} availability); avoids ~{wait_avoided:.0f}h, net ≈ "
                                           f"${round(savings):,} at ${ref.DAILY_OP_COST_USD // 1000}k/day.")})
                continue

        # -------------------------------------------------------------- SLOW_STEAM
        if SLOW_STEAM_WAIT_H <= wait < DIVERT_WAIT_H and v.status == "INBOUND":
            steam_down = min(wait - 6, 48)
            savings = 0.35 * (steam_down / 24) * ref.DAILY_OP_COST_USD
            recs.append({**base, "option": "SLOW_STEAM", "target_port": None, "eta_shift_hours": round(steam_down, 1),
                         "est_savings_usd": round(savings), "confidence": 0.72, "tier": "high", "sustained": sustained,
                         "option_detail": _detail("slow-steam: 18h<=wait<48h and INBOUND"),
                         "rationale": (f"Inbound with predicted {wait:.0f}h queue; reduce to ~14 kn to meet the freed "
                                       f"window — ~35% fuel-burn cut over {steam_down:.0f}h saves ≈ ${round(savings):,}.")})
            continue

        # ---------------------------------------------------------- PRIORITY_WINDOW
        if wait >= PRIORITY_WAIT_H and v.reefer_units >= REEFFER_PRIORITY_MIN:
            savings = v.reefer_units * ref.REEFER_CONTENT_VALUE_USD * 0.4
            recs.append({**base, "option": "PRIORITY_WINDOW", "target_port": None,
                         "eta_shift_hours": -min(6, wait - 8), "est_savings_usd": round(savings),
                         "confidence": 0.64, "tier": "medium", "sustained": sustained,
                         "option_detail": _detail("priority window: wait>=10h and >=200 reefers"),
                         "rationale": (f"{v.reefer_units} reefer units with {wait:.0f}h predicted wait; priority window "
                                       f"swap avoids ≈ ${round(savings):,} spoilage risk.")})
            continue

        recs.append({**base, "option": "HOLD", "target_port": None, "eta_shift_hours": 0, "est_savings_usd": 0,
                     "confidence": 0.55, "tier": "low", "sustained": sustained,
                     "option_detail": _detail("hold: within normal rotation or negative divert economics"),
                     "rationale": (f"Predicted {wait:.0f}h wait within normal rotation — hold current schedule."
                                   if wait < PRIORITY_WAIT_H else
                                   f"Moderate {wait:.0f}h wait but no reefer/size constraint and diversion economics "
                                   f"negative — hold and re-evaluate next cycle.")})

    tier_rank = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    recs.sort(key=lambda r: (tier_rank[r["tier"]], -r["est_savings_usd"]))
    return recs
