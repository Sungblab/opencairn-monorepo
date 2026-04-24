"""Unit tests for :mod:`worker.lib.batch_submit` chunking + alignment.

Plan 3b §AD-1 deferred the >BATCH_EMBED_MAX_ITEMS split logic to Phase 2.
Gemini's ``InlinedRequests`` ceiling + the safer memory envelope (2000
× 768-d floats ≈ 6 MiB per chunk) set the practical max. This test
pins the pure helpers so the orchestration can be refactored later
without re-deriving the correctness contract.
"""
from __future__ import annotations

from llm import EmbedInput

from worker.lib.batch_submit import (
    _align_from_chunks,
    _chunk_inputs,
)


class TestChunkInputs:
    def test_below_max_yields_single_chunk(self) -> None:
        items = [EmbedInput(text=str(i)) for i in range(5)]
        chunks = _chunk_inputs(items, max_items=100)
        assert len(chunks) == 1
        assert len(chunks[0]) == 5

    def test_exactly_at_max_yields_single_chunk(self) -> None:
        items = [EmbedInput(text=str(i)) for i in range(100)]
        chunks = _chunk_inputs(items, max_items=100)
        assert len(chunks) == 1
        assert len(chunks[0]) == 100

    def test_above_max_splits_into_exact_sized_chunks(self) -> None:
        items = [EmbedInput(text=str(i)) for i in range(250)]
        chunks = _chunk_inputs(items, max_items=100)
        assert [len(c) for c in chunks] == [100, 100, 50]

    def test_preserves_input_order_within_chunks(self) -> None:
        items = [EmbedInput(text=f"item-{i}") for i in range(5)]
        chunks = _chunk_inputs(items, max_items=2)
        flat = [inp for chunk in chunks for inp in chunk]
        assert [f.text for f in flat] == [f"item-{i}" for i in range(5)]

    def test_empty_input_yields_empty_list(self) -> None:
        chunks = _chunk_inputs([], max_items=100)
        assert chunks == []

    def test_invalid_max_items_is_treated_as_single_chunk(self) -> None:
        """Defensive: negative or zero MAX_ITEMS from env should not
        infinite-loop; degrade to 'no split'.
        """
        items = [EmbedInput(text=str(i)) for i in range(5)]
        for bad in (0, -1):
            chunks = _chunk_inputs(items, max_items=bad)
            assert chunks == [items]


class TestAlignFromChunks:
    def test_aligns_sequentially_across_chunks(self) -> None:
        original = [EmbedInput(text=str(i)) for i in range(5)]
        chunk_results = [
            [[1.0], [2.0], [3.0]],   # chunk 0 for items 0..2
            [[4.0], [5.0]],          # chunk 1 for items 3..4
        ]
        aligned = _align_from_chunks(original, chunk_results)
        assert aligned == [[1.0], [2.0], [3.0], [4.0], [5.0]]

    def test_preserves_none_placeholders_for_empty_text(self) -> None:
        """``make_batch_submit`` skips ``EmbedInput`` with falsy text
        when building the workflow payload, but the aligned output
        must still mark them as ``None`` so the caller's zip() lines up.
        """
        original = [
            EmbedInput(text="a"),
            EmbedInput(text=""),
            EmbedInput(text="b"),
        ]
        # chunks only contain items with text — in this case 2 items
        chunk_results = [[[1.0], [2.0]]]
        aligned = _align_from_chunks(original, chunk_results)
        assert aligned == [[1.0], None, [2.0]]

    def test_chunk_none_result_propagates(self) -> None:
        original = [EmbedInput(text=str(i)) for i in range(3)]
        chunk_results = [[[1.0], None, [3.0]]]
        aligned = _align_from_chunks(original, chunk_results)
        assert aligned == [[1.0], None, [3.0]]

    def test_missing_items_get_none(self) -> None:
        """If a chunk result shortens (edge case from provider skipping
        empty texts that somehow slipped in), missing slots become None
        rather than IndexError."""
        original = [EmbedInput(text=str(i)) for i in range(3)]
        chunk_results = [[[1.0]]]  # only 1 vector for 3 inputs
        aligned = _align_from_chunks(original, chunk_results)
        assert aligned == [[1.0], None, None]
