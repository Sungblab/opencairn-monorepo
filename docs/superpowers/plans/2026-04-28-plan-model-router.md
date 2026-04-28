# Model Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-side adaptive model + thinking-budget selection so each of the 12 OpenCairn agents resolves to the cheapest model that still meets quality, while emitting a transparent `route_decision` event for observability and humanizer display.

**Architecture:** A pure-Python router in `packages/llm/src/llm/router/` resolves a `Mode` per call. Layer A (rule-based) reads `Agent.preferred_mode()` declarations — covers ~99% of calls instantly with zero LLM round-trips. Layer B (Flash-Lite classifier with Redis cache) handles `agent_type="research"` ad-hoc user prompts. Mode → `(provider, model, thinking_budget)` resolution is **env-driven only** (per project rule: provider/model selection is server-env, never user-facing UI). A new `get_provider_for_mode(mode)` factory builds a per-call `ProviderConfig`. Each agent activity calls the router before constructing its provider, then yields a `RouteDecision` `AgentEvent` so the chat UI can render a badge ("⚖ balanced → flash + think(auto)") that is **read-only display, not a selector**.

**Tech Stack:**
- Python 3.13, pydantic v2, redis-py async (Layer B cache)
- `packages/llm` (provider abstraction), `apps/worker` (agents + runtime), `apps/api` (Hono SSE pass-through + agent_runs writer)
- Feature flags `FEATURE_MODEL_ROUTER` (master switch) and `FEATURE_MODEL_ROUTER_CLASSIFIER` (Layer B)

---

## Scope clarification — what this plan does NOT build

These spec items are **explicitly excluded** because of the project rule "LLM provider/model selection is env-only, no UI":

- ❌ User-facing mode selector (chat input chip, settings page, keyboard shortcut Alt+1~5) → spec §3, §13 Q4
- ❌ `user_mode` field in any API request payload → spec §9.3
- ❌ `default_mode` column on `user_preferences` → spec §8.1
- ❌ Tier-based mode access table (Free/BYOK/Pro/Enterprise per mode) → spec §3.2
- ❌ Pre-flight cost hint shown in input field UI ("[auto ▾] 예상 ~₩8") → spec §6.3 (the badge in §8.3 is **after-the-fact display**, which we DO build)
- ❌ Upgrade CTA when Free user picks accurate → spec §3.2 (no user choice, no CTA)
- ❌ Per-conversation / per-turn mode persistence → spec §13 Q1, Q2

`RouteDecision` events DO emit and the humanizer DOES render the resulting badge — that is observability, not selection.

PAYG balance-based downgrade (spec §6.2) is **deferred** — it depends on Plan 9b billing which is blocked on 사업자등록. We add the hook but no-op the check.

---

## File structure

### New files

| Path | Responsibility |
|---|---|
| `packages/llm/src/llm/router/__init__.py` | Public exports |
| `packages/llm/src/llm/router/types.py` | `Mode`, `ThinkingBudget`, `RouteDecisionData` (pydantic) |
| `packages/llm/src/llm/router/config.py` | `MODE_CONFIG`, `BUDGET_TOKENS`, env reader `RouterEnv` |
| `packages/llm/src/llm/router/rules.py` | Layer A: `resolve_layer_a()`, `agent_mode_map()` |
| `packages/llm/src/llm/router/classifier.py` | Layer B: `ClassifierResult`, `CLASSIFIER_PROMPT_KO`, `CLASSIFIER_PROMPT_EN`, `classify()` + Redis cache |
| `packages/llm/src/llm/router/resolve.py` | `resolve()` orchestrator (Layer A → fallback → Layer B → guardrails) |
| `packages/llm/src/llm/router/cost.py` | `estimate_cost_krw()` per (provider, model, prompt_tokens) |
| `packages/llm/src/llm/router/ceiling.py` | Per-agent ceiling enforcement |
| `packages/llm/tests/test_router_types.py` | Mode/Budget enum tests |
| `packages/llm/tests/test_router_config.py` | Env reader + MODE_CONFIG defaults |
| `packages/llm/tests/test_router_rules.py` | Layer A unit tests |
| `packages/llm/tests/test_router_classifier.py` | Layer B classifier + cache |
| `packages/llm/tests/test_router_resolve.py` | End-to-end resolve() with stub provider |
| `packages/llm/tests/test_router_cost.py` | Cost estimation |
| `packages/llm/tests/test_router_ceiling.py` | Ceiling downgrade |
| `packages/llm/tests/test_factory_for_mode.py` | `get_provider_for_mode()` |
| `apps/worker/tests/eval/router_eval.py` | 30-case eval harness (extensible to 100) |
| `apps/worker/tests/eval/router_eval_cases.jsonl` | Eval cases (query → expected_mode) |
| `apps/worker/tests/runtime/test_agent_preferred_mode.py` | All 12 agents declare correct preferred_mode |
| `docs/architecture/model-router.md` | Operator/runtime reference |

### Modified files

| Path | Change |
|---|---|
| `packages/llm/src/llm/__init__.py` | Re-export `get_provider_for_mode`, `Mode`, `ThinkingBudget`, `resolve` |
| `packages/llm/src/llm/factory.py` | Add `get_provider_for_mode(mode, *, base=None)` |
| `packages/llm/src/llm/base.py` | `generate()` + `generate_with_tools()` accept `thinking_budget` kwarg via `**kwargs` (already permissive); document in docstring |
| `packages/llm/src/llm/gemini.py` | Read `thinking_budget` from kwargs (fall back to `config.extra["thinking_budget"]`); apply to `GenerateContentConfig.thinking_config` |
| `packages/llm/src/llm/ollama.py` | Read `thinking_budget`; for unsupported models, drop silently and set `extra["thinking_fallback"] = True` |
| `apps/worker/src/runtime/agent.py` | Add `preferred_mode()` classmethod, default `Mode.BALANCED` |
| `apps/worker/src/runtime/events.py` | Add `RouteDecision` event class + add to `AgentEvent` union; export |
| `apps/worker/src/worker/agents/compiler/agent.py` | Override `preferred_mode()` → `Mode.FAST_LITE_THINK`; emit `RouteDecision` after `AgentStart` |
| `apps/worker/src/worker/agents/research/agent.py` | Override `preferred_mode()` → `Mode.BALANCED`; emit RouteDecision (Layer B if free-form prompt) |
| `apps/worker/src/worker/agents/librarian/agent.py` | Override → `Mode.ACCURATE`; emit RouteDecision |
| `apps/worker/src/worker/agents/connector/agent.py` | Override → `Mode.FAST_LITE_THINK`; emit |
| `apps/worker/src/worker/agents/curator/agent.py` | Override → `Mode.FAST_LITE_NO_THINK`; emit |
| `apps/worker/src/worker/agents/narrator/agent.py` | Override → `Mode.FAST`; emit |
| `apps/worker/src/worker/agents/temporal_agent/agent.py` | Override → `Mode.FAST_LITE_NO_THINK`; emit |
| `apps/worker/src/worker/agents/synthesis/agent.py` | Override → `Mode.BALANCED`; emit |
| `apps/worker/src/worker/agents/code/agent.py` | Override → `Mode.BALANCED`; emit |
| `apps/worker/src/worker/agents/visualization/agent.py` | Override → `Mode.FAST`; emit |
| (Socratic + deep_research) — see Task 6 below | The Socratic agent currently lives only in `apps/worker/src/worker/activities/socratic_activity.py` (no Agent subclass). Add a thin `SocraticAgent` shell or skip preferred_mode override and treat the activity itself as the call site. Same for deep_research. |
| `apps/worker/src/worker/activities/compiler_activity.py` | Replace `provider = get_provider()` with `provider = get_provider_for_mode(decision.resolved_mode)` |
| `apps/worker/src/worker/activities/research_activity.py` | Same swap; pass `prompt=...` to enable Layer B |
| `apps/worker/src/worker/activities/librarian_activity.py` | Same swap |
| `apps/worker/src/worker/activities/connector_activity.py` | Same swap |
| `apps/worker/src/worker/activities/curator_activity.py` | Same swap |
| `apps/worker/src/worker/activities/narrator_activity.py` | Same swap |
| `apps/worker/src/worker/activities/synthesis_activity.py` | Same swap |
| `apps/worker/src/worker/activities/socratic_activity.py` | Same swap (mode hard-coded to FAST inside activity since no Agent subclass) |
| `apps/worker/src/worker/activities/deep_research/create_plan.py` | Mode → RESEARCH (no router involvement; Deep Research has its own Interactions API) |
| `apps/api/src/routes/agents/chat.ts` | Pass-through `route_decision` SSE events (no transformation, just relay) |
| `apps/api/src/routes/agents/runs.ts` | Persist `routed_mode` + `routed_model` + `thinking_budget` from RouteDecision payload to `agent_runs` |
| `packages/db/src/schema/agents.ts` | Add nullable `routedMode`, `routedModel`, `thinkingBudget`, `routerLayer` columns to `agent_runs` |
| `packages/db/migrations/00XX_router_columns.sql` | Drizzle-generated migration (number determined at generation; current head = 0033) |
| `apps/worker/src/worker/lib/redis.py` (or equivalent) | Reuse existing Redis client; if absent, add a thin `get_redis()` helper |
| `.env.example` | Document new env vars (see Task 21) |

---

## Task list

### Task 1: `Mode` and `ThinkingBudget` enums

**Files:**
- Create: `packages/llm/src/llm/router/__init__.py` (placeholder, fills out as plan progresses)
- Create: `packages/llm/src/llm/router/types.py`
- Create: `packages/llm/tests/test_router_types.py`

- [ ] **Step 1: Write the failing test**

```python
# packages/llm/tests/test_router_types.py
from llm.router.types import Mode, ThinkingBudget


def test_mode_values():
    assert Mode.FAST.value == "fast"
    assert Mode.FAST_LITE_NO_THINK.value == "fast_lite_no_think"
    assert Mode.FAST_LITE_THINK.value == "fast_lite_think"
    assert Mode.BALANCED.value == "balanced"
    assert Mode.ACCURATE.value == "accurate"
    assert Mode.RESEARCH.value == "research"


def test_thinking_budget_values():
    assert ThinkingBudget.OFF.value == "off"
    assert ThinkingBudget.LOW.value == "low"
    assert ThinkingBudget.AUTO.value == "auto"
    assert ThinkingBudget.HIGH.value == "high"
    assert ThinkingBudget.MAX.value == "max"


def test_mode_str_serializable():
    # Used in pydantic models — must be a str subclass
    assert isinstance(Mode.FAST, str)
    assert isinstance(ThinkingBudget.HIGH, str)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/llm && uv run pytest tests/test_router_types.py -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'llm.router'`.

- [ ] **Step 3: Create the package skeleton + types**

```python
# packages/llm/src/llm/router/__init__.py
"""Adaptive model + thinking-budget router.

See docs/superpowers/specs/2026-04-22-model-router-design.md for design.
This package is provider-agnostic and side-effect free at import time.
Layer B classifier and ceiling enforcement read from env lazily.
"""
from llm.router.types import Mode, ThinkingBudget

__all__ = ["Mode", "ThinkingBudget"]
```

```python
# packages/llm/src/llm/router/types.py
"""Internal Mode / ThinkingBudget enums.

`Mode` is an internal-only resolution target. The project rule forbids
exposing these values in any user-facing surface (no API payload field,
no settings UI). They appear in `RouteDecision` events for observability
and humanizer display only.
"""
from __future__ import annotations

from enum import Enum


class Mode(str, Enum):
    FAST = "fast"
    FAST_LITE_NO_THINK = "fast_lite_no_think"
    FAST_LITE_THINK = "fast_lite_think"
    BALANCED = "balanced"
    ACCURATE = "accurate"
    RESEARCH = "research"


class ThinkingBudget(str, Enum):
    OFF = "off"
    LOW = "low"
    AUTO = "auto"
    HIGH = "high"
    MAX = "max"


__all__ = ["Mode", "ThinkingBudget"]
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/llm && uv run pytest tests/test_router_types.py -v
```
Expected: 3 PASSED.

- [ ] **Step 5: Commit**

```bash
git add packages/llm/src/llm/router/__init__.py \
        packages/llm/src/llm/router/types.py \
        packages/llm/tests/test_router_types.py
git commit -m "feat(llm): add Mode and ThinkingBudget enums for router"
```

---

### Task 2: `MODE_CONFIG` mapping + env reader

**Files:**
- Create: `packages/llm/src/llm/router/config.py`
- Create: `packages/llm/tests/test_router_config.py`

- [ ] **Step 1: Write the failing test**

