"""Tests for LocalFSTrajectoryStorage — NDJSON write, read, atomic rename."""
from __future__ import annotations

import json
from pathlib import Path

from runtime.events import AgentEnd, AgentStart
from runtime.trajectory import LocalFSTrajectoryStorage, TrajectoryWriter


def _ev_start(seq: int = 0) -> AgentStart:
    return AgentStart(
        run_id="r1",
        workspace_id="w1",
        agent_name="test",
        seq=seq,
        ts=1.0,
        scope="project",
        input={"q": "x"},
    )


def _ev_end(seq: int = 1) -> AgentEnd:
    return AgentEnd(
        run_id="r1",
        workspace_id="w1",
        agent_name="test",
        seq=seq,
        ts=2.0,
        output={"answer": "y"},
        duration_ms=1000,
    )


async def test_writer_creates_file(tmp_trajectory_dir: Path) -> None:
    storage = LocalFSTrajectoryStorage(base_dir=tmp_trajectory_dir)
    writer = await storage.open_writer(run_id="r1", workspace_id="w1")
    await writer.emit(_ev_start())
    await writer.emit(_ev_end())
    await writer.close()

    files = list(tmp_trajectory_dir.rglob("*.ndjson"))
    assert len(files) == 1
    assert files[0].name == "r1.ndjson"
    assert "w1" in files[0].parts


async def test_writer_appends_ndjson_lines(tmp_trajectory_dir: Path) -> None:
    storage = LocalFSTrajectoryStorage(base_dir=tmp_trajectory_dir)
    writer = await storage.open_writer(run_id="r1", workspace_id="w1")
    await writer.emit(_ev_start(seq=0))
    await writer.emit(_ev_end(seq=1))
    uri = await writer.close()

    lines = Path(uri.removeprefix("file://")).read_text().splitlines()
    assert len(lines) == 2
    parsed = [json.loads(line) for line in lines]
    assert parsed[0]["type"] == "agent_start"
    assert parsed[1]["type"] == "agent_end"


async def test_writer_returns_file_uri(tmp_trajectory_dir: Path) -> None:
    storage = LocalFSTrajectoryStorage(base_dir=tmp_trajectory_dir)
    writer = await storage.open_writer(run_id="r1", workspace_id="w1")
    await writer.emit(_ev_start())
    uri = await writer.close()
    assert uri.startswith("file://")


async def test_read_trajectory_roundtrip(tmp_trajectory_dir: Path) -> None:
    storage = LocalFSTrajectoryStorage(base_dir=tmp_trajectory_dir)
    writer = await storage.open_writer(run_id="r1", workspace_id="w1")
    await writer.emit(_ev_start())
    await writer.emit(_ev_end())
    uri = await writer.close()

    events = [ev async for ev in storage.read_trajectory(uri)]
    assert len(events) == 2
    assert events[0].type == "agent_start"
    assert events[1].type == "agent_end"


async def test_buffer_flushes_on_agent_end(tmp_trajectory_dir: Path) -> None:
    """agent_end forces a flush even when buffer_size is not reached."""
    storage = LocalFSTrajectoryStorage(base_dir=tmp_trajectory_dir)
    writer = TrajectoryWriter(
        storage=storage,
        run_id="r1",
        workspace_id="w1",
        buffer_size=50,
    )
    await writer.open()
    await writer.emit(_ev_start())
    # Before agent_end, buffer hasn't reached 50 events and no flush has fired,
    # so nothing has hit disk yet (neither final nor tmp).
    before = list(tmp_trajectory_dir.rglob("r1.ndjson*"))
    assert before == []

    # agent_end is one of the event types that forces _flush(), which writes
    # to the .tmp file. Rename to the final path only happens on close().
    await writer.emit(_ev_end())
    after = list(tmp_trajectory_dir.rglob("r1.ndjson*"))
    assert len(after) == 1
    assert after[0].name == "r1.ndjson.tmp"
