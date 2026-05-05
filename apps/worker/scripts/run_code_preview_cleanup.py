"""Run the internal static code preview cleanup sweep.

This script is the cron-friendly entrypoint for Phase 7F static preview
cleanup. It calls the API's internal-secret protected endpoint:

    POST /api/internal/agent-actions/preview-cleanup

Usage::

    python -m scripts.run_code_preview_cleanup
    python -m scripts.run_code_preview_cleanup --limit 250

The API performs the DB mutation. The worker script only provides a stable
operations target that can run from a container cron, Kubernetes CronJob, or
other scheduler with ``INTERNAL_API_URL`` and ``INTERNAL_API_SECRET`` set.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any, TypedDict

from worker.lib.api_client import post_internal

logger = logging.getLogger(__name__)

CleanupPoster = Callable[[str, dict[str, Any]], Awaitable[dict[str, Any]]]


class PreviewCleanupResult(TypedDict):
    expiredCount: int
    actionIds: list[str]


async def run_preview_cleanup(
    *,
    limit: int | None = None,
    poster: CleanupPoster = post_internal,
) -> PreviewCleanupResult:
    """Call the internal API cleanup endpoint and validate the response shape."""
    body: dict[str, Any] = {}
    if limit is not None:
        body["limit"] = limit

    response = await poster("/api/internal/agent-actions/preview-cleanup", body)
    expired_count = response.get("expiredCount")
    action_ids = response.get("actionIds")
    if not isinstance(expired_count, int) or not isinstance(action_ids, list):
        raise RuntimeError("preview_cleanup_invalid_response")
    if not all(isinstance(action_id, str) for action_id in action_ids):
        raise RuntimeError("preview_cleanup_invalid_action_ids")
    return {"expiredCount": expired_count, "actionIds": action_ids}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of expired preview actions to mark in one sweep.",
    )
    return parser


async def amain(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.limit is not None and args.limit < 1:
        raise SystemExit("--limit must be >= 1")

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    result = await run_preview_cleanup(limit=args.limit)
    logger.info(
        "code preview cleanup expired %d action(s)",
        result["expiredCount"],
    )
    if result["actionIds"]:
        logger.info("expired action ids: %s", ", ".join(result["actionIds"]))
    return 0


def main(argv: list[str] | None = None) -> int:
    return asyncio.run(amain(argv))


if __name__ == "__main__":
    raise SystemExit(main())
