"""Dataclasses passed across SynthesisExportWorkflow activity boundaries.

Temporal serializes these via the default JSON converter, so all fields
must be JSON-friendly.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional


SynthesisFormat = Literal["latex", "docx", "pdf", "md"]
SynthesisTemplate = Literal["ieee", "acm", "apa", "korean_thesis", "report"]
SourceKind = Literal["s3_object", "note", "dr_result"]


@dataclass(frozen=True)
class SynthesisRunParams:
    run_id: str
    workspace_id: str
    project_id: Optional[str]
    user_id: str
    format: SynthesisFormat
    template: SynthesisTemplate
    user_prompt: str
    explicit_source_ids: list[str] = field(default_factory=list)
    note_ids: list[str] = field(default_factory=list)
    auto_search: bool = False
    byok_key_handle: Optional[str] = None


@dataclass(frozen=True)
class SourceItem:
    id: str
    title: str
    body: str
    token_count: int
    kind: SourceKind


@dataclass
class SourceBundle:
    items: list[SourceItem] = field(default_factory=list)

    def as_text(self) -> str:
        parts: list[str] = []
        for it in self.items:
            parts.append(f"## [{it.id}] {it.title}\n{it.body}")
        return "\n\n".join(parts)

    def notes_excerpt(self) -> str:
        notes = [it for it in self.items if it.kind == "note"]
        if not notes:
            return ""
        return "\n\n".join(f"- {n.title}: {n.body}" for n in notes)


@dataclass
class CompiledArtifact:
    s3_key: str
    bytes: int
    format: str
