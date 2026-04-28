"""Object-key formulas shared between ingest activities.

Centralises the figure-upload key so ``parse_pdf`` (which uploads) and
``enrich_document`` (which records keys for the enrichment artifact)
agree on the layout. If the formula ever changes, both sides update at
once instead of drifting in opposite directions.
"""

from __future__ import annotations


def figure_object_key(
    *,
    user_id: str,
    workflow_id: str,
    page_idx: int,
    fig_idx: int,
) -> str:
    """Canonical MinIO/R2 key for a figure extracted from a PDF page.

    Used by ``parse_pdf._upload_figure`` (write) and
    ``enrich_document_activity._build_figure_items`` (read).
    """
    return (
        f"uploads/{user_id}/figures/{workflow_id}/p{page_idx}-f{fig_idx}.png"
    )
