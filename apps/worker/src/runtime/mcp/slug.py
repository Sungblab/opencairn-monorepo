from __future__ import annotations

import re

SLUG_PATTERN = re.compile(r"^[a-z0-9_]{1,32}$")


def is_valid_slug(value: str) -> bool:
    return bool(SLUG_PATTERN.fullmatch(value))


def slugify_display_name(display_name: str, taken: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", display_name.strip().lower())
    base = base.strip("_")[:32].rstrip("_") or "mcp"
    if base not in taken:
        return base
    for i in range(2, 10_000):
        suffix = f"_{i}"
        candidate = f"{base[:32 - len(suffix)]}{suffix}"
        if candidate not in taken:
            return candidate
    raise ValueError("Unable to allocate MCP server slug")
