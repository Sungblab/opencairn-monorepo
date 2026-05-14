from worker.activities.synthesis_export.types import (
    SourceBundle,
    SourceItem,
    SynthesisRunParams,
)


def test_run_params_round_trip():
    p = SynthesisRunParams(
        run_id="r1",
        workspace_id="w1",
        project_id=None,
        user_id="u1",
        format="latex",
        template="korean_thesis",
        user_prompt="x",
        explicit_source_ids=["s1"],
        note_ids=["n1"],
        auto_search=False,
        byok_key_handle=None,
    )
    assert p.format == "latex"


def test_source_bundle_as_text_concatenates_titles_and_bodies():
    bundle = SourceBundle(
        items=[
            SourceItem(
                id="s1",
                title="Paper A",
                body="abstract A...",
                token_count=50,
                kind="s3_object",
            ),
            SourceItem(
                id="n1",
                title="Note",
                body="my note body",
                token_count=30,
                kind="note",
            ),
        ]
    )
    text = bundle.as_text()
    assert "Paper A" in text and "abstract A" in text
    assert "Note" in text and "my note body" in text


def test_source_bundle_notes_excerpt_only_returns_note_kind():
    bundle = SourceBundle(
        items=[
            SourceItem(id="s1", title="A", body="b1", token_count=10, kind="s3_object"),
            SourceItem(id="n1", title="Note", body="b2", token_count=10, kind="note"),
        ]
    )
    assert "b2" in bundle.notes_excerpt()
    assert "b1" not in bundle.notes_excerpt()
