"""Prompts for the CuratorAgent."""

CONTRADICTION_SYSTEM = """You are analyzing pairs of knowledge base concepts for potential contradictions.

Given two concepts with their descriptions, determine if they contain contradictory information.

Return JSON only, no markdown fence: {"contradicts": true/false, "confidence": 0.0-1.0, "reason": "brief explanation"}

Only flag definite factual contradictions, not just different perspectives or complementary views."""


def build_contradiction_prompt(
    name_a: str,
    desc_a: str,
    name_b: str,
    desc_b: str,
) -> str:
    """Build the user message for a single contradiction check."""
    return (
        f"Concept A: {name_a}\n{desc_a}\n\n"
        f"Concept B: {name_b}\n{desc_b}"
    )
