"""Data quality service for W1.

Provides:
- NormalisationEngine: converts raw vessel call fields to SI units and stores
  original and normalised values in VesselCall.normalised JSONB column.
- compute_terminal_quality: aggregates data completeness per terminal and writes
  TerminalQuality rows.
"""

from __future__ import annotations

from typing import Any, Dict

from sqlalchemy.orm import Session

from ..models import VesselCall, TerminalQuality, Terminal


class NormalisationEngine:
    """Simple normalisation engine.

    For each VesselCall, creates a ``normalised`` dict mapping field names to a dict
    with ``original``, ``unit`` and ``value_si``. The conversion logic is highly
    simplified – in a real implementation you would use a units library.
    """

    # Mapping of field -> (conversion factor to SI, SI unit)
    _conversion_map: Dict[str, tuple[float, str]] = {
        "loa_ft": (0.3048, "m"),
        "beam_ft": (0.3048, "m"),
        "draft_ft": (0.3048, "m"),
        "depth_ft": (0.3048, "m"),  # used in some pipelines
    }

    def __init__(self, session: Session) -> None:
        self.session = session

    def normalise_vessel(self, vessel: VesselCall) -> Dict[str, Any]:
        norm: Dict[str, Any] = {}
        for field, (factor, unit) in self._conversion_map.items():
            raw_val = getattr(vessel, field, None)
            if raw_val is not None:
                norm[field] = {
                    "original": raw_val,
                    "unit": "ft",
                    "value_si": round(raw_val * factor, 3),
                    "si_unit": unit,
                }
        return norm

    def run(self) -> None:
        """Iterate over all VesselCall rows that lack ``normalised`` and fill it.
        """
        vessels = self.session.query(VesselCall).filter(VesselCall.normalised.is_(None)).all()
        for v in vessels:
            v.normalised = self.normalise_vessel(v)
        self.session.commit()


def compute_terminal_quality(session: Session) -> None:
    """Compute a simplistic completeness percentage per terminal.

    Completeness is defined as the proportion of vessel calls belonging to the
    terminal that have non‑null ``imo`` and ``voyage_number``. This is a placeholder
    implementation – replace with the real rule‑set as needed.
    """
    # Get all terminal codes
    terminal_codes = [t.code for t in session.query(Terminal).all()]
    for code in terminal_codes:
        total = session.query(VesselCall).filter(VesselCall.dest_zone_code == code).count()
        if total == 0:
            completeness = 100.0
            missing = []
        else:
            good = session.query(VesselCall).filter(
                VesselCall.dest_zone_code == code,
                VesselCall.imo.is_not(None),
                VesselCall.voyage_number.is_not(None),
            ).count()
            completeness = round(100.0 * good / total, 2)
            missing = []
            if session.query(VesselCall).filter(VesselCall.dest_zone_code == code, VesselCall.imo.is_(None)).count() > 0:
                missing.append("imo")
            if session.query(VesselCall).filter(VesselCall.dest_zone_code == code, VesselCall.voyage_number.is_(None)).count() > 0:
                missing.append("voyage_number")
        # Upsert TerminalQuality
        terminal_id = session.query(Terminal.id).filter(Terminal.code == code).scalar()
        tq = session.query(TerminalQuality).filter(TerminalQuality.terminal_id == terminal_id).first()
        if not tq:
            tq = TerminalQuality(
                terminal_id=terminal_id,
                completeness_pct=completeness,
                missing=missing,
                rules_version="v1",
            )
            session.add(tq)
        else:
            tq.completeness_pct = completeness
            tq.missing = missing
    session.commit()
