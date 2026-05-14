"""Narrator Agent prompts.

SCRIPT_SYSTEM — system prompt for 2-speaker podcast script generation.
build_script_prompt — assembles the user-turn from a note's title + content.
"""
from __future__ import annotations

SCRIPT_SYSTEM = """You are a podcast script writer. Given a wiki note's content, \
generate a natural 2-speaker dialogue between Host and Guest that explains and \
discusses the topic.

Requirements:
- Host introduces the topic and asks probing questions
- Guest explains concepts clearly with examples
- Style: {style}
- Length: approximately 10 turns per speaker
- Return JSON array: [{{"speaker": "host" | "guest", "text": "..."}}, ...]

Return ONLY the JSON array, no markdown wrapper."""


def build_script_prompt(title: str, content: str, style: str) -> str:
    """Build the user-turn message for script generation.

    Clips content to 2000 chars so the full prompt stays within typical
    context budgets.  The style token is embedded in the system prompt, so
    the user turn is purely factual (title + content).
    """
    snippet = content[:2000] if content else "(no content)"
    return f"Title: {title}\n\nContent:\n{snippet}\n\nGenerate a {style} podcast dialogue."


def _script_to_text(script: list[dict]) -> str:
    """Convert a parsed script to a single string suitable for TTS synthesis.

    Each turn is prefixed with the capitalised speaker name so the TTS model
    can distinguish the two voices.
    """
    return "\n".join(
        f"{turn['speaker'].title()}: {turn['text']}" for turn in script
    )
