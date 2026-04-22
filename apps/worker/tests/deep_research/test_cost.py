"""Cost estimation per spec §7.4:

    estimated_cost_usd = base[model] * clamp(duration_minutes / 20, 0.5, 1.5)
    base[deep-research-preview-04-2026]     = 2.0
    base[deep-research-max-preview-04-2026] = 5.0

Managed path further multiplies by MANAGED_MARGIN env (default 1.3).
"""
from __future__ import annotations

import pytest

from worker.activities.deep_research.cost import estimate_cost_usd_cents


@pytest.mark.parametrize(
    "model,duration_minutes,expected_cents",
    [
        # Default model, reference duration (20 min) → base * 1.0 → 2.00 USD.
        ("deep-research-preview-04-2026", 20.0, 200),
        # Default model, short duration → clamp at 0.5 factor → 1.00 USD.
        ("deep-research-preview-04-2026", 5.0, 100),
        # Max model, long duration → clamp at 1.5 factor → 7.50 USD.
        ("deep-research-max-preview-04-2026", 60.0, 750),
        # Max model, reference duration → 5.00 USD.
        ("deep-research-max-preview-04-2026", 20.0, 500),
    ],
)
def test_estimate_cost_base_and_clamps(model, duration_minutes, expected_cents):
    assert (
        estimate_cost_usd_cents(
            model=model,
            duration_minutes=duration_minutes,
            billing_path="byok",
        )
        == expected_cents
    )


def test_managed_path_applies_default_margin(monkeypatch):
    monkeypatch.delenv("MANAGED_MARGIN", raising=False)
    # 5.00 * 1.0 * 1.3 = 6.50 USD → 650 cents.
    assert (
        estimate_cost_usd_cents(
            model="deep-research-max-preview-04-2026",
            duration_minutes=20.0,
            billing_path="managed",
        )
        == 650
    )


def test_managed_path_reads_margin_env(monkeypatch):
    monkeypatch.setenv("MANAGED_MARGIN", "1.5")
    # 2.00 * 1.0 * 1.5 = 3.00 USD → 300 cents.
    assert (
        estimate_cost_usd_cents(
            model="deep-research-preview-04-2026",
            duration_minutes=20.0,
            billing_path="managed",
        )
        == 300
    )


def test_rejects_unknown_model():
    with pytest.raises(ValueError, match="unknown model"):
        estimate_cost_usd_cents(
            model="gemini-pro",
            duration_minutes=10.0,
            billing_path="byok",
        )
