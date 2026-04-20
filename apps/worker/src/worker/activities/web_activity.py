import asyncio
import re

import httpx
import trafilatura
from temporalio import activity

COMPLEX_MARKER_PATTERN = re.compile(
    r"(figure\s+\d+|table\s+\d+|equation\s+\d+|\$\$|\\\[)",
    re.IGNORECASE,
)
COMPLEX_THRESHOLD = 3
HTTP_TIMEOUT = 30.0
USER_AGENT = "OpenCairn/1.0 (knowledge base ingest bot)"


def _extract(html: str) -> str:
    """Trafilatura extraction, fallback to naive strip."""
    text = trafilatura.extract(
        html,
        include_tables=True,
        include_links=False,
        include_images=False,
        output_format="txt",
    )
    if text:
        return text
    # Fallback: strip tags manually
    stripped = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", stripped).strip()


@activity.defn(name="scrape_web_url")
async def scrape_web_url(inp: dict) -> dict:
    url: str = inp["url"]
    activity.logger.info("Scraping web URL: %s", url)

    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=HTTP_TIMEOUT,
        headers={"User-Agent": USER_AGENT},
    ) as client:
        response = await client.get(url)
        response.raise_for_status()
        html = response.text

    activity.heartbeat("extracting with trafilatura")
    # trafilatura is sync and CPU-bound on large pages; offload to thread
    text = await asyncio.to_thread(_extract, html)

    matches = COMPLEX_MARKER_PATTERN.findall(text)
    has_complex_layout = len(matches) >= COMPLEX_THRESHOLD

    activity.logger.info(
        "Web scrape complete: %d chars, complex=%s", len(text), has_complex_layout
    )
    return {"text": text, "has_complex_layout": has_complex_layout}