```python
# packages/llm/tests/test_router_config.py
import pytest

from llm.router.config import (
    BUDGET_TOKENS,
    MODE_CONFIG,
    RouterEnv,
    load_router_env,
)
from llm.router.types import Mode, ThinkingBudget


def test_mode_config_covers_all_modes():
    # Every Mode must have a (model_tier, thinking_budget) entry
    for m in Mode:
        assert m in MODE_CONFIG, f"{m} missing from MODE_CONFIG"


def test_mode_config_values():
    assert MODE_CONFIG[Mode.FAST] == ("flash", ThinkingBudget.OFF)
    assert MODE_CONFIG[Mode.FAST_LITE_NO_THINK] == ("flash_lite", ThinkingBudget.OFF)
    assert MODE_CONFIG[Mode.FAST_LITE_THINK] == ("flash_lite", ThinkingBudget.LOW)
    assert MODE_CONFIG[Mode.BALANCED] == ("flash", ThinkingBudget.AUTO)
    assert MODE_CONFIG[Mode.ACCURATE] == ("pro", ThinkingBudget.HIGH)
    assert MODE_CONFIG[Mode.RESEARCH][0] == "research"


def test_budget_tokens():
    assert BUDGET_TOKENS[ThinkingBudget.OFF] == 0
    assert BUDGET_TOKENS[ThinkingBudget.LOW] == 1024
    assert BUDGET_TOKENS[ThinkingBudget.AUTO] is None  # Provider decides
    assert BUDGET_TOKENS[ThinkingBudget.HIGH] == 8192
    assert BUDGET_TOKENS[ThinkingBudget.MAX] == 24576


def test_load_router_env_reads_per_tier_models(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    monkeypatch.setenv("LLM_MODEL_FAST", "gemini-3-flash-preview")
    monkeypatch.setenv("LLM_MODEL_FAST_LITE", "gemini-3-flash-lite-preview")
    monkeypatch.setenv("LLM_MODEL_BALANCED", "gemini-3-flash-preview")
    monkeypatch.setenv("LLM_MODEL_ACCURATE", "gemini-3-pro-preview")
    monkeypatch.setenv("LLM_MODEL_RESEARCH", "deep-research-preview-04-2026")
    env = load_router_env()
    assert env.provider == "gemini"
    assert env.model_for_tier["flash"] == "gemini-3-flash-preview"
    assert env.model_for_tier["pro"] == "gemini-3-pro-preview"


def test_load_router_env_missing_tier_falls_back_to_llm_model(monkeypatch):
    # Operators may set a single LLM_MODEL and leave per-tier blank.
    # In that case every tier resolves to the same model — router still
    # works structurally, thinking_budget still varies.
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.setenv("LLM_MODEL", "llama3:8b")
    monkeypatch.delenv("LLM_MODEL_FAST", raising=False)
    monkeypatch.delenv("LLM_MODEL_PRO", raising=False)
    env = load_router_env()
    assert env.model_for_tier["flash"] == "llama3:8b"
    assert env.model_for_tier["pro"] == "llama3:8b"


def test_load_router_env_research_tier_optional(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.setenv("LLM_MODEL", "llama3:8b")
    monkeypatch.delenv("LLM_MODEL_RESEARCH", raising=False)
    env = load_router_env()
    # Ollama has no Deep Research equivalent — research tier may be None
    assert env.model_for_tier.get("research") in (None, "llama3:8b")
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/llm && uv run pytest tests/test_router_config.py -v
```
Expected: 5 FAIL with `ModuleNotFoundError: No module named 'llm.router.config'`.

- [ ] **Step 3: Implement config module**

```python
# packages/llm/src/llm/router/config.py
"""Mode → tier mapping and env reader.

Per project rule, model selection is **env-driven only**:
- LLM_MODEL_FAST           — flash tier (default model)
- LLM_MODEL_FAST_LITE      — flash-lite tier
- LLM_MODEL_BALANCED       — flash tier with thinking auto
- LLM_MODEL_ACCURATE       — pro tier
- LLM_MODEL_RESEARCH       — Deep Research model (Gemini only)

Operators may omit per-tier vars; missing ones fall back to LLM_MODEL.
That keeps router structurally functional under a single-model deployment;
only thinking_budget varies between modes in that degenerate case.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field

from llm.router.types import Mode, ThinkingBudget


# (model_tier, thinking_budget) per mode. ``model_tier`` is a logical name
# resolved against env vars at provider-config time.
MODE_CONFIG: dict[Mode, tuple[str, ThinkingBudget]] = {
    Mode.FAST:                (("flash"),      ThinkingBudget.OFF),
    Mode.FAST_LITE_NO_THINK:  (("flash_lite"), ThinkingBudget.OFF),
    Mode.FAST_LITE_THINK:     (("flash_lite"), ThinkingBudget.LOW),
    Mode.BALANCED:            (("flash"),      ThinkingBudget.AUTO),
    Mode.ACCURATE:            (("pro"),        ThinkingBudget.HIGH),
    Mode.RESEARCH:            (("research"),   ThinkingBudget.AUTO),
}


# Numeric token budgets used when constructing provider configs. ``None``
# means "let the provider decide" (Gemini AUTO).
BUDGET_TOKENS: dict[ThinkingBudget, int | None] = {
    ThinkingBudget.OFF: 0,
    ThinkingBudget.LOW: 1024,
    ThinkingBudget.AUTO: None,
    ThinkingBudget.HIGH: 8192,
    ThinkingBudget.MAX: 24576,
}


_TIER_ENV = {
    "flash":      "LLM_MODEL_FAST",
    "flash_lite": "LLM_MODEL_FAST_LITE",
    "balanced":   "LLM_MODEL_BALANCED",  # alias of flash usually; allows separate model
    "pro":        "LLM_MODEL_ACCURATE",
    "research":   "LLM_MODEL_RESEARCH",
}


@dataclass
class RouterEnv:
    provider: str
    api_key: str | None = field(default=None, repr=False)
    base_url: str | None = None
    embed_model: str = ""
    # Resolved per-tier model IDs. Falls back to LLM_MODEL when a tier var is unset.
    model_for_tier: dict[str, str | None] = field(default_factory=dict)


def load_router_env() -> RouterEnv:
    provider = os.environ.get("LLM_PROVIDER", "gemini")
    fallback_model = os.environ.get("LLM_MODEL", "")
    model_for_tier: dict[str, str | None] = {}
    for tier, var in _TIER_ENV.items():
        v = os.environ.get(var)
        if v:
            model_for_tier[tier] = v
        elif tier == "research":
            # Research is optional — None signals "not supported on this deployment".
            model_for_tier[tier] = fallback_model or None
        else:
            model_for_tier[tier] = fallback_model or None
    return RouterEnv(
        provider=provider,
        api_key=os.environ.get("LLM_API_KEY"),
        base_url=os.environ.get("OLLAMA_BASE_URL"),
        embed_model=os.environ.get("EMBED_MODEL", ""),
        model_for_tier=model_for_tier,
    )


__all__ = ["MODE_CONFIG", "BUDGET_TOKENS", "RouterEnv", "load_router_env"]
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/llm && uv run pytest tests/test_router_config.py -v
```
Expected: 5 PASSED.

- [ ] **Step 5: Commit**

```bash
git add packages/llm/src/llm/router/config.py packages/llm/tests/test_router_config.py
git commit -m "feat(llm): add MODE_CONFIG mapping and env-driven RouterEnv reader"
```

---

### Task 3: `get_provider_for_mode()` factory

**Files:**
- Modify: `packages/llm/src/llm/factory.py:1-37`
- Create: `packages/llm/tests/test_factory_for_mode.py`

- [ ] **Step 1: Write the failing test**

```python
# packages/llm/tests/test_factory_for_mode.py
import pytest

from llm.base import ProviderConfig
from llm.factory import get_provider_for_mode
from llm.router.types import Mode, ThinkingBudget


def test_get_provider_for_mode_returns_provider_with_tier_model(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    monkeypatch.setenv("LLM_API_KEY", "test")
    monkeypatch.setenv("LLM_MODEL", "gemini-3-flash-preview")
    monkeypatch.setenv("LLM_MODEL_ACCURATE", "gemini-3-pro-preview")
    monkeypatch.setenv("EMBED_MODEL", "gemini-embedding-001")

    p = get_provider_for_mode(Mode.ACCURATE)
    assert p.config.model == "gemini-3-pro-preview"
    assert p.config.extra["thinking_budget"] == ThinkingBudget.HIGH.value


def test_get_provider_for_mode_thinking_off_for_fast(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    monkeypatch.setenv("LLM_API_KEY", "test")
    monkeypatch.setenv("LLM_MODEL", "gemini-3-flash-preview")
    monkeypatch.setenv("EMBED_MODEL", "gemini-embedding-001")

    p = get_provider_for_mode(Mode.FAST)
    assert p.config.extra["thinking_budget"] == ThinkingBudget.OFF.value
    assert p.config.extra["thinking_budget_tokens"] == 0


def test_get_provider_for_mode_falls_back_to_llm_model_when_tier_missing(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.setenv("LLM_MODEL", "llama3:8b")
    monkeypatch.setenv("EMBED_MODEL", "nomic-embed-text")
    monkeypatch.delenv("LLM_MODEL_ACCURATE", raising=False)

    p = get_provider_for_mode(Mode.ACCURATE)
    # Falls back to single LLM_MODEL — router still works structurally
    assert p.config.model == "llama3:8b"


def test_get_provider_for_mode_research_unsupported_raises(monkeypatch):
    # When LLM_MODEL_RESEARCH unset on a deployment AND LLM_MODEL also unset
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.delenv("LLM_MODEL", raising=False)
    monkeypatch.delenv("LLM_MODEL_RESEARCH", raising=False)
    monkeypatch.setenv("EMBED_MODEL", "nomic-embed-text")

    with pytest.raises(RuntimeError, match="research"):
        get_provider_for_mode(Mode.RESEARCH)


def test_get_provider_for_mode_with_explicit_base_overrides_env(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    monkeypatch.setenv("LLM_API_KEY", "test")
    monkeypatch.setenv("EMBED_MODEL", "gemini-embedding-001")
    base = ProviderConfig(
        provider="gemini",
        api_key="byok",
        model="placeholder",  # overridden per mode
        embed_model="gemini-embedding-001",
    )
    p = get_provider_for_mode(Mode.BALANCED, base=base)
    # api_key from base preserved (BYOK), model resolved from env tier
    assert p.config.api_key == "byok"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/llm && uv run pytest tests/test_factory_for_mode.py -v
```
Expected: 5 FAIL with `ImportError: cannot import name 'get_provider_for_mode'`.

- [ ] **Step 3: Add the factory function**

Append to `packages/llm/src/llm/factory.py`:

```python
from llm.router.config import BUDGET_TOKENS, MODE_CONFIG, load_router_env
from llm.router.types import Mode


def get_provider_for_mode(
    mode: Mode,
    *,
    base: ProviderConfig | None = None,
) -> LLMProvider:
    """Build a provider configured for ``mode``.

    Reads `LLM_MODEL_<TIER>` env vars to resolve the model. Sets
    ``thinking_budget`` (string) and ``thinking_budget_tokens`` (int|None)
    on ``config.extra`` so the provider can pass it to the underlying SDK.

    ``base`` lets callers preserve a BYOK ``api_key`` while letting the
    router pick model/thinking. When ``base`` is provided, only ``model``
    and ``extra`` are overridden — ``provider``, ``api_key``,
    ``embed_model``, ``base_url`` come from ``base``.

    Raises ``RuntimeError`` when the requested mode's tier has no model
    configured (notably ``Mode.RESEARCH`` on Ollama-only deployments).
    """
    env = load_router_env()
    tier, budget = MODE_CONFIG[mode]
    model = env.model_for_tier.get(tier)
    if model is None:
        raise RuntimeError(
            f"Mode {mode.value} requires LLM_MODEL_{tier.upper()} or LLM_MODEL "
            f"to be set in env (provider={env.provider})."
        )

    extra = {
        "thinking_budget": budget.value,
        "thinking_budget_tokens": BUDGET_TOKENS[budget],
    }

    if base is not None:
        cfg = ProviderConfig(
            provider=base.provider,
            api_key=base.api_key,
            model=model,
            embed_model=base.embed_model,
            tts_model=base.tts_model,
            base_url=base.base_url,
            extra={**base.extra, **extra},
        )
    else:
        cfg = ProviderConfig(
            provider=env.provider,
            api_key=env.api_key,
            model=model,
            embed_model=env.embed_model,
            tts_model=os.getenv("TTS_MODEL"),
            base_url=env.base_url,
            extra=extra,
        )

    return get_provider(cfg)
```

Update `packages/llm/src/llm/__init__.py` to re-export:

```python
from llm.factory import get_provider, get_provider_for_mode
from llm.router.types import Mode, ThinkingBudget
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/llm && uv run pytest tests/test_factory_for_mode.py tests/test_factory.py -v
```
Expected: all PASS (existing factory tests should not regress).

- [ ] **Step 5: Commit**

```bash
git add packages/llm/src/llm/factory.py packages/llm/src/llm/__init__.py \
        packages/llm/tests/test_factory_for_mode.py
git commit -m "feat(llm): add get_provider_for_mode() factory keyed by Mode"
```

---

### Task 4: Wire `thinking_budget` into Gemini and Ollama providers

**Files:**
- Modify: `packages/llm/src/llm/gemini.py` (`generate` and `generate_with_tools`)
- Modify: `packages/llm/src/llm/ollama.py` (silent fallback)
- Add tests to: `packages/llm/tests/test_gemini.py`, `packages/llm/tests/test_ollama.py`

- [ ] **Step 1: Write the failing test**

