import pytest

from scripts.run_code_preview_cleanup import run_preview_cleanup


@pytest.mark.asyncio
async def test_run_preview_cleanup_posts_to_internal_endpoint() -> None:
    calls: list[tuple[str, dict]] = []

    async def poster(path: str, body: dict) -> dict:
        calls.append((path, body))
        return {
            "expiredCount": 2,
            "actionIds": [
                "00000000-0000-4000-8000-000000000001",
                "00000000-0000-4000-8000-000000000002",
            ],
        }

    result = await run_preview_cleanup(limit=25, poster=poster)

    assert calls == [("/api/internal/agent-actions/preview-cleanup", {"limit": 25})]
    assert result == {
        "expiredCount": 2,
        "actionIds": [
            "00000000-0000-4000-8000-000000000001",
            "00000000-0000-4000-8000-000000000002",
        ],
    }


@pytest.mark.asyncio
async def test_run_preview_cleanup_omits_unset_limit() -> None:
    calls: list[tuple[str, dict]] = []

    async def poster(path: str, body: dict) -> dict:
        calls.append((path, body))
        return {"expiredCount": 0, "actionIds": []}

    await run_preview_cleanup(poster=poster)

    assert calls == [("/api/internal/agent-actions/preview-cleanup", {})]


@pytest.mark.asyncio
async def test_run_preview_cleanup_rejects_invalid_response() -> None:
    async def poster(_path: str, _body: dict) -> dict:
        return {"expiredCount": "two", "actionIds": []}

    with pytest.raises(RuntimeError, match="preview_cleanup_invalid_response"):
        await run_preview_cleanup(poster=poster)
