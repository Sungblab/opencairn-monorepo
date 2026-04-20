"""Research agent package.

Answers a user query by running hybrid search over the project's source notes,
drafting an answer with citations, and emitting wiki-feedback suggestions for
notes that look stale or incomplete.
"""
from worker.agents.research.agent import (
    ResearchAgent,
    ResearchCitation,
    ResearchInput,
    ResearchOutput,
    ResearchWikiFeedback,
)

__all__ = [
    "ResearchAgent",
    "ResearchCitation",
    "ResearchInput",
    "ResearchOutput",
    "ResearchWikiFeedback",
]