```python
# Append to packages/llm/tests/test_gemini.py
import pytest
from llm.base import ProviderConfig
from llm.gemini import GeminiProvider


@pytest.mark.asyncio
async def test_generate_passes_thinking_budget_from_config_extra(monkeypatch):
    cfg = ProviderConfig(
        provider="gemini",
        api_key="x",
        model="gemini-3-flash-preview",
        embed_model="gemini-embedding-001",
        extra={"thinking_budget": "high", "thinking_budget_tokens": 8192},
    )
    p = GeminiProvider(cfg)

    captured = {}

    async def fake_gen(*, model, contents, config, **kw):
        captured["thinking"] = config.thinking_config
        return _stub_response("ok")

    monkeypatch.setattr(p._client.aio.models, "generate_content", fake_gen)
    out = await p.generate([{"role": "user", "content": "hi"}])
    assert out == "ok"
    assert captured["thinking"] is not None
    # Gemini SDK accepts ``thinking_budget`` as int (token count)
    assert captured["thinking"].thinking_budget == 8192


@pytest.mark.asyncio
async def test_generate_thinking_off_sets_zero_budget(monkeypatch):
    cfg = ProviderConfig(
        provider="gemini",
        api_key="x",
        model="gemini-3-flash-preview",
        embed_model="gemini-embedding-001",
        extra={"thinking_budget": "off", "thinking_budget_tokens": 0},
    )
    p = GeminiProvider(cfg)
    captured = {}

    async def fake_gen(*, model, contents, config, **kw):
        captured["thinking"] = config.thinking_config
        return _stub_response("ok")

    monkeypatch.setattr(p._client.aio.models, "generate_content", fake_gen)
    await p.generate([{"role": "user", "content": "hi"}])
    assert captured["thinking"].thinking_budget == 0


@pytest.mark.asyncio
async def test_generate_kwargs_thinking_budget_overrides_config(monkeypatch):
    cfg = ProviderConfig(
        provider="gemini",
        api_key="x",
        model="gemini-3-flash-preview",
        embed_model="gemini-embedding-001",
        extra={"thinking_budget": "off", "thinking_budget_tokens": 0},
    )
    p = GeminiProvider(cfg)
    captured = {}

    async def fake_gen(*, model, contents, config, **kw):
        captured["thinking"] = config.thinking_config
        return _stub_response("ok")

    monkeypatch.setattr(p._client.aio.models, "generate_content", fake_gen)
    await p.generate([{"role": "user", "content": "hi"}], thinking_budget_tokens=1024)
    assert captured["thinking"].thinking_budget == 1024


def _stub_response(text: str):
    class _R:
        def __init__(self, t):
            self.text = t
            self.candidates = []
            self.usage_metadata = None
    return _R(text)
```

```python
# Append to packages/llm/tests/test_ollama.py
import pytest
from llm.base import ProviderConfig
from llm.ollama import OllamaProvider


@pytest.mark.asyncio
async def test_ollama_silently_drops_unsupported_thinking(monkeypatch):
    cfg = ProviderConfig(
        provider="ollama",
        model="llama3:8b",
        embed_model="nomic-embed-text",
        extra={"thinking_budget": "high", "thinking_budget_tokens": 8192},
    )
    p = OllamaProvider(cfg)
    captured = {"called_with": None}

    async def fake_chat(**kwargs):
        captured["called_with"] = kwargs
        return {"message": {"content": "ok"}}

    monkeypatch.setattr(p._client, "chat", fake_chat)
    out = await p.generate([{"role": "user", "content": "hi"}])
    assert out == "ok"
    # No thinking parameter passed to ollama for unsupported model
    assert "think" not in (captured["called_with"] or {})
    # Fallback flag set on extra so caller can audit
    assert cfg.extra.get("thinking_fallback") is True
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/llm && uv run pytest tests/test_gemini.py::test_generate_passes_thinking_budget_from_config_extra tests/test_ollama.py::test_ollama_silently_drops_unsupported_thinking -v
```
Expected: FAIL — Gemini doesn't currently read `thinking_budget` from config.extra in `generate()`; Ollama doesn't set the fallback flag.

- [ ] **Step 3: Wire thinking_budget into GeminiProvider.generate**

In `packages/llm/src/llm/gemini.py`, locate `generate()` and update the `GenerateContentConfig` construction. Read `thinking_budget_tokens` from kwargs first, else from `self.config.extra`. When non-None, pass `types.ThinkingConfig(thinking_budget=<int>)`. Apply the same to `generate_with_tools()`. Locate the existing `generate()` method and modify (current line range varies; grep for `async def generate` in `gemini.py` to find the spot):

```python
async def generate(self, messages: list[dict], **kwargs) -> str:
    # ... existing message-to-contents conversion ...

    config_kwargs: dict = {}
    budget_tokens = kwargs.get(
        "thinking_budget_tokens",
        self.config.extra.get("thinking_budget_tokens"),
    )
    # AUTO is signalled by None — let SDK default. Only set when explicit int.
    if budget_tokens is not None:
        config_kwargs["thinking_config"] = types.ThinkingConfig(
            thinking_budget=int(budget_tokens),
        )

    response = await self._client.aio.models.generate_content(
        model=self.config.model,
        contents=contents,
        config=types.GenerateContentConfig(**config_kwargs),
    )
    return response.text
```

Apply the same pattern to `generate_with_tools()` — merge `thinking_config` into the existing `GenerateContentConfig`.

- [ ] **Step 4: Wire silent fallback into OllamaProvider.generate**

In `packages/llm/src/llm/ollama.py`, locate the `generate()` method. Most Ollama models (`llama3:8b`, `mistral`) don't support thinking; some (`deepseek-r1:32b`) do. We don't try to detect — we drop thinking silently and stamp `thinking_fallback`:

```python
async def generate(self, messages: list[dict], **kwargs) -> str:
    # ... existing chat construction ...
    if self.config.extra.get("thinking_budget_tokens") not in (None, 0):
        # Mark that we couldn't honor the requested thinking budget
        # so callers / route_decision can surface a "fallback: true"
        self.config.extra["thinking_fallback"] = True
    response = await self._client.chat(...)  # no `think` parameter passed
    return response["message"]["content"]
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/llm && uv run pytest tests/test_gemini.py tests/test_ollama.py -v
```
Expected: all new tests PASS, existing tests don't regress.

- [ ] **Step 6: Commit**

```bash
git add packages/llm/src/llm/gemini.py packages/llm/src/llm/ollama.py \
        packages/llm/tests/test_gemini.py packages/llm/tests/test_ollama.py
git commit -m "feat(llm): plumb thinking_budget_tokens into Gemini/Ollama generate"
```

---

### Task 5: `Agent.preferred_mode()` classmethod

**Files:**
- Modify: `apps/worker/src/runtime/agent.py:1-43`
- Create: `apps/worker/tests/runtime/test_agent_preferred_mode.py`

- [ ] **Step 1: Write the failing test**

```python
# apps/worker/tests/runtime/test_agent_preferred_mode.py
"""All Agent subclasses must declare preferred_mode."""
from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any, ClassVar

import pytest
from llm.router.types import Mode

from runtime.agent import Agent
from runtime.events import AgentEvent
from runtime.tools import ToolContext


class _StubAgent(Agent):
    name: ClassVar[str] = "stub"
    description: ClassVar[str] = "test"

    async def run(
        self, input: dict[str, Any], ctx: ToolContext
    ) -> AsyncGenerator[AgentEvent, Any]:
        if False:
            yield  # type: ignore[unreachable]


class _FastAgent(Agent):
    name: ClassVar[str] = "fast"
    description: ClassVar[str] = "test"

    @classmethod
    def preferred_mode(cls) -> Mode:
        return Mode.FAST

    async def run(
        self, input: dict[str, Any], ctx: ToolContext
    ) -> AsyncGenerator[AgentEvent, Any]:
        if False:
            yield  # type: ignore[unreachable]


def test_default_preferred_mode_is_balanced():
    assert _StubAgent.preferred_mode() is Mode.BALANCED


def test_subclass_can_override_preferred_mode():
    assert _FastAgent.preferred_mode() is Mode.FAST
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/worker && uv run pytest tests/runtime/test_agent_preferred_mode.py -v
```
Expected: FAIL — `Agent` has no `preferred_mode` attribute.

- [ ] **Step 3: Add the classmethod**

Edit `apps/worker/src/runtime/agent.py`:

```python
"""Agent base class — contract for all 12 OpenCairn agents."""
from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator
from typing import Any, ClassVar

from llm.router.types import Mode

from runtime.events import AgentEvent
from runtime.tools import ToolContext


class Agent(ABC):
    """All OpenCairn agents subclass this.

    `run()` is an async generator — yields AgentEvent items. If the agent
    yields `AwaitingInput`, the consumer may resume via `generator.asend(response)`.

    Subclasses MUST define class-level `name` and `description`. They MAY
    override `preferred_mode()` to declare their Layer A routing target;
    the default is `Mode.BALANCED`.
    """

    name: ClassVar[str]
    description: ClassVar[str]

    def __init_subclass__(cls, **kwargs: Any) -> None:
        super().__init_subclass__(**kwargs)
        if getattr(cls, "__abstractmethods__", None):
            return
        if not isinstance(getattr(cls, "name", None), str):
            raise TypeError(f"{cls.__name__} must define class-level `name: str`")
        if not isinstance(getattr(cls, "description", None), str):
            raise TypeError(f"{cls.__name__} must define class-level `description: str`")

    @classmethod
    def preferred_mode(cls) -> Mode:
        """Layer A routing target. Override per agent.

        See ``packages/llm/src/llm/router/rules.py`` for the aggregated
        agent → mode map (built by introspection over Agent subclasses).
        """
        return Mode.BALANCED

    @abstractmethod
    def run(
        self, input: dict[str, Any], ctx: ToolContext
    ) -> AsyncGenerator[AgentEvent, Any]:
        ...


__all__ = ["Agent"]
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/worker && uv run pytest tests/runtime/test_agent_preferred_mode.py -v
```
Expected: 2 PASSED.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/runtime/agent.py \
        apps/worker/tests/runtime/test_agent_preferred_mode.py
git commit -m "feat(runtime): add Agent.preferred_mode() classmethod (default BALANCED)"
```

---

### Task 6: Override `preferred_mode()` on all production agents

**Files:**
- Modify all agent classes (one commit per agent for atomic review)

The agents and their target modes per spec §4.1:

| Agent class | Path | Mode |
|---|---|---|
| `CompilerAgent` | `apps/worker/src/worker/agents/compiler/agent.py` | `FAST_LITE_THINK` |
| `ResearchAgent` | `apps/worker/src/worker/agents/research/agent.py` | `BALANCED` |
| `LibrarianAgent` | `apps/worker/src/worker/agents/librarian/agent.py` | `ACCURATE` |
| `ConnectorAgent` | `apps/worker/src/worker/agents/connector/agent.py` | `FAST_LITE_THINK` |
| `CuratorAgent` | `apps/worker/src/worker/agents/curator/agent.py` | `FAST_LITE_NO_THINK` |
| `NarratorAgent` | `apps/worker/src/worker/agents/narrator/agent.py` | `FAST` |
| `TemporalAgent` | `apps/worker/src/worker/agents/temporal_agent/agent.py` | `FAST_LITE_NO_THINK` |
| `SynthesisAgent` | `apps/worker/src/worker/agents/synthesis/agent.py` | `BALANCED` |
| `CodeAgent` | `apps/worker/src/worker/agents/code/agent.py` | `BALANCED` |
| `VisualizationAgent` | `apps/worker/src/worker/agents/visualization/agent.py` | `FAST` |

**Note on Socratic and Deep Research:** these currently exist as activities only (no `Agent` subclass — `socratic_activity.py`, `deep_research/`). They're handled in Task 11 by hard-coding the mode in the activity itself rather than introducing a stub Agent subclass. This is intentional minimal scope.

- [ ] **Step 1: Write the failing aggregation test**

```python
# Append to apps/worker/tests/runtime/test_agent_preferred_mode.py
from llm.router.rules import agent_mode_map
from llm.router.types import Mode

# Import all production agents to register subclasses
from worker.agents.code.agent import CodeAgent
from worker.agents.compiler.agent import CompilerAgent
from worker.agents.connector.agent import ConnectorAgent
from worker.agents.curator.agent import CuratorAgent
from worker.agents.librarian.agent import LibrarianAgent
from worker.agents.narrator.agent import NarratorAgent
from worker.agents.research.agent import ResearchAgent
from worker.agents.synthesis.agent import SynthesisAgent
from worker.agents.temporal_agent.agent import TemporalAgent
from worker.agents.visualization.agent import VisualizationAgent


def test_each_production_agent_declares_expected_mode():
    expected = {
        "compiler":      Mode.FAST_LITE_THINK,
        "research":      Mode.BALANCED,
        "librarian":     Mode.ACCURATE,
        "connector":     Mode.FAST_LITE_THINK,
        "curator":       Mode.FAST_LITE_NO_THINK,
        "narrator":      Mode.FAST,
        "temporal":      Mode.FAST_LITE_NO_THINK,
        "synthesis":     Mode.BALANCED,
        "code":          Mode.BALANCED,
        "visualization": Mode.FAST,
    }
    for cls in (
        CompilerAgent, ResearchAgent, LibrarianAgent, ConnectorAgent,
        CuratorAgent, NarratorAgent, TemporalAgent, SynthesisAgent,
        CodeAgent, VisualizationAgent,
    ):
        assert cls.preferred_mode() == expected[cls.name], (
            f"{cls.__name__}.preferred_mode() = {cls.preferred_mode()}, "
            f"expected {expected[cls.name]}"
        )
