"""Anomaly & disruption detection — scikit-learn Isolation Forest.

Implements Module H of the requirements doc:
  * detects abnormal patterns (bunching, equipment outage, sudden queue variance)
  * robust unsupervised method (Isolation Forest) against each zone's own history
  * distinguishes a genuine disruption from a likely data/sensor error
  * refuses to assert anomalies below a minimum historical sample size
"""

from __future__ import annotations

import numpy as np
from sklearn.ensemble import IsolationForest

MIN_SAMPLES = 96          # 4 days of hourly history before we trust an anomaly call
CONTAMINATION = 0.04


def _matrix(history) -> tuple[np.ndarray, list[str]]:
    idx = np.array([h.index for h in history], dtype=float)
    q = np.array([h.queue_count for h in history], dtype=float)
    w = np.array([h.avg_wait_hours for h in history], dtype=float)
    yard = np.array([(h.yard_util_pct or 0.0) for h in history], dtype=float)
    dq = np.diff(q, prepend=q[:1])
    di = np.diff(idx, prepend=idx[:1])
    win = 6
    roll_std = np.array([np.std(idx[max(0, i - win):i + 1]) for i in range(len(idx))])
    X = np.column_stack([idx, q, w, yard, dq, di, roll_std])
    names = ["index", "queue", "wait", "yard_util", "d_queue", "d_index", "index_roll_std"]
    return X, names


def detect_anomalies(ctx) -> list[dict]:
    """Run Isolation Forest per terminal zone; return flagged disruptions."""
    flags: list[dict] = []
    for zone_code, history in ctx.history.items():
        if zone_code == "Z-PORT":
            continue
        n = len(history)
        if n < MIN_SAMPLES:
            flags.append({
                "zone_code": zone_code, "kind": "INSUFFICIENT_DATA", "method": "IsolationForest",
                "score": 0.0, "is_anomaly": False, "sample_size": n,
                "detail": f"Only {n}h of history (< {MIN_SAMPLES}h) — anomaly confidence explicitly low.",
                "features": None,
            })
            continue
        X, names = _matrix(history)
        model = IsolationForest(n_estimators=200, contamination=CONTAMINATION, random_state=0)
        model.fit(X)
        scores = model.decision_function(X)
        preds = model.predict(X)
        # evaluate the most recent 12h window
        window = slice(max(0, n - 12), n)
        window_anoms = int((preds[window] == -1).sum())
        recent_anom = bool(preds[-1] == -1) or window_anoms >= 3
        recent_score = float(scores[window].min())
        last = history[-1]
        last_dq = float(X[-1, names.index("d_queue")])
        last_di = float(X[-1, names.index("d_index")])

        if last_dq >= 5:
            kind = "BUNCHING"
        elif (last.yard_util_pct or 0) >= 92:
            kind = "YARD_SATURATION"
        elif last.index >= 70 and abs(last_di) < 6:
            kind = "OUTAGE"
        elif abs(last_dq) > 14 or abs(last_di) > 40:
            kind = "DATA_ERROR"  # implausible jump → likely sensor/entry error, not a real disruption
        else:
            kind = "VARIANCE"

        z = history[-1]
        flags.append({
            "zone_code": zone_code,
            "kind": kind,
            "method": "IsolationForest",
            "score": round(recent_score, 4),
            "is_anomaly": recent_anom and kind != "DATA_ERROR",
            "sample_size": n,
            "detail": (
                f"queue={z.queue_count}, wait={z.avg_wait_hours:.0f}h, index={z.index:.0f}, "
                f"Δqueue(last h)={last_dq:+.0f}, Δindex={last_di:+.0f}. "
                + ("Recent window flagged anomalous." if recent_anom else "Recent window within normal range.")
                + (" Flagged as probable DATA ERROR (implausible jump) — not a confirmed disruption."
                   if kind == "DATA_ERROR" else "")
            ),
            "features": {k: round(float(X[-1, i]), 2) for i, k in enumerate(names)},
        })
    return flags
