"""Deep Research cost estimator — pure function, spec §7.4.

Google does not return actual billing, so we compute a deterministic
estimate from the model and measured duration. Managed path multiplies
by ``MANAGED_MARGIN`` (env, default 1.3). The result is stored as
integer cents in ``research_runs.total_cost_usd_cents`` and surfaced to
the user as an "approx" badge in the research-meta Plate block.
"""
from __future__ import annotations

import os
from typing import Literal

BillingPath = Literal["byok", "managed"]

_BASE_USD: dict[str, float] = {
    "deep-research-preview-04-2026": 2.0,
    "deep-research-max-preview-04-2026": 5.0,
}

_TIME_FACTOR_MIN = 0.5
_TIME_FACTOR_MAX = 1.5
_REFERENCE_DURATION_MIN = 20.0


def estimate_cost_usd_cents(
    *,
    model: str,
    duration_minutes: float,
    billing_path: BillingPath,
) -> int:
    """Return the estimated cost in integer USD cents."""
    base = _BASE_USD.get(model)
    if base is None:
        raise ValueError(f"unknown model: {model}")

    time_factor = duration_minutes / _REFERENCE_DURATION_MIN
    time_factor = max(_TIME_FACTOR_MIN, min(_TIME_FACTOR_MAX, time_factor))

    usd = base * time_factor
    if billing_path == "managed":
        margin = float(os.environ.get("MANAGED_MARGIN", "1.3"))
        usd *= margin

    return int(round(usd * 100))
