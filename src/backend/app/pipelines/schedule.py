"""Schedule upload pipeline (W1).

Parses a CSV file containing vessel schedule information. Expected columns
include at least ``imo``, ``voyage_number`` and ``declared_eta_hours``. The
function returns a list of dict rows after basic validation.
"""

from __future__ import annotations

import csv
import io
import logging
from typing import List, Dict, Any

LOGGER = logging.getLogger(__name__)

_REQUIRED_COLUMNS = {"imo", "voyage_number", "declared_eta_hours"}


def parse_schedule(csv_bytes: bytes) -> List[Dict[str, Any]]:
    """Parse CSV bytes and return a list of validated rows.

    Rows missing any required column are omitted and recorded as errors by the
    caller. ``declared_eta_hours`` is converted to ``float``.
    """
    rows: List[Dict[str, Any]] = []
    with io.StringIO(csv_bytes.decode("utf-8")) as f:
        reader = csv.DictReader(f)
        missing = _REQUIRED_COLUMNS - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"Schedule CSV missing required columns: {missing}")
        for line_no, row in enumerate(reader, start=2):
            try:
                row["declared_eta_hours"] = float(row["declared_eta_hours"])
                rows.append(row)
            except Exception as exc:
                LOGGER.warning("Invalid row %d in schedule CSV: %s", line_no, exc)
    return rows
