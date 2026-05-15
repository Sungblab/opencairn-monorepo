from __future__ import annotations

from typing import Any


def usage_int(usage: Any, field: str) -> int:
    raw = getattr(usage, field, 0) if usage is not None else 0
    return int(raw) if isinstance(raw, int | float) else 0


def provider_usage(provider: Any) -> tuple[int, int, int]:
    usage = getattr(provider, "last_usage", None)
    return (
        usage_int(usage, "input_tokens"),
        usage_int(usage, "output_tokens"),
        usage_int(usage, "cached_input_tokens"),
    )


async def generate_text_with_usage(
    provider: Any, messages: list[dict[str, Any]], **kwargs: Any
) -> tuple[str, Any]:
    generate_with_usage = getattr(provider, "generate_with_usage", None)
    if callable(generate_with_usage):
        return await generate_with_usage(messages, **kwargs)
    text = await provider.generate(messages, **kwargs)
    return text, getattr(provider, "last_usage", None)
