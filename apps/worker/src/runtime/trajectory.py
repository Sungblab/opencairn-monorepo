"""Trajectory storage — Protocol + LocalFSTrajectoryStorage + TrajectoryWriter.

NDJSON path: {base}/{workspace_id}/{YYYY-MM-DD}/{run_id}.ndjson
"""
from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol, runtime_checkable

from pydantic import TypeAdapter

from runtime.events import AgentEnd, AgentError, AgentEvent

_AGENT_EVENT_ADAPTER: TypeAdapter[AgentEvent] = TypeAdapter(AgentEvent)


class TrajectoryWriterProtocol(Protocol):
    async def emit(self, event: AgentEvent) -> None: ...
    async def close(self) -> str: ...  # returns URI


@runtime_checkable
class TrajectoryStorage(Protocol):
    async def open_writer(
        self, run_id: str, workspace_id: str
    ) -> TrajectoryWriterProtocol: ...
    def read_trajectory(self, uri: str) -> AsyncIterator[AgentEvent]: ...


class LocalFSWriter:
    """Buffered NDJSON writer with atomic rename on close."""

    def __init__(self, *, final_path: Path) -> None:
        self._final = final_path
        self._tmp = final_path.with_suffix(final_path.suffix + ".tmp")
        self._final.parent.mkdir(parents=True, exist_ok=True)
        self._lock = asyncio.Lock()
        self._buffer: list[str] = []

    async def emit(self, event: AgentEvent) -> None:
        line = event.model_dump_json()
        async with self._lock:
            self._buffer.append(line)
            if len(self._buffer) >= 50 or isinstance(event, AgentEnd | AgentError):
                await self._flush()

    async def _flush(self) -> None:
        if not self._buffer:
            return
        content = "\n".join(self._buffer) + "\n"
        await asyncio.to_thread(self._append, content)
        self._buffer.clear()

    def _append(self, content: str) -> None:
        with open(self._tmp, "a", encoding="utf-8") as f:
            f.write(content)

    async def close(self) -> str:
        async with self._lock:
            await self._flush()
        if self._tmp.exists():
            await asyncio.to_thread(os.replace, self._tmp, self._final)
        return f"file://{self._final}"


class LocalFSTrajectoryStorage:
    def __init__(self, *, base_dir: Path) -> None:
        self._base = Path(base_dir)
        self._base.mkdir(parents=True, exist_ok=True)

    async def open_writer(self, run_id: str, workspace_id: str) -> LocalFSWriter:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        path = self._base / workspace_id / today / f"{run_id}.ndjson"
        return LocalFSWriter(final_path=path)

    async def read_trajectory(self, uri: str) -> AsyncIterator[AgentEvent]:
        path = Path(uri.removeprefix("file://"))
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                yield _AGENT_EVENT_ADAPTER.validate_json(line)


class TrajectoryWriter:
    """Higher-level writer used by the TrajectoryWriterHook.

    Wraps a backend writer and exposes a consistent API regardless of storage
    backend. The `buffer_size` argument is accepted for API symmetry; the
    actual buffering policy lives in the backend writer.
    """

    def __init__(
        self,
        *,
        storage: TrajectoryStorage,
        run_id: str,
        workspace_id: str,
        buffer_size: int = 50,
    ) -> None:
        self._storage = storage
        self._run_id = run_id
        self._workspace_id = workspace_id
        self._buffer_size = buffer_size
        self._backend_writer: TrajectoryWriterProtocol | None = None

    async def open(self) -> None:
        self._backend_writer = await self._storage.open_writer(
            self._run_id, self._workspace_id
        )

    async def emit(self, event: AgentEvent) -> None:
        if self._backend_writer is None:
            raise RuntimeError("TrajectoryWriter not opened")
        await self._backend_writer.emit(event)

    async def close(self) -> str:
        if self._backend_writer is None:
            raise RuntimeError("TrajectoryWriter not opened")
        return await self._backend_writer.close()


def resolve_storage_from_env() -> TrajectoryStorage:
    """Factory that honors TRAJECTORY_BACKEND env."""
    backend = os.environ.get("TRAJECTORY_BACKEND", "local")
    if backend == "local":
        base = Path(
            os.environ.get("TRAJECTORY_DIR", "/var/lib/opencairn/trajectories")
        )
        return LocalFSTrajectoryStorage(base_dir=base)
    if backend == "s3":
        from runtime.trajectory_s3 import S3TrajectoryStorage

        return S3TrajectoryStorage.from_env()
    raise ValueError(f"Unknown TRAJECTORY_BACKEND: {backend}")


__all__ = [
    "LocalFSTrajectoryStorage",
    "LocalFSWriter",
    "TrajectoryStorage",
    "TrajectoryWriter",
    "TrajectoryWriterProtocol",
    "resolve_storage_from_env",
]
