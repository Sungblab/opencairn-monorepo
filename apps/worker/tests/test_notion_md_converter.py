"""Unit tests for the Notion Markdown → Plate converter.

The converter is the single source of fidelity for imported Notion pages —
once content lands in Plate JSON, the rest of OpenCairn treats it like any
other note. These tests lock down the transforms the editor actually cares
about: headings, inline marks, internal/external links, images, and code.
"""
from __future__ import annotations

from worker.activities.notion_activities import md_to_plate

NOTE_UUID = "00000000-0000-4000-8000-000000000001"
NOTION_ID = "abc123abc123abc123abc123abc12312"  # 32-char hex


def _noop_resolve(_path: str) -> str | None:
    return None


def test_headings_and_paragraph() -> None:
    out = md_to_plate(
        "# Hello\n\nWorld.\n",
        uuid_link_map={},
        idx_to_note_id={},
        resolve_asset=_noop_resolve,
    )
    assert out[0]["type"] == "h1"
    assert out[0]["children"][0]["text"] == "Hello"
    assert out[1]["type"] == "p"
    assert out[1]["children"][0]["text"] == "World."


def test_inline_marks() -> None:
    out = md_to_plate(
        "**bold** and *italic* and `code`\n",
        uuid_link_map={},
        idx_to_note_id={},
        resolve_asset=_noop_resolve,
    )
    para = out[0]
    assert para["type"] == "p"
    texts = para["children"]
    assert any(c.get("bold") for c in texts)
    assert any(c.get("italic") for c in texts)
    assert any(c.get("code") for c in texts)


def test_internal_wiki_link() -> None:
    out = md_to_plate(
        f"[Other](../Other%20Page%20{NOTION_ID}.md)\n",
        uuid_link_map={NOTION_ID: 7},
        idx_to_note_id={7: NOTE_UUID},
        resolve_asset=_noop_resolve,
    )
    para = out[0]
    link = [c for c in para["children"] if c.get("type") == "wikilink"]
    assert len(link) == 1
    assert link[0]["noteId"] == NOTE_UUID
    assert link[0]["label"] == "Other"


def test_external_link_preserved() -> None:
    out = md_to_plate(
        "[Google](https://google.com)\n",
        uuid_link_map={},
        idx_to_note_id={},
        resolve_asset=_noop_resolve,
    )
    links = [c for c in out[0]["children"] if c.get("type") == "a"]
    assert len(links) == 1
    assert links[0]["url"] == "https://google.com"


def test_image_resolve() -> None:
    calls: list[str] = []

    def resolve(path: str) -> str | None:
        calls.append(path)
        return "https://minio.test/img-123.png"

    out = md_to_plate(
        "![alt](./img.png)\n",
        uuid_link_map={},
        idx_to_note_id={},
        resolve_asset=resolve,
    )
    assert calls == ["./img.png"]
    blocks = [b for b in out if b.get("type") == "image"]
    assert len(blocks) == 1
    assert blocks[0]["url"] == "https://minio.test/img-123.png"
    assert blocks[0]["alt"] == "alt"


def test_code_block() -> None:
    out = md_to_plate(
        "```python\nprint('hi')\n```\n",
        uuid_link_map={},
        idx_to_note_id={},
        resolve_asset=_noop_resolve,
    )
    blocks = [b for b in out if b.get("type") == "code_block"]
    assert len(blocks) == 1
    assert blocks[0]["lang"] == "python"
    assert "print('hi')" in blocks[0]["children"][0]["text"]


def test_bullet_list() -> None:
    out = md_to_plate(
        "- one\n- two\n",
        uuid_link_map={},
        idx_to_note_id={},
        resolve_asset=_noop_resolve,
    )
    lists = [b for b in out if b.get("type") == "ul"]
    assert len(lists) == 1
    items = lists[0]["children"]
    assert len(items) == 2
    assert items[0]["type"] == "li"
    # List item text collapses into a single leaf for simple items
    assert any(
        c.get("text") == "one" for c in items[0]["children"]
    )


def test_unresolved_internal_link_falls_back_to_external() -> None:
    # The linked page wasn't in the uuid_link_map (e.g. pointed outside the
    # import). We must NOT crash — downgrade to a regular external link so
    # the user still sees something clickable.
    out = md_to_plate(
        f"[Missing](../Missing%20Page%20{NOTION_ID}.md)\n",
        uuid_link_map={},
        idx_to_note_id={},
        resolve_asset=_noop_resolve,
    )
    para = out[0]
    links = [c for c in para["children"] if c.get("type") == "a"]
    assert len(links) == 1
    assert links[0]["url"].endswith(f"{NOTION_ID}.md")
