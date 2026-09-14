"""Bob: engine-grounded assistant (Claude narrative with deterministic fallback)."""

from __future__ import annotations

import json
import re

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import ChatMessage
from ..services import llm, pipeline

router = APIRouter(prefix="/api", tags=["bob"])


class BobBody(BaseModel):
    message: str


def _intent(msg: str) -> str:
    m = msg.lower()
    if re.search(r"\b(plan|shift|72|handover)\b", m):
        return "plan"
    if re.search(r"\b(optimi[sz]e|berth|crane|assignment)\b", m):
        return "optimise"
    if re.search(r"\b(rout|divert|slow|diversion)\b", m):
        return "routing"
    if re.search(r"\b(forecast|hotspot|predict|outlook|congestion)\b", m):
        return "forecast"
    if re.search(r"\b(vessel|queue|ship|anchor)\b", m):
        return "vessel"
    return "status"


@router.get("/bob")
def history(db: Session = Depends(get_db)):
    rows = db.execute(select(ChatMessage).order_by(ChatMessage.id.desc()).limit(50)).scalars().all()
    return {"messages": [{"role": r.role, "content": r.content, "meta": r.meta,
                          "created_at": r.created_at.isoformat()} for r in reversed(rows)]}


@router.post("/bob")
def ask(body: BobBody, db: Session = Depends(get_db)):
    intent = _intent(body.message)
    full = pipeline.build_full(db, persist=False)

    if intent == "plan":
        actions = ["forecast.run", "optimiser.run", "routing.recommend", "plan.generate"]
        pack = {"summary": full["plan"]["summary"], "top_actions": full["plan"]["summary"]["top_actions"]}
    elif intent == "optimise":
        actions = ["optimiser.run", "forecast.run"]
        pack = {"metrics": full["optimiser"]["metrics"], "baseline": full["optimiser"]["baseline"],
                "deltas": full["optimiser"]["deltas"], "solver": full["optimiser"]["solver"]}
    elif intent == "routing":
        actions = ["routing.recommend", "forecast.run"]
        pack = {"top": full["routing"][:6], "counts": _counts(full["routing"])}
    elif intent == "forecast":
        actions = ["forecast.run", "hotspot.rank", "anomaly.detect"]
        pack = {"port": {"current": full["forecasts"]["Z-PORT"].current, "peak": full["forecasts"]["Z-PORT"].peak},
                "hotspots": full["hotspots"]["ranked"][:4], "anomalies": full["anomalies"]}
    elif intent == "vessel":
        actions = ["vessels.query", "forecast.run"]
        waiting = [v for v in full["ctx"].vessels if v.status != "INBOUND"]
        pack = {"waiting": len(waiting), "longest": sorted(
            [{"name": v.name, "anchored_hours": v.anchored_hours, "carrier": v.carrier} for v in waiting],
            key=lambda x: -x["anchored_hours"])[:6]}
    else:
        actions = ["overview.get"]
        pack = pipeline.build_overview(full["ctx"], full["forecasts"], full["hotspots"],
                                       full["anomalies"], full["optimiser"])["kpis"]

    engine_data = json.dumps(pack, default=str)
    text, mode = llm.answer(body.message, engine_data)
    if not text:
        mode = "deterministic"
        text = _deterministic(intent, pack)

    db.add(ChatMessage(role="user", content=body.message, meta={"intent": intent}))
    db.add(ChatMessage(role="assistant", content=text, meta={"actions": actions, "mode": mode, "intent": intent}))
    db.commit()
    return {"content": text, "actions": actions, "mode": mode, "intent": intent}


def _counts(recs: list[dict]) -> dict:
    out: dict[str, int] = {}
    for r in recs:
        out[r["option"]] = out.get(r["option"], 0) + 1
    return out


def _deterministic(intent: str, pack: dict) -> str:
    if intent == "forecast":
        p = pack["port"]
        hs = pack["hotspots"]
        top = hs[0] if hs else None
        s = (f"Port-wide index is {p['current']['index']}/100 now, forecast to peak at {p['peak']['index']} "
             f"around +{p['peak']['hour']}h. ")
        if top:
            s += (f"Top hotspot: {top['zone_name']} (risk {top['risk_score']}/100, binding resource "
                  f"{top['binding_constraint']}) — {top['explanation']}")
        return s
    if intent == "optimise":
        m = pack["metrics"]; b = pack["baseline"]; d = pack["deltas"]
        return (f"CP-SAT optimiser ({pack['solver']}) services {m['serviced']} vessels vs {b['serviced']} for FIFO; "
                f"weighted wait {m['weighted_wait_hours']}h vs {b['weighted_wait_hours']}h "
                f"(delta {d['weighted_wait']}h). Berth utilisation {m['berth_util_pct']}%, crane {m['crane_util_pct']}%.")
    if intent == "plan":
        sm = pack["summary"]
        return (f"72h plan: risk {sm['risk_level']}, {sm['total_arrivals']} arrivals, {sm['total_berthings']} berthings, "
                f"{sm['total_moves']:,} moves, peak index {sm['peak_index']} ({sm['peak_zone']}), "
                f"{sm['deferred_count']} deferred. " + " ".join(sm.get("top_actions", [])[:2]))
    if intent == "vessel":
        return (f"{pack['waiting']} vessels waiting; longest: "
                + ", ".join(f"{v['name']} ({v['anchored_hours']:.0f}h)" for v in pack.get("longest", [])[:3]))
    if intent == "routing":
        c = pack.get("counts", {})
        return ("Routing: " + ", ".join(f"{k}={v}" for k, v in c.items()) +
                ". See the Routing tab for divert / slow-steam / priority / hold detail.")
    k = pack
    return (f"Port index {k['port_index_now']}/100, peak {k['peak_forecast_index']} at +{k['peak_forecast_hour']}h; "
            f"{k['vessels_at_anchor']} at anchor, {k['vessels_inbound']} inbound, avg wait {k['avg_anchorage_wait']}h; "
            f"berth util {k['berth_util_pct']}%, crane util {k['crane_util_pct']}%.")
