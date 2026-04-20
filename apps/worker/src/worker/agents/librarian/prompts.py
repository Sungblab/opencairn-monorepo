"""Prompts used by the Librarian agent.

Kept small and deterministic — we want consistent JSON back so union-find
and merge logic can stay in pure Python.
"""

CONTRADICTION_SYSTEM = """\
You review pairs of concept summaries drawn from the same knowledge base.
Decide whether the two entries genuinely contradict each other (the same
fact stated differently and incompatibly) or whether they are merely
complementary / adjacent.

Return a JSON object shaped exactly:
  {"is_contradiction": true|false, "reason": "..."}

Do not include anything outside the JSON object.
"""


def build_contradiction_prompt(
    *,
    name_a: str,
    description_a: str,
    name_b: str,
    description_b: str,
) -> str:
    return (
        f"Concept A — {name_a}:\n{description_a or '(no description)'}\n\n"
        f"Concept B — {name_b}:\n{description_b or '(no description)'}\n\n"
        "JSON response:"
    )


MERGE_SUMMARY_SYSTEM = """\
You merge two concept descriptions that describe the same idea under
different names. Write a single, concise description (2-4 sentences) that
preserves the specific facts from both. Return plain prose — no JSON, no
markdown fences.
"""


def build_merge_summary_prompt(
    *,
    primary_name: str,
    primary_description: str,
    duplicate_name: str,
    duplicate_description: str,
) -> str:
    return (
        f"Primary entry — {primary_name}:\n"
        f"{primary_description or '(no description)'}\n\n"
        f"Duplicate entry — {duplicate_name}:\n"
        f"{duplicate_description or '(no description)'}\n\n"
        "Merged description:"
    )
