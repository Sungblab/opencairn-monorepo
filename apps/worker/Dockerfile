# syntax=docker/dockerfile:1.7

# OpenCairn Python worker image.
# Hosts both the Temporal worker (ingest pipeline, Plan 3) and — going forward —
# the LangGraph agent runtime (Plan 12/Plan 4). The CMD starts the Temporal
# worker entrypoint; the agent runtime is imported by activities, not run as a
# standalone process, so a single container suffices for v0.1.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_SYSTEM_PYTHON=1 \
    UV_LINK_MODE=copy

# System deps:
#   openjdk-21-jre-headless — opendataloader-pdf (Plan 3 Task 3)
#   ffmpeg                  — faster-whisper / yt-dlp transcription (Plan 3 Task 5/6)
#   curl                    — healthchecks + uv installer
#   ca-certificates         — HTTPS to MinIO / Gemini / Temporal
RUN apt-get update && apt-get install -y --no-install-recommends \
        openjdk-21-jre-headless \
        ffmpeg \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# uv (fast Python package manager, matches monorepo convention).
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv

WORKDIR /app

# Sibling workspace package (opencairn-llm) is referenced via
# [tool.uv.sources] with a relative path — copy it first so uv sync can resolve.
COPY packages/llm /app/packages/llm

# Resolve and install worker deps (no dev group).
COPY apps/worker/pyproject.toml apps/worker/uv.lock /app/apps/worker/
WORKDIR /app/apps/worker
RUN uv sync --no-dev --frozen

# opendataloader-pdf (Plan 3 Task 3) — Java-based PDF → JSON extractor.
# The release URL is a placeholder; the ``|| (...)`` fallback keeps the image
# build green when the URL is unreachable so CI/dev builds don't stall. When
# the jar is missing the parse_pdf activity will fail at runtime — operators
# should mount a jar manually at /app/opendataloader-pdf.jar in that case.
ARG OPENDATALOADER_VERSION=0.3.0
RUN curl -fL \
        "https://github.com/opencairn/opendataloader-pdf/releases/download/v${OPENDATALOADER_VERSION}/opendataloader-pdf-${OPENDATALOADER_VERSION}-all.jar" \
        -o /app/opendataloader-pdf.jar \
    || (echo "WARN: opendataloader-pdf jar download failed; mount manually at /app/opendataloader-pdf.jar" && touch /app/opendataloader-pdf.jar)

# Application code.
COPY apps/worker/src /app/apps/worker/src
COPY apps/worker/scripts /app/apps/worker/scripts

ENV PATH="/app/apps/worker/.venv/bin:${PATH}" \
    PYTHONPATH="/app/apps/worker/src"

CMD ["python", "-m", "worker.temporal_main"]
