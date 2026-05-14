"""SynthesisExportAgent prompt templates.

Citation rules vary by output format (LaTeX/DOCX strict, MD/PDF best-effort).
Template hint blocks inject Korean thesis structure when relevant.
"""
from __future__ import annotations

SYNTHESIS_SYSTEM = """You are a research synthesis writer. You receive a set \
of source documents and a user instruction. Produce ONE consolidated document \
by calling the `emit_structured_output` tool exactly once.

Output schema name: SynthesisOutputSchema. Validate your `data` against:
- `format`: must equal the requested format ("latex" | "docx" | "pdf" | "md")
- `template`: must equal the requested template
- `sections[].content`: markup matching the format:
    * latex → LaTeX body fragments (no \\documentclass — assembler wraps it)
    * docx → minimal HTML (h1/h2/p/ul/ol/li/strong/em/code/blockquote)
    * pdf  → minimal HTML (same subset as docx)
    * md   → CommonMark
- `sections[].source_ids`: list of `source_id` strings you actually drew from
- `bibliography[]`: full BibTeX-friendly metadata for every source you cite

Citation rules (STRICT for latex/docx, best-effort for pdf/md):
- latex: every factual claim must include `\\cite{cite_key}` inline.
- docx:  use `[N]` markers in content; the assembler converts to footnotes.
- pdf:   inline `[N]` markers preferred; section-end "Sources:" list acceptable.
- md:    section-end "**Sources:**" list of titles + URLs.

Always set `cite_key` to `src:{source_id_first_8_chars}`.

If a section title is missing from the user instruction, infer one. Never \
invent sources — only cite from the supplied bundle.
"""

KOREAN_THESIS_HINT = """학위논문 구조(template=korean_thesis):
표지 → 초록(한/영) → 목차/그림목차/표목차 → 제1장 서론(1.1 배경 및 필요성, \
1.2 연구 목적, 1.3 논문 구성) → 제N장 관련 연구 → 제N장 제안 방법 → \
제N장 실험 및 결과 → 제N장 결론 → 참고문헌. 본문은 학술 문체(존댓말 X, \
명사형 종결)."""

REPORT_HINT = """A general-purpose report. Default sections: Summary, \
Background, Findings, Discussion, References."""

ACADEMIC_HINT = """Academic paper. Default sections: Abstract, \
1. Introduction, 2. Related Work, 3. Method, 4. Experiments, 5. Discussion, \
6. Conclusion, References."""


def build_user_prompt(
    *,
    sources_text: str,
    workspace_notes: str,
    user_prompt: str,
    format: str,
    template: str,
) -> str:
    template_hints = {
        "korean_thesis": KOREAN_THESIS_HINT,
        "report": REPORT_HINT,
        "ieee": ACADEMIC_HINT,
        "acm": ACADEMIC_HINT,
        "apa": ACADEMIC_HINT,
    }
    hint = template_hints.get(template, "")
    return f"""=== Output Format ===
format: {format}
template: {template}
{hint}

=== User Instruction ===
{user_prompt}

=== Source Bundle ===
{sources_text or "(no explicit sources provided)"}

=== Workspace Notes ===
{workspace_notes or "(none)"}

Now call `emit_structured_output` with `schema_name="SynthesisOutputSchema"` \
and your composed `data`. Do not produce any text outside the tool call.
"""
