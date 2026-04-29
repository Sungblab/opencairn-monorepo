import os
import pytest
from fastapi.testclient import TestClient
from server import app


client = TestClient(app)


def _read_fixture(name: str) -> str:
    path = os.path.join(os.path.dirname(__file__), "fixtures", name)
    with open(path, encoding="utf-8") as f:
        return f.read()


def test_healthz():
    res = client.get("/healthz")
    assert res.status_code == 200


@pytest.mark.skipif(
    os.environ.get("TECTONIC_BIN") is None,
    reason="Real tectonic binary required (CI/Docker only)",
)
def test_compile_korean_fixture():
    tex = _read_fixture("hello-ko.tex")
    res = client.post("/compile", json={
        "tex_source": tex, "engine": "xelatex", "timeout_ms": 60000,
    })
    assert res.status_code == 200
    body = res.content
    assert body[:5] == b"%PDF-"
    assert len(body) > 1000


def test_compile_rejects_oversize_input():
    huge = "%" + ("x" * (3 * 1024 * 1024))
    res = client.post("/compile", json={"tex_source": huge})
    assert res.status_code == 400


def test_compile_returns_400_on_invalid_tex():
    if os.environ.get("TECTONIC_BIN") is None:
        pytest.skip("Real tectonic binary required")
    res = client.post("/compile", json={
        "tex_source": "\\this is not valid latex \\\\\\",
        "timeout_ms": 10000,
    })
    assert res.status_code in (400, 500)