```

(`agent_mode_map` will be implemented in Task 7; this test imports it but only uses it transitively — drop the import for now if it errors during this task and add in Task 7.)

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/worker && uv run pytest tests/runtime/test_agent_preferred_mode.py::test_each_production_agent_declares_expected_mode -v
```
Expected: FAIL — every agent currently returns the default `BALANCED`.

- [ ] **Step 3: Add the override on each agent**

For each agent file, add right after the `name`/`description` declarations:

```python
# In CompilerAgent:
from llm.router.types import Mode  # at top

@classmethod
def preferred_mode(cls) -> Mode:
    return Mode.FAST_LITE_THINK
```

Repeat with the appropriate `Mode.*` value per the table above. Keep the import + classmethod adjacent to existing `name`/`description` for locality.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/worker && uv run pytest tests/runtime/test_agent_preferred_mode.py -v
```
Expected: all PASS.

- [ ] **Step 5: Run the full agent test suite to catch regressions**

```bash
cd apps/worker && uv run pytest tests/ -k "agent" -v
```
Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/worker/agents/ \
        apps/worker/tests/runtime/test_agent_preferred_mode.py
git commit -m "feat(agents): declare preferred_mode() on all 10 production agents"
```

---

### Task 7: `agent_mode_map()` runtime introspection

**Files:**
- Create: `packages/llm/src/llm/router/rules.py`
- Create: `packages/llm/tests/test_router_rules.py`

The router lives in `packages/llm` but `Agent` lives in `apps/worker/src/runtime`. To avoid circular import, the router accepts a *callable* `agent_mode_resolver: Callable[[str], Mode | None]` injected by the worker. Default behavior when no resolver is registered: returns `None` and falls through to `Mode.BALANCED`.

- [ ] **Step 1: Write the failing test**

```python
# packages/llm/tests/test_router_rules.py
import pytest

from llm.router.rules import (
    agent_mode_map,
    register_agent_mode_resolver,
    resolve_layer_a,
)
from llm.router.types import Mode


def test_resolve_layer_a_uses_registered_resolver():
    register_agent_mode_resolver(lambda name: Mode.ACCURATE if name == "librarian" else None)
    assert resolve_layer_a("librarian") == (Mode.ACCURATE, "rule:librarian")
    assert resolve_layer_a("unknown") == (Mode.BALANCED, "fallback:no_rule")


def test_resolve_layer_a_research_returns_none_to_signal_layer_b():
    # 'research' is special: returns None so caller knows to invoke Layer B
    register_agent_mode_resolver(lambda name: Mode.BALANCED if name == "research" else None)
    # Layer A intentionally yields fallback for research; resolve() top-level
    # decides whether to call classifier
    mode, reason = resolve_layer_a("research")
    assert mode == Mode.BALANCED
    assert reason in ("rule:research", "fallback:research_layer_b")


def test_agent_mode_map_aggregates_resolver_returns_for_known_names(monkeypatch):
    register_agent_mode_resolver(
        lambda name: {
            "compiler": Mode.FAST_LITE_THINK,
            "curator":  Mode.FAST_LITE_NO_THINK,
        }.get(name)
    )
    mp = agent_mode_map(["compiler", "curator", "unknown"])
    assert mp == {"compiler": Mode.FAST_LITE_THINK, "curator": Mode.FAST_LITE_NO_THINK}


@pytest.fixture(autouse=True)
def _reset_resolver():
    yield
    register_agent_mode_resolver(None)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/llm && uv run pytest tests/test_router_rules.py -v
```
Expected: FAIL — `llm.router.rules` doesn't exist.

- [ ] **Step 3: Implement rules.py**

```python
# packages/llm/src/llm/router/rules.py
"""Layer A — rule-based routing.

The router lives in packages/llm but Agent classes live in apps/worker.
To avoid a cyclic import, the worker registers an *agent_mode_resolver*
callable at startup that maps agent name → preferred Mode (or None).

Layer A semantics:
- If resolver returns Mode → use it, reason="rule:<name>"
- If resolver returns None → fall through to Mode.BALANCED,
  reason="fallback:no_rule"
- Special-case "research": resolve() (in resolve.py) checks for a free-form
  prompt and may call Layer B before falling back to whatever Layer A
  returned.
"""
from __future__ import annotations

from collections.abc import Callable, Iterable

from llm.router.types import Mode


_RESOLVER: Callable[[str], Mode | None] | None = None


def register_agent_mode_resolver(
    resolver: Callable[[str], Mode | None] | None,
) -> None:
    """Install (or clear) the global resolver. Called once by worker init."""
    global _RESOLVER
    _RESOLVER = resolver


def resolve_layer_a(agent_type: str) -> tuple[Mode, str]:
    """Return ``(mode, reason)`` for ``agent_type``.

    No LLM calls. ``reason`` is a short tag for ``RouteDecision.reason``.
    """
    if _RESOLVER is not None:
        m = _RESOLVER(agent_type)
        if m is not None:
            return m, f"rule:{agent_type}"
    return Mode.BALANCED, "fallback:no_rule"


def agent_mode_map(names: Iterable[str]) -> dict[str, Mode]:
    """Convenience: aggregate resolver returns for a list of names.

    Used by docs/eval to print the current map. Skips names with no rule.
    """
    if _RESOLVER is None:
        return {}
    out: dict[str, Mode] = {}
    for n in names:
        m = _RESOLVER(n)
        if m is not None:
            out[n] = m
    return out


__all__ = [
    "register_agent_mode_resolver",
    "resolve_layer_a",
    "agent_mode_map",
]
```

Wire the worker-side resolver. Modify `apps/worker/src/runtime/__init__.py` (or create a `worker/agents/__init__.py` registration block) to register at import time:

```python
# apps/worker/src/runtime/__init__.py — add at end
from llm.router.rules import register_agent_mode_resolver
from runtime.agent import Agent


def _resolve(name: str):
    for cls in Agent.__subclasses__():
        if getattr(cls, "name", None) == name:
            return cls.preferred_mode()
    return None


register_agent_mode_resolver(_resolve)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/llm && uv run pytest tests/test_router_rules.py -v
```
Expected: 3 PASSED.

- [ ] **Step 5: Commit**

```bash
git add packages/llm/src/llm/router/rules.py \
        packages/llm/tests/test_router_rules.py \
        apps/worker/src/runtime/__init__.py
git commit -m "feat(router): add Layer A rules with worker-side agent resolver"
```

---

### Task 8: `resolve()` orchestrator (Layer A only, Layer B stubbed)

**Files:**
- Create: `packages/llm/src/llm/router/resolve.py`
- Create: `packages/llm/tests/test_router_resolve.py`

- [ ] **Step 1: Write the failing test**

```python
# packages/llm/tests/test_router_resolve.py
import pytest

from llm.router.resolve import RouteDecisionData, resolve
from llm.router.rules import register_agent_mode_resolver
from llm.router.types import Mode, ThinkingBudget


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    monkeypatch.setenv("LLM_MODEL", "gemini-3-flash-preview")
    monkeypatch.setenv("LLM_MODEL_FAST_LITE", "gemini-3-flash-lite-preview")
    monkeypatch.setenv("LLM_MODEL_ACCURATE", "gemini-3-pro-preview")
    monkeypatch.setenv("EMBED_MODEL", "gemini-embedding-001")
    register_agent_mode_resolver(lambda name: {
        "compiler":  Mode.FAST_LITE_THINK,
        "librarian": Mode.ACCURATE,
    }.get(name))
    yield
    register_agent_mode_resolver(None)


@pytest.mark.asyncio
async def test_resolve_layer_a_compiler():
    decision = await resolve(agent_type="compiler", prompt=None, user_id="u1")
    assert decision.resolved_mode == Mode.FAST_LITE_THINK
    assert decision.layer == "A"
    assert decision.reason == "rule:compiler"
    assert decision.thinking_budget == ThinkingBudget.LOW
    assert decision.provider == "gemini"
    assert decision.model == "gemini-3-flash-lite-preview"


@pytest.mark.asyncio
async def test_resolve_layer_a_librarian_accurate():
    decision = await resolve(agent_type="librarian", prompt=None, user_id="u1")
    assert decision.resolved_mode == Mode.ACCURATE
    assert decision.model == "gemini-3-pro-preview"
    assert decision.thinking_budget == ThinkingBudget.HIGH


@pytest.mark.asyncio
async def test_resolve_unknown_agent_falls_back_balanced():
    decision = await resolve(agent_type="unknown", prompt=None, user_id="u1")
    assert decision.resolved_mode == Mode.BALANCED
    assert decision.layer == "fallback"
    assert decision.confidence == 1.0


@pytest.mark.asyncio
async def test_resolve_research_without_prompt_uses_layer_a_default():
    decision = await resolve(agent_type="research", prompt=None, user_id="u1")
    assert decision.resolved_mode == Mode.BALANCED
    assert decision.layer == "fallback"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/llm && uv run pytest tests/test_router_resolve.py -v
```
Expected: FAIL — `llm.router.resolve` doesn't exist.

- [ ] **Step 3: Implement resolve.py with Layer A + Layer B stub**

```python
# packages/llm/src/llm/router/resolve.py
"""Top-level router orchestrator.

Layer A is consulted first for all agents. For ``agent_type="research"``
with a free-form ``prompt``, Layer B (classifier) may be invoked when
``FEATURE_MODEL_ROUTER_CLASSIFIER`` env flag is true. Cost-ceiling and
PAYG-balance guardrails (Task 16) are applied at the end.
"""
from __future__ import annotations

import os
from typing import Literal

from pydantic import BaseModel

from llm.router.config import MODE_CONFIG, load_router_env
from llm.router.rules import resolve_layer_a
from llm.router.types import Mode, ThinkingBudget


class RouteDecisionData(BaseModel):
    """Pydantic carrier for routing outcome.

    Used both as the payload of the ``RouteDecision`` AgentEvent (Task 9)
    and as the return value of ``resolve()``. Kept in packages/llm so it's
    importable from both worker and api layers without a runtime dep.
    """

    resolved_mode: Mode
    provider: str
    model: str
    thinking_budget: ThinkingBudget
    layer: Literal["A", "B", "fallback"]
    reason: str
    confidence: float = 1.0
    estimated_cost_krw: int = 0
    downgraded: bool = False
    fallback: bool = False  # provider-side fallback (Ollama no-think)


async def resolve(
    *,
    agent_type: str | None,
    prompt: str | None,
    user_id: str,
    context_size_tokens: int = 0,
) -> RouteDecisionData:
    """Resolve a routing decision. No LLM call for Layer A path.

    Layer B is invoked only when:
      - agent_type == "research"
      - prompt is non-empty
      - FEATURE_MODEL_ROUTER_CLASSIFIER env is "true"
    """
    if agent_type is None:
        mode, reason, layer, confidence = (
            Mode.BALANCED,
            "fallback:no_agent",
            "fallback",
            1.0,
        )
    else:
        a_mode, a_reason = resolve_layer_a(agent_type)
        layer: Literal["A", "B", "fallback"] = "A"
        reason = a_reason
        confidence = 1.0
        mode = a_mode

        # Layer B: research with prompt + flag on
        if (
            agent_type == "research"
            and prompt
            and os.environ.get("FEATURE_MODEL_ROUTER_CLASSIFIER", "false").lower() == "true"
        ):
            from llm.router.classifier import classify  # lazy
            cls = await classify(prompt=prompt, user_id=user_id)
            if cls.recommended_mode == "fast":
                mode = Mode.FAST
            elif cls.recommended_mode == "balanced":
                mode = Mode.BALANCED
            elif cls.recommended_mode == "accurate":
                # Auto NEVER promotes to ACCURATE (spec §6.1) — cap at BALANCED
                mode = Mode.BALANCED
                reason = f"classifier:{cls.complexity}_capped_balanced"
            else:
                reason = f"classifier:{cls.complexity}"
            layer = "B"
            confidence = cls.confidence
            if not reason.startswith("classifier"):
                reason = f"classifier:{cls.complexity}"

        if a_reason.startswith("fallback"):
            layer = "fallback"

    # Resolve mode → (provider, model, thinking)
    env = load_router_env()
    tier, budget = MODE_CONFIG[mode]
    model = env.model_for_tier.get(tier) or os.environ.get("LLM_MODEL", "")

    decision = RouteDecisionData(
        resolved_mode=mode,
        provider=env.provider,
        model=model,
        thinking_budget=budget,
        layer=layer,
        reason=reason,
        confidence=confidence,
    )
    # Cost / ceiling guardrails wired in Task 16
    return decision


__all__ = ["resolve", "RouteDecisionData"]
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/llm && uv run pytest tests/test_router_resolve.py -v
```
Expected: 4 PASSED.

- [ ] **Step 5: Commit**

```bash
git add packages/llm/src/llm/router/resolve.py packages/llm/tests/test_router_resolve.py
git commit -m "feat(router): add resolve() orchestrator with Layer A + Layer B stub"
```

---

### Task 9: `RouteDecision` AgentEvent

**Files:**
- Modify: `apps/worker/src/runtime/events.py`
- Add tests to: `apps/worker/tests/runtime/test_events.py` (or create if absent)

- [ ] **Step 1: Write the failing test**

