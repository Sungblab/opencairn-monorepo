"""Prompt strings for the Research agent.

Kept in a separate module so evaluation harnesses can diff prompt revisions
without touching the agent wiring. All prompts ask for strict JSON back —
the agent's parser is tolerant but the prompt stays unambiguous.
"""

DECOMPOSE_SYSTEM = """\
You break a user's research question into 1-4 focused, non-overlapping
sub-queries that together fully answer the original. Keep them short and
concrete — each sub-query should be searchable on its own against a
knowledge base of source notes.

Return a JSON object shaped exactly:
  {"sub_queries": ["...", "...", ...]}

Do not include any commentary outside the JSON object.
"""

ANSWER_SYSTEM = """\
You are a careful research assistant with access to a set of source notes.
Answer the user's question using ONLY the evidence provided. When a
statement is supported by a note, cite it inline as [[note-id]] where
note-id is the note id you were given. Do not invent notes. If the
evidence is insufficient, say so explicitly.

Write in the user's language. Keep the answer concise but complete; avoid
repeating boilerplate. Do not wrap the answer in JSON or markdown code
fences — return plain prose.
"""

WIKI_FEEDBACK_SYSTEM = """\
After answering the question, scan the evidence notes and flag at most 3
that have material issues: outdated facts, missing context, or
contradictions that surfaced during the answer.

Return a JSON object shaped exactly:
  {"feedback": [{"note_id": "...", "suggestion": "...", "reason": "..."}]}

If nothing is worth flagging, return {"feedback": []}. Do not include any
commentary outside the JSON object.
"""


def build_decompose_prompt(query: str) -> str:
    return f"User question:\n{query}\n\nJSON response:"


def build_answer_prompt(query: str, evidence_block: str) -> str:
    return (
        f"User question:\n{query}\n\n"
        f"Evidence notes (cite by [[note-id]]):\n{evidence_block}\n\n"
        "Answer:"
    )


def build_wiki_feedback_prompt(
    *, query: str, answer: str, evidence_block: str
) -> str:
    return (
        f"User question:\n{query}\n\n"
        f"Your answer:\n{answer}\n\n"
        f"Evidence notes:\n{evidence_block}\n\n"
        "JSON response:"
    )


def format_evidence_block(
    citations: list[dict[str, str]], max_chars: int = 6000
) -> str:
    """Render evidence into a bounded block for the answer prompt. Each note
    is labelled with its id so the LLM can cite back. We truncate the total
    to ``max_chars`` to keep prompt size bounded — RRF already sorted the
    most relevant ones to the front, so truncation drops the weakest hits.
    """
    parts: list[str] = []
    used = 0
    for c in citations:
        note_id = c.get("noteId") or c.get("id", "")
        title = c.get("title", "Untitled")
        snippet = c.get("snippet", "")
        chunk = f"[[{note_id}]] {title}\n{snippet}\n"
        if used + len(chunk) > max_chars and parts:
            break
        parts.append(chunk)
        used += len(chunk)
    return "\n".join(parts) if parts else "(no evidence retrieved)"
