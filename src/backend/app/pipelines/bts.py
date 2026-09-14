"""BTS benchmark pipeline (W1).

Loads a weekly BTS CSV file containing berth statistics. The CSV format is not
strictly defined here – we expect columns like `terminal_code`, `berth_id`,
`avg_moves`, etc. This pipeline validates required columns and inserts rows into
a read‑only view/table for analytics. For now we simply log the rows.
"""

from __future__ import annotations

import csv
import io
import logging
from typing import List, Dict, Any

LOGGER = logging.getLogger(__name__)


def _required_columns() -> List[str]:
    return ["terminal_code", "berth_id", "avg_moves"]


def parse_bts_csv(csv_bytes: bytes) -> List[Dict[str, Any]]:
    """Parse CSV bytes and return a list of dict rows after validation."""
    result: List[Dict[str, Any]] = []
    with io.StringIO(csv_bytes.decode("utf-8")) as f:
        reader = csv.DictReader(f)
        missing = set(_required_columns()) - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"BTS CSV missing required columns: {missing}")
        for row in reader:
            # Simple type conversion, ignore errors
            try:
                row["berth_id"] = int(row["berth_id"])
                row["avg_moves"] = float(row["avg_moves"])
            except Exception:
                LOGGER.warning("Failed to convert row values: %s", row)
            result.append(row)
    return result


def run_bts_pipeline(csv_bytes: bytes) -> None:
    """Entry point for the BTS pipeline.

    In a full implementation this would write to a dedicated model/table. Here we
    simply parse and log the number of rows.
    """
    rows = parse_bts_csv(csv_bytes)
    LOGGER.info("BTS pipeline processed %d rows", len(rows))
    # TODO: insert into a read‑only analytics view/table if needed.
