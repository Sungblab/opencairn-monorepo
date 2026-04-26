"""Tests for socratic_activity: generate_questions and evaluate_answer."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from worker.activities.socratic_activity import evaluate_answer, generate_questions

QUESTIONS_JSON = json.dumps({
    "questions": [
        {"text": "What is closure?", "hint": "Think about scope", "difficulty": "medium"},
        {"text": "Explain hoisting", "hint": None, "difficulty": "easy"},
    ]
})

EVAL_JSON = json.dumps({
    "score": 75,
    "is_correct": True,
    "feedback": "Good understanding, but missed lexical scope detail.",
    "should_create_flashcard": False,
})


@pytest.mark.asyncio
async def test_generate_questions_returns_list():
    with patch(
        "worker.activities.socratic_activity.get_provider",
        return_value=MagicMock(generate=AsyncMock(return_value=QUESTIONS_JSON)),
    ):
        result = await generate_questions({
            "conceptName": "JavaScript Closures",
            "noteContext": "A closure is a function...",
        })
    assert "questions" in result
    assert len(result["questions"]) == 2
    assert result["questions"][0]["text"] == "What is closure?"
    assert result["questions"][0]["difficulty"] == "medium"


@pytest.mark.asyncio
async def test_generate_questions_strips_code_fences():
    fenced = f"```json\n{QUESTIONS_JSON}\n```"
    with patch(
        "worker.activities.socratic_activity.get_provider",
        return_value=MagicMock(generate=AsyncMock(return_value=fenced)),
    ):
        result = await generate_questions({
            "conceptName": "Closures",
            "noteContext": "...",
        })
    assert "questions" in result


@pytest.mark.asyncio
async def test_evaluate_answer_returns_score_and_feedback():
    with patch(
        "worker.activities.socratic_activity.get_provider",
        return_value=MagicMock(generate=AsyncMock(return_value=EVAL_JSON)),
    ):
        result = await evaluate_answer({
            "conceptName": "JavaScript Closures",
            "question": "What is closure?",
            "userAnswer": "A function with access to outer scope",
            "noteContext": "...",
        })
    assert result["score"] == 75
    assert result["is_correct"] is True
    assert "feedback" in result
    assert result["should_create_flashcard"] is False


@pytest.mark.asyncio
async def test_evaluate_answer_low_score_triggers_flashcard():
    low_score = json.dumps({
        "score": 20,
        "is_correct": False,
        "feedback": "Incorrect.",
        "should_create_flashcard": True,
    })
    with patch(
        "worker.activities.socratic_activity.get_provider",
        return_value=MagicMock(generate=AsyncMock(return_value=low_score)),
    ):
        result = await evaluate_answer({
            "conceptName": "Closures",
            "question": "Q",
            "userAnswer": "wrong",
            "noteContext": "...",
        })
    assert result["should_create_flashcard"] is True
    assert result["score"] == 20
