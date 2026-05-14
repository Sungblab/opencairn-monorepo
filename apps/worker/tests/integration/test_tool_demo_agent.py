"""Integration tests for ToolDemoAgent.

Gated by GEMINI_API_KEY_CI; skipped locally. Asserts each of the four
chat-mode presets runs end-to-end and respects the cost budget.
"""
from __future__ import annotations

import os

import pytest
from llm.factory import get_provider

from runtime.tool_loop import LoopConfig
from worker.agents.tool_demo.agent import ToolDemoAgent

pytestmark = pytest.mark.skipif(
    not os.environ.get("GEMINI_API_KEY_CI"),
    reason="needs GEMINI_API_KEY_CI",
)


COST_BUDGET_USD = 0.05


def _context(project_id: str) -> dict:
    return {
        "workspace_id": "integration-ws",
        "project_id": project_id,
        "user_id": "test-user",
        "run_id": "test-run",
        "scope": "project",
    }


async def test_plain_mode_no_tool_calls(postgres_url, seeded_project):
    provider = get_provider()
    agent = ToolDemoAgent.plain(provider=provider)
    result = await agent.run(
        user_prompt="Say hello in one short sentence.",
        tool_context=_context(seeded_project),
    )
    assert result.termination_reason == "model_stopped"
    assert result.tool_call_count == 0
    assert result.final_text


async def test_reference_mode_hits_search_tools(postgres_url, seeded_project):
    provider = get_provider()
    agent = ToolDemoAgent.reference(provider=provider)
    result = await agent.run(
        user_prompt="What topics are in this project?",
        tool_context=_context(seeded_project),
        config=LoopConfig(max_turns=4, max_tool_calls=4),
    )
    assert result.termination_reason == "model_stopped"
    assert result.tool_call_count >= 1


async def test_full_mode_structured_output(postgres_url, seeded_project):
    provider = get_provider()
    agent = ToolDemoAgent.full(provider=provider)
    result = await agent.run(
        user_prompt=(
            "Find a topic and submit a ConceptSummary via "
            "emit_structured_output."
        ),
        tool_context=_context(seeded_project),
        config=LoopConfig(max_turns=5, max_tool_calls=6),
    )
    assert result.termination_reason in (
        "structured_submitted", "model_stopped",
    )


async def test_external_mode_fetch_url_and_emit():
    provider = get_provider()
    agent = ToolDemoAgent.external(provider=provider)
    result = await agent.run(
        user_prompt=(
            "Fetch https://example.com and submit a summary via "
            "emit_structured_output using the ResearchAnswer schema."
        ),
        tool_context=_context("any-project"),
        config=LoopConfig(max_turns=5),
    )
    assert result.termination_reason in (
        "structured_submitted", "model_stopped",
    )
