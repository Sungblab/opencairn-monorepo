"""Prompts for the StalenessAgent."""
from __future__ import annotations

STALENESS_SYSTEM = """You are evaluating whether a wiki note in a knowledge base is still accurate and up-to-date.

Given a note's title and content, score how likely it is to be outdated (0.0 = definitely current, 1.0 = very likely outdated).

Consider:
- Mentions of specific versions, dates, or time-sensitive information
- References to "current" or "latest" features
- Technical details that evolve quickly

Return JSON: {"score": 0.0-1.0, "reason": "brief explanation"}"""


def build_staleness_prompt(title: str, content: str, days_old: int) -> str:
    snippet = content[:1000] if content else "(no content)"
    return f"Note: {title}\nLast updated: {days_old} days ago\n\nContent:\n{snippet}"
