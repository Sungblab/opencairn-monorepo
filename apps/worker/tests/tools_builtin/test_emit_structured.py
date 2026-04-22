from __future__ import annotations

from pydantic import BaseModel

from runtime.tools import ToolContext
from worker.tools_builtin.emit_structured_output import emit_structured_output
from worker.tools_builtin.schema_registry import SCHEMA_REGISTRY, register_schema


class _DemoSchema(BaseModel):
    title: str
    score: int


def _ctx() -> ToolContext:
    async def _emit(_ev): ...
    return ToolContext(
        workspace_id="ws", project_id="pj", page_id=None,
        user_id="u", run_id="r", scope="project",
        emit=_emit,
    )


def test_register_schema():
    register_schema("DemoSchema", _DemoSchema)
    assert SCHEMA_REGISTRY["DemoSchema"] is _DemoSchema


async def test_emit_valid():
    register_schema("DemoSchema", _DemoSchema)
    res = await emit_structured_output.run(
        args={"schema_name": "DemoSchema", "data": {"title": "x", "score": 3}},
        ctx=_ctx(),
    )
    assert res["accepted"] is True
    assert res["validated"] == {"title": "x", "score": 3}


async def test_emit_invalid_returns_errors():
    register_schema("DemoSchema", _DemoSchema)
    res = await emit_structured_output.run(
        args={"schema_name": "DemoSchema", "data": {"title": "x"}},
        ctx=_ctx(),
    )
    assert res["accepted"] is False
    assert "score" in str(res["errors"])


async def test_emit_unregistered_schema_returns_error():
    res = await emit_structured_output.run(
        args={"schema_name": "UnknownSchema", "data": {}},
        ctx=_ctx(),
    )
    assert res["accepted"] is False
    assert "not registered" in res["errors"][0].lower()