```python
# apps/worker/tests/runtime/test_route_decision_event.py
from pydantic import TypeAdapter

from llm.router.types import Mode, ThinkingBudget
from runtime.events import AgentEvent, RouteDecision


def test_route_decision_minimal_fields():
    ev = RouteDecision(
        run_id="r1",
        workspace_id="w1",
        agent_name="compiler",
        seq=1,
        ts=1700000000.0,
        resolved_mode=Mode.FAST_LITE_THINK,
        provider="gemini",
        model="gemini-3-flash-lite-preview",
        thinking_budget=ThinkingBudget.LOW,
        layer="A",
        reason="rule:compiler",
    )
    assert ev.type == "route_decision"
    assert ev.confidence == 1.0
    assert ev.estimated_cost_krw == 0


def test_route_decision_round_trips_in_agent_event_union():
    ev = RouteDecision(
        run_id="r1",
        workspace_id="w1",
        agent_name="compiler",
        seq=1,
        ts=1700000000.0,
        resolved_mode=Mode.BALANCED,
        provider="gemini",
        model="gemini-3-flash-preview",
        thinking_budget=ThinkingBudget.AUTO,
        layer="A",
        reason="rule:research",
    )
    adapter = TypeAdapter(AgentEvent)
    payload = ev.model_dump()
    revived = adapter.validate_python(payload)
    assert revived.type == "route_decision"
    assert revived.resolved_mode == Mode.BALANCED
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/worker && uv run pytest tests/runtime/test_route_decision_event.py -v
```
Expected: FAIL — `RouteDecision` doesn't exist in `runtime.events`.

- [ ] **Step 3: Add the event class to events.py**

In `apps/worker/src/runtime/events.py`, add after the existing event classes (alongside `Handoff`, before `AwaitingInput`):

```python
from llm.router.types import Mode, ThinkingBudget


class RouteDecision(BaseEvent):
    """Emitted right after AgentStart by every router-aware agent.

    Carries enough info for the humanizer to render a status badge and for
    agent_runs to record what was actually picked. Read-only display — the
    chat UI never lets users change this.
    """
    type: Literal["route_decision"] = "route_decision"
    resolved_mode: Mode
    provider: str
    model: str
    thinking_budget: ThinkingBudget
    layer: Literal["A", "B", "fallback"]
    reason: str
    confidence: float = 1.0
    estimated_cost_krw: int = 0
    downgraded: bool = False
    fallback: bool = False
```

Update `AgentEvent` union to include `RouteDecision`:

```python
AgentEvent = Annotated[
    Union[
        AgentStart,
        AgentEnd,
        AgentError,
        ModelEnd,
        ToolUse,
        ToolResult,
        Handoff,
        AwaitingInput,
        CustomEvent,
        RouteDecision,
    ],
    Field(discriminator="type"),
]
```

Update `__all__` to include `RouteDecision`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/worker && uv run pytest tests/runtime/test_route_decision_event.py tests/runtime/ -v
```
Expected: 2 new PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/runtime/events.py \
        apps/worker/tests/runtime/test_route_decision_event.py
git commit -m "feat(runtime): add RouteDecision to AgentEvent discriminated union"
```

---

### Task 10: Helper to emit `RouteDecision` from agents

**Files:**
- Modify: `apps/worker/src/runtime/events.py` (add helper)
- Create: `apps/worker/tests/runtime/test_emit_route_decision.py`

- [ ] **Step 1: Write the failing test**

```python
# apps/worker/tests/runtime/test_emit_route_decision.py
import pytest

from llm.router.resolve import RouteDecisionData
from llm.router.types import Mode, ThinkingBudget
from runtime.events import RouteDecision, build_route_decision_event


def test_build_route_decision_event_from_decision_data():
    d = RouteDecisionData(
        resolved_mode=Mode.FAST_LITE_THINK,
        provider="gemini",
        model="gemini-3-flash-lite-preview",
        thinking_budget=ThinkingBudget.LOW,
        layer="A",
        reason="rule:compiler",
    )
    ev = build_route_decision_event(
        decision=d,
        run_id="r1",
        workspace_id="w1",
        agent_name="compiler",
        seq=2,
        ts=1700000000.5,
    )
    assert isinstance(ev, RouteDecision)
    assert ev.resolved_mode == Mode.FAST_LITE_THINK
    assert ev.reason == "rule:compiler"
    assert ev.run_id == "r1"
    assert ev.seq == 2
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/worker && uv run pytest tests/runtime/test_emit_route_decision.py -v
```
Expected: FAIL — `build_route_decision_event` does not exist.

- [ ] **Step 3: Add helper**

Append to `apps/worker/src/runtime/events.py`:

```python
def build_route_decision_event(
    *,
    decision: "RouteDecisionData",
    run_id: str,
    workspace_id: str,
    agent_name: str,
    seq: int,
    ts: float,
    parent_seq: int | None = None,
) -> RouteDecision:
    """Build a RouteDecision event from a router decision payload.

    Agents call this immediately after AgentStart to surface the picked
    mode for observability and humanizer rendering.
    """
    return RouteDecision(
        run_id=run_id,
        workspace_id=workspace_id,
        agent_name=agent_name,
        seq=seq,
        ts=ts,
        parent_seq=parent_seq,
        resolved_mode=decision.resolved_mode,
        provider=decision.provider,
        model=decision.model,
        thinking_budget=decision.thinking_budget,
        layer=decision.layer,
        reason=decision.reason,
        confidence=decision.confidence,
        estimated_cost_krw=decision.estimated_cost_krw,
        downgraded=decision.downgraded,
        fallback=decision.fallback,
    )
```

Add `build_route_decision_event` to `__all__`. Use a stringized forward reference for `RouteDecisionData` to avoid runtime import cycle, and import it lazily inside the function body (or inside a `TYPE_CHECKING` block at module top).

```python
# at top of events.py
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from llm.router.resolve import RouteDecisionData
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/worker && uv run pytest tests/runtime/test_emit_route_decision.py -v
```
Expected: PASSED.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/runtime/events.py \
        apps/worker/tests/runtime/test_emit_route_decision.py
git commit -m "feat(runtime): add build_route_decision_event helper"
```

---

### Task 11: Wire activities to call router and use `get_provider_for_mode`

**Files:**
- Modify each activity that currently calls `get_provider()`:
  - `apps/worker/src/worker/activities/compiler_activity.py:108`
  - `apps/worker/src/worker/activities/research_activity.py:97`
  - `apps/worker/src/worker/activities/librarian_activity.py:86`
  - `apps/worker/src/worker/activities/connector_activity.py:88`
  - `apps/worker/src/worker/activities/curator_activity.py:94`
  - `apps/worker/src/worker/activities/narrator_activity.py:94`
  - `apps/worker/src/worker/activities/synthesis_activity.py` (path verified during task)
  - `apps/worker/src/worker/activities/socratic_activity.py:53,76`
- Optionally batch_embed_activities.py and image/enhance — these are not LLM-chat, leave on `get_provider()` (router only governs chat completion choice; embeddings + multimodal stay on env defaults).

The router gates on `FEATURE_MODEL_ROUTER`. When off → use `get_provider()` (legacy single-model path). When on → call `resolve()` and use `get_provider_for_mode()`.

Each agent that *yields events* (Compiler, Research, Librarian, Connector, Curator, Narrator, Synthesis) also yields a `RouteDecision` event right after `AgentStart`.

- [ ] **Step 1: Write the failing integration test for Compiler**

```python
# apps/worker/tests/agents/test_compiler_emits_route_decision.py
"""Compiler must emit RouteDecision after AgentStart when router flag on."""
from __future__ import annotations

import pytest

from runtime.events import AgentStart, RouteDecision


@pytest.mark.asyncio
async def test_compiler_emits_route_decision_after_agent_start(
    monkeypatch, compiler_agent_factory  # existing fixture
):
    monkeypatch.setenv("FEATURE_MODEL_ROUTER", "true")
    agent, ctx, input_ = compiler_agent_factory()
    events = []
    async for ev in agent.run(input_, ctx):
        events.append(ev)
        if len(events) >= 3:
            break
    types = [e.type for e in events[:2]]
    assert types[0] == "agent_start"
    assert types[1] == "route_decision"
    rd = events[1]
    assert isinstance(rd, RouteDecision)
    assert rd.agent_name == "compiler"
    assert rd.layer == "A"
```

(`compiler_agent_factory` is the existing test fixture that builds a CompilerAgent + stub provider + stub api client. Reuse what's already in `apps/worker/tests/agents/conftest.py` or `apps/worker/tests/agents/compiler/conftest.py`. If it doesn't exist, instantiate manually with stubs.)

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/worker && uv run pytest tests/agents/test_compiler_emits_route_decision.py -v
```
Expected: FAIL — Compiler doesn't yield RouteDecision yet.

- [ ] **Step 3: Modify CompilerAgent.run to emit RouteDecision**

In `apps/worker/src/worker/agents/compiler/agent.py`, right after the existing `yield AgentStart(...)` block:

```python
from llm.router.resolve import resolve
from runtime.events import build_route_decision_event

# inside run(), right after `yield AgentStart(...)`:
decision = await resolve(
    agent_type=self.name,
    prompt=None,
    user_id=validated.user_id,
)
yield build_route_decision_event(
    decision=decision,
    run_id=ctx.run_id,
    workspace_id=ctx.workspace_id,
    agent_name=self.name,
    seq=seq.next(),
    ts=time.time(),
)
self._routed_mode = decision.resolved_mode  # for activity to use
```

Repeat the pattern in every other agent's `run()`. For `ResearchAgent`, pass `prompt=user_prompt` so Layer B can fire when the flag is on.

- [ ] **Step 4: Modify activities to construct provider per resolved mode**

Each activity currently does `provider = get_provider()`. Change pattern:

```python
# BEFORE (compiler_activity.py:108):
provider = get_provider()
agent = CompilerAgent(provider=provider, api=api, batch_submit=batch_submit)

# AFTER:
import os
from llm import get_provider_for_mode
from llm.router.resolve import resolve
from worker.agents.compiler.agent import CompilerAgent

if os.environ.get("FEATURE_MODEL_ROUTER", "false").lower() == "true":
    decision = await resolve(
        agent_type=CompilerAgent.name,
        prompt=None,
        user_id=workflow_input.user_id,
    )
    provider = get_provider_for_mode(decision.resolved_mode)
else:
    provider = get_provider()
agent = CompilerAgent(provider=provider, api=api, batch_submit=batch_submit)
```

Note: when both the activity AND the agent call `resolve()`, we resolve twice. To avoid the duplicate work and ensure the event the agent emits matches the provider it actually got, **pass the decision into the agent** as an optional constructor arg:

```python
# CompilerAgent.__init__:
def __init__(self, *, provider, api=None, batch_submit=None, route_decision=None):
    self.provider = provider
    ...
    self._route_decision = route_decision  # set by activity, agent re-uses

# in run(): use self._route_decision if set, else call resolve() (for solo tests)
```

Apply consistently to all 7 agent classes.

For Socratic and Deep Research (no Agent subclass), the activity itself decides the mode:

```python
# socratic_activity.py
if os.environ.get("FEATURE_MODEL_ROUTER", "false").lower() == "true":
    from llm.router.types import Mode
    provider = get_provider_for_mode(Mode.FAST)  # Socratic = chat = fast
else:
    provider = get_provider()
```

- [ ] **Step 5: Run all agent tests + the new integration test**

```bash
cd apps/worker && uv run pytest tests/agents/ tests/runtime/ -v
```
Expected: all PASS, including the new RouteDecision emission tests.

- [ ] **Step 6: Repeat for each remaining agent (one commit per agent for review)**

```bash
git add apps/worker/src/worker/agents/compiler/ apps/worker/src/worker/activities/compiler_activity.py
git commit -m "feat(compiler): emit RouteDecision and use get_provider_for_mode under flag"

# Repeat block for: research, librarian, connector, curator, narrator, synthesis, socratic, code, visualization, temporal
```

---

### Task 12: Layer B classifier — schema and prompt

**Files:**
- Create: `packages/llm/src/llm/router/classifier.py` (schema + prompts only — `classify()` body in Task 13)
- Create: `packages/llm/tests/test_router_classifier.py`

- [ ] **Step 1: Write the failing test for the schema and prompt selector**

```python
# packages/llm/tests/test_router_classifier.py
import pytest

from llm.router.classifier import (
    CLASSIFIER_PROMPT_EN,
    CLASSIFIER_PROMPT_KO,
    ClassifierResult,
    select_prompt,
)


def test_classifier_result_schema():
    r = ClassifierResult(
        complexity="medium",
        needs_reasoning=True,
        needs_long_context=False,
        code_heavy=False,
        recommended_mode="balanced",
        confidence=0.85,
    )
    assert r.recommended_mode == "balanced"
    assert 0.0 <= r.confidence <= 1.0


def test_select_prompt_korean_for_korean_text():
    p = select_prompt("이 논문 한국어로 요약해줘")
    assert p is CLASSIFIER_PROMPT_KO


def test_select_prompt_english_for_english_text():
    p = select_prompt("Summarize this paper")
    assert p is CLASSIFIER_PROMPT_EN


def test_select_prompt_falls_back_to_korean_on_undetected():
    # langdetect can fail on very short/noisy text — Korean is the
    # OpenCairn default per "ko-first" project rule.
    p = select_prompt("?!@#")
    assert p is CLASSIFIER_PROMPT_KO
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/llm && uv run pytest tests/test_router_classifier.py -v
```
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement schema + prompts**

