from .base import LLMProvider, EmbedInput, ThinkingResult, SearchResult, ProviderConfig
from .batch_types import (
    BATCH_STATE_CANCELLED,
    BATCH_STATE_EXPIRED,
    BATCH_STATE_FAILED,
    BATCH_STATE_PENDING,
    BATCH_STATE_RUNNING,
    BATCH_STATE_SUCCEEDED,
    BATCH_TERMINAL_STATES,
    BatchEmbedHandle,
    BatchEmbedPoll,
    BatchEmbedResult,
    BatchNotSupported,
)
from .embed_helper import (
    ENV_BATCH_ENABLED_COMPILER,
    ENV_BATCH_ENABLED_LIBRARIAN,
    ENV_BATCH_MIN_ITEMS,
    embed_many,
)
from .factory import get_provider
from .interactions import (
    InteractionEvent,
    InteractionEventKind,
    InteractionHandle,
    InteractionState,
    InteractionStatus,
)

__all__ = [
    "LLMProvider",
    "EmbedInput",
    "ThinkingResult",
    "SearchResult",
    "ProviderConfig",
    "get_provider",
    # Batch embedding surface (Plan 3b)
    "BatchEmbedHandle",
    "BatchEmbedPoll",
    "BatchEmbedResult",
    "BatchNotSupported",
    "BATCH_STATE_PENDING",
    "BATCH_STATE_RUNNING",
    "BATCH_STATE_SUCCEEDED",
    "BATCH_STATE_FAILED",
    "BATCH_STATE_CANCELLED",
    "BATCH_STATE_EXPIRED",
    "BATCH_TERMINAL_STATES",
    "embed_many",
    "ENV_BATCH_ENABLED_COMPILER",
    "ENV_BATCH_ENABLED_LIBRARIAN",
    "ENV_BATCH_MIN_ITEMS",
    # Interactions API (Deep Research)
    "InteractionEvent",
    "InteractionEventKind",
    "InteractionHandle",
    "InteractionState",
    "InteractionStatus",
]
