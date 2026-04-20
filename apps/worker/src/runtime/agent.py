"""Agent base class — contract for all 12 OpenCairn agents."""
from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator
from typing import Any, ClassVar

from runtime.events import AgentEvent
from runtime.tools import ToolContext


class Agent(ABC):
    """All OpenCairn agents subclass this.

    `run()` is an async generator — yields AgentEvent items. If the agent
    yields `AwaitingInput`, the consumer may resume via `generator.asend(response)`.

    Subclasses MUST define class-level `name` and `description`.
    """

    name: ClassVar[str]
    description: ClassVar[str]

    def __init_subclass__(cls, **kwargs: Any) -> None:
        super().__init_subclass__(**kwargs)
        # Allow further abstract subclasses to skip the check.
        if getattr(cls, "__abstractmethods__", None):
            return
        if not isinstance(getattr(cls, "name", None), str):
            raise TypeError(f"{cls.__name__} must define class-level `name: str`")
        if not isinstance(getattr(cls, "description", None), str):
            raise TypeError(f"{cls.__name__} must define class-level `description: str`")

    @abstractmethod
    def run(
        self, input: dict[str, Any], ctx: ToolContext
    ) -> AsyncGenerator[AgentEvent, Any]:
        """Run the agent. Yields AgentEvent items. Implementations are `async def` with `yield`."""
        ...


__all__ = ["Agent"]
