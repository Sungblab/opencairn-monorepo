"""CuratorAgent — knowledge-base quality scanner.

Detects orphan concepts (degree 0), near-duplicate concept pairs
(cosine similarity ≥ 0.9), and potentially contradicting wiki notes.
Each finding is written to the ``suggestions`` table via the internal API.
"""
from worker.agents.curator.agent import CuratorAgent

__all__ = ["CuratorAgent"]
