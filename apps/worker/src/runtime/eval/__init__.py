"""Eval framework — trajectory-based agent tests."""
from runtime.eval.case import EvalCase, ExpectedHandoff, ExpectedToolCall
from runtime.eval.loader import load_case_file, load_cases
from runtime.eval.metrics import ScoreResult, score_trajectory
from runtime.eval.runner import DEFAULT_CRITERIA, AgentEvaluator, EvalResult

__all__ = [
    "AgentEvaluator",
    "DEFAULT_CRITERIA",
    "EvalCase",
    "EvalResult",
    "ExpectedHandoff",
    "ExpectedToolCall",
    "ScoreResult",
    "load_case_file",
    "load_cases",
    "score_trajectory",
]
