"""Bob router — thin wrapper over the shared Bob service (services/bob.py)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import ChatMessage
from ..services import bob as bob_svc

router = APIRouter(prefix="/api", tags=["bob"])


class BobBody(BaseModel):
    message: str


@router.get("/bob")
def history(db: Session = Depends(get_db)):
    rows = db.execute(select(ChatMessage).order_by(ChatMessage.id.desc()).limit(50)).scalars().all()
    return {"messages": [{"role": r.role, "content": r.content, "meta": r.meta,
                          "created_at": r.created_at.isoformat()} for r in reversed(rows)]}


@router.post("/bob")
def ask(body: BobBody, db: Session = Depends(get_db)):
    out = bob_svc.respond(db, body.message, persist=True)
    return {"content": out["content"], "actions": out["actions"], "mode": out["mode"], "intent": out["intent"]}
