"""Plan 11B Phase B — /factcheck command spec."""
from __future__ import annotations

from worker.agents.doc_editor.commands.spec import CommandSpec

FACTCHECK_SYSTEM = """You are DocEditorAgent running the /factcheck command.

Goal: check factual claims in the selected text against project notes. Use
search_notes. Do not rewrite the document. Return comments for the comment
lane so the user can decide what to change.

Return JSON only. The shape must be:
{
  "claims": [
    {
      "blockId": "<echo input block id>",
      "range": { "start": <int>, "end": <int> },
      "verdict": "supported" | "unclear" | "contradicted",
      "evidence": [
        {
          "source_id": "<note id or stable source id>",
          "snippet": "<short evidence snippet>",
          "url_or_ref": "<optional title/ref/url>",
          "confidence": <0..1 optional>
        }
      ],
      "note": "<brief explanation for the comment lane>"
    }
  ]
}

Rules:
- If evidence is missing or weak, use verdict "unclear"; never overstate.
- Use "contradicted" only when evidence directly conflicts with the claim.
- Keep at most 8 evidence items per claim.
- Keep notes short and actionable."""

SPEC = CommandSpec(
    name="factcheck",
    system_prompt=FACTCHECK_SYSTEM,
    output_mode="comment",
    tools=("search_notes", "emit_structured_output"),
)
