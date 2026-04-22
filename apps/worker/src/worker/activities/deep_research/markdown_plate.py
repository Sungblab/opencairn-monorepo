"""Markdown → Plate v49 converter for Deep Research reports.

Thin wrapper over ``notion_activities.md_to_plate`` (Plan 12 Notion
import). We don't re-parse CommonMark — we just:
  - Guard against empty input (caller error).
  - Wire the Google URI → MinIO URL map into ``resolve_asset``.
  - Wrap the underlying call in a try/except so broken markdown never
    crashes the activity — we'd rather save a degraded note than lose
    the whole run (spec §6.3).

Citations come in as structured records alongside markdown, but the
Google-returned report already embeds them as inline links. The list is
threaded through for future use (e.g. a Plate block that surfaces them
in a "Sources" footer) — currently we consume them in persist_report
for the research-meta block, not here.
"""
from __future__ import annotations

from typing import Any

from worker.activities.notion_activities import md_to_plate as _md_to_plate


class ConversionError(ValueError):
    """Raised when input is obviously unusable (empty / whitespace only)."""


def markdown_to_plate(
    *,
    markdown: str,
    image_urls: dict[str, str],
    citations: list[dict[str, str]],
) -> list[dict[str, Any]]:
    """Return a list of Plate nodes representing ``markdown``.

    Args:
        markdown: Google-returned report body.
        image_urls: Mapping from Google-native image URI (e.g. ``gs://...``)
            → MinIO signed URL. Keys not present stay at their original URL
            in the Plate output.
        citations: Informational; currently unused but kept in the signature
            so callers and tests exercise the shape the research-meta block
            ultimately consumes.
    """
    _ = citations  # accepted for forward compat

    if not markdown.strip():
        raise ConversionError("markdown is empty")

    def _resolve_asset(path: str) -> str | None:
        return image_urls.get(path)

    try:
        return _md_to_plate(
            markdown,
            uuid_link_map={},
            idx_to_note_id={},
            resolve_asset=_resolve_asset,
        )
    except Exception:
        return [{"type": "p", "children": [{"text": markdown}]}]
