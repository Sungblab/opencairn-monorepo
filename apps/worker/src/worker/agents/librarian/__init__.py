"""Librarian agent package.

Nightly maintenance run per project: detect orphan concepts, flag
contradictions, merge near-duplicate concepts, and strengthen co-occurring
concept edges. Runs exclusively via :class:`AgentApiClient`.
"""
from worker.agents.librarian.agent import (
    LibrarianAgent,
    LibrarianContradiction,
    LibrarianInput,
    LibrarianOutput,
)

__all__ = [
    "LibrarianAgent",
    "LibrarianContradiction",
    "LibrarianInput",
    "LibrarianOutput",
]
