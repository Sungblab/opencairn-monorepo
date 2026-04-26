#!/usr/bin/env bash
#
# Plan 7 Canvas Phase 1 — runtime invariant guards.
#
# Each rule below encodes a security invariant the codebase must NEVER
# regress. CI (or any pre-PR check) should run this script and fail on
# any non-zero exit.
#
# 1. iframe sandbox MUST be "allow-scripts" only — adding "allow-same-origin"
#    breaks the cross-origin Blob URL boundary and lets user-authored canvas
#    code reach parent localStorage/cookies via window.parent.* (ADR-006).
#
# 2. postMessage from canvas iframe MUST NOT use "*" wildcard targetOrigin.
#    Wildcard lets any window listening on origin null receive the message.
#    Always pin to a specific origin or "null" for our Blob URL iframe.
#
# 3. Pyodide CDN URL MUST be a pinned semver path. Floating tags ("latest",
#    "@latest") would let CDN drift change Python runtime behavior between
#    deploys without a code change.
#
# Run: bash scripts/canvas-regression-guard.sh
# Exit codes: 0 = clean, 1 = violation found.
#
# Note on rule 1 regex precision: the codebase intentionally mentions
# "allow-same-origin" inside defensive comments and test descriptions
# (e.g. "sandbox attribute is exactly 'allow-scripts' (no allow-same-origin)").
# The regex below targets only the actual threat — a sandbox attribute /
# string literal that *grants* allow-same-origin — by requiring the token
# appear inside a quoted sandbox value or directly adjacent to allow-scripts
# inside quotes. Lines that begin with a JS/TS comment marker are filtered
# out as a second layer of defense.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

FAIL=0

echo "[canvas-guard] checking allow-same-origin in canvas surfaces..."
# Match an actual sandbox attribute / string literal that grants
# allow-same-origin. We accept either:
#   sandbox="...allow-same-origin..."   (JSX/HTML attribute)
#   "allow-scripts allow-same-origin"   (string literal containing the combo)
# Then strip lines that start with comment markers (// or *) so the
# defensive doc comments in CanvasFrame.tsx don't trip the guard.
if grep -RnE '(sandbox\s*=\s*"[^"]*allow-same-origin|"[^"]*allow-scripts[[:space:]]+allow-same-origin)' \
     apps/web/src/components/canvas/ \
     "apps/web/src/app/[locale]/canvas/" 2>/dev/null \
   | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|\*)' ; then
  echo "  FAIL: allow-same-origin granted in a sandbox value — sandbox escape risk"
  FAIL=1
fi

echo "[canvas-guard] checking postMessage('*') in canvas runtime..."
if grep -RnE 'postMessage\([^,]*,\s*"\*"' \
     apps/web/src/components/canvas/ 2>/dev/null; then
  echo "  FAIL: wildcard postMessage found — origin must be pinned"
  FAIL=1
fi

echo "[canvas-guard] checking Pyodide floating-tag CDN URLs..."
if grep -RnE "pyodide/(latest|v@latest)" apps/web/src/ 2>/dev/null; then
  echo "  FAIL: Pyodide floating tag found — pin to vX.Y.Z"
  FAIL=1
fi

echo "[canvas-guard] checking Monaco is not loaded from a CDN..."
# Monaco must be self-hosted via @monaco-editor/react webpack bundling.
# A reference to monaco-editor.min.js or the monaco loader from cdnjs/jsdelivr
# in app source would mean we're loading editor JS from a third party,
# which (a) defeats the offline-friendly Docker deploy story and (b) widens
# our CSP attack surface (cdn.jsdelivr.net is currently allowed for Pyodide
# only — Monaco landing there would silently extend that allowance).
if grep -RnE "(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)/.*monaco-editor" apps/web/src/ 2>/dev/null; then
  echo "  FAIL: Monaco CDN reference detected — must self-host via @monaco-editor/react"
  FAIL=1
fi

echo "[canvas-guard] checking SSE response uses text/event-stream..."
# /api/code/runs/:runId/stream MUST emit text/event-stream Content-Type so
# browser EventSource consumers can attach. A regression to application/json
# would break the streaming UI silently. We assert positive presence of the
# text/event-stream literal in apps/api/src/routes/code.ts rather than
# scanning for application/json (which legitimately appears on POST routes).
if ! grep -q "text/event-stream" apps/api/src/routes/code.ts 2>/dev/null; then
  echo "  FAIL: /api/code/runs/:runId/stream must set text/event-stream Content-Type"
  FAIL=1
fi

if [[ $FAIL -ne 0 ]]; then
  echo "[canvas-guard] FAIL"
  exit 1
fi

echo "[canvas-guard] PASS"
