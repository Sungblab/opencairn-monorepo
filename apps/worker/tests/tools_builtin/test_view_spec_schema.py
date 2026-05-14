import pytest
from pydantic import ValidationError

from worker.tools_builtin.schema_registry import SCHEMA_REGISTRY
from worker.tools_builtin.view_spec_schema import ViewSpec


def _node(id_: str, **kw):
    return {"id": id_, "name": kw.pop("name", "n"), **kw}


def _edge(s: str, t: str, **kw):
    return {
        "sourceId": s,
        "targetId": t,
        "relationType": kw.pop("relationType", "uses"),
        "weight": kw.pop("weight", 0.5),
        **kw,
    }


U1 = "11111111-1111-4111-8111-111111111111"
U2 = "22222222-2222-4222-8222-222222222222"
U3 = "33333333-3333-4333-8333-333333333333"


def test_view_spec_registered_in_registry():
    assert "ViewSpec" in SCHEMA_REGISTRY
    assert SCHEMA_REGISTRY["ViewSpec"] is ViewSpec


def test_minimal_graph_view_validates():
    spec = ViewSpec.model_validate({
        "viewType": "graph", "layout": "fcose", "rootId": None,
        "nodes": [_node(U1)], "edges": [],
    })
    assert spec.viewType == "graph"


def test_mindmap_requires_root_id():
    with pytest.raises(ValidationError, match="rootId is required"):
        ViewSpec.model_validate({
            "viewType": "mindmap", "layout": "dagre", "rootId": None,
            "nodes": [_node(U1)], "edges": [],
        })


def test_board_requires_root_id():
    with pytest.raises(ValidationError, match="rootId is required"):
        ViewSpec.model_validate({
            "viewType": "board", "layout": "preset", "rootId": None,
            "nodes": [_node(U1)], "edges": [],
        })


def test_dangling_source_edge_rejected():
    with pytest.raises(ValidationError, match="dangling"):
        ViewSpec.model_validate({
            "viewType": "graph", "layout": "fcose", "rootId": None,
            "nodes": [_node(U1)],
            "edges": [_edge(U2, U1)],  # U2 not in nodes
        })


def test_dangling_target_edge_rejected():
    with pytest.raises(ValidationError, match="dangling"):
        ViewSpec.model_validate({
            "viewType": "graph", "layout": "fcose", "rootId": None,
            "nodes": [_node(U1)],
            "edges": [_edge(U1, U3)],
        })


def test_node_cap_per_view_type_mindmap_50():
    nodes = [_node(f"11111111-1111-4111-8111-{i:012d}") for i in range(51)]
    with pytest.raises(ValidationError, match="too many nodes"):
        ViewSpec.model_validate({
            "viewType": "mindmap", "layout": "dagre", "rootId": nodes[0]["id"],
            "nodes": nodes, "edges": [],
        })


def test_node_cap_cards_80():
    nodes = [_node(f"11111111-1111-4111-8111-{i:012d}") for i in range(81)]
    with pytest.raises(ValidationError, match="too many nodes"):
        ViewSpec.model_validate({
            "viewType": "cards", "layout": "preset", "rootId": None,
            "nodes": nodes, "edges": [],
        })


def test_rationale_max_200():
    with pytest.raises(ValidationError):
        ViewSpec.model_validate({
            "viewType": "graph", "layout": "fcose", "rootId": None,
            "nodes": [], "edges": [],
            "rationale": "x" * 201,
        })


def test_event_year_optional():
    spec = ViewSpec.model_validate({
        "viewType": "timeline", "layout": "preset", "rootId": None,
        "nodes": [_node(U1, eventYear=2017)],
        "edges": [],
    })
    assert spec.nodes[0].eventYear == 2017