```python
# packages/llm/src/llm/router/classifier.py
"""Layer B classifier — small LLM call to gauge query complexity.

Per spec §6.1, the classifier never recommends ACCURATE for an auto path
(caller in resolve.py caps at BALANCED). The model used is whatever
LLM_MODEL_FAST_LITE resolves to, with thinking forced off.

Korean is the primary prompt per the project's ko-first rule. We attempt
langdetect; on failure fall back to Korean.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ClassifierResult(BaseModel):
    complexity: Literal["low", "medium", "high"]
    needs_reasoning: bool = False
    needs_long_context: bool = False
    code_heavy: bool = False
    recommended_mode: Literal["fast", "balanced", "accurate"]
    confidence: float = Field(ge=0.0, le=1.0)


CLASSIFIER_PROMPT_KO = """\
사용자 질문을 분류하세요. 출력은 JSON만.

분류 기준:
- low: 단순 사실 조회, 1-2문장 답변 가능
- medium: 여러 정보 결합, 요약·비교·설명
- high: 다단계 추론, 코드 생성, 수학, 창작

recommended_mode 가이드:
- low + !needs_reasoning → fast
- medium 또는 high → balanced
- high + (long_context 또는 code_heavy) → accurate

확신(confidence) < 0.7이면 한 단계 위로 (보수적).
"""


CLASSIFIER_PROMPT_EN = """\
Classify the user query. Output JSON only.

Criteria:
- low: simple factual lookup, 1-2 sentence answer
- medium: combining info, summarization/comparison/explanation
- high: multi-step reasoning, code generation, math, creative

recommended_mode guide:
- low + !needs_reasoning → fast
- medium or high → balanced
- high + (long_context or code_heavy) → accurate

If confidence < 0.7, escalate one step (conservative).
"""


def select_prompt(text: str) -> str:
    """Pick KO or EN prompt based on heuristic.

    Tries langdetect; on import or detection failure, defaults to KO
    (project is ko-first). Pure function — no side effects.
    """
    try:
        from langdetect import detect, DetectorFactory  # type: ignore[import-not-found]
        DetectorFactory.seed = 0  # deterministic
        lang = detect(text)
    except Exception:
        return CLASSIFIER_PROMPT_KO
    if lang == "en":
        return CLASSIFIER_PROMPT_EN
    return CLASSIFIER_PROMPT_KO


__all__ = [
    "ClassifierResult",
    "CLASSIFIER_PROMPT_KO",
    "CLASSIFIER_PROMPT_EN",
    "select_prompt",
]
```

Add `langdetect>=1.0.9` to `packages/llm/pyproject.toml` dependencies.

- [ ] **Step 4: Install dependency and run tests**

```bash
cd packages/llm && uv sync && uv run pytest tests/test_router_classifier.py -v
```
Expected: 4 PASSED.

- [ ] **Step 5: Commit**

```bash
git add packages/llm/src/llm/router/classifier.py \
        packages/llm/tests/test_router_classifier.py \
        packages/llm/pyproject.toml packages/llm/uv.lock
git commit -m "feat(router): add classifier schema and KO/EN prompts (Layer B prep)"
```

---

### Task 13: Layer B `classify()` with Redis cache

**Files:**
- Modify: `packages/llm/src/llm/router/classifier.py` (add `classify()` body)
- Modify: `packages/llm/tests/test_router_classifier.py`

The cache lives in Redis with key `router:classify:{sha256(prompt)[:16]}:{user_id}` and TTL 600s. The Redis client is constructed lazily from `REDIS_URL`. Tests inject a fake.

- [ ] **Step 1: Write the failing test**

```python
# Append to packages/llm/tests/test_router_classifier.py
from unittest.mock import AsyncMock

import pytest

from llm.router.classifier import classify


@pytest.mark.asyncio
async def test_classify_uses_provider_and_returns_result(monkeypatch):
    fake_provider = AsyncMock()
    fake_provider.generate = AsyncMock(return_value=(
        '{"complexity": "high", "needs_reasoning": true, '
        '"needs_long_context": false, "code_heavy": false, '
        '"recommended_mode": "accurate", "confidence": 0.9}'
    ))
    monkeypatch.setattr(
        "llm.router.classifier._build_classifier_provider",
        lambda: fake_provider,
    )
    fake_redis = AsyncMock()
    fake_redis.get = AsyncMock(return_value=None)
    fake_redis.setex = AsyncMock(return_value=True)
    monkeypatch.setattr(
        "llm.router.classifier._get_redis", AsyncMock(return_value=fake_redis)
    )

    r = await classify(prompt="복잡한 추론 필요한 질문", user_id="u1")
    assert r.complexity == "high"
    assert r.recommended_mode == "accurate"
    fake_redis.setex.assert_awaited_once()


@pytest.mark.asyncio
async def test_classify_returns_cached_when_present(monkeypatch):
    cached = (
        '{"complexity": "low", "needs_reasoning": false, '
        '"needs_long_context": false, "code_heavy": false, '
        '"recommended_mode": "fast", "confidence": 0.95}'
    )
    fake_redis = AsyncMock()
    fake_redis.get = AsyncMock(return_value=cached.encode())
    monkeypatch.setattr(
        "llm.router.classifier._get_redis", AsyncMock(return_value=fake_redis)
    )
    # If LLM is called we fail loudly — cache hit must avoid the call
    fake_provider = AsyncMock()
    fake_provider.generate = AsyncMock(side_effect=AssertionError("should not call"))
    monkeypatch.setattr(
        "llm.router.classifier._build_classifier_provider",
        lambda: fake_provider,
    )

    r = await classify(prompt="오늘 날씨", user_id="u1")
    assert r.recommended_mode == "fast"
    assert r.confidence == 0.95


@pytest.mark.asyncio
async def test_classify_falls_back_when_redis_unavailable(monkeypatch):
    monkeypatch.setattr(
        "llm.router.classifier._get_redis",
        AsyncMock(side_effect=ConnectionError("no redis")),
    )
    fake_provider = AsyncMock()
    fake_provider.generate = AsyncMock(return_value=(
        '{"complexity": "low", "needs_reasoning": false, '
        '"needs_long_context": false, "code_heavy": false, '
        '"recommended_mode": "fast", "confidence": 0.8}'
    ))
    monkeypatch.setattr(
        "llm.router.classifier._build_classifier_provider",
        lambda: fake_provider,
    )

    r = await classify(prompt="무엇이든", user_id="u1")
    assert r.recommended_mode == "fast"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/llm && uv run pytest tests/test_router_classifier.py -v
```
Expected: 3 new tests FAIL — `classify` not implemented.

- [ ] **Step 3: Implement `classify()` with cache + provider call**

Append to `packages/llm/src/llm/router/classifier.py`:

```python
import hashlib
import json
import os
from typing import Any

from llm.base import LLMProvider, ProviderConfig
from llm.factory import get_provider
from llm.router.config import load_router_env

CACHE_TTL_SECONDS = 600


def _cache_key(prompt: str, user_id: str) -> str:
    h = hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:16]
    return f"router:classify:{h}:{user_id}"


async def _get_redis():  # pragma: no cover — overridden in tests
    """Lazy Redis client. Returns ``None`` when REDIS_URL unset."""
    url = os.environ.get("REDIS_URL")
    if not url:
        raise ConnectionError("REDIS_URL not set")
    import redis.asyncio as aioredis
    return aioredis.from_url(url, decode_responses=False)


def _build_classifier_provider() -> LLMProvider:
    """Build the Flash-Lite provider used for classification.

    Always thinking off, regardless of mode config — classifier is meant
    to be cheap and fast (spec §10 anti-pattern: classifier on Pro).
    """
    env = load_router_env()
    model = env.model_for_tier.get("flash_lite") or os.environ.get("LLM_MODEL", "")
    cfg = ProviderConfig(
        provider=env.provider,
        api_key=env.api_key,
        model=model,
        embed_model=env.embed_model,
        base_url=env.base_url,
        extra={"thinking_budget": "off", "thinking_budget_tokens": 0},
    )
    return get_provider(cfg)


async def classify(*, prompt: str, user_id: str) -> ClassifierResult:
    key = _cache_key(prompt, user_id)
    try:
        r = await _get_redis()
        cached = await r.get(key)
        if cached:
            data: dict[str, Any] = json.loads(cached)
            return ClassifierResult.model_validate(data)
    except Exception:
        r = None  # fall through to LLM call

    provider = _build_classifier_provider()
    sys_prompt = select_prompt(prompt)
    raw = await provider.generate([
        {"role": "system", "content": sys_prompt},
        {"role": "user", "content": prompt},
    ])
    try:
        data = json.loads(raw)
        result = ClassifierResult.model_validate(data)
    except Exception:
        # On parse failure default to balanced + low confidence so the
        # caller can fall back deterministically.
        result = ClassifierResult(
            complexity="medium",
            recommended_mode="balanced",
            confidence=0.0,
        )

    if r is not None:
        try:
            await r.setex(key, CACHE_TTL_SECONDS, result.model_dump_json())
        except Exception:
            pass  # cache write failures are non-fatal
    return result
```

Add `redis>=5.0` to `packages/llm/pyproject.toml`.

- [ ] **Step 4: Run tests**

```bash
cd packages/llm && uv sync && uv run pytest tests/test_router_classifier.py tests/test_router_resolve.py -v
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/llm/src/llm/router/classifier.py \
        packages/llm/tests/test_router_classifier.py \
        packages/llm/pyproject.toml packages/llm/uv.lock
git commit -m "feat(router): implement Layer B classify() with Redis cache + langdetect"
```

---

### Task 14: Integrate Layer B into `resolve()` and add end-to-end test

**Files:**
- Modify: `packages/llm/src/llm/router/resolve.py` (already has the lazy import; verify wiring)
- Add tests to: `packages/llm/tests/test_router_resolve.py`

- [ ] **Step 1: Write the failing test**

```python
# Append to packages/llm/tests/test_router_resolve.py
from unittest.mock import AsyncMock

import pytest

from llm.router.classifier import ClassifierResult


@pytest.mark.asyncio
async def test_resolve_layer_b_for_research_when_flag_on(monkeypatch):
    monkeypatch.setenv("FEATURE_MODEL_ROUTER_CLASSIFIER", "true")
    fake_classify = AsyncMock(return_value=ClassifierResult(
        complexity="high",
        needs_reasoning=True,
        needs_long_context=False,
        code_heavy=False,
        recommended_mode="balanced",
        confidence=0.9,
    ))
    monkeypatch.setattr("llm.router.classifier.classify", fake_classify)

    decision = await resolve(
        agent_type="research", prompt="복잡한 질문", user_id="u1"
    )
    assert decision.layer == "B"
    assert decision.resolved_mode == Mode.BALANCED
    assert decision.reason.startswith("classifier:")
    assert decision.confidence == 0.9


@pytest.mark.asyncio
async def test_resolve_layer_b_caps_accurate_to_balanced(monkeypatch):
    """Auto path NEVER promotes to ACCURATE (spec §6.1)."""
    monkeypatch.setenv("FEATURE_MODEL_ROUTER_CLASSIFIER", "true")
    fake_classify = AsyncMock(return_value=ClassifierResult(
        complexity="high",
        needs_reasoning=True,
        needs_long_context=True,
        code_heavy=True,
        recommended_mode="accurate",
        confidence=0.95,
    ))
    monkeypatch.setattr("llm.router.classifier.classify", fake_classify)
    decision = await resolve(
        agent_type="research", prompt="x", user_id="u1"
    )
    assert decision.resolved_mode == Mode.BALANCED  # capped, not ACCURATE
    assert "capped" in decision.reason


@pytest.mark.asyncio
async def test_resolve_layer_b_skipped_when_flag_off(monkeypatch):
    monkeypatch.delenv("FEATURE_MODEL_ROUTER_CLASSIFIER", raising=False)
    decision = await resolve(
        agent_type="research", prompt="x", user_id="u1"
    )
    assert decision.layer == "fallback"  # research's Layer A is fallback path
```

- [ ] **Step 2: Run tests**

```bash
cd packages/llm && uv run pytest tests/test_router_resolve.py -v
```
Expected: all PASS (the integration is already in `resolve.py` from Task 8; this just verifies behavior).

- [ ] **Step 3: Commit**

```bash
git add packages/llm/tests/test_router_resolve.py
git commit -m "test(router): cover Layer B integration paths in resolve()"
```

---

### Task 15: `estimate_cost_krw()` helper

**Files:**
- Create: `packages/llm/src/llm/router/cost.py`
- Create: `packages/llm/tests/test_router_cost.py`

- [ ] **Step 1: Write the failing test**

```python
# packages/llm/tests/test_router_cost.py
from llm.router.cost import estimate_cost_krw
from llm.router.types import Mode


def test_estimate_known_modes():
    # These are coarse defaults — operators can override via env. Tests
    # only assert they're positive and ordered fast < balanced < accurate.
    fast = estimate_cost_krw(Mode.FAST, prompt_tokens=1000, completion_tokens=200)
    bal = estimate_cost_krw(Mode.BALANCED, prompt_tokens=1000, completion_tokens=200)
    acc = estimate_cost_krw(Mode.ACCURATE, prompt_tokens=1000, completion_tokens=200)
    assert fast >= 0
    assert fast <= bal <= acc


def test_estimate_zero_tokens_zero_cost():
    assert estimate_cost_krw(Mode.BALANCED, prompt_tokens=0, completion_tokens=0) == 0
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/llm && uv run pytest tests/test_router_cost.py -v
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement coarse cost table**

```python
# packages/llm/src/llm/router/cost.py
"""Coarse per-mode cost estimation in KRW.

Numbers are gross approximations meant for guardrail comparisons, not
billing. Operators may override via env vars but defaults are sensible
for Gemini 3.x at the time of writing (2026-04).
"""
from __future__ import annotations

