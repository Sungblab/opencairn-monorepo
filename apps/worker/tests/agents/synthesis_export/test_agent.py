import pytest
from unittest.mock import AsyncMock, MagicMock

from llm.tool_types import AssistantTurn, ToolUse, UsageCounts

from worker.agents.synthesis_export.agent import (
    SynthesisExportAgent,
    SynthesisExportContext,
    _OUTPUT_TOOL,
)


@pytest.mark.asyncio
async def test_returns_structured_output_when_tool_called():
    provider = MagicMock()
    provider.generate_with_tools = AsyncMock(
        return_value=AssistantTurn(
            final_text=None,
            tool_uses=(
                ToolUse(
                    id="t1",
                    name="emit_structured_output",
                    args={
                        "schema_name": "SynthesisOutputSchema",
                        "data": {
                            "format": "md",
                            "title": "Test Doc",
                            "abstract": None,
                            "sections": [
                                {"title": "S1", "content": "body", "source_ids": []}
                            ],
                            "bibliography": [],
                            "template": "report",
                        },
                    },
                ),
            ),
            assistant_message=None,
            usage=UsageCounts(input_tokens=100, output_tokens=50),
            stop_reason="tool_use",
        )
    )
    agent = SynthesisExportAgent(llm=provider)
    ctx = SynthesisExportContext(
        sources_text="(no sources)",
        workspace_notes="",
        user_prompt="write me a markdown doc",
        format="md",
        template="report",
    )
    out, usage = await agent.run(ctx)
    assert out.format == "md"
    assert out.title == "Test Doc"
    assert usage.input_tokens == 100
    provider.generate_with_tools.assert_awaited_once()


def test_structured_output_tool_schema_requires_nested_document_fields():
    schema = _OUTPUT_TOOL.input_schema()
    data_schema = schema["properties"]["data"]
    assert data_schema["required"] == ["format", "title", "sections", "template"]
    assert data_schema["properties"]["format"]["enum"] == ["latex", "docx", "pdf", "md"]
    section_schema = data_schema["properties"]["sections"]["items"]
    assert section_schema["required"] == ["title", "content", "source_ids"]
    assert data_schema["properties"]["template"]["enum"] == [
        "ieee",
        "acm",
        "apa",
        "korean_thesis",
        "report",
    ]


@pytest.mark.asyncio
async def test_raises_clear_error_when_tool_data_missing():
    provider = MagicMock()
    provider.generate_with_tools = AsyncMock(
        return_value=AssistantTurn(
            final_text=None,
            tool_uses=(
                ToolUse(
                    id="t1",
                    name="emit_structured_output",
                    args={"schema_name": "SynthesisOutputSchema"},
                ),
            ),
            assistant_message=None,
            usage=UsageCounts(input_tokens=10, output_tokens=5),
            stop_reason="tool_use",
        )
    )
    agent = SynthesisExportAgent(llm=provider)
    ctx = SynthesisExportContext(
        sources_text="",
        workspace_notes="",
        user_prompt="x",
        format="md",
        template="report",
    )
    with pytest.raises(RuntimeError, match="malformed structured output"):
        await agent.run(ctx)


@pytest.mark.asyncio
async def test_raises_when_tool_not_called():
    provider = MagicMock()
    provider.generate_with_tools = AsyncMock(
        return_value=AssistantTurn(
            final_text="I refuse",
            tool_uses=(),
            assistant_message=None,
            usage=UsageCounts(input_tokens=10, output_tokens=5),
            stop_reason="stop",
        )
    )
    agent = SynthesisExportAgent(llm=provider)
    ctx = SynthesisExportContext(
        sources_text="",
        workspace_notes="",
        user_prompt="x",
        format="md",
        template="report",
    )
    with pytest.raises(RuntimeError, match="emit_structured_output"):
        await agent.run(ctx)
