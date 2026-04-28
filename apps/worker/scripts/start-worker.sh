#!/bin/sh
# Container entrypoint for the OpenCairn worker.
#
# Boots the unoserver daemon in the background so the parse_office /
# parse_hwp activities can shell out to ``unoconvert`` against a long-lived
# LibreOffice instance (orders of magnitude faster than spawning soffice per
# file). Then exec's the Temporal worker as PID 1 so SIGTERM from
# ``docker stop`` propagates correctly.
#
# Why exit-on-startup-failure (not warn-and-continue):
#   If unoserver dies during startup we MUST fail the container, not boot
#   the worker. A worker that accepts Office/HWP work without unoserver
#   running burns ~14 minutes per upload (3× retries with exponential
#   backoff at 30-minute schedule_to_close) before dead-lettering, with no
#   user-visible signal except eventual workflow failure. Exiting here
#   makes Docker's restart policy + healthcheck catch the broken state
#   immediately. Closes the H2 review finding.
#
# Why a logfile (not /dev/null):
#   unoserver's stdout/stderr is the only diagnostic for "LibreOffice
#   wouldn't start". We pipe it into ``/var/log/unoserver.log`` so an
#   operator can ``docker exec ... cat /var/log/unoserver.log`` after a
#   failed boot.
set -e

UNOSERVER_HOST="${UNOSERVER_HOST:-127.0.0.1}"
UNOSERVER_PORT="${UNOSERVER_PORT:-2003}"
UNOSERVER_LOG="${UNOSERVER_LOG:-/var/log/unoserver.log}"

# Touch the logfile so a fresh container has a stable target for
# ``unoserver`` even before the daemon writes its first line. ``mkdir -p``
# is a no-op when /var/log already exists (always true on Debian).
mkdir -p "$(dirname "${UNOSERVER_LOG}")"
: > "${UNOSERVER_LOG}"

echo "[entrypoint] Starting unoserver on ${UNOSERVER_HOST}:${UNOSERVER_PORT} (log: ${UNOSERVER_LOG})"
unoserver --interface "${UNOSERVER_HOST}" --port "${UNOSERVER_PORT}" \
    >"${UNOSERVER_LOG}" 2>&1 &
UNOSERVER_PID=$!

# Give LibreOffice a moment to register the UNO bridge before any activity
# tries to connect. Two seconds is sufficient on a modern container; the
# first conversion still pays a small extra warm-up cost on the LO side.
sleep 2

# Sanity check — if unoserver died during startup we exit so the container
# restarts (per docker-compose ``restart: unless-stopped``) instead of
# silently accepting work that will all fail downstream.
if ! kill -0 "${UNOSERVER_PID}" 2>/dev/null; then
    echo "[entrypoint] FATAL: unoserver exited during startup. Last lines from ${UNOSERVER_LOG}:" >&2
    tail -20 "${UNOSERVER_LOG}" >&2 || true
    exit 1
fi

echo "[entrypoint] Starting Temporal worker"
exec python -m worker.temporal_main