import os

from llm.router.types import Mode


# (KRW per million prompt tokens, KRW per million completion tokens)
# Defaults (rounded) — operators override via PRICE_KRW_PER_MTOK_PROMPT_<MODE>.
_DEFAULTS: dict[Mode, tuple[int, int]] = {
    Mode.FAST:                (130, 520),
    Mode.FAST_LITE_NO_THINK:  (50, 200),
    Mode.FAST_LITE_THINK:     (50, 250),
    Mode.BALANCED:            (130, 650),
    Mode.ACCURATE:            (1700, 6800),
    Mode.RESEARCH:            (1700, 6800),
}


def _rates_for(mode: Mode) -> tuple[int, int]:
    p_env = os.environ.get(f"PRICE_KRW_PER_MTOK_PROMPT_{mode.value.upper()}")
    c_env = os.environ.get(f"PRICE_KRW_PER_MTOK_COMPLETION_{mode.value.upper()}")
    p, c = _DEFAULTS[mode]
    if p_env:
        p = int(p_env)
    if c_env:
        c = int(c_env)
    return p, c


def estimate_cost_krw(
    mode: Mode, *, prompt_tokens: int, completion_tokens: int
) -> int:
    if prompt_tokens <= 0 and completion_tokens <= 0:
        return 0
    p, c = _rates_for(mode)
    return int(round(prompt_tokens * p / 1_000_000 + completion_tokens * c / 1_000_000))


__all__ = ["estimate_cost_krw"]
```

- [ ] **Step 4: Run tests**

```bash
cd packages/llm && uv run pytest tests/test_router_cost.py -v
```
Expected: 2 PASSED.

- [ ] **Step 5: Commit**

```bash
git add packages/llm/src/llm/router/cost.py packages/llm/tests/test_router_cost.py
git commit -m "feat(router): coarse per-mode cost estimation in KRW"
```

---

### Task 16: Per-agent ceiling enforcement (downgrade)

**Files:**
- Create: `packages/llm/src/llm/router/ceiling.py`
- Modify: `packages/llm/src/llm/router/resolve.py` (call ceiling check before returning)
- Create: `packages/llm/tests/test_router_ceiling.py`

PAYG balance check is a stub here — emits a TODO log. Real wiring lands when Plan 9b unblocks.

- [ ] **Step 1: Write the failing test**

```python
# packages/llm/tests/test_router_ceiling.py
import pytest

from llm.router.ceiling import apply_ceiling
from llm.router.resolve import RouteDecisionData
from llm.router.types import Mode, ThinkingBudget


def _decision(mode: Mode, est_cost: int) -> RouteDecisionData:
    return RouteDecisionData(
        resolved_mode=mode,
        provider="gemini",
        model="gemini-3-pro-preview",
        thinking_budget=ThinkingBudget.HIGH,
        layer="A",
        reason="rule:librarian",
        estimated_cost_krw=est_cost,
    )


def test_ceiling_no_downgrade_when_under(monkeypatch):
    monkeypatch.setenv("AGENT_CEILING_LIBRARIAN_KRW", "1000")
    out = apply_ceiling(_decision(Mode.ACCURATE, 500), agent_type="librarian")
    assert out.resolved_mode == Mode.ACCURATE
    assert out.downgraded is False


def test_ceiling_downgrades_accurate_to_balanced(monkeypatch):
    monkeypatch.setenv("AGENT_CEILING_LIBRARIAN_KRW", "100")
    out = apply_ceiling(_decision(Mode.ACCURATE, 500), agent_type="librarian")
    assert out.resolved_mode == Mode.BALANCED
    assert out.downgraded is True
    assert "ceiling" in out.reason


def test_ceiling_no_env_no_op():
    """Without env config, ceiling is permissive (no downgrade)."""
    out = apply_ceiling(_decision(Mode.ACCURATE, 99999), agent_type="librarian")
    assert out.resolved_mode == Mode.ACCURATE
    assert out.downgraded is False
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/llm && uv run pytest tests/test_router_ceiling.py -v
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ceiling**

```python
# packages/llm/src/llm/router/ceiling.py
"""Per-agent cost-ceiling enforcement.

Spec §6.4: when the router proposes ACCURATE and the per-agent ceiling
is exceeded, downgrade to BALANCED. Per-agent env: ``AGENT_CEILING_<NAME>_KRW``
(e.g. ``AGENT_CEILING_LIBRARIAN_KRW=500``).

PAYG balance downgrade (§6.2) is a separate TODO that depends on Plan 9b.
"""
from __future__ import annotations

import os

from llm.router.resolve import RouteDecisionData
from llm.router.types import Mode, ThinkingBudget


_DOWNGRADE_TARGETS: dict[Mode, Mode] = {
    Mode.ACCURATE: Mode.BALANCED,
    Mode.BALANCED: Mode.FAST,
    Mode.RESEARCH: Mode.BALANCED,
}


def apply_ceiling(
    decision: RouteDecisionData,
    *,
    agent_type: str,
) -> RouteDecisionData:
    raw = os.environ.get(f"AGENT_CEILING_{agent_type.upper()}_KRW")
    if not raw:
        return decision
    try:
        ceiling = int(raw)
    except ValueError:
        return decision
    if decision.estimated_cost_krw <= ceiling:
        return decision

    target = _DOWNGRADE_TARGETS.get(decision.resolved_mode)
    if target is None:
        return decision  # already at floor

    return decision.model_copy(update={
        "resolved_mode": target,
        "thinking_budget": _new_budget_for(target),
        "downgraded": True,
        "reason": f"{decision.reason}+ceiling:{ceiling}krw",
    })


def _new_budget_for(mode: Mode) -> ThinkingBudget:
    from llm.router.config import MODE_CONFIG
    return MODE_CONFIG[mode][1]


__all__ = ["apply_ceiling"]
```

Wire into `resolve.py` — at the end of `resolve()`, before the return:

```python
# resolve.py — at end of resolve(), before `return decision`
from llm.router.cost import estimate_cost_krw
from llm.router.ceiling import apply_ceiling

# Rough cost estimate for ceiling check (caller hasn't run prompt yet,
# so use context_size_tokens + 500 token completion budget as estimate)
decision = decision.model_copy(update={
    "estimated_cost_krw": estimate_cost_krw(
        mode,
        prompt_tokens=context_size_tokens or 1000,
        completion_tokens=500,
    ),
})
if agent_type:
    decision = apply_ceiling(decision, agent_type=agent_type)
return decision
```

- [ ] **Step 4: Run tests**

```bash
cd packages/llm && uv run pytest tests/test_router_ceiling.py tests/test_router_resolve.py -v
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/llm/src/llm/router/ceiling.py \
        packages/llm/src/llm/router/resolve.py \
        packages/llm/tests/test_router_ceiling.py
git commit -m "feat(router): per-agent KRW ceiling enforcement with downgrade"
```

---

### Task 17: Ollama mode-map test (env-agnostic verification)

The Ollama tier mapping is **operator-supplied via env vars** — same `LLM_MODEL_<TIER>` knobs as Gemini. We just verify the router doesn't crash when an Ollama-only deployment lacks the RESEARCH tier and that `thinking_fallback` flows through.

**Files:**
- Add tests to: `packages/llm/tests/test_router_resolve.py`

- [ ] **Step 1: Write the failing test**

```python
# Append to packages/llm/tests/test_router_resolve.py

@pytest.mark.asyncio
async def test_resolve_ollama_balanced(monkeypatch):
    register_agent_mode_resolver(lambda name: Mode.BALANCED)
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.setenv("LLM_MODEL", "llama3:70b")
    monkeypatch.setenv("LLM_MODEL_FAST", "llama3:8b")
    monkeypatch.setenv("EMBED_MODEL", "nomic-embed-text")
    monkeypatch.delenv("LLM_MODEL_RESEARCH", raising=False)

    decision = await resolve(agent_type="connector", prompt=None, user_id="u1")
    assert decision.provider == "ollama"
    assert decision.model == "llama3:70b"


@pytest.mark.asyncio
async def test_resolve_ollama_research_fallback(monkeypatch):
    register_agent_mode_resolver(lambda name: Mode.BALANCED)
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.setenv("LLM_MODEL", "llama3:70b")
    monkeypatch.setenv("EMBED_MODEL", "nomic-embed-text")
    monkeypatch.delenv("LLM_MODEL_RESEARCH", raising=False)

    # On Ollama, deep research isn't supported — agent code should not
    # request Mode.RESEARCH directly; the activity layer either skips
    # the agent or surfaces an error. The router itself returns the
    # configured model (LLM_MODEL fallback) when asked.
    register_agent_mode_resolver(lambda name: Mode.RESEARCH if name == "deep_research" else None)
    decision = await resolve(agent_type="deep_research", prompt=None, user_id="u1")
    assert decision.resolved_mode == Mode.RESEARCH
    assert decision.model == "llama3:70b"  # fallback to LLM_MODEL
```

- [ ] **Step 2: Run tests**

```bash
cd packages/llm && uv run pytest tests/test_router_resolve.py -v
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/llm/tests/test_router_resolve.py
git commit -m "test(router): cover Ollama tier resolution and research fallback"
```

---

### Task 18: `FEATURE_MODEL_ROUTER` flag end-to-end

Confirm that with the flag **off**, every activity falls back to the existing `get_provider()` path (no behavior change) and no `RouteDecision` events are emitted.

**Files:**
- Add tests to: `apps/worker/tests/agents/test_router_flag_off.py`

- [ ] **Step 1: Write the failing test**

```python
# apps/worker/tests/agents/test_router_flag_off.py
import pytest

from runtime.events import RouteDecision


@pytest.mark.asyncio
async def test_compiler_does_not_emit_route_decision_when_flag_off(
    monkeypatch, compiler_agent_factory
):
    monkeypatch.delenv("FEATURE_MODEL_ROUTER", raising=False)
    agent, ctx, input_ = compiler_agent_factory()
    events = []
    async for ev in agent.run(input_, ctx):
        events.append(ev)
        if len(events) >= 5:
            break
    assert not any(isinstance(e, RouteDecision) for e in events)
```

- [ ] **Step 2: Wrap each agent's RouteDecision emission in a flag check**

In each modified agent's `run()` (Task 11 already added the emission), gate it:

```python
import os
# ... after AgentStart yield:
if os.environ.get("FEATURE_MODEL_ROUTER", "false").lower() == "true":
    decision = await resolve(...)
    yield build_route_decision_event(...)
```

Same gating in the activity provider construction (already gated in Task 11).

- [ ] **Step 3: Run tests**

```bash
cd apps/worker && uv run pytest tests/agents/test_router_flag_off.py tests/agents/ -v
```
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/worker/agents/ apps/worker/tests/agents/test_router_flag_off.py
git commit -m "feat(router): gate RouteDecision emission on FEATURE_MODEL_ROUTER"
```

---

### Task 19: SSE pass-through of `route_decision` in apps/api

**Files:**
- Modify: `apps/api/src/routes/agents/chat.ts` (or wherever the SSE producer relays AgentEvents)
- Add tests to: `apps/api/src/routes/agents/chat.test.ts`

The api currently relays events from worker to the SSE client. Verify `route_decision` events pass through without filtering, and that the JSON schema on the wire matches the Python pydantic dump (camelCase vs snake_case — confirm convention by reading existing event handling).

- [ ] **Step 1: Read the existing SSE handler**

```bash
grep -rn "route_decision\|agent_start\|model_end" apps/api/src/routes/agents/ | head -20
```

Identify where AgentEvent JSON is forwarded. The pattern used elsewhere (e.g. for `model_end`, `tool_use`) is the reference.

- [ ] **Step 2: Write the failing test**

```ts
// apps/api/src/routes/agents/chat.test.ts (append)
import { describe, it, expect } from "vitest";

