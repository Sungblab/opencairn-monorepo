"""Socratic Agent activities — Plan 6.

Two one-shot LLM activities:
  - ``generate_questions``: produce Socratic questions for a concept.
  - ``evaluate_answer``: score and give feedback on a user's answer.

Both use ``get_provider().generate()`` with a JSON-structured prompt.
The LLM is asked to return JSON and the response is parsed; markdown
code-fences are stripped before parsing so the output is robust to
models that wrap JSON in triple-backtick json blocks.
"""
from __future__ import annotations

import json
import re
from typing import Any

from temporalio import activity

from llm.factory import get_provider

_GENERATE_SYSTEM = (
    "You are a Socratic tutor. Generate 2-4 questions to test a student's "
    "understanding of the concept below. Mix difficulty levels. Questions "
    "should probe reasoning, not just recall. "
    "Respond ONLY with valid JSON matching:\n"
    '{"questions": [{"text": str, "hint": str|null, "difficulty": "easy"|"medium"|"hard"}]}'
)

_EVALUATE_SYSTEM = (
    "You are a Socratic tutor evaluating a student's answer. "
    "Respond ONLY with valid JSON matching:\n"
    '{"score": int 0-100, "is_correct": bool, '
    '"feedback": str, "should_create_flashcard": bool}\n'
    "Set should_create_flashcard=true when score < 70."
)


def _parse_json(raw: str) -> dict[str, Any]:
    stripped = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE)
    return json.loads(stripped.strip())


@activity.defn(name="socratic_generate")
async def generate_questions(req: dict[str, Any]) -> dict[str, Any]:
    """Generate Socratic questions for a concept."""
    concept_name = req["conceptName"]
    note_context = req.get("noteContext", "")
    user_prompt = (
        f"Concept: {concept_name}\n\n"
        f"Student's notes (for context):\n{note_context[:3000]}"
    )
    provider = get_provider()
    raw = await provider.generate(
        [
            {"role": "user", "content": _GENERATE_SYSTEM + "\n\n" + user_prompt},
        ],
        max_output_tokens=1024,
    )
    return _parse_json(raw)


@activity.defn(name="socratic_evaluate")
async def evaluate_answer(req: dict[str, Any]) -> dict[str, Any]:
    """Evaluate a student's answer to a Socratic question."""
    concept_name = req["conceptName"]
    question = req["question"]
    user_answer = req["userAnswer"]
    note_context = req.get("noteContext", "")
    user_prompt = (
        f"Concept: {concept_name}\n"
        f"Question: {question}\n"
        f"Student's answer: {user_answer}\n\n"
        f"Reference context:\n{note_context[:1500]}"
    )
    provider = get_provider()
    raw = await provider.generate(
        [
            {"role": "user", "content": _EVALUATE_SYSTEM + "\n\n" + user_prompt},
        ],
        max_output_tokens=512,
    )
    return _parse_json(raw)
