"""`emit_structured_output` tool — structured answer submission."""
from __future__ import annotations

from pydantic import ValidationError

from runtime.tools import ToolContext, tool

from .schema_registry import SCHEMA_REGISTRY


@tool(name="emit_structured_output")
async def emit_structured_output(
    schema_name: str,
    data: dict,
    ctx: ToolContext,
) -> dict:
    """Submit your final answer as a structured object matching one of
    the registered schemas. The loop ends when a valid schema is
    accepted. If validation fails, fix the errors and retry.
    """
    model = SCHEMA_REGISTRY.get(schema_name)
    if model is None:
        return {
            "accepted": False,
            "errors": [
                f"Schema '{schema_name}' is not registered. "
                f"Available: {sorted(SCHEMA_REGISTRY.keys())}"
            ],
        }
    try:
        validated = model.model_validate(data)
    except ValidationError as e:
        return {"accepted": False, "errors": [str(err) for err in e.errors()]}
    return {"accepted": True, "validated": validated.model_dump()}
