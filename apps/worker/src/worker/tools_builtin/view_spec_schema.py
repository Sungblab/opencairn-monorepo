"""ViewSpec schema for emit_structured_output (Plan 5 Phase 2).

Registered in SCHEMA_REGISTRY at import time. VisualizationAgent imports
this module purely for its registration side-effect.

This Pydantic schema is intentionally STRICTER than the public-facing
Zod schema in `packages/shared/src/api-types.ts`: it enforces
rootId-required-for-mindmap/board, per-view-type node caps, and
dangling-edge rejection. The Zod side ships only the loose contract
(uniform 500-node cap, nullable rootId) because the deterministic
GET /api/projects/:id/graph?view= path constructs payloads from DB
rows that are structurally consistent by construction.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from worker.tools_builtin.schema_registry import register_schema

NODE_CAPS = {
    "mindmap": 50, "timeline": 50, "cards": 80, "board": 200, "graph": 200,
}


class ViewSpecNode(BaseModel):
    id: str
    name: str
    description: str | None = None
    degree: int | None = None
    noteCount: int | None = None
    firstNoteId: str | None = None
    eventYear: int | None = Field(default=None, ge=-3000, le=3000)
    # ISO-8601 created_at fallback for the timeline view. The Vis Agent
    # populates `eventYear` only for explicitly date-anchored concepts;
    # everything else relies on the deterministic SQL surfacing
    # `concepts.created_at` here so the layout doesn't collapse onto
    # the axis midpoint. Mirrors `ViewNode.createdAt` in api-types.ts.
    createdAt: str | None = None
    position: dict | None = None


class ViewSpecEdge(BaseModel):
    sourceId: str
    targetId: str
    relationType: str
    weight: float = Field(ge=0, le=1)


class ViewSpec(BaseModel):
    viewType: Literal["graph", "mindmap", "cards", "timeline", "board"]
    layout: Literal["fcose", "dagre", "preset", "cose-bilkent"]
    rootId: str | None
    nodes: list[ViewSpecNode] = Field(max_length=500)
    edges: list[ViewSpecEdge] = Field(max_length=2000)
    rationale: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def _structural_constraints(self) -> "ViewSpec":
        if self.viewType in ("mindmap", "board") and not self.rootId:
            raise ValueError(f"rootId is required for viewType={self.viewType}")
        cap = NODE_CAPS[self.viewType]
        if len(self.nodes) > cap:
            raise ValueError(
                f"too many nodes for viewType={self.viewType}: "
                f"{len(self.nodes)} > {cap}"
            )
        node_ids = {n.id for n in self.nodes}
        for i, e in enumerate(self.edges):
            if e.sourceId not in node_ids:
                raise ValueError(f"edge[{i}].sourceId dangling: {e.sourceId}")
            if e.targetId not in node_ids:
                raise ValueError(f"edge[{i}].targetId dangling: {e.targetId}")
        return self


register_schema("ViewSpec", ViewSpec)
