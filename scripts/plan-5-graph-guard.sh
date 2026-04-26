#!/usr/bin/env bash
#
# Plan 5 Phase 1 — Knowledge Graph regression guards.
#
# Each rule below encodes an invariant the Plan 5 codebase must NEVER
# regress. CI (or any pre-PR check) should run this script and fail on
# any non-zero exit.
#
# 1. Cytoscape package versions MUST be pinned (no `latest`, no `*`).
#    A floating tag would let a Cytoscape major bump silently break the
#    graph viewer between deploys.
#
# 2. Wiki-link Plate node `type` key MUST stay `"wiki-link"`. The
#    Hocuspocus extractor (apps/hocuspocus/src/wiki-link-sync.ts) walks
#    Plate values looking for nodes whose `type === "wiki-link"`. Renaming
#    the editor-side key without updating the extractor breaks every
#    backlinks insert silently.
#
# 3. ProjectGraph MUST use `dynamic(() => import("react-cytoscapejs"))`,
#    NEVER a top-level static import. Cytoscape needs DOM/window;
#    server-side rendering would crash with `window is not defined`.
#
# Run: bash scripts/plan-5-graph-guard.sh
# Exit codes: 0 = clean, 1 = violation found.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

FAIL=0

echo "[plan-5-guard] checking cytoscape version pins in apps/web/package.json..."
if grep -nE '"cytoscape(-fcose|-dagre)?"\s*:\s*"(latest|\*)"' apps/web/package.json 2>/dev/null; then
  echo "  FAIL: cytoscape package pinned to latest/* — pin to ^x.y or x.y.z"
  FAIL=1
fi
if grep -nE '"react-cytoscapejs"\s*:\s*"(latest|\*)"' apps/web/package.json 2>/dev/null; then
  echo "  FAIL: react-cytoscapejs pinned to latest/* — pin to ^x.y or x.y.z"
  FAIL=1
fi

echo "[plan-5-guard] checking wiki-link Plate node type key invariants..."
if ! grep -q 'type: "wiki-link"' apps/web/src/components/editor/elements/wiki-link-element.tsx 2>/dev/null; then
  echo "  FAIL: wiki-link element type key missing — Hocuspocus extractor would silently break"
  FAIL=1
fi
if ! grep -q 'WIKILINK_KEY = "wiki-link"' apps/web/src/components/editor/plugins/wiki-link.tsx 2>/dev/null; then
  echo "  FAIL: WIKILINK_KEY constant value drifted — extractor relies on the literal 'wiki-link'"
  FAIL=1
fi

echo "[plan-5-guard] checking ProjectGraph SSR safety (no top-level react-cytoscapejs import)..."
# A direct top-level static import would SSR-mount Cytoscape and crash on
# window. The dynamic(() => import(...)) pattern is the only allowed form.
# We allow `import type` since it is erased at compile time.
if grep -nE '^[[:space:]]*import[[:space:]]+[^t][^y][^p][^e]?[^"]*from[[:space:]]+"react-cytoscapejs"' \
     apps/web/src/components/graph/ProjectGraph.tsx 2>/dev/null; then
  echo "  FAIL: top-level static import of react-cytoscapejs — must use dynamic() with ssr:false"
  FAIL=1
fi

# ─── Plan 5 Phase 2 guards ──────────────────────────────────────────────
#
# 4. ViewSpec MUST be registered in SCHEMA_REGISTRY. The terminal path of
#    VisualizationAgent calls emit_structured_output(schema_name="ViewSpec",
#    data=...); if the registration disappears (e.g. an import-side-effect
#    refactor), the agent loop runs to max-steps and the SSE stream never
#    emits `event: view_spec`.
#
# 5. SSE event tokens (`view_spec`, `tool_use`, `done`) MUST exist in the
#    /api/visualize bridge. The web client (useVisualizeMutation) parses
#    these by exact string match — silently dropping a token would freeze
#    the dialog progress feed without any error.
#
# 6. ViewType enum in @opencairn/shared MUST list all 5 view names
#    (graph, mindmap, cards, timeline, board) on the same line. The
#    UI ViewSwitcher + worker-side prompt rely on the full set; dropping
#    one would silently 400 every visualize request that targets it.

echo "[plan-5-guard] checking ViewSpec SCHEMA_REGISTRY registration..."
if ! grep -q 'register_schema("ViewSpec"' \
     apps/worker/src/worker/tools_builtin/view_spec_schema.py 2>/dev/null; then
  echo "  FAIL: ViewSpec is not registered in SCHEMA_REGISTRY — VisualizationAgent terminal path broken"
  FAIL=1
fi

echo "[plan-5-guard] checking SSE event tokens in temporal-visualize bridge..."
if ! grep -q "event: view_spec" apps/api/src/lib/temporal-visualize.ts 2>/dev/null; then
  echo "  FAIL: 'event: view_spec' SSE token missing — client never receives terminal payload"
  FAIL=1
fi
if ! grep -q "event: tool_use" apps/api/src/lib/temporal-visualize.ts 2>/dev/null; then
  echo "  FAIL: 'event: tool_use' SSE token missing — VisualizeProgress feed silently freezes"
  FAIL=1
fi
if ! grep -q "event: done" apps/api/src/lib/temporal-visualize.ts 2>/dev/null; then
  echo "  FAIL: 'event: done' SSE token missing — client connection never closes cleanly"
  FAIL=1
fi

echo "[plan-5-guard] checking ViewType enum has all 5 view names..."
if ! grep -qE 'graph.*mindmap.*cards.*timeline.*board' \
     packages/shared/src/api-types.ts 2>/dev/null; then
  echo "  FAIL: ViewType enum missing one of {graph, mindmap, cards, timeline, board}"
  FAIL=1
fi

if [[ $FAIL -ne 0 ]]; then
  echo "[plan-5-guard] FAIL"
  exit 1
fi

echo "[plan-5-guard] PASS"
