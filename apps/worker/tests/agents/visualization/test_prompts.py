from worker.agents.visualization.prompts import VISUALIZATION_SYSTEM


def test_prompt_mentions_three_tools():
    assert "search_concepts" in VISUALIZATION_SYSTEM
    assert "get_concept_graph" in VISUALIZATION_SYSTEM
    assert "emit_structured_output" in VISUALIZATION_SYSTEM


def test_prompt_describes_all_five_view_types():
    for v in ["graph", "mindmap", "cards", "timeline", "board"]:
        assert v in VISUALIZATION_SYSTEM


def test_prompt_describes_all_layouts():
    for ly in ["fcose", "dagre", "preset"]:
        assert ly in VISUALIZATION_SYSTEM


def test_prompt_states_root_required_for_mindmap_board():
    assert "rootId is REQUIRED for mindmap/board" in VISUALIZATION_SYSTEM


def test_prompt_states_node_caps():
    assert "50" in VISUALIZATION_SYSTEM   # mindmap/timeline cap
    assert "80" in VISUALIZATION_SYSTEM   # cards cap
    assert "200" in VISUALIZATION_SYSTEM  # board/graph cap


def test_prompt_states_rationale_200_chars():
    assert "≤200 chars" in VISUALIZATION_SYSTEM


def test_prompt_disallows_other_tools():
    assert "Do NOT call read_note" in VISUALIZATION_SYSTEM
