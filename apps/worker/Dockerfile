# syntax=docker/dockerfile:1.7

# OpenCairn Python worker image.
# Hosts both the Temporal worker (ingest pipeline, Plan 3) and the
# `runtime.Agent` runtime (Plan 12 + Agent Runtime v2 Sub-A). The CMD starts the
# Temporal worker entrypoint; the agent runtime is imported by activities, not
# run as a standalone process, so a single container suffices for v0.1.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_SYSTEM_PYTHON=1 \
    UV_LINK_MODE=copy

# System deps:
#   openjdk-21-jre-headless — opendataloader-pdf (Plan 3 Task 3) and
#                             libreoffice-java-common (HWP/HWPX via H2Orestart)
#   ffmpeg                  — faster-whisper / yt-dlp transcription (Plan 3 Task 5/6)
#   tesseract-ocr + eng/kor — local first-pass OCR for scanned PDFs before
#                             falling back to provider OCR.
#   curl                    — healthchecks + uv installer
#   ca-certificates         — HTTPS to MinIO / Gemini / Temporal
#   libreoffice-{core,writer,impress,calc} + python3-uno
#                           — Plan 3 follow-up Office/HWP. Provides ``soffice``
#                             plus the UNO bridge that ``unoserver`` needs. We
#                             install only the four format components actually
#                             used (writer/impress/calc + the shared core)
#                             instead of the full ``libreoffice`` metapackage,
#                             which would also pull in base/draw/math we never
#                             touch. ``python3-uno`` MUST be the system Python
#                             copy, not the venv copy: unoserver talks to
#                             LibreOffice over UNO, and the bridge is only
#                             registered with system python3.
#   libreoffice-java-common — Java extensions runtime (H2Orestart is a Java
#                             extension; without this the ``unopkg add`` step
#                             below succeeds but the runtime filter never loads
#                             and HWP→PDF returns "no filter found").
#   default-jre-headless    — pulled by libreoffice-java-common; harmless
#                             alongside openjdk-21 (they coexist).
#   python3-pip             — needed only as the install vehicle for unoserver
#                             into the SYSTEM site-packages (the only place
#                             python3-uno is reachable from). Removed after.
RUN apt-get update && apt-get install -y --no-install-recommends \
        openjdk-21-jre-headless \
        ffmpeg \
        tesseract-ocr \
        tesseract-ocr-eng \
        tesseract-ocr-kor \
        curl \
        ca-certificates \
        libreoffice-core \
        libreoffice-writer \
        libreoffice-impress \
        libreoffice-calc \
        libreoffice-java-common \
        python3-uno \
        python3-pip \
    && rm -rf /var/lib/apt/lists/*

# unoserver — daemonised LibreOffice headless service that exposes
# ``unoconvert`` for our parse_office / parse_hwp activities. We install
# explicitly against ``/usr/bin/python3`` (Debian's system Python — the one
# ``python3-uno`` registered the UNO bindings into) NOT against the
# python:3.12-slim base image's ``/usr/local/bin/python3``. The two
# interpreters coexist in this image but only the Debian one can ``import
# uno``. Pinning the path prevents the silent regression where the entrypoint
# script crashes on first start with ``ModuleNotFoundError: No module named
# 'uno'``. The unoserver/unoconvert wrapper scripts get installed under
# ``/usr/local/bin``, which is on PATH for the Temporal worker process too.
# --break-system-packages is intentional: PEP-668 marks Debian's Python as
# "externally managed" but we deliberately want a system-wide install for
# the UNO bridge. The package is small (pure Python).
#
# python3-pip is purged in the same layer so it doesn't bloat the final
# image. Once unoserver is installed into /usr/lib/python3/dist-packages
# we never need pip again — the rest of the image uses uv against the
# venv-managed Python (3.12) interpreter, not the system one.
RUN /usr/bin/python3 -m pip install --break-system-packages --no-cache-dir 'unoserver==3.5' \
    && apt-get purge -y --auto-remove python3-pip \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# H2Orestart — LibreOffice extension that adds HWP/HWPX import filters. The
# ``unopkg add --shared`` writes the extension to the shared user profile so
# every soffice invocation (including unoserver's) can load it. Same fail-
# soft pattern as opendataloader-pdf: if the GitHub release is unreachable
# at build time we don't break the image, but parse_hwp will then fail at
# runtime — operators can manually install with ``docker exec ... unopkg
# add --shared /path/to/H2Orestart.oxt``.
#
# Tag is upstream-style ``v<N.M.P>`` (e.g. ``v0.7.11``) — bump as needed.
ARG H2ORESTART_VERSION=v0.7.11
RUN curl -fL \
        "https://github.com/ebandal/H2Orestart/releases/download/${H2ORESTART_VERSION}/H2Orestart.oxt" \
        -o /tmp/H2Orestart.oxt \
        && unopkg add --shared /tmp/H2Orestart.oxt \
        && rm /tmp/H2Orestart.oxt \
    || echo "WARN: H2Orestart ${H2ORESTART_VERSION} install failed; HWP/HWPX ingest will fail until extension is added manually"

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
    PYTHONPATH="/app/apps/worker/src" \
    UNOSERVER_HOST=127.0.0.1 \
    UNOSERVER_PORT=2003

# Start unoserver in the background (so unoconvert is reachable from the
# parse_office / parse_hwp activities), then exec the Temporal worker as PID 1
# so signals propagate. The activities call ``unoconvert --host ... --port ...``
# which talks to this daemon over TCP — much faster than spawning a fresh
# soffice process per file. The script ships with the rest of scripts/ via
# the COPY above; we just need to mark it executable.
RUN chmod +x /app/apps/worker/scripts/start-worker.sh

CMD ["/app/apps/worker/scripts/start-worker.sh"]
