"""Schedule upload pipeline (W1).

Parses a CSV file containing vessel schedule information. Expected columns
include at least ``imo``, ``voyage_number`` and ``declared_eta_hours``.

The function returns **both** accepted and rejected rows with per-row error
strings, so the caller can report an audit that actually adds up
(``accepted + rejected == rows``) instead of silently swallowing bad lines
(audit B-2: the previous version dropped them, so a CSV of 1 invalid row
reported ``accepted=0 rejected=0`` with no error).
"""

from __future__ import annotations

import csv
import io
import logging
from typing import Any

LOGGER = logging.getLogger(__name__)

_REQUIRED_COLUMNS = {"imo", "voyage_number", "declared_eta_hours"}


def parse_schedule(csv_bytes: bytes) -> dict[str, Any]:
    """Parse CSV bytes into accepted rows + rejected rows with errors.

    Returns ``{"accepted": [...], "rejected": [{"row_no", "row", "error"}], "rows": n}``.
    ``declared_eta_hours`` is coerced to ``float``; a row that cannot be coerced, or
    that is missing a required value, is rejected with its error string.
    """
    accepted: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []

    with io.StringIO(csv_bytes.decode("utf-8")) as f:
        reader = csv.DictReader(f)
        missing = _REQUIRED_COLUMNS - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"Schedule CSV missing required columns: {sorted(missing)}")
        for line_no, row in enumerate(reader, start=2):
            try:
                eta_raw = (row.get("declared_eta_hours") or "").strip()
                if eta_raw == "":
                    raise ValueError("declared_eta_hours is empty")
                row["declared_eta_hours"] = float(eta_raw)
                if not (row.get("imo") or "").strip():
                    raise ValueError("imo is empty")
                if not (row.get("voyage_number") or "").strip():
                    raise ValueError("voyage_number is empty")
                accepted.append(row)
            except Exception as exc:  # noqa: BLE001  (row-level validation)
                LOGGER.warning("Invalid row %d in schedule CSV: %s", line_no, exc)
                rejected.append({"row_no": line_no, "row": row, "error": str(exc)})

    LOGGER.info("Schedule CSV: %d accepted, %d rejected", len(accepted), len(rejected))
    return {"accepted": accepted, "rejected": rejected, "rows": len(accepted) + len(rejected)}
