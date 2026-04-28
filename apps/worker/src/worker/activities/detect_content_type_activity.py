"""Spec B — classify an ingested document into one of 7 content types.

Returns ``{"content_type", "confidence", "used_llm"}``. Signals come from
mime type + first/last/middle page heuristics; an LLM is only consulted
when heuristic confidence is < 0.7 (typical: paper-vs-book conflict).
"""

from __future__ import annotations

import os
import re

from temporalio import activity

from llm import get_provider
from llm.base import ProviderConfig

CONTENT_TYPES = frozenset(
    {"document", "paper", "slide", "book", "code", "table", "image"}
)

SLIDE_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
CODE_MIMES = frozenset({"text/x-python", "application/x-ipynb+json"})

_PAPER_RE = re.compile(r"\b(abstract|keywords?|doi|arxiv|journal)\b", re.IGNORECASE)
_TOC_RE = re.compile(r"\b(table of contents|목차|contents)\b", re.IGNORECASE)


def _heuristic(mime: str, pages: list[dict]) -> tuple[str, float]:
    """Return (content_type, confidence). Confidence < 0.7 → LLM fallback."""
    if mime == SLIDE_MIME:
        return "slide", 1.0
    if mime in CODE_MIMES:
        return "code", 1.0
    if mime.startswith("image/"):
        return "image", 1.0

    total = len(pages)
    first_3_text = " ".join((p.get("text") or "") for p in pages[:3])

    paper_hits = len(_PAPER_RE.findall(first_3_text))
    paper_signal = paper_hits >= 2

    first_10_text = " ".join((p.get("text") or "") for p in pages[:10])
    book_signal = total > 80 and bool(_TOC_RE.search(first_10_text))

    table_count = sum(1 for p in pages if p.get("tables"))
    table_signal = (table_count / total) >= 0.6 if total > 0 else False

    signals: list[tuple[str, float]] = []
    if paper_signal:
        signals.append(("paper", 0.92))
    if book_signal:
        signals.append(("book", 0.88))
    if table_signal:
        signals.append(("table", 0.85))

    if len(signals) == 1:
        return signals[0]
    if len(signals) > 1:
        # conflicting signals → defer to LLM
        return signals[0][0], 0.45

    return "document", 0.75


@activity.defn(name="detect_content_type")
async def detect_content_type(inp: dict) -> dict:
    mime: str = inp.get("mime_type", "")
    pages: list[dict] = inp.get("parsed_pages", [])

    content_type, confidence = _heuristic(mime, pages)
    used_llm = False

    if confidence < 0.7:
        if activity.in_activity():
            activity.heartbeat("LLM fallback for content type classification")
        first_3_text = " ".join((p.get("text") or "") for p in pages[:3])[:3000]
        cfg = ProviderConfig(
            provider=os.environ.get("LLM_PROVIDER", "gemini"),
            api_key=os.environ.get("LLM_API_KEY"),
            model=os.environ.get(
                "LLM_FLASH_LITE_MODEL", "gemini-3.1-flash-lite-preview"
            ),
        )
        provider = get_provider(cfg)
        prompt = (
            "Classify this document. Reply with exactly one word:\n"
            "paper | slide | book | code | table | document\n---\n"
            + first_3_text
        )
        raw = (
            await provider.generate([{"role": "user", "content": prompt}])
        ).strip().lower()
        content_type = raw if raw in CONTENT_TYPES else "document"
        used_llm = True

    if activity.in_activity():
        activity.logger.info(
            "content_type=%s confidence=%.2f used_llm=%s",
            content_type,
            confidence,
            used_llm,
        )
    return {
        "content_type": content_type,
        "confidence": confidence,
        "used_llm": used_llm,
    }