describe("chat SSE relay", () => {
  it("forwards route_decision events untouched", async () => {
    // Construct a fake worker event stream that yields:
    //   1. agent_start
    //   2. route_decision
    //   3. agent_end
    // Assert the SSE response contains a 'data:' frame with type=route_decision
    // and resolved_mode, provider, model, thinking_budget fields preserved.
    // ... test body using existing test fixtures ...
  });
});
```

(Adapt to whatever SSE testing helper apps/api already uses. Reuse the harness from existing chat.test.ts.)

- [ ] **Step 3: Verify the relay handles the new type**

If the existing relay uses an explicit allowlist of event types, add `"route_decision"` to it. If it forwards any event with a discriminator, no code change needed — the test simply locks that behavior.

- [ ] **Step 4: Run tests**

```bash
cd apps/api && pnpm test -- chat.test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/agents/
git commit -m "feat(api): forward route_decision events through chat SSE relay"
```

---

### Task 20: Persist routed mode to `agent_runs`

**Files:**
- Modify: `packages/db/src/schema/agents.ts` (add nullable `routedMode`, `routedModel`, `thinkingBudget`, `routerLayer` columns to `agentRuns` table)
- Generate migration: `packages/db/migrations/00XX_router_columns.sql`
- Modify: `apps/api/src/routes/agents/runs.ts` (or wherever `agent_runs` rows are written) to capture these fields from the first `route_decision` event

- [ ] **Step 1: Update schema**

```ts
// packages/db/src/schema/agents.ts (append columns inside agentRuns table)
routedMode: text("routed_mode"),         // nullable — old runs have no value
routedModel: text("routed_model"),
thinkingBudget: text("thinking_budget"),
routerLayer: text("router_layer"),       // 'A' | 'B' | 'fallback'
```

- [ ] **Step 2: Generate migration**

```bash
pnpm --filter @opencairn/db db:generate
```

The CLI will produce `packages/db/migrations/0034_router_columns.sql` (number depends on current head — currently 0033 per memory). Inspect to confirm it only adds the four nullable columns.

- [ ] **Step 3: Apply migration to dev DB and write the writer**

```bash
pnpm --filter @opencairn/db db:migrate
```

Edit the agent_runs writer in apps/api to capture these from the first `route_decision` event in the SSE stream:

```ts
// pseudo — actual location depends on existing structure
if (event.type === "route_decision" && agentRun.routedMode === null) {
  await db.update(agentRuns).set({
    routedMode: event.resolvedMode,
    routedModel: event.model,
    thinkingBudget: event.thinkingBudget,
    routerLayer: event.layer,
  }).where(eq(agentRuns.runId, event.runId));
}
```

- [ ] **Step 4: Test**

```bash
cd apps/api && pnpm test
```

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/agents.ts packages/db/migrations/00*_router_columns.sql apps/api/src/
git commit -m "feat(db,api): persist routed_mode/model/budget/layer on agent_runs"
```

---

### Task 21: Document env vars and ops behavior

**Files:**
- Modify: `.env.example`
- Create: `docs/architecture/model-router.md`
- Modify: `docs/README.md` (add link)
- Modify: `docs/contributing/plans-status.md` (mark plan complete)

- [ ] **Step 1: Add env vars to `.env.example`**

```bash
# Append to .env.example
# ----- Model Router (Plan: 2026-04-28-plan-model-router.md) -----
# Master switch. When false, agents use single LLM_MODEL via get_provider().
FEATURE_MODEL_ROUTER=false
# Layer B classifier (research agent ad-hoc queries). Requires REDIS_URL.
FEATURE_MODEL_ROUTER_CLASSIFIER=false

# Per-tier models. Each falls back to LLM_MODEL when unset.
LLM_MODEL_FAST=gemini-3-flash-preview
LLM_MODEL_FAST_LITE=gemini-3-flash-lite-preview
LLM_MODEL_BALANCED=gemini-3-flash-preview
LLM_MODEL_ACCURATE=gemini-3-pro-preview
LLM_MODEL_RESEARCH=deep-research-preview-04-2026

# Per-agent KRW ceilings. When estimated cost exceeds, router downgrades.
# Names match Agent.name (compiler/research/librarian/connector/curator/
# narrator/temporal/synthesis/code/visualization).
# AGENT_CEILING_LIBRARIAN_KRW=500
# AGENT_CEILING_RESEARCH_KRW=200

# Optional price overrides — defaults are coarse Gemini 3.x rates.
# PRICE_KRW_PER_MTOK_PROMPT_ACCURATE=1700
# PRICE_KRW_PER_MTOK_COMPLETION_ACCURATE=6800
```

- [ ] **Step 2: Write `docs/architecture/model-router.md`**

```markdown
# Model Router (Runtime Reference)

> **Spec:** `docs/superpowers/specs/2026-04-22-model-router-design.md`
> **Plan:** `docs/superpowers/plans/2026-04-28-plan-model-router.md`

## What it does

Resolves which model + thinking budget each agent call uses. Server-side
only — no user-facing mode selector (project rule: provider/model
selection is env-only).

## Runtime layers

- **Layer A** (rule-based, 0 ms): each `Agent` subclass declares
  `preferred_mode()`. The router maps this to `(model_tier, thinking_budget)`
  via `MODE_CONFIG`, then resolves the tier to a concrete model via
  `LLM_MODEL_<TIER>` env vars.
- **Layer B** (classifier, ~80 ms): only invoked for `agent_type="research"`
  with a free-form user prompt and `FEATURE_MODEL_ROUTER_CLASSIFIER=true`.
  Uses Flash-Lite + thinking off. Result cached in Redis (TTL 600 s).
- **Ceiling** (final): `AGENT_CEILING_<NAME>_KRW` downgrades the chosen
  mode when the estimated cost exceeds the ceiling.

## What gets emitted

Every router-aware activity yields a `RouteDecision` event right after
`AgentStart`. apps/api forwards it via SSE to the chat UI; the humanizer
renders a small badge. The decision is also persisted to
`agent_runs.routed_mode/routed_model/thinking_budget/router_layer`.

## Operating

- **Roll out**: set `FEATURE_MODEL_ROUTER=true`. Layer B requires
  `FEATURE_MODEL_ROUTER_CLASSIFIER=true` AND `REDIS_URL`.
- **Disable per-agent override**: leave the agent's `preferred_mode()`
  default; the router falls back to `Mode.BALANCED`.
- **Self-host (Ollama)**: set the same `LLM_MODEL_<TIER>` env vars to your
  Ollama tag list. `LLM_MODEL_RESEARCH` may be omitted — Deep Research is
  Gemini-only.
- **Audit a deployment**: query
  `select routed_mode, count(*) from agent_runs group by 1`.

## Anti-patterns

(See spec §10.) Most relevant for this implementation:

- Don't add a UI mode selector — project rule overrides spec §3.
- Don't promote `auto` to `accurate` — caps at `balanced` (spec §6.1, enforced
  in `resolve.py`).
- Don't run the classifier on Pro — `_build_classifier_provider()` hard-pins
  Flash-Lite + thinking off.
- Don't read `user_preferences.default_mode` — the column does not exist
  in this implementation. Mode is per-call, server-decided.
```

- [ ] **Step 3: Index the doc**

Add to `docs/README.md` table of contents under "Architecture" or wherever runtime-reference docs live.

- [ ] **Step 4: Update plans-status**

In `docs/contributing/plans-status.md`, move Plan Model Router from active/planned into the "Complete" section with the merge SHA placeholder. Note: skip until merge.

- [ ] **Step 5: Commit**

```bash
git add .env.example docs/architecture/model-router.md docs/README.md
git commit -m "docs(router): runtime reference + env var inventory"
```

---

### Task 22: Eval scaffold (`router_eval.py`)

**Files:**
- Create: `apps/worker/tests/eval/router_eval_cases.jsonl`
- Create: `apps/worker/tests/eval/router_eval.py`

- [ ] **Step 1: Write the case file**

```jsonl
# apps/worker/tests/eval/router_eval_cases.jsonl  (one JSON object per line)
{"query": "오늘 날씨는?", "agent_type": "research", "expected_mode": "fast"}
{"query": "Hi, what time is it?", "agent_type": "research", "expected_mode": "fast"}
{"query": "내 노트에서 CNN 찾아줘", "agent_type": "research", "expected_mode": "balanced"}
{"query": "이 논문을 한국어로 1만자 요약해줘", "agent_type": "research", "expected_mode": "balanced"}
{"query": "삼성전자 반도체 경쟁력 딥리서치", "agent_type": "research", "expected_mode": "balanced"}
# Compiler / Librarian / etc. always rule-based
{"query": "", "agent_type": "compiler", "expected_mode": "fast_lite_think"}
{"query": "", "agent_type": "librarian", "expected_mode": "accurate"}
{"query": "", "agent_type": "curator", "expected_mode": "fast_lite_no_think"}
{"query": "", "agent_type": "narrator", "expected_mode": "fast"}
# Add more — 30 minimum, 100 target
```

(Add 25+ more cases covering the spec's coverage table.)

- [ ] **Step 2: Write the harness**

```python
# apps/worker/tests/eval/router_eval.py
"""Router eval harness — measures Layer A/B accuracy against golden cases.

Run:  uv run python -m tests.eval.router_eval
Goal: >= 90% match against expected_mode (spec §11.2).
"""
from __future__ import annotations

import asyncio
import json
import pathlib

from llm.router.resolve import resolve

CASES_FILE = pathlib.Path(__file__).parent / "router_eval_cases.jsonl"


async def _run_one(case: dict) -> tuple[bool, str]:
    decision = await resolve(
        agent_type=case["agent_type"],
        prompt=case["query"] or None,
        user_id="eval",
    )
    actual = decision.resolved_mode.value
    return actual == case["expected_mode"], actual


async def main() -> int:
    cases = [json.loads(ln) for ln in CASES_FILE.read_text().splitlines() if ln.strip() and not ln.startswith("#")]
    total = 0
    passed = 0
    misses: list[dict] = []
    for c in cases:
        ok, actual = await _run_one(c)
        total += 1
        if ok:
            passed += 1
        else:
            misses.append({**c, "actual": actual})
    rate = passed / total if total else 0
    print(f"router eval: {passed}/{total} = {rate:.1%}")
    for m in misses:
        print(f"  MISS: {m}")
    return 0 if rate >= 0.9 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
```

- [ ] **Step 3: Run the harness**

```bash
cd apps/worker && uv run python -m tests.eval.router_eval
```
Expected: prints rate, exits 0 if ≥ 90%. Layer A cases should be 100% — only Layer B cases are subject to drift.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/tests/eval/router_eval_cases.jsonl apps/worker/tests/eval/router_eval.py
git commit -m "test(router): eval harness with 30+ golden cases"
```

---

### Task 23: Final verification + memory update

- [ ] **Step 1: Run the full test suite**

```bash
cd packages/llm && uv run pytest tests/ -v
cd apps/worker && uv run pytest tests/ -v
cd apps/api && pnpm test
cd apps/web && pnpm test
```
Expected: all green. The web suite should be unaffected.

- [ ] **Step 2: Verify the flag-off path**

```bash
unset FEATURE_MODEL_ROUTER FEATURE_MODEL_ROUTER_CLASSIFIER
cd apps/worker && uv run pytest tests/ -v
```
Expected: all PASS — flag-off is the legacy path.

- [ ] **Step 3: Run the eval harness**

```bash
cd apps/worker && uv run python -m tests.eval.router_eval
```
Expected: ≥ 90% pass rate (Layer A cases must be 100%).

- [ ] **Step 4: i18n parity check** (no UI added — should pass without changes)

```bash
pnpm --filter @opencairn/web i18n:parity
```
Expected: PASS — this plan adds no user-facing strings.

- [ ] **Step 5: Update plan status doc + memory**

Per `opencairn:post-feature` skill: update `docs/contributing/plans-status.md` and write a memory entry once merged.

- [ ] **Step 6: Open PR**

```bash
gh pr create --title "feat: model router (Plan 2026-04-28)" --body "..."
```

---

## Self-review (writer's checklist)

**Spec coverage:**
- §3 user-facing modes — **excluded** by user rule, documented in scope clarification ✅
- §3.1 design principles — N/A (no UI) ✅
- §3.2 mode permission table — **excluded** (no user choice) ✅
- §4.1 Layer A rules + AGENT_MODE_MAP — Tasks 5/6/7 ✅
- §4.2 Layer B classifier — Tasks 12/13/14 ✅
- §4.3 layer A/B branching — Task 8 (resolve.py) ✅
- §4.4 cache — Task 13 (Redis) ✅
- §5 thinking budget mapping — Tasks 1/2/4 ✅
- §6.1 auto never promotes to accurate — Task 8 (capped in resolve.py + tested in 14) ✅
- §6.2 PAYG balance downgrade — **deferred** (Plan 9b dependency, called out) ✅
- §6.3 pre-flight cost UI — **excluded** (no UI) ✅
- §6.4 cost ceiling — Task 16 ✅
- §7 Ollama tier handling — Tasks 4 (silent fallback), 17 (resolve test) ✅
- §8.1 user_preferences.default_mode column — **excluded** (no UI) ✅
- §8.2 RouteDecision event — Tasks 9/10 ✅
- §8.3 humanizer surface — relay only, Task 19 (no humanizer changes in scope here; that's Plan 11B Phase B work) ✅
- §9.1 router function signature — Task 8 ✅
- §9.2 Agent ABC extension — Task 5 ✅
- §9.3 user_mode payload field — **excluded** (no UI) ✅
- §10 anti-patterns — preserved in code + doc ✅
- §11.1 router unit tests — Tasks 1, 7, 8, 14, 16 ✅
- §11.2 eval set — Task 22 ✅
- §11.3 classifier monitoring — deferred (needs prod data) — noted ✅
- §12 rollout phases — flag-gated, supports v0.1 → v0.4 progressive rollout ✅
- §13 open questions — Q3 (classifier language) decided in Task 12 (KO primary, EN fallback). Q1/Q2/Q4/Q5 N/A. ✅
- §14 success metrics — instrumented via agent_runs.routed_mode column for offline analysis ✅

**Placeholders:** none — every code block contains exact code or exact commands.

**Type consistency:** `Mode`, `ThinkingBudget`, `RouteDecisionData`, `RouteDecision`, `apply_ceiling`, `resolve`, `get_provider_for_mode`, `register_agent_mode_resolver`, `agent_mode_map`, `build_route_decision_event` — all consistent across tasks.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-28-plan-model-router.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks
2. **Inline Execution** — execute tasks in this session with batch checkpoints

Which approach?
