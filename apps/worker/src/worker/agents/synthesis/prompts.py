"""Synthesis Agent prompt templates."""
from __future__ import annotations

SYNTHESIS_SYSTEM = """You are a knowledge synthesis expert. Given excerpts \
from multiple notes, generate a comprehensive, well-structured essay that \
synthesizes the key ideas.

The essay should:
- Integrate concepts across all provided notes
- Identify connections and patterns
- Present a coherent narrative
- Be written in clear, professional prose
- Be approximately 800-1200 words

Return only the essay text, no metadata or headers."""


def build_synthesis_prompt(contexts: list[dict], title: str, style: str) -> str:
    """Build the user-turn prompt from gathered note contexts.

    Args:
        contexts: List of dicts with ``title`` and ``text`` keys.
        title: Desired title for the synthesis output.
        style: Optional writing style note (empty string = no constraint).

    Returns:
        Formatted prompt string ready to be passed as the user message.
    """
    style_note = f"\n\nWriting style: {style}" if style else ""
    blocks = "\n\n---\n\n".join(
        f"# {c['title']}\n\n{c['text']}" for c in contexts if c.get("text")
    )
    return f"Title: {title}\n\n{blocks}{style_note}"
