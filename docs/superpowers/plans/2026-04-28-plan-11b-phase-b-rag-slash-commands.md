# Plan 11B Phase B — RAG Slash Commands (`/cite` + `/factcheck`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Phase A `DocEditorAgent` foundation with two RAG-backed commands — `/cite` (auto-attach citation footnotes via diff hunks) and `/factcheck` (per-claim verdict comments in the comment lane with inline 🟢/🟡/🔴 markers) — behind a new `FEATURE_DOC_EDITOR_RAG` flag layered on top of `FEATURE_DOC_EDITOR_SLASH`.

**Architecture:** Reuse the project-scoped `search_notes` builtin tool (already wraps `hybrid_search_notes`) — DocEditor commands simply opt into it via the new `tools` field on `CommandSpec` and run through `ToolLoopExecutor`. `/cite` keeps `output_mode='diff'` so Phase A's `InlineDiffSheet` renders it unchanged. `/factcheck` adds `output_mode='comment'`: the agent emits a `claims[]` payload, the API materializes one `comments` row per claim (no migration — `bodyAst` carries `agentKind`/`command`/`verdict`/`evidence`/`triggeredBy`, `authorId` is the triggering user), and a new Plate decoration plugin renders inline verdict badges by reading those tagged comments.

**Tech Stack:** Python 3.12 + `runtime.agent.Agent` + `runtime.tool_loop.ToolLoopExecutor` + `packages/llm` Gemini/Ollama (worker), Hono 4 SSE + Drizzle (api), Plate v49 + decoration plugin (web), Vitest + pytest.

**Spec:** `docs/superpowers/specs/2026-04-21-plan-11b-chat-editor-knowledge-loop-design.md` §6 (Slash Commands) — specifically §6.1 rows for `/cite` + `/factcheck`, §6.6 Comment lane payload, §6.9 error paths.

**Predecessor plan:** `docs/superpowers/plans/2026-04-28-plan-11b-phase-a-slash-commands.md` — Phase B assumes Phase A is merged first. File layout, SSE wire format, audit-row writes, `applyHunks` transform, and the slash menu's "AI" section all come from Phase A; this plan layers onto them.

**Dependencies:**
- ✅ Plan 11B Phase A — `DocEditorAgent`, `CommandSpec`, `doc_editor_calls` table, `InlineDiffSheet`, slash menu AI section, SSE encoder/parser, `applyHunks`.
- ✅ Plan 4 Phase B — `search_notes` builtin tool (`apps/worker/src/worker/tools_builtin/search_notes.py`) wraps `AgentApiClient.hybrid_search_notes` and is `allowed_scopes=("project",)`.
- ✅ Plan 12 (Agent Runtime v2 Sub-A) — `ToolLoopExecutor` (`apps/worker/src/runtime/tool_loop.py`) and `emit_structured_output` builtin.
- ✅ Plan 2C — `comments` table, `comment_reply` notification path (left untouched here).
- ✅ Plan 4 — `comments.bodyAst jsonb` column (already present).

**Out of scope (deferred):**
- Tab Mode `diff` viewer + per-hunk granular accept/reject — Phase C.
- Save Suggestion (§4) — Phase D.
- Page Provenance (§5) — Phase E.
- Related Pages (§7) — Phase F.
- Claim row resolution UX (mark verdict as resolved) — folded into Phase C alongside the real Diff View.
- Multi-block `/factcheck` over a whole section — out of v1 (§6.10 explicit non-goal).

**No DB migration:** Phase B reuses `doc_editor_calls` (Phase A) and `comments`/`comment_mentions` (Plan 2C). All factcheck metadata lives in `comments.bodyAst`. If a future task discovers the FK on `comments.author_id → user.id` blocks the design, the contingency in Task 7 is to fall back to the **triggering user as author** with `bodyAst.agentKind` flagging the row — this is the chosen default and avoids any seed migration.

**Feature flag layering:**
- `FEATURE_DOC_EDITOR_SLASH=true` — Phase A (kept identical).
- `FEATURE_DOC_EDITOR_RAG=true` — Phase B. Independently gated; the API rejects `/cite` and `/factcheck` with 404 when off, so the AI section in the slash menu hides those rows but keeps the Phase A four. When `_RAG=true` but `_SLASH=false`, the route is unreachable (the router itself only mounts when `_SLASH=true`).

---

## File Map

### packages/shared
- **Modify** `src/doc-editor.ts` — extend command enum, add comment payload + claim schemas, extend SSE event union with `output_mode: 'comment'` and a `factcheck_comments_inserted` event.
- **Modify** `tests/doc-editor.test.ts` — coverage for new schemas and the existing schema regressions.

### apps/worker
- **Modify** `src/worker/agents/doc_editor/commands/spec.py` — add `tools: tuple[str, ...]` (tool *names* — registry resolves at runtime; keeps the dataclass picklable for Temporal). Bump `OutputMode` to include `comment` (already declared in Phase A `Literal`, but only "diff" was used).
- **Modify** `src/worker/agents/doc_editor/commands/__init__.py` — register `cite` + `factcheck`.
- **Create** `src/worker/agents/doc_editor/commands/cite.py` — system prompt + spec.
- **Create** `src/worker/agents/doc_editor/commands/factcheck.py` — system prompt + spec.
- **Modify** `src/worker/agents/doc_editor/agent.py` — branch `run` on `spec.tools` (empty → Phase A path, non-empty → tool-loop path) and on `spec.output_mode` (diff vs comment payload parsing).
- **Modify** `src/worker/activities/doc_editor_activity.py` — accept `project_id` in input (already present on `notes`; resolved API-side, see Task 8). Inject `project_id` into `ToolContext` so `search_notes` (project-scoped) can run.
- **Modify** `src/worker/workflows/doc_editor_workflow.py` — pass `project_id` through (no logic change beyond field forwarding).
- **Create** `tests/agents/test_doc_editor_cite.py` — `/cite` happy path + zero-evidence case.
- **Create** `tests/agents/test_doc_editor_factcheck.py` — `/factcheck` happy path + all-unclear case + claim payload shape.
- **Modify** `tests/agents/test_doc_editor_agent.py` — guardrail test: empty tools list still uses the Phase A code path verbatim.

### apps/api
- **Modify** `src/routes/doc-editor.ts` — accept `cite` and `factcheck` (after Zod gate updated), look up `note.projectId`, forward to workflow; for `comment` output mode, materialize `comments` rows in a single transaction and emit `factcheck_comments_inserted` SSE event with the new comment ids; second feature flag `FEATURE_DOC_EDITOR_RAG`.
- **Modify** `tests/doc-editor.test.ts` — add `/cite` and `/factcheck` route tests (mocked workflow), `_RAG=false` rejects, comment rows materialized.
- **Create** `src/lib/doc-editor-comments.ts` — pure helper that converts a `claims` payload into `commentInsert[]` rows (so we can unit-test without the route).
- **Create** `tests/doc-editor-comments.test.ts`.

### apps/web
- **Modify** `src/lib/api/doc-editor.ts` — extend `parseSseChunk` for the new event variants (Zod already throws on unknown — extend the schema in `packages/shared` first, this just inherits).
- **Modify** `src/hooks/useDocEditorCommand.ts` — add a `comment` ready state with `claims` + `commentIds` payload; surface the in-flight tool-call count for a "Searching the wiki…" sub-status.
- **Modify** `src/components/editor/doc-editor/InlineDiffSheet.tsx` — when `currentCommand === 'factcheck'` and state is `ready-comment`, render a tiny "N claims added to comment lane" panel + a "Show in comments" button that scrolls the right rail to the new comments. (No diff hunks for factcheck — there are none.)
- **Modify** `src/components/editor/plugins/slash.tsx` — append `/cite` + `/factcheck` to the AI section, gated on a runtime flag exposed via `NEXT_PUBLIC_FEATURE_DOC_EDITOR_RAG` (mirrors how Phase A keys off `NEXT_PUBLIC_FEATURE_DOC_EDITOR_SLASH`; see app.tsx for an existing example).
- **Create** `src/components/editor/plugins/factcheck-decorations.tsx` — Plate plugin: walks `comments` (passed as a memoized list prop) where `bodyAst.agentKind === 'doc_editor'` and `bodyAst.command === 'factcheck'`; emits `Range[]` decorations keyed to `(noteId, blockId, anchor.start, anchor.end)` with `factcheckVerdict: 'supported' | 'unclear' | 'contradicted'`; renders a leaf-level emoji indicator (🟢/🟡/🔴) and a tooltip with the claim's `note` excerpt.
- **Create** `src/components/editor/plugins/__tests__/factcheck-decorations.test.ts` — pure decoration computation test.
- **Modify** `src/components/editor/NoteEditor.tsx` — register the new decoration plugin; subscribe to the existing comments query and pass through; route the `/cite` and `/factcheck` slash actions to `useDocEditorCommand`.
- **Modify** `messages/ko/doc-editor.json` + `messages/en/doc-editor.json` — new keys (cite/factcheck label, factcheck verdict labels, "Searching wiki" sub-status, "Comments added" toast/CTA, evidence list strings, error strings).

### docs
- **Modify** `docs/architecture/api-contract.md` — append the `_RAG` flag and the comment-mode SSE event to the doc-editor row Phase A added.
- **Modify** `docs/contributing/plans-status.md` — add the Plan 11B Phase B entry.
- **Modify** `CLAUDE.md` — append Phase B to the Plans roster (only if Phase A entry already exists; otherwise append both).

---

## Task 1: Shared — extend Zod for `/cite` + `/factcheck` + comment SSE events

**Files:**
- Modify: `packages/shared/src/doc-editor.ts`
- Modify: `packages/shared/tests/doc-editor.test.ts`

- [ ] **Step 1: Append failing tests for the new schemas**

Open `packages/shared/tests/doc-editor.test.ts` and append:

```ts
import {
  docEditorClaimSchema,
  docEditorCommentPayloadSchema,
} from "../src/doc-editor";

describe("doc-editor zod — Phase B additions", () => {
  it("accepts cite + factcheck in the v2 command set", () => {
    expect(docEditorCommandSchema.safeParse("cite").success).toBe(true);
    expect(docEditorCommandSchema.safeParse("factcheck").success).toBe(true);
    // outline still rejected (Phase B does not add it)
    expect(docEditorCommandSchema.safeParse("outline").success).toBe(false);
  });

  it("validates a factcheck claim with evidence", () => {
    const ok = docEditorClaimSchema.safeParse({
      blockId: "b1",
      range: { start: 10, end: 42 },
      verdict: "supported",
      evidence: [
        {
          source_id: "00000000-0000-0000-0000-000000000001",
          snippet: "The paper reports 84% accuracy on MNIST.",
          url_or_ref: "https://example.com/paper",
          confidence: 0.82,
        },
      ],
      note: "Two independent sources confirm.",
    });
    expect(ok.success).toBe(true);
  });

  it("rejects a verdict outside the closed set", () => {
    const bad = docEditorClaimSchema.safeParse({
      blockId: "b1",
      range: { start: 0, end: 5 },
      verdict: "maybe",
      evidence: [],
      note: "",
    });
    expect(bad.success).toBe(false);
  });

  it("comment payload requires at least one claim", () => {
    const empty = docEditorCommentPayloadSchema.safeParse({ claims: [] });
    expect(empty.success).toBe(false);
  });

  it("doc_editor_result accepts output_mode='comment' with claims payload", () => {
    const ev = docEditorSseEventSchema.safeParse({
      type: "doc_editor_result",
      output_mode: "comment",
      payload: {
        claims: [
          {
            blockId: "b1",
            range: { start: 0, end: 5 },
            verdict: "unclear",
            evidence: [],
            note: "no evidence found",
          },
        ],
      },
    });
    expect(ev.success).toBe(true);
  });

  it("recognizes factcheck_comments_inserted SSE event", () => {
    const ev = docEditorSseEventSchema.safeParse({
      type: "factcheck_comments_inserted",
      commentIds: ["00000000-0000-0000-0000-000000000001"],
    });
    expect(ev.success).toBe(true);
  });
});
```

- [ ] **Step 2: Verify failure**

```
pnpm --filter @opencairn/shared test -- doc-editor
```
Expected: 6 FAIL — `docEditorClaimSchema` / `docEditorCommentPayloadSchema` not exported, comment branch missing from union, `cite`/`factcheck` not in enum, `factcheck_comments_inserted` not in union.

- [ ] **Step 3: Extend the schema**

Open `packages/shared/src/doc-editor.ts` and replace the current `docEditorCommandSchema` + `docEditorSseEventSchema` blocks. Keep all the Phase A schemas intact; only add to them.

```ts
// v2 command set — Plan 11B Phase B layers /cite + /factcheck on top of
// the four LLM-only commands. /cite returns diff hunks; /factcheck returns
// claims that the API materializes as comments. The wire schema is open
// to additional commands but the API gates them with feature flags.
export const docEditorCommandSchema = z.enum([
  "improve",
  "translate",
  "summarize",
  "expand",
  "cite",
  "factcheck",
]);
export type DocEditorCommand = z.infer<typeof docEditorCommandSchema>;
```

Append below the `docEditorDiffPayloadSchema`:

```ts
// Phase B — factcheck claim. `range` is the position inside the block's
// flattened text, mirroring `docEditorHunkSchema.originalRange`. `evidence`
// may be empty (verdict='unclear' with note='no sources found' is honest).
export const docEditorClaimSchema = z.object({
  blockId: z.string().min(1).max(64),
  range: z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  }),
  verdict: z.enum(["supported", "unclear", "contradicted"]),
  evidence: z
    .array(
      z.object({
        // source_id is whichever stable identifier the search tool returns;
        // for /cite + /factcheck via search_notes that's noteId (uuid).
        // Kept loose so future external sources (web fetch) fit the same shape.
        source_id: z.string().min(1).max(128),
        snippet: z.string().max(800),
        url_or_ref: z.string().max(512).optional(),
        confidence: z.number().min(0).max(1).optional(),
      }),
    )
    .max(8),
  note: z.string().max(280),
});
export type DocEditorClaim = z.infer<typeof docEditorClaimSchema>;

export const docEditorCommentPayloadSchema = z.object({
  claims: z.array(docEditorClaimSchema).min(1).max(20),
});
export type DocEditorCommentPayload = z.infer<typeof docEditorCommentPayloadSchema>;
```

Replace the `docEditorSseEventSchema` discriminated union (extend it; keep the existing branches intact):

```ts
export const docEditorSseEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("delta"), text: z.string() }),
  z.object({
    type: z.literal("doc_editor_result"),
    output_mode: z.enum(["diff", "comment"]),
    payload: z.union([
      docEditorDiffPayloadSchema,
      docEditorCommentPayloadSchema,
    ]),
  }),
  // Phase B — emitted by the API after writing N comment rows for /factcheck.
  // Lets the web layer scroll the right-rail comments view to the new ids.
  z.object({
    type: z.literal("factcheck_comments_inserted"),
    commentIds: z.array(z.string().uuid()).max(20),
  }),
  // Phase B — surfaces the in-flight tool count so the UI can render
  // "Searching the wiki… (2 sources)". Optional event; UI must work
  // without it.
  z.object({
    type: z.literal("tool_progress"),
    tool: z.literal("search_notes"),
    callCount: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("cost"),
    tokens_in: z.number().int().nonnegative(),
    tokens_out: z.number().int().nonnegative(),
    cost_krw: z.number().nonnegative(),
  }),
  z.object({
    type: z.literal("error"),
    code: z.enum([
      "llm_failed",
      "selection_race",
      "command_unknown",
      "internal",
      // Phase B — dedicated codes
      "rag_no_results",
      "rag_quota_exceeded",
    ]),
    message: z.string(),
  }),
  z.object({ type: z.literal("done") }),
]);
export type DocEditorSseEvent = z.infer<typeof docEditorSseEventSchema>;
```

- [ ] **Step 4: Verify pass**

```
pnpm --filter @opencairn/shared test -- doc-editor
```
Expected: PASS — Phase A's 3 tests + Phase B's 6 tests = 9 PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/doc-editor.ts packages/shared/tests/doc-editor.test.ts
git commit -m "feat(shared): extend doc-editor zod with /cite, /factcheck, comment payloads (Plan 11B-B)"
```

---

## Task 2: Worker — extend `CommandSpec` with `tools` field

**Files:**
- Modify: `apps/worker/src/worker/agents/doc_editor/commands/spec.py`
- Modify: `apps/worker/tests/agents/test_doc_editor_commands.py`

- [ ] **Step 1: Append failing test**

In `apps/worker/tests/agents/test_doc_editor_commands.py`, append:

```python
def test_command_spec_supports_tools_tuple():
    """Phase B — CommandSpec carries an optional tuple of tool names."""
    from worker.agents.doc_editor.commands.spec import CommandSpec

    spec = CommandSpec(
        name="cite",
        system_prompt="x",
        output_mode="diff",
        tools=("search_notes", "emit_structured_output"),
    )
    assert spec.tools == ("search_notes", "emit_structured_output")


def test_phase_a_specs_have_empty_tools_tuple():
    """Phase A specs default to no tools so their behavior is unchanged."""
    from worker.agents.doc_editor.commands import COMMANDS

    for name in ("improve", "translate", "summarize", "expand"):
        assert COMMANDS[name].tools == ()
```

- [ ] **Step 2: Verify failure**

```
pnpm --filter @opencairn/worker exec pytest tests/agents/test_doc_editor_commands.py -v
```
Expected: 2 FAIL — `tools` attribute missing.

- [ ] **Step 3: Extend `CommandSpec`**

Open `apps/worker/src/worker/agents/doc_editor/commands/spec.py`. The Phase A file declares `OutputMode = Literal["diff", "comment", "insert"]` already. Add the `tools` field with a default empty tuple so Phase A specs don't need touching:

```python
"""Plan 11B — CommandSpec dataclass (Phase A + B)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


OutputMode = Literal["diff", "comment", "insert"]


@dataclass(frozen=True)
class CommandSpec:
    """Per-slash-command configuration.

    Phase A: `tools=()`, `output_mode='diff'`. The agent calls the LLM once
    via `provider.generate(..., response_mime_type='application/json')`.

    Phase B: `tools=(...)` is non-empty → the agent runs through
    `runtime.tool_loop.ToolLoopExecutor` with the named tools resolved
    from the global tool registry. `output_mode` may be 'diff' (e.g.
    /cite) or 'comment' (e.g. /factcheck).

    Phase C may add 'insert' for /summarize-below.

    Tool *names* (not Tool instances) are stored here so the dataclass
    stays frozen + picklable; Temporal serializes activity inputs via
    JSON, and Tool objects don't survive that round-trip cleanly.
    """

    name: str
    system_prompt: str
    output_mode: OutputMode
    max_selection_chars: int = 4000
    tools: tuple[str, ...] = field(default_factory=tuple)
```

- [ ] **Step 4: Verify pass**

```
pnpm --filter @opencairn/worker exec pytest tests/agents/test_doc_editor_commands.py -v
```
Expected: PASS — Phase A's 3 tests + Phase B's 2 tests = 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker/agents/doc_editor/commands/spec.py apps/worker/tests/agents/test_doc_editor_commands.py
git commit -m "feat(worker): CommandSpec.tools tuple for RAG-backed slash commands (Plan 11B-B)"
```

---

## Task 3: Worker — `/cite` command spec

**Files:**
- Create: `apps/worker/src/worker/agents/doc_editor/commands/cite.py`
- Modify: `apps/worker/src/worker/agents/doc_editor/commands/__init__.py`
- Modify: `apps/worker/tests/agents/test_doc_editor_commands.py`

- [ ] **Step 1: Append failing registry test**

In `apps/worker/tests/agents/test_doc_editor_commands.py`, replace the `test_registry_lists_v1_commands` body with the v2 list and add a cite-specific assertion:

```python
def test_registry_lists_v2_commands():
    assert sorted(COMMANDS.keys()) == [
        "cite",
        "expand",
        "factcheck",
        "improve",
        "summarize",
        "translate",
    ]


def test_cite_spec_uses_search_notes_tool_and_diff_output():
    spec = COMMANDS["cite"]
    assert spec.output_mode == "diff"
    assert "search_notes" in spec.tools
    assert "emit_structured_output" in spec.tools
```

(Delete the old `test_registry_lists_v1_commands` if it's still present, or update its assertion to the new v2 list.)

- [ ] **Step 2: Verify failure**

```
pnpm --filter @opencairn/worker exec pytest tests/agents/test_doc_editor_commands.py -v
```
Expected: FAIL — `cite` not registered.

- [ ] **Step 3: Implement the spec**

```python
# apps/worker/src/worker/agents/doc_editor/commands/cite.py
"""Plan 11B Phase B — /cite command.

Drops citation footnote markers (`[^1]`, `[^2]`, …) into the user's
selection and appends a bibliography block at the end of the selection.
RAG via `search_notes` (project-scoped); structured output via
`emit_structured_output`. Returns diff hunks — Phase A's InlineDiffSheet
+ applyHunks render and apply unchanged.
"""
from __future__ import annotations

from worker.agents.doc_editor.commands.spec import CommandSpec

CITE_SYSTEM = """You are a citation-augmenter for a research-grade
knowledge base. The user has selected a passage; your job is to:

1. Identify factual claims in the selection that warrant a citation.
   Skip first-person opinion, numerical examples, and obvious general
   knowledge. Aim for high precision — a single, well-grounded marker
   is better than many speculative ones.

2. For each claim, call the `search_notes` tool with a focused
   sub-query (3-12 words) that captures the claim. Read the snippets;
   if no result has rrfScore ≥ 0.20, do NOT cite that claim — leave the
   prose unchanged. Cap the number of `search_notes` calls at 3.

3. Insert footnote markers (`[^1]`, `[^2]`, …) immediately after the
   final character of each cited claim. Renumber sequentially in
   document order. Do NOT touch other text inside the selection.

4. Append a single bibliography block at the very end of the selection
   in the format:

       \\n\\n[^1]: <Title> — <noteId>
       [^2]: <Title> — <noteId>

   (Newlines literal. The doc-editor renderer will keep them as a final
   block.) Use the noteId returned by `search_notes`.

5. Submit the result via `emit_structured_output` with the schema:

   {
     "hunks": [{
       "blockId": "<echo input blockId>",
       "originalRange": { "start": <int>, "end": <int> },
       "originalText": "<full original selection>",
       "replacementText": "<original prose with [^n] markers + bibliography appended>"
     }],
     "summary": "<≤140 chars, e.g. 'Cited 2 claims from 2 sources'>"
   }

If no claim warrants citation, submit a single hunk where
replacementText equals originalText and summary='No claims to cite'.
Do NOT fabricate citations or sources."""

SPEC = CommandSpec(
    name="cite",
    system_prompt=CITE_SYSTEM,
    output_mode="diff",
    tools=("search_notes", "emit_structured_output"),
)
```

- [ ] **Step 4: Register in `__init__.py`**

Open `apps/worker/src/worker/agents/doc_editor/commands/__init__.py` and add the import + dict entry. The Phase A file already exports `COMMANDS`; add `cite` and the upcoming `factcheck` (declared as a forward reference so this task compiles even before Task 4 lands; the `factcheck.py` import in Task 4 will fix the ImportError):

```python
"""Plan 11B Phase A + B command registry."""
from __future__ import annotations

from worker.agents.doc_editor.commands import (
    cite,
    expand,
    factcheck,
    improve,
    summarize,
    translate,
)
from worker.agents.doc_editor.commands.spec import CommandSpec, OutputMode

COMMANDS: dict[str, CommandSpec] = {
    improve.SPEC.name: improve.SPEC,
    translate.SPEC.name: translate.SPEC,
    summarize.SPEC.name: summarize.SPEC,
    expand.SPEC.name: expand.SPEC,
    cite.SPEC.name: cite.SPEC,
    factcheck.SPEC.name: factcheck.SPEC,
}


def get_command_spec(name: str) -> CommandSpec:
    return COMMANDS[name]


__all__ = ["COMMANDS", "CommandSpec", "OutputMode", "get_command_spec"]
```

(Tests run after Task 4 — leaving the imports broken between Task 3 and 4 is acceptable on a single branch since both land before the next test step. If you ran tests now they'd fail on the missing `factcheck` module.)

- [ ] **Step 5: Commit (intentionally not running tests yet — Task 4 lands `factcheck.py`)**

```bash
git add apps/worker/src/worker/agents/doc_editor/commands/cite.py apps/worker/src/worker/agents/doc_editor/commands/__init__.py apps/worker/tests/agents/test_doc_editor_commands.py
git commit -m "feat(worker): /cite CommandSpec + system prompt (Plan 11B-B)"
```

---

## Task 4: Worker — `/factcheck` command spec

**Files:**
- Create: `apps/worker/src/worker/agents/doc_editor/commands/factcheck.py`
- Modify: `apps/worker/tests/agents/test_doc_editor_commands.py`

- [ ] **Step 1: Append failing tests**

In `apps/worker/tests/agents/test_doc_editor_commands.py`:

```python
def test_factcheck_spec_uses_search_notes_tool_and_comment_output():
    spec = COMMANDS["factcheck"]
    assert spec.output_mode == "comment"
    assert "search_notes" in spec.tools
    assert "emit_structured_output" in spec.tools
```

- [ ] **Step 2: Verify failure**

```
pnpm --filter @opencairn/worker exec pytest tests/agents/test_doc_editor_commands.py -v
```
Expected: FAIL — `factcheck` module not found (Task 3 left it as a forward ref).

- [ ] **Step 3: Implement the spec**

```python
# apps/worker/src/worker/agents/doc_editor/commands/factcheck.py
"""Plan 11B Phase B — /factcheck command.

Per-claim verdict pass over a selection. Output is a list of `claims`
with verdict ∈ {supported, unclear, contradicted}, evidence snippets,
and a short note. The API materializes one comment row per claim with
`bodyAst.agentKind='doc_editor'` so the editor's Plate decoration
plugin can render inline 🟢/🟡/🔴 markers.
"""
from __future__ import annotations

from worker.agents.doc_editor.commands.spec import CommandSpec

FACTCHECK_SYSTEM = """You are a careful fact-checker for a personal
knowledge base. The user has selected a passage; your job is to:

1. Decompose the selection into atomic factual claims (max 8). A claim
   is a single, checkable assertion (one date, one number, one
   relationship, etc.). Skip rhetorical questions, the author's
   explicit opinions, and things that depend on definitions only.

2. For each claim, call `search_notes` with a focused sub-query
   (3-12 words). Read every returned snippet. Cap total tool calls at 6
   across the whole pass.

3. Decide verdict ∈ {supported, unclear, contradicted}:
   - 'supported': ≥1 source explicitly confirms the claim.
   - 'contradicted': ≥1 source explicitly contradicts the claim AND
     no other source supports it. Be conservative — only mark
     contradicted when the conflict is direct.
   - 'unclear': no usable evidence either way, or sources disagree
     among themselves with comparable weight.

4. For each claim, record the substring range inside the block (start,
   end character offsets in the flattened block text). The user
   message will give you the block text and an explicit start/end
   offset for the selection — your claim ranges must be inside that
   selection.

5. For each claim, attach 0-3 evidence entries (`{source_id, snippet,
   url_or_ref?, confidence?}`). `source_id` is the noteId returned by
   `search_notes`. `snippet` ≤ 800 chars; trim to the most relevant
   span. Confidence is a 0-1 float — your subjective signal strength.

6. `note` is a one-sentence (≤280 chars) summary of *why* you reached
   this verdict. Honest > hedged. Empty `evidence` is acceptable when
   verdict='unclear'; never claim 'supported' without evidence.

7. Submit via `emit_structured_output`:

   {
     "claims": [{
       "blockId": "<echo input>",
       "range": { "start": <int>, "end": <int> },
       "verdict": "supported"|"unclear"|"contradicted",
       "evidence": [{ "source_id": "...", "snippet": "...",
                       "url_or_ref": "...", "confidence": 0.7 }],
       "note": "..."
     }, ...]
   }

If the selection contains no checkable claims, return a single claim
covering the entire selection with verdict='unclear', empty evidence,
and note='No checkable claims in this passage.'"""

SPEC = CommandSpec(
    name="factcheck",
    system_prompt=FACTCHECK_SYSTEM,
    output_mode="comment",
    tools=("search_notes", "emit_structured_output"),
)
```

- [ ] **Step 4: Verify pass**

```
pnpm --filter @opencairn/worker exec pytest tests/agents/test_doc_editor_commands.py -v
```
Expected: PASS — 5 tests (3 Phase A + 2 from Task 2 + Task 3's two new + Task 4's). Total 7.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker/agents/doc_editor/commands/factcheck.py apps/worker/tests/agents/test_doc_editor_commands.py
git commit -m "feat(worker): /factcheck CommandSpec + system prompt (Plan 11B-B)"
```

---

## Task 5: Worker — `DocEditorAgent` tool-loop branch (used by `/cite`)

**Files:**
- Modify: `apps/worker/src/worker/agents/doc_editor/agent.py`
- Create: `apps/worker/tests/agents/test_doc_editor_cite.py`

- [ ] **Step 1: Write the failing happy-path test**

```python
# apps/worker/tests/agents/test_doc_editor_cite.py
"""Plan 11B Phase B — /cite happy path through the tool loop."""
from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from llm.tool_types import ToolUse, ToolLoopTurn, ToolUsage
from runtime.events import AgentEnd, AgentStart, ModelEnd, ToolUse as ToolUseEvent
from runtime.tools import ToolContext
from worker.agents.doc_editor.agent import DocEditorAgent, DocEditorOutput


def _ctx(project_id: str = "proj-1") -> ToolContext:
    async def _emit(_ev: Any) -> None:
        return None
    return ToolContext(
        run_id="run-test",
        workspace_id="ws-test",
        project_id=project_id,
        page_id=None,
        user_id="user-1",
        scope="project",
        emit=_emit,
    )


@pytest.mark.asyncio
async def test_cite_calls_search_notes_then_emits_diff():
    """Two-turn loop: turn 1 calls search_notes, turn 2 calls emit_structured_output."""
    fake_search_result = [
        {
            "noteId": "11111111-1111-1111-1111-111111111111",
            "title": "MNIST Benchmark",
            "snippet": "84.2% accuracy reported on test split.",
            "rrfScore": 0.42,
        }
    ]
    structured_payload = {
        "hunks": [
            {
                "blockId": "b1",
                "originalRange": {"start": 0, "end": 30},
                "originalText": "MNIST hits 84% accuracy here.",
                "replacementText": (
                    "MNIST hits 84% accuracy here.[^1]\n\n"
                    "[^1]: MNIST Benchmark — 11111111-1111-1111-1111-111111111111"
                ),
            }
        ],
        "summary": "Cited 1 claim from 1 source",
    }

    # The provider's generate_with_tools yields two turns; we mock both.
    turn1 = ToolLoopTurn(
        assistant_message={"role": "assistant", "content": ""},
        tool_uses=[
            ToolUse(
                id="t1",
                name="search_notes",
                args={"query": "MNIST 84% accuracy"},
            )
        ],
        final_text=None,
        structured_output=None,
        usage=ToolUsage(input_tokens=200, output_tokens=20),
    )
    turn2 = ToolLoopTurn(
        assistant_message={"role": "assistant", "content": ""},
        tool_uses=[
            ToolUse(
                id="t2",
                name="emit_structured_output",
                args={"value": structured_payload},
            )
        ],
        final_text=None,
        structured_output=None,
        usage=ToolUsage(input_tokens=400, output_tokens=180),
    )
    provider = MagicMock()
    provider.config.model = "gemini-2.5-flash"
    provider.generate_with_tools = AsyncMock(side_effect=[turn1, turn2])
    provider.tool_result_to_message = lambda r: {
        "role": "tool",
        "content": json.dumps(r.data),
    }

    # Stub the search_notes tool registry lookup
    fake_search_tool = MagicMock()
    fake_search_tool.name = "search_notes"
    fake_search_tool.run = AsyncMock(return_value=fake_search_result)
    fake_search_tool.input_schema = lambda: {}
    fake_search_tool.redact = lambda a: a
    fake_search_tool.supports_parallel = lambda a: False

    agent = DocEditorAgent(
        provider=provider,
        tool_overrides={"search_notes": fake_search_tool},
    )

    events: list[Any] = []
    async for ev in agent.run(
        {
            "command": "cite",
            "selection": {
                "blockId": "b1",
                "start": 0,
                "end": 30,
                "text": "MNIST hits 84% accuracy here.",
            },
            "documentContextSnippet": "",
            "note_id": "note-1",
            "user_id": "user-1",
        },
        _ctx(project_id="proj-1"),
    ):
        events.append(ev)

    assert isinstance(events[0], AgentStart)
    assert isinstance(events[-1], AgentEnd)
    # search_notes used at least once
    assert any(
        isinstance(e, ToolUseEvent) and e.tool_name == "search_notes" for e in events
    )
    out = DocEditorOutput(**events[-1].output)
    assert out.command == "cite"
    assert out.output_mode == "diff"
    assert "[^1]" in out.payload["hunks"][0]["replacementText"]
```

- [ ] **Step 2: Verify failure**

```
pnpm --filter @opencairn/worker exec pytest tests/agents/test_doc_editor_cite.py -v
```
Expected: FAIL — `tool_overrides` kwarg unknown OR tool-loop branch missing.

- [ ] **Step 3: Refactor `DocEditorAgent.run` to support both paths**

Open `apps/worker/src/worker/agents/doc_editor/agent.py`. The Phase A file invokes `provider.generate(...)` directly. Refactor so that if the spec has tools the agent runs them through `ToolLoopExecutor`; otherwise the Phase A path is taken verbatim. Add a `tool_overrides` constructor kwarg that injects fake tool implementations for tests.

Replace the imports block at the top of the file with:

```python
from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Any, ClassVar

from llm import LLMProvider

from runtime.agent import Agent
from runtime.events import (
    AgentEnd,
    AgentError,
    AgentEvent,
    AgentStart,
    ModelEnd,
    ToolUse as ToolUseEvent,
)
from runtime.tool_loop import LoopConfig, ToolLoopExecutor
from runtime.tools import ToolContext, get_tool

from worker.agents.doc_editor.commands import get_command_spec
```

Update `DocEditorAgent.__init__`:

```python
class DocEditorAgent(Agent):
    name: ClassVar[str] = "doc_editor"
    description: ClassVar[str] = (
        "Apply a slash-command (improve/translate/summarize/expand/cite/factcheck)"
        " to a selection range and return diff hunks or claim comments."
    )

    def __init__(
        self,
        *,
        provider: LLMProvider,
        tool_overrides: dict[str, Any] | None = None,
    ) -> None:
        self.provider = provider
        # tool_overrides lets unit tests inject stub Tool objects without
        # touching the global registry. Production passes None.
        self._tool_overrides = dict(tool_overrides or {})
```

Replace the `try:` block inside `run` with a branch:

```python
        try:
            spec = get_command_spec(validated.command)
            if len(validated.selection_text) > spec.max_selection_chars:
                raise ValueError(
                    f"selection too long: {len(validated.selection_text)} > {spec.max_selection_chars}"
                )

            user_msg = self._build_user_message(spec.name, validated)

            if spec.tools:
                # Phase B path — multi-turn tool loop with search_notes + emit_structured_output.
                payload, tokens_in, tokens_out, latency_ms = (
                    await self._run_tool_loop(spec, user_msg, ctx, seq, validated)
                )
            else:
                # Phase A path — single LLM call, no tools.
                payload, tokens_in, tokens_out, latency_ms = (
                    await self._run_single_shot(spec, user_msg, validated)
                )

            yield ModelEnd(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="model_end",
                model_id=self.provider.config.model or "unknown",
                prompt_tokens=tokens_in,
                completion_tokens=tokens_out,
                cached_tokens=0,
                cost_krw=0,
                finish_reason="stop",
                latency_ms=latency_ms,
            )

            out = DocEditorOutput(
                command=validated.command,
                output_mode=spec.output_mode,
                payload=payload,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
            )
            yield AgentEnd(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="agent_end",
                output=out.__dict__,
                duration_ms=int((time.time() - t0) * 1000),
            )
```

Add the two helper methods at the bottom of the class (before `_build_user_message` or after, your call — just keep them as instance methods):

```python
    async def _run_single_shot(
        self,
        spec: "CommandSpec",
        user_msg: str,
        v: "DocEditorInput",
    ) -> tuple[dict[str, Any], int, int, int]:
        """Phase A path — preserved verbatim from the prior implementation."""
        messages = [
            {"role": "system", "content": spec.system_prompt},
            {"role": "user", "content": user_msg},
        ]
        started = time.time()
        raw = await self.provider.generate(
            messages,
            response_mime_type="application/json",
        )
        latency_ms = int((time.time() - started) * 1000)
        tokens_in = len(user_msg) // 4
        tokens_out = len(raw) // 4
        if spec.output_mode == "diff":
            payload = self._parse_diff_payload(
                raw,
                fallback_block_id=v.selection_block_id,
                fallback_text=v.selection_text,
                fallback_start=v.selection_start,
                fallback_end=v.selection_end,
            )
        else:
            # Phase A never reaches here, but defensive.
            raise RuntimeError(
                f"single-shot path with output_mode={spec.output_mode} unsupported"
            )
        return payload, tokens_in, tokens_out, latency_ms

    async def _run_tool_loop(
        self,
        spec: "CommandSpec",
        user_msg: str,
        ctx: ToolContext,
        seq: _SeqCounter,
        v: "DocEditorInput",
    ) -> tuple[dict[str, Any], int, int, int]:
        """Phase B path — runs ToolLoopExecutor with the spec's named tools.

        Returns a parsed payload (diff hunks or claim list, depending on
        spec.output_mode), prompt tokens, completion tokens, and total
        wall-clock latency in ms.
        """
        # Resolve named tools from registry, allowing unit-test overrides.
        tools = []
        for tool_name in spec.tools:
            if tool_name in self._tool_overrides:
                tools.append(self._tool_overrides[tool_name])
            else:
                tools.append(get_tool(tool_name))

        config = LoopConfig(
            max_turns=4,
            max_tool_calls=8,
            per_tool_timeout_sec=30.0,
            mode="auto",
            allowed_tool_names=list(spec.tools),
        )

        # Trivial registry shim — the executor expects a registry-like
        # object with `get(name)`. We pre-resolved tools above; build a
        # dict-backed registry on the fly.
        class _DictRegistry:
            def __init__(self, items: list[Any]) -> None:
                self._by_name = {t.name: t for t in items}

            def get(self, name: str) -> Any:
                return self._by_name[name]

        executor = ToolLoopExecutor(
            provider=self.provider,
            tool_registry=_DictRegistry(tools),
            config=config,
            tool_context={
                "workspace_id": ctx.workspace_id,
                "project_id": ctx.project_id,
                "user_id": ctx.user_id,
                "run_id": ctx.run_id,
            },
            tools=tools,
        )

        messages = [
            {"role": "system", "content": spec.system_prompt},
            {"role": "user", "content": user_msg},
        ]
        started = time.time()
        result = await executor.run(messages)
        latency_ms = int((time.time() - started) * 1000)

        raw_struct = result.final_structured_output
        if not isinstance(raw_struct, dict):
            raise ValueError("tool loop did not produce a structured output")

        if spec.output_mode == "diff":
            payload = self._normalize_diff_payload(
                raw_struct,
                fallback_block_id=v.selection_block_id,
                fallback_text=v.selection_text,
                fallback_start=v.selection_start,
                fallback_end=v.selection_end,
            )
        elif spec.output_mode == "comment":
            payload = self._normalize_comment_payload(
                raw_struct,
                fallback_block_id=v.selection_block_id,
                fallback_start=v.selection_start,
                fallback_end=v.selection_end,
            )
        else:  # 'insert' — Phase C
            raise RuntimeError(
                f"tool-loop path with output_mode={spec.output_mode} not implemented yet"
            )

        return (
            payload,
            result.total_input_tokens,
            result.total_output_tokens,
            latency_ms,
        )

    def _normalize_diff_payload(
        self,
        raw: dict[str, Any],
        *,
        fallback_block_id: str,
        fallback_text: str,
        fallback_start: int,
        fallback_end: int,
    ) -> dict[str, Any]:
        """Same shape as `_parse_diff_payload` but the input is already a dict
        (from `emit_structured_output`) so we skip the JSON-fence regex."""
        if "hunks" not in raw:
            raise ValueError("tool-loop diff output missing 'hunks'")
        hunks = raw.get("hunks") or []
        if not isinstance(hunks, list) or not hunks:
            raise ValueError("tool-loop diff output 'hunks' empty")
        clean: list[dict[str, Any]] = []
        for h in hunks:
            if not isinstance(h, dict):
                continue
            block_id = h.get("blockId") or fallback_block_id
            rng = h.get("originalRange") or {}
            start = int(rng.get("start", fallback_start))
            end = int(rng.get("end", fallback_end))
            original = str(h.get("originalText") or fallback_text)
            replacement = str(h.get("replacementText") or "")
            clean.append(
                {
                    "blockId": block_id,
                    "originalRange": {"start": start, "end": end},
                    "originalText": original,
                    "replacementText": replacement,
                }
            )
        return {"hunks": clean, "summary": str(raw.get("summary") or "")[:280]}

    def _normalize_comment_payload(
        self,
        raw: dict[str, Any],
        *,
        fallback_block_id: str,
        fallback_start: int,
        fallback_end: int,
    ) -> dict[str, Any]:
        """Coerce `claims[]` to the shared zod shape, defending against
        common LLM mistakes (missing range, off-by-one fields)."""
        claims_raw = raw.get("claims") or []
        if not isinstance(claims_raw, list) or not claims_raw:
            # Honest fallback — at least one claim, marked unclear.
            return {
                "claims": [
                    {
                        "blockId": fallback_block_id,
                        "range": {"start": fallback_start, "end": fallback_end},
                        "verdict": "unclear",
                        "evidence": [],
                        "note": "No checkable claims in this passage.",
                    }
                ]
            }

        clean: list[dict[str, Any]] = []
        for c in claims_raw[:20]:
            if not isinstance(c, dict):
                continue
            verdict = c.get("verdict")
            if verdict not in ("supported", "unclear", "contradicted"):
                verdict = "unclear"
            rng = c.get("range") or {}
            ev = c.get("evidence") or []
            evidence: list[dict[str, Any]] = []
            for e in ev[:8]:
                if not isinstance(e, dict):
                    continue
                evidence.append(
                    {
                        "source_id": str(e.get("source_id") or "")[:128],
                        "snippet": str(e.get("snippet") or "")[:800],
                        "url_or_ref": (
                            str(e["url_or_ref"])[:512]
                            if e.get("url_or_ref")
                            else None
                        ),
                        "confidence": (
                            float(e["confidence"])
                            if isinstance(e.get("confidence"), (int, float))
                            else None
                        ),
                    }
                )
                # Drop None keys so the output matches the zod schema's
                # optional() semantics.
                evidence[-1] = {
                    k: v for k, v in evidence[-1].items() if v is not None
                }
            clean.append(
                {
                    "blockId": c.get("blockId") or fallback_block_id,
                    "range": {
                        "start": int(rng.get("start", fallback_start)),
                        "end": int(rng.get("end", fallback_end)),
                    },
                    "verdict": verdict,
                    "evidence": evidence,
                    "note": str(c.get("note") or "")[:280],
                }
            )

        if not clean:
            clean.append(
                {
                    "blockId": fallback_block_id,
                    "range": {"start": fallback_start, "end": fallback_end},
                    "verdict": "unclear",
                    "evidence": [],
                    "note": "No checkable claims in this passage.",
                }
            )
        return {"claims": clean}
```

Forward references like `"CommandSpec"` and `"DocEditorInput"` are fine here — the dataclasses are defined in the same module already.

- [ ] **Step 4: Verify cite test passes (and Phase A tests still pass)**

```
pnpm --filter @opencairn/worker exec pytest tests/agents/test_doc_editor_cite.py tests/agents/test_doc_editor_agent.py -v
```
Expected: PASS — `test_cite_calls_search_notes_then_emits_diff` + the original 4 Phase A agent tests = 5 PASS.

If `test_doc_editor_agent.py` regresses, the most likely cause is a changed return shape from the helper extraction — `_run_single_shot` should yield exactly the same `payload`/`tokens_in`/`tokens_out`/`latency_ms` shape Phase A's body did. Diff against Phase A's `agent.py` line-by-line.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker/agents/doc_editor/agent.py apps/worker/tests/agents/test_doc_editor_cite.py
git commit -m "feat(worker): DocEditorAgent tool-loop branch + /cite happy path (Plan 11B-B)"
```

---

## Task 6: Worker — `/factcheck` happy path through the tool loop

**Files:**
- Create: `apps/worker/tests/agents/test_doc_editor_factcheck.py`

- [ ] **Step 1: Write failing tests**

```python
# apps/worker/tests/agents/test_doc_editor_factcheck.py
"""Plan 11B Phase B — /factcheck claim payload."""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from llm.tool_types import ToolLoopTurn, ToolUse, ToolUsage
from runtime.events import AgentEnd
from runtime.tools import ToolContext
from worker.agents.doc_editor.agent import DocEditorAgent, DocEditorOutput


def _ctx() -> ToolContext:
    async def _emit(_ev: Any) -> None:
        return None
    return ToolContext(
        run_id="run-fc",
        workspace_id="ws-1",
        project_id="proj-1",
        page_id=None,
        user_id="user-1",
        scope="project",
        emit=_emit,
    )


def _provider_with_two_turns(structured: dict[str, Any]) -> MagicMock:
    turn1 = ToolLoopTurn(
        assistant_message={"role": "assistant", "content": ""},
        tool_uses=[
            ToolUse(id="t1", name="search_notes", args={"query": "MNIST accuracy"})
        ],
        final_text=None,
        structured_output=None,
        usage=ToolUsage(input_tokens=200, output_tokens=20),
    )
    turn2 = ToolLoopTurn(
        assistant_message={"role": "assistant", "content": ""},
        tool_uses=[
            ToolUse(id="t2", name="emit_structured_output", args={"value": structured})
        ],
        final_text=None,
        structured_output=None,
        usage=ToolUsage(input_tokens=400, output_tokens=180),
    )
    p = MagicMock()
    p.config.model = "gemini-2.5-flash"
    p.generate_with_tools = AsyncMock(side_effect=[turn1, turn2])
    p.tool_result_to_message = lambda r: {"role": "tool", "content": str(r.data)}
    return p


def _stub_search_tool(hits: list[dict[str, Any]]) -> Any:
    t = MagicMock()
    t.name = "search_notes"
    t.run = AsyncMock(return_value=hits)
    t.input_schema = lambda: {}
    t.redact = lambda a: a
    t.supports_parallel = lambda a: False
    return t


@pytest.mark.asyncio
async def test_factcheck_happy_path_yields_claims():
    structured = {
        "claims": [
            {
                "blockId": "b1",
                "range": {"start": 0, "end": 30},
                "verdict": "supported",
                "evidence": [
                    {
                        "source_id": "11111111-1111-1111-1111-111111111111",
                        "snippet": "MNIST 84.2%",
                        "confidence": 0.8,
                    }
                ],
                "note": "Confirmed by benchmark note.",
            }
        ]
    }
    provider = _provider_with_two_turns(structured)
    agent = DocEditorAgent(
        provider=provider,
        tool_overrides={
            "search_notes": _stub_search_tool([
                {"noteId": "11111111-1111-1111-1111-111111111111", "title": "MNIST", "snippet": "84.2", "rrfScore": 0.5}
            ]),
        },
    )
    events: list[Any] = []
    async for ev in agent.run(
        {
            "command": "factcheck",
            "selection": {"blockId": "b1", "start": 0, "end": 30, "text": "MNIST hits 84% accuracy here."},
            "documentContextSnippet": "",
            "note_id": "n1",
            "user_id": "u1",
        },
        _ctx(),
    ):
        events.append(ev)
    end = events[-1]
    assert isinstance(end, AgentEnd)
    out = DocEditorOutput(**end.output)
    assert out.command == "factcheck"
    assert out.output_mode == "comment"
    assert out.payload["claims"][0]["verdict"] == "supported"
    assert out.payload["claims"][0]["evidence"][0]["source_id"].startswith("11111")


@pytest.mark.asyncio
async def test_factcheck_empty_claims_falls_back_to_unclear():
    """Spec §6.9 — verdict='unclear' with empty evidence is acceptable
    (honesty over coverage). Empty claims list → one unclear claim
    covering the whole selection."""
    provider = _provider_with_two_turns({"claims": []})
    agent = DocEditorAgent(
        provider=provider,
        tool_overrides={"search_notes": _stub_search_tool([])},
    )
    events: list[Any] = []
    async for ev in agent.run(
        {
            "command": "factcheck",
            "selection": {"blockId": "b1", "start": 0, "end": 30, "text": "Some prose."},
            "documentContextSnippet": "",
            "note_id": "n1",
            "user_id": "u1",
        },
        _ctx(),
    ):
        events.append(ev)
    out = DocEditorOutput(**events[-1].output)
    claims = out.payload["claims"]
    assert len(claims) == 1
    assert claims[0]["verdict"] == "unclear"
    assert claims[0]["evidence"] == []


@pytest.mark.asyncio
async def test_factcheck_normalizes_bad_verdict():
    """Spec §6.9 — defensive: an off-spec verdict from the LLM degrades
    to 'unclear' rather than failing the run."""
    provider = _provider_with_two_turns({
        "claims": [
            {
                "blockId": "b1",
                "range": {"start": 0, "end": 5},
                "verdict": "very-true",  # garbage
                "evidence": [],
                "note": "weird",
            }
        ]
    })
    agent = DocEditorAgent(
        provider=provider,
        tool_overrides={"search_notes": _stub_search_tool([])},
    )
    events: list[Any] = []
    async for ev in agent.run(
        {
            "command": "factcheck",
            "selection": {"blockId": "b1", "start": 0, "end": 5, "text": "hello"},
            "documentContextSnippet": "",
            "note_id": "n1",
            "user_id": "u1",
        },
        _ctx(),
    ):
        events.append(ev)
    out = DocEditorOutput(**events[-1].output)
    assert out.payload["claims"][0]["verdict"] == "unclear"
```

- [ ] **Step 2: Verify pass**

```
pnpm --filter @opencairn/worker exec pytest tests/agents/test_doc_editor_factcheck.py -v
```
Expected: 3 PASS — the agent's `_normalize_comment_payload` (Task 5) already handles all three cases.

If anything fails, fix `_normalize_comment_payload` (the most likely miss is the verdict default + the "empty list → fallback" branch).

- [ ] **Step 3: Commit**

```bash
git add apps/worker/tests/agents/test_doc_editor_factcheck.py
git commit -m "test(worker): /factcheck happy path + empty + bad-verdict (Plan 11B-B)"
```

---

## Task 7: Worker — activity + workflow forward `project_id`

**Files:**
- Modify: `apps/worker/src/worker/activities/doc_editor_activity.py`
- Modify: `apps/worker/src/worker/workflows/doc_editor_workflow.py`
- Modify: `apps/worker/tests/activities/test_doc_editor_activity.py`

- [ ] **Step 1: Update the activity test**

In `apps/worker/tests/activities/test_doc_editor_activity.py`, add:

```python
@pytest.mark.asyncio
async def test_run_doc_editor_passes_project_id_to_agent_ctx():
    """Phase B — project_id flows from activity input into ToolContext so
    project-scoped tools (search_notes) can resolve."""
    fake_output = {
        "command": "cite",
        "output_mode": "diff",
        "payload": {"hunks": [], "summary": ""},
        "tokens_in": 1,
        "tokens_out": 1,
    }
    captured_ctx = {}
    real_invoke = AsyncMock(return_value=fake_output)

    async def _spy(payload):
        # Verify the new field made it through.
        assert payload.project_id == "proj-1"
        return await real_invoke(payload)

    with patch(
        "worker.activities.doc_editor_activity._invoke_agent",
        new=_spy,
    ):
        out = await run_doc_editor(
            DocEditorActivityInput(
                command="cite",
                note_id="n1",
                workspace_id="ws1",
                project_id="proj-1",  # NEW Phase B field
                user_id="u1",
                selection_block_id="b1",
                selection_start=0,
                selection_end=5,
                selection_text="hello",
                document_context_snippet="",
                language=None,
            )
        )
    assert out["command"] == "cite"
```

- [ ] **Step 2: Verify failure**

```
pnpm --filter @opencairn/worker exec pytest tests/activities/test_doc_editor_activity.py -v
```
Expected: FAIL — `DocEditorActivityInput` has no `project_id` field.

- [ ] **Step 3: Add the field**

In `apps/worker/src/worker/activities/doc_editor_activity.py`:

```python
@dataclass(frozen=True)
class DocEditorActivityInput:
    command: str
    note_id: str
    workspace_id: str
    project_id: str  # Phase B — needed so search_notes (project-scoped) resolves
    user_id: str
    selection_block_id: str
    selection_start: int
    selection_end: int
    selection_text: str
    document_context_snippet: str
    language: str | None
```

In `_invoke_agent`, plumb it into `ToolContext`:

```python
    ctx = ToolContext(
        run_id=f"doc-editor-{uuid.uuid4().hex[:12]}",
        workspace_id=payload.workspace_id,
        project_id=payload.project_id,
        page_id=None,
        user_id=payload.user_id,
        scope="project",
        emit=_noop_emit,  # Phase B — no event fanout from inside the activity
    )
```

(Add `async def _noop_emit(_ev): return None` at module scope; keep the existing `import uuid` etc.)

- [ ] **Step 4: Workflow forwards the field unchanged**

`DocEditorWorkflow.run` already passes `payload` through; verify the dataclass-as-dict serialization still works. No code changes needed unless temporal_main has a typed reflection step.

- [ ] **Step 5: Verify activity tests pass**

```
pnpm --filter @opencairn/worker exec pytest tests/activities/test_doc_editor_activity.py -v
```
Expected: PASS — Phase A test still green + new Phase B test green.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/worker/activities/doc_editor_activity.py apps/worker/src/worker/workflows/doc_editor_workflow.py apps/worker/tests/activities/test_doc_editor_activity.py
git commit -m "feat(worker): activity input + ToolContext carry project_id for RAG tools (Plan 11B-B)"
```

---

## Task 8: API — claim → comment row helper (pure)

**Files:**
- Create: `apps/api/src/lib/doc-editor-comments.ts`
- Create: `apps/api/tests/doc-editor-comments.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/api/tests/doc-editor-comments.test.ts
import { describe, it, expect } from "vitest";
import { claimsToCommentInserts } from "../src/lib/doc-editor-comments";

describe("claimsToCommentInserts", () => {
  it("emits one row per claim with bodyAst tagged", () => {
    const rows = claimsToCommentInserts({
      claims: [
        {
          blockId: "b1",
          range: { start: 0, end: 5 },
          verdict: "supported",
          evidence: [
            {
              source_id: "11111111-1111-1111-1111-111111111111",
              snippet: "x",
            },
          ],
          note: "y",
        },
        {
          blockId: "b2",
          range: { start: 10, end: 20 },
          verdict: "unclear",
          evidence: [],
          note: "no evidence",
        },
      ],
      noteId: "00000000-0000-0000-0000-000000000001",
      workspaceId: "00000000-0000-0000-0000-000000000002",
      triggeringUserId: "user-42",
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].authorId).toBe("user-42");
    expect(rows[0].anchorBlockId).toBe("b1");
    expect(rows[0].body).toContain("supported");
    expect(rows[0].bodyAst).toMatchObject({
      agentKind: "doc_editor",
      command: "factcheck",
      verdict: "supported",
      triggeredBy: "user-42",
    });
    expect(rows[1].bodyAst).toMatchObject({ verdict: "unclear" });
  });

  it("renders body as a 1-line summary referencing the verdict", () => {
    const [row] = claimsToCommentInserts({
      claims: [
        {
          blockId: "b1",
          range: { start: 0, end: 5 },
          verdict: "contradicted",
          evidence: [],
          note: "Source A says otherwise.",
        },
      ],
      noteId: "00000000-0000-0000-0000-000000000001",
      workspaceId: "00000000-0000-0000-0000-000000000002",
      triggeringUserId: "user-1",
    });
    expect(row.body.toLowerCase()).toContain("contradicted");
    expect(row.body).toContain("Source A says otherwise.");
  });
});
```

- [ ] **Step 2: Verify failure**

```
pnpm --filter @opencairn/api test -- doc-editor-comments
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement helper**

```ts
// apps/api/src/lib/doc-editor-comments.ts
import type { DocEditorClaim, DocEditorCommentPayload } from "@opencairn/shared";

// Comment row insert shape (matches `comments.ts` Drizzle schema, sans
// id / createdAt / updatedAt / parentId / resolvedAt / resolvedBy which
// are server-defaulted or null).
export type CommentInsertRow = {
  workspaceId: string;
  noteId: string;
  anchorBlockId: string;
  authorId: string;
  body: string;
  bodyAst: {
    agentKind: "doc_editor";
    command: "factcheck";
    triggeredBy: string;
    verdict: DocEditorClaim["verdict"];
    range: DocEditorClaim["range"];
    evidence: DocEditorClaim["evidence"];
    note: string;
  };
};

// Phase B — author_id == triggering user. The agent kind + command live
// in bodyAst so the editor's decoration plugin (web-side) can filter
// without a schema change. The triggering user retains edit/delete
// permission on the comments — they "issued" them.
export function claimsToCommentInserts(args: {
  claims: DocEditorCommentPayload["claims"];
  noteId: string;
  workspaceId: string;
  triggeringUserId: string;
}): CommentInsertRow[] {
  return args.claims.map((c) => ({
    workspaceId: args.workspaceId,
    noteId: args.noteId,
    anchorBlockId: c.blockId,
    authorId: args.triggeringUserId,
    body: renderClaimBody(c),
    bodyAst: {
      agentKind: "doc_editor",
      command: "factcheck",
      triggeredBy: args.triggeringUserId,
      verdict: c.verdict,
      range: c.range,
      evidence: c.evidence,
      note: c.note,
    },
  }));
}

function renderClaimBody(c: DocEditorClaim): string {
  // Plain-text body is what the comment lane displays for clients that
  // don't render bodyAst. Keep it short + readable.
  const verdictLabel: Record<DocEditorClaim["verdict"], string> = {
    supported: "✅ supported",
    unclear: "❓ unclear",
    contradicted: "⛔ contradicted",
  };
  const head = `${verdictLabel[c.verdict]}`;
  const tail = c.note ? ` — ${c.note}` : "";
  return `${head}${tail}`.slice(0, 600);
}
```

- [ ] **Step 4: Verify pass**

```
pnpm --filter @opencairn/api test -- doc-editor-comments
```
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/doc-editor-comments.ts apps/api/tests/doc-editor-comments.test.ts
git commit -m "feat(api): claimsToCommentInserts pure helper for /factcheck (Plan 11B-B)"
```

---

## Task 9: API — extend doc-editor route for `/cite` + `/factcheck`

**Files:**
- Modify: `apps/api/src/routes/doc-editor.ts`
- Modify: `apps/api/tests/doc-editor.test.ts`

- [ ] **Step 1: Append failing route tests**

In `apps/api/tests/doc-editor.test.ts`:

```ts
const origRagFlag = process.env.FEATURE_DOC_EDITOR_RAG;
beforeEach(() => {
  process.env.FEATURE_DOC_EDITOR_SLASH = "true";
  process.env.FEATURE_DOC_EDITOR_RAG = "true";
});
afterAll(() => {
  process.env.FEATURE_DOC_EDITOR_RAG = origRagFlag;
});

describe("POST /api/notes/:id/doc-editor/commands/cite (Phase B)", () => {
  it("returns 404 when FEATURE_DOC_EDITOR_RAG is off", async () => {
    process.env.FEATURE_DOC_EDITOR_RAG = "false";
    const { auth, noteId } = await seedNote();
    const res = await app.request(
      `/api/notes/${noteId}/doc-editor/commands/cite`,
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          selection: { blockId: "b1", start: 0, end: 5, text: "hello" },
          documentContextSnippet: "",
        }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("streams diff hunks for /cite when RAG flag is on", async () => {
    const { auth, noteId } = await seedNote();
    vi.spyOn(
      await import("../src/lib/temporal-client"),
      "executeDocEditorWorkflow",
    ).mockResolvedValue({
      command: "cite",
      output_mode: "diff",
      payload: {
        hunks: [
          {
            blockId: "b1",
            originalRange: { start: 0, end: 5 },
            originalText: "hello",
            replacementText: "hello[^1]\n\n[^1]: src",
          },
        ],
        summary: "1 source",
      },
      tokens_in: 200,
      tokens_out: 50,
    });
    const res = await app.request(
      `/api/notes/${noteId}/doc-editor/commands/cite`,
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          selection: { blockId: "b1", start: 0, end: 5, text: "hello" },
          documentContextSnippet: "",
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("event: doc_editor_result");
    expect(body).toContain('"output_mode":"diff"');
  });
});

describe("POST /api/notes/:id/doc-editor/commands/factcheck (Phase B)", () => {
  it("inserts comments + emits factcheck_comments_inserted", async () => {
    const { auth, noteId } = await seedNote();
    vi.spyOn(
      await import("../src/lib/temporal-client"),
      "executeDocEditorWorkflow",
    ).mockResolvedValue({
      command: "factcheck",
      output_mode: "comment",
      payload: {
        claims: [
          {
            blockId: "b1",
            range: { start: 0, end: 5 },
            verdict: "supported",
            evidence: [],
            note: "ok",
          },
          {
            blockId: "b1",
            range: { start: 6, end: 11 },
            verdict: "unclear",
            evidence: [],
            note: "no evidence",
          },
        ],
      },
      tokens_in: 400,
      tokens_out: 120,
    });
    const res = await app.request(
      `/api/notes/${noteId}/doc-editor/commands/factcheck`,
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          selection: { blockId: "b1", start: 0, end: 11, text: "hello world" },
          documentContextSnippet: "",
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("event: doc_editor_result");
    expect(body).toContain('"output_mode":"comment"');
    expect(body).toContain("event: factcheck_comments_inserted");
    // 2 claim rows materialized
    const { db, comments } = await import("@opencairn/db");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(comments).where(eq(comments.noteId, noteId));
    const factcheckRows = rows.filter(
      (r) =>
        r.bodyAst &&
        typeof r.bodyAst === "object" &&
        (r.bodyAst as Record<string, unknown>).agentKind === "doc_editor",
    );
    expect(factcheckRows).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Verify failure**

```
pnpm --filter @opencairn/api test -- doc-editor
```
Expected: FAIL — flag gate missing, comment branch missing.

- [ ] **Step 3: Extend the route**

Open `apps/api/src/routes/doc-editor.ts`. Update the imports + add the comment branch.

```ts
import { claimsToCommentInserts } from "../lib/doc-editor-comments";
import { comments, notes } from "@opencairn/db";
import { eq } from "drizzle-orm";
import {
  docEditorCommandSchema,
  docEditorRequestSchema,
  docEditorCommentPayloadSchema,
  docEditorDiffPayloadSchema,
  type DocEditorCommand,
} from "@opencairn/shared";
```

Add a small helper near the top:

```ts
function ragRequired(cmd: DocEditorCommand): boolean {
  return cmd === "cite" || cmd === "factcheck";
}
```

Inside the route handler (after the existing `cmdParsed.success` check, before reading the body), add the second flag gate:

```ts
    if (
      ragRequired(cmdParsed.data) &&
      (process.env.FEATURE_DOC_EDITOR_RAG ?? "false").toLowerCase() !== "true"
    ) {
      // Mirror Phase A's "404 instead of 403" choice — the route
      // *exists* (the slash flag turned it on) but the specific command
      // is hidden behind its own flag. Returning 404 prevents flag
      // enumeration via the API.
      return c.json({ error: "not_found" }, 404);
    }
```

After the body is parsed and before invoking the workflow, look up `note.projectId` (the workflow needs it). You likely already pull `note.workspaceId` from `getNoteOrNotFound`; extend that helper to include `projectId`, or do a one-liner select:

```ts
    const [{ projectId }] = await db
      .select({ projectId: notes.projectId })
      .from(notes)
      .where(eq(notes.id, noteId));
```

Update the workflow invocation to pass `project_id`:

```ts
        const result = await executeDocEditorWorkflow({
          command: cmdParsed.data,
          note_id: noteId,
          workspace_id: note.workspaceId,
          project_id: projectId,
          user_id: user.id,
          selection_block_id: selection.blockId,
          selection_start: selection.start,
          selection_end: selection.end,
          selection_text: selection.text,
          document_context_snippet: documentContextSnippet,
          language: language ?? null,
        });
```

After `result` is in hand, branch on `output_mode`:

```ts
        if (result.output_mode === "diff") {
          const diff = docEditorDiffPayloadSchema.parse(result.payload);
          await stream.write(
            encodeSseEvent({
              type: "doc_editor_result",
              output_mode: "diff",
              payload: diff,
            }),
          );
        } else if (result.output_mode === "comment") {
          const commentPayload = docEditorCommentPayloadSchema.parse(
            result.payload,
          );
          await stream.write(
            encodeSseEvent({
              type: "doc_editor_result",
              output_mode: "comment",
              payload: commentPayload,
            }),
          );
          // Materialize one comment row per claim. Single transaction so
          // a failure rolls back to "no comments" rather than partial.
          const rows = claimsToCommentInserts({
            claims: commentPayload.claims,
            noteId,
            workspaceId: note.workspaceId,
            triggeringUserId: user.id,
          });
          const inserted = await db
            .insert(comments)
            .values(rows)
            .returning({ id: comments.id });
          await stream.write(
            encodeSseEvent({
              type: "factcheck_comments_inserted",
              commentIds: inserted.map((r) => r.id),
            }),
          );
        }
```

(Drop the previous unconditional `doc_editor_result` write — it was diff-only; the new branch covers both.)

`cost` and `done` events still fire after the branch.

- [ ] **Step 4: Verify pass**

```
pnpm --filter @opencairn/api test -- doc-editor
```
Expected: PASS — Phase A's 4 tests + Phase B's 3 tests = 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/doc-editor.ts apps/api/tests/doc-editor.test.ts
git commit -m "feat(api): /cite + /factcheck routes + comment materialization (Plan 11B-B)"
```

---

## Task 10: Web — extend slash menu with `/cite` + `/factcheck`

**Files:**
- Modify: `apps/web/src/components/editor/plugins/slash.tsx`
- Modify: `apps/web/messages/ko/doc-editor.json` + `apps/web/messages/en/doc-editor.json`

- [ ] **Step 1: Add i18n keys**

`apps/web/messages/ko/doc-editor.json` — append under `command.*`:

```json
"command": {
  "improve": "다듬기",
  "translate": "번역",
  "summarize": "요약",
  "expand": "확장",
  "cite": "출처 달기",
  "factcheck": "사실 확인"
},
```

Append a new `factcheck` section at the JSON's top level:

```json
"factcheck": {
  "verdict": {
    "supported": "근거 확인됨",
    "unclear": "판단 보류",
    "contradicted": "반대 근거 있음"
  },
  "commentsAdded": "{count}개의 사실 확인 코멘트가 추가되었어요",
  "showInComments": "코멘트에서 보기",
  "noClaims": "확인할 주장이 없어요",
  "searching": "위키 검색 중… ({count}건)"
}
```

Add the equivalent under `messages/en/doc-editor.json`:

```json
"command": {
  "improve": "Improve",
  "translate": "Translate",
  "summarize": "Summarize",
  "expand": "Expand",
  "cite": "Cite",
  "factcheck": "Fact-check"
},
"factcheck": {
  "verdict": {
    "supported": "Supported",
    "unclear": "Unclear",
    "contradicted": "Contradicted"
  },
  "commentsAdded": "{count} fact-check comments added",
  "showInComments": "Show in comments",
  "noClaims": "No checkable claims",
  "searching": "Searching the wiki… ({count})"
}
```

- [ ] **Step 2: Add an i18n parity check**

```
pnpm --filter @opencairn/web i18n:parity
```
Expected: PASS. If it fails, the diff will name the missing key — add to whichever locale is short.

- [ ] **Step 3: Extend slash menu**

Open `apps/web/src/components/editor/plugins/slash.tsx`. Phase A added the AI section with four rows. Append two more, gated on `process.env.NEXT_PUBLIC_FEATURE_DOC_EDITOR_RAG === "true"`:

```ts
const ragEnabled =
  process.env.NEXT_PUBLIC_FEATURE_DOC_EDITOR_RAG === "true";

// ... inside the COMMANDS array, after the four AI rows:
{ key: "cite", section: "ai", labelKey: "cite", visible: ragEnabled },
{ key: "factcheck", section: "ai", labelKey: "factcheck", visible: ragEnabled },
```

If `SlashCommandDef` doesn't already have a `visible?: boolean` field, add one with default `true`. Filter visible rows in the render path.

Extend the `SlashKey` union to include `"cite" | "factcheck"`.

- [ ] **Step 4: Smoke locally**

```
NEXT_PUBLIC_FEATURE_DOC_EDITOR_SLASH=true NEXT_PUBLIC_FEATURE_DOC_EDITOR_RAG=true pnpm --filter @opencairn/web dev
```

Open a note, type `/`, scroll to AI section. Confirm 6 rows visible. With `NEXT_PUBLIC_FEATURE_DOC_EDITOR_RAG=false`, only 4 rows.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/plugins/slash.tsx apps/web/messages/ko/doc-editor.json apps/web/messages/en/doc-editor.json
git commit -m "feat(web): slash menu /cite + /factcheck rows behind NEXT_PUBLIC_FEATURE_DOC_EDITOR_RAG (Plan 11B-B)"
```

---

## Task 11: Web — extend `useDocEditorCommand` for comment-mode + tool progress

**Files:**
- Modify: `apps/web/src/hooks/useDocEditorCommand.ts`
- Modify: `apps/web/src/lib/api/doc-editor.ts` (only if the parser needs touching — Task 1 should cover the schema)
- Create/modify: `apps/web/src/lib/api/__tests__/doc-editor.test.ts` (parser regressions for new event types)

- [ ] **Step 1: Append parser test for new events**

In `apps/web/src/lib/api/__tests__/doc-editor.test.ts`:

```ts
it("parses a comment-mode doc_editor_result", () => {
  const chunk =
    "event: doc_editor_result\n" +
    `data: ${JSON.stringify({
      output_mode: "comment",
      payload: {
        claims: [
          {
            blockId: "b1",
            range: { start: 0, end: 5 },
            verdict: "supported",
            evidence: [],
            note: "ok",
          },
        ],
      },
    })}\n\n`;
  const events = parseSseChunk(chunk);
  expect(events).toHaveLength(1);
  if (events[0].type === "doc_editor_result") {
    expect(events[0].output_mode).toBe("comment");
  }
});

it("parses factcheck_comments_inserted", () => {
  const chunk =
    "event: factcheck_comments_inserted\n" +
    `data: ${JSON.stringify({
      commentIds: ["00000000-0000-0000-0000-000000000001"],
    })}\n\n`;
  const events = parseSseChunk(chunk);
  expect(events[0].type).toBe("factcheck_comments_inserted");
});

it("parses tool_progress as a noop event", () => {
  const chunk =
    "event: tool_progress\n" +
    `data: ${JSON.stringify({ tool: "search_notes", callCount: 2 })}\n\n`;
  const events = parseSseChunk(chunk);
  expect(events[0].type).toBe("tool_progress");
});
```

- [ ] **Step 2: Verify pass**

```
pnpm --filter @opencairn/web test -- doc-editor
```
Expected: PASS — the parser is schema-driven; the schema additions in Task 1 already cover these.

- [ ] **Step 3: Extend the hook state**

Open `apps/web/src/hooks/useDocEditorCommand.ts`. Update `DocEditorState` to include both ready variants and a tool-progress sub-status:

```ts
import type {
  DocEditorCommand,
  DocEditorRequest,
  DocEditorSseEvent,
  DocEditorDiffPayload,
  DocEditorCommentPayload,
} from "@opencairn/shared";

export type DocEditorState =
  | { status: "idle" }
  | {
      status: "running";
      // Phase B — bumps each time a tool_progress event is seen so the
      // sheet can render "Searching… (N)". Starts at 0; stays 0 for
      // tool-less commands (Phase A).
      toolCallCount: number;
    }
  | {
      status: "ready";
      outputMode: "diff";
      payload: DocEditorDiffPayload;
      cost: { tokens_in: number; tokens_out: number; cost_krw: number };
    }
  | {
      status: "ready";
      outputMode: "comment";
      payload: DocEditorCommentPayload;
      commentIds: string[];
      cost: { tokens_in: number; tokens_out: number; cost_krw: number };
    }
  | { status: "error"; code: string; message: string };
```

Update the `run` callback's accumulator:

```ts
      let payload: DocEditorDiffPayload | DocEditorCommentPayload | null = null;
      let outputMode: "diff" | "comment" | null = null;
      let commentIds: string[] = [];
      let cost = { tokens_in: 0, tokens_out: 0, cost_krw: 0 };
      let toolCallCount = 0;
      try {
        for await (const ev of runDocEditorCommand(
          noteId,
          command,
          body,
          ac.signal,
        )) {
          if (ev.type === "doc_editor_result") {
            outputMode = ev.output_mode;
            payload = ev.payload;
          } else if (ev.type === "factcheck_comments_inserted") {
            commentIds = ev.commentIds;
          } else if (ev.type === "tool_progress") {
            toolCallCount += 1;
            setState({ status: "running", toolCallCount });
          } else if (ev.type === "cost") {
            cost = ev;
          } else if (ev.type === "error") {
            setState({ status: "error", code: ev.code, message: ev.message });
            return;
          }
        }
        if (payload && outputMode === "diff") {
          setState({
            status: "ready",
            outputMode: "diff",
            payload: payload as DocEditorDiffPayload,
            cost,
          });
        } else if (payload && outputMode === "comment") {
          setState({
            status: "ready",
            outputMode: "comment",
            payload: payload as DocEditorCommentPayload,
            commentIds,
            cost,
          });
        } else {
          setState({
            status: "error",
            code: "internal",
            message: "no result",
          });
        }
      } catch (err) {
        // unchanged
      }
```

The initial `setState({ status: "running" })` becomes `setState({ status: "running", toolCallCount: 0 })`.

- [ ] **Step 4: Verify hook tests still pass**

```
pnpm --filter @opencairn/web test -- useDocEditorCommand
```
Expected: PASS. (Phase A had no hook unit test specifically — InlineDiffSheet covered the integration. If a test breaks because the state shape changed, update the existing assertion.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/useDocEditorCommand.ts apps/web/src/lib/api/__tests__/doc-editor.test.ts
git commit -m "feat(web): hook handles comment output_mode + tool_progress (Plan 11B-B)"
```

---

## Task 12: Web — InlineDiffSheet branch for `/factcheck`

**Files:**
- Modify: `apps/web/src/components/editor/doc-editor/InlineDiffSheet.tsx`
- Modify: `apps/web/src/components/editor/doc-editor/__tests__/InlineDiffSheet.test.tsx`

- [ ] **Step 1: Append failing test**

```tsx
it("renders factcheck summary + 'Show in comments' CTA when ready-comment", () => {
  const onShow = vi.fn();
  render(
    withI18n(
      <InlineDiffSheet
        open
        currentCommand="factcheck"
        state={{
          status: "ready",
          outputMode: "comment",
          payload: {
            claims: [
              { blockId: "b1", range: { start: 0, end: 5 }, verdict: "supported", evidence: [], note: "ok" },
              { blockId: "b1", range: { start: 6, end: 11 }, verdict: "unclear", evidence: [], note: "x" },
            ],
          },
          commentIds: ["c1", "c2"],
          cost: { tokens_in: 100, tokens_out: 50, cost_krw: 0 },
        }}
        onAcceptAll={vi.fn()}
        onRejectAll={vi.fn()}
        onClose={vi.fn()}
        onShowInComments={onShow}
      />,
    ),
  );
  expect(
    screen.getByText(/2 fact-check comments added|2개의 사실 확인/i),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: /show in comments|코멘트에서 보기/i }),
  );
  expect(onShow).toHaveBeenCalledWith(["c1", "c2"]);
});

it("renders 'Searching the wiki' sub-status during tool calls", () => {
  render(
    withI18n(
      <InlineDiffSheet
        open
        currentCommand="cite"
        state={{ status: "running", toolCallCount: 2 }}
        onAcceptAll={vi.fn()}
        onRejectAll={vi.fn()}
        onClose={vi.fn()}
      />,
    ),
  );
  expect(screen.getByText(/Searching|위키 검색/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Verify failure**

```
pnpm --filter @opencairn/web test -- InlineDiffSheet
```
Expected: FAIL — `onShowInComments` prop missing, `currentCommand` prop missing, comment branch unrendered, running-with-toolCallCount path missing.

- [ ] **Step 3: Extend the component**

In `apps/web/src/components/editor/doc-editor/InlineDiffSheet.tsx`, update Props:

```ts
type Props = {
  open: boolean;
  state: DocEditorState;
  currentCommand?: DocEditorCommand;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onClose: () => void;
  onShowInComments?: (commentIds: string[]) => void;
  onLanguageChange?: (lang: string) => void; // existing Phase A prop
};
```

Inside the component, add a comment-mode branch (drop into the existing `state.status === "ready"` block):

```tsx
{state.status === "ready" && state.outputMode === "comment" && (
  <>
    <p className="text-sm">
      {tFc("commentsAdded", { count: state.payload.claims.length })}
    </p>
    {state.payload.claims.length > 0 && state.commentIds.length > 0 && (
      <Button
        variant="ghost"
        onClick={() => onShowInComments?.(state.commentIds)}
      >
        {tFc("showInComments")}
      </Button>
    )}
  </>
)}
{state.status === "ready" && state.outputMode === "diff" && (
  /* existing diff branch unchanged — wrap the existing JSX */
)}
```

Replace the `running` branch:

```tsx
{state.status === "running" && (
  <p className="text-sm text-muted-foreground">
    {state.toolCallCount > 0
      ? tFc("searching", { count: state.toolCallCount })
      : t("loading")}
  </p>
)}
```

Add a fresh `useTranslations` call:

```ts
const tFc = useTranslations("doc-editor.factcheck");
```

- [ ] **Step 4: Verify pass**

```
pnpm --filter @opencairn/web test -- InlineDiffSheet
```
Expected: PASS — Phase A's 3-4 tests + Phase B's 2 = 5-6 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/doc-editor/InlineDiffSheet.tsx apps/web/src/components/editor/doc-editor/__tests__/InlineDiffSheet.test.tsx
git commit -m "feat(web): InlineDiffSheet comment-mode branch + searching sub-status (Plan 11B-B)"
```

---

## Task 13: Web — Plate decoration plugin for inline factcheck markers

**Files:**
- Create: `apps/web/src/components/editor/plugins/factcheck-decorations.tsx`
- Create: `apps/web/src/components/editor/plugins/__tests__/factcheck-decorations.test.ts`

- [ ] **Step 1: Write failing test (pure decoration computation)**

```ts
// apps/web/src/components/editor/plugins/__tests__/factcheck-decorations.test.ts
import { describe, it, expect } from "vitest";
import { computeFactcheckDecorations } from "../factcheck-decorations";

const makeBlock = (id: string, text: string) => ({
  type: "p",
  id,
  children: [{ text }],
});

describe("computeFactcheckDecorations", () => {
  it("returns empty when there are no factcheck comments", () => {
    const value = [makeBlock("b1", "hello world")];
    expect(computeFactcheckDecorations(value, [])).toEqual([]);
  });

  it("emits one decoration per factcheck comment matching its block + range", () => {
    const value = [makeBlock("b1", "hello world")];
    const decorations = computeFactcheckDecorations(value, [
      {
        id: "c1",
        anchorBlockId: "b1",
        bodyAst: {
          agentKind: "doc_editor",
          command: "factcheck",
          range: { start: 0, end: 5 },
          verdict: "supported",
          note: "ok",
          evidence: [],
        },
      },
    ]);
    expect(decorations).toHaveLength(1);
    expect(decorations[0]).toMatchObject({
      blockId: "b1",
      start: 0,
      end: 5,
      verdict: "supported",
      commentId: "c1",
    });
  });

  it("ignores non-factcheck comments and unresolved blocks", () => {
    const value = [makeBlock("b1", "hello world")];
    const decorations = computeFactcheckDecorations(value, [
      {
        id: "c1",
        anchorBlockId: "b1",
        bodyAst: { agentKind: "doc_editor", command: "summarize" },
      },
      {
        id: "c2",
        anchorBlockId: "missing-block",
        bodyAst: {
          agentKind: "doc_editor",
          command: "factcheck",
          range: { start: 0, end: 5 },
          verdict: "supported",
          note: "ok",
          evidence: [],
        },
      },
      {
        id: "c3",
        anchorBlockId: "b1",
        bodyAst: null,
      },
    ]);
    expect(decorations).toEqual([]);
  });

  it("skips decorations whose range exceeds the block text length", () => {
    const value = [makeBlock("b1", "hi")];
    const decorations = computeFactcheckDecorations(value, [
      {
        id: "c1",
        anchorBlockId: "b1",
        bodyAst: {
          agentKind: "doc_editor",
          command: "factcheck",
          range: { start: 0, end: 999 },
          verdict: "unclear",
          note: "x",
          evidence: [],
        },
      },
    ]);
    expect(decorations).toEqual([]);
  });
});
```

- [ ] **Step 2: Verify failure**

```
pnpm --filter @opencairn/web test -- factcheck-decorations
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the pure helper + plugin shell**

```tsx
// apps/web/src/components/editor/plugins/factcheck-decorations.tsx
"use client";

import type { Value, TElement, TText } from "platejs";

export type FactcheckCommentLike = {
  id: string;
  anchorBlockId: string | null;
  bodyAst: unknown;
};

export type FactcheckDecoration = {
  commentId: string;
  blockId: string;
  start: number;
  end: number;
  verdict: "supported" | "unclear" | "contradicted";
  note: string;
};

const VERDICT_VALUES = ["supported", "unclear", "contradicted"] as const;
type Verdict = (typeof VERDICT_VALUES)[number];

function isFactcheckBodyAst(v: unknown): v is {
  agentKind: "doc_editor";
  command: "factcheck";
  range: { start: number; end: number };
  verdict: Verdict;
  note: string;
} {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.agentKind !== "doc_editor") return false;
  if (o.command !== "factcheck") return false;
  if (!o.range || typeof o.range !== "object") return false;
  const r = o.range as Record<string, unknown>;
  if (typeof r.start !== "number" || typeof r.end !== "number") return false;
  if (!VERDICT_VALUES.includes(o.verdict as Verdict)) return false;
  return true;
}

function flatten(children: (TElement | TText)[]): string {
  return children
    .map((c) =>
      "text" in c ? c.text : flatten((c.children ?? []) as (TElement | TText)[]),
    )
    .join("");
}

// Pure decoration computation — extracted so it's unit-testable without
// a Plate editor instance. Returns lightweight records; the plugin (see
// below) maps them to Plate `Range[]` decorations at render time.
export function computeFactcheckDecorations(
  value: Value,
  comments: FactcheckCommentLike[],
): FactcheckDecoration[] {
  const blockText = new Map<string, string>();
  for (const node of value) {
    const n = node as { id?: string; children?: (TElement | TText)[] };
    if (typeof n.id === "string" && Array.isArray(n.children)) {
      blockText.set(n.id, flatten(n.children));
    }
  }
  const out: FactcheckDecoration[] = [];
  for (const c of comments) {
    if (!c.anchorBlockId) continue;
    if (!isFactcheckBodyAst(c.bodyAst)) continue;
    const text = blockText.get(c.anchorBlockId);
    if (text === undefined) continue;
    const { start, end } = c.bodyAst.range;
    if (start < 0 || end > text.length || end <= start) continue;
    out.push({
      commentId: c.id,
      blockId: c.anchorBlockId,
      start,
      end,
      verdict: c.bodyAst.verdict,
      note: c.bodyAst.note,
    });
  }
  return out;
}

// ─── Plate plugin wrapper ───────────────────────────────────────────────
// Wires `computeFactcheckDecorations` into Plate's decoration system.
// We pass the comments via React context (set by `NoteEditor.tsx`) so
// the plugin doesn't have to re-query on every keystroke.

import { createPlatePlugin } from "platejs/react";
import { createContext, useContext, useMemo } from "react";

const FactcheckCommentsContext = createContext<FactcheckCommentLike[]>([]);

export function FactcheckCommentsProvider({
  comments,
  children,
}: {
  comments: FactcheckCommentLike[];
  children: React.ReactNode;
}) {
  const memo = useMemo(() => comments, [comments]);
  return (
    <FactcheckCommentsContext.Provider value={memo}>
      {children}
    </FactcheckCommentsContext.Provider>
  );
}

const VERDICT_EMOJI: Record<Verdict, string> = {
  supported: "🟢",
  unclear: "🟡",
  contradicted: "🔴",
};

export const FactcheckDecorationPlugin = createPlatePlugin({
  key: "factcheck-decorations",
}).extend(({ editor }) => {
  return {
    decorate: ({ entry: [node, path] }) => {
      // Only top-level blocks carry an id; leaf decoration nodes lack one.
      const block = node as { id?: string };
      if (!block.id) return [];
      const comments = useContext(FactcheckCommentsContext);
      const decorations = computeFactcheckDecorations(
        editor.children,
        comments,
      );
      const matches = decorations.filter((d) => d.blockId === block.id);
      return matches.map((d) => ({
        anchor: { path: [...path, 0], offset: d.start },
        focus: { path: [...path, 0], offset: d.end },
        factcheckVerdict: d.verdict,
        factcheckNote: d.note,
        factcheckCommentId: d.commentId,
      }));
    },
    handlers: {},
    // Render the leaf with an emoji prefix when our decoration key is set.
    overrideByKey: {
      // Rely on Plate's leaf override pipeline. Implementation note:
      // Plate v49 exposes a `renderLeaf` hook at the editor level; the
      // simplest path is a leaf component that checks `props.leaf
      // .factcheckVerdict`. If the surrounding code uses a different
      // pattern (e.g. `withDecorate`), match that.
    },
  };
});

// Leaf component the editor can wire into its renderLeaf chain.
export function FactcheckLeaf({
  attributes,
  children,
  leaf,
}: {
  attributes: Record<string, unknown>;
  children: React.ReactNode;
  leaf: {
    factcheckVerdict?: Verdict;
    factcheckNote?: string;
    factcheckCommentId?: string;
  };
}) {
  if (!leaf.factcheckVerdict) {
    return <span {...attributes}>{children}</span>;
  }
  return (
    <span
      {...attributes}
      title={leaf.factcheckNote}
      data-factcheck-comment-id={leaf.factcheckCommentId}
      className={`factcheck-mark factcheck-${leaf.factcheckVerdict}`}
    >
      {VERDICT_EMOJI[leaf.factcheckVerdict]}
      {children}
    </span>
  );
}
```

(Plate v49 specifics: confirm `createPlatePlugin` + `decorate` API in `apps/web/src/components/editor/plugins/wiki-link.tsx` for the exact import path and lifecycle. If your version of Plate uses `decorateNode` or `withPlugin`, adapt the wrapper while keeping the pure `computeFactcheckDecorations` function unchanged.)

- [ ] **Step 4: Verify pure helper passes**

```
pnpm --filter @opencairn/web test -- factcheck-decorations
```
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/plugins/factcheck-decorations.tsx apps/web/src/components/editor/plugins/__tests__/factcheck-decorations.test.ts
git commit -m "feat(web): factcheck decoration plugin + pure computeFactcheckDecorations (Plan 11B-B)"
```

---

## Task 14: Web — wire decoration plugin into NoteEditor + slash callbacks

**Files:**
- Modify: `apps/web/src/components/editor/NoteEditor.tsx`

- [ ] **Step 1: Read the current NoteEditor wiring**

Run:
```
sed -n '1,200p' apps/web/src/components/editor/NoteEditor.tsx
```
Identify:
- Where Plate plugins are registered.
- Where the comments query is fetched (Phase 2C added a hook; reuse that data).
- The Phase A `handleAiCommand` callback.

- [ ] **Step 2: Register the decoration plugin**

In `NoteEditor.tsx`:

```tsx
import {
  FactcheckCommentsProvider,
  FactcheckDecorationPlugin,
  FactcheckLeaf,
  type FactcheckCommentLike,
} from "./plugins/factcheck-decorations";

// In the plugins array:
plugins: [...existingPlugins, FactcheckDecorationPlugin],

// Map the existing comments query to the FactcheckCommentLike shape.
// Phase 2C exposes a `useNoteComments(noteId)` hook (or similar);
// reuse it.
const comments = useNoteComments(noteId);
const factcheckComments: FactcheckCommentLike[] = useMemo(
  () =>
    comments.map((c) => ({
      id: c.id,
      anchorBlockId: c.anchorBlockId,
      bodyAst: c.bodyAst,
    })),
  [comments],
);

return (
  <FactcheckCommentsProvider comments={factcheckComments}>
    <Plate {...} renderLeaf={FactcheckLeaf}>
      ...
    </Plate>
  </FactcheckCommentsProvider>
);
```

(If Plate v49 uses a different `renderLeaf` slot, locate the existing leaf renderer and chain it. The decoration key `factcheckVerdict` must propagate to the leaf props.)

- [ ] **Step 3: Extend the slash AI callback**

Phase A's `handleAiCommand` already covers improve/translate/summarize/expand. Add cite + factcheck — the same `useDocEditorCommand` call, the sheet handles the rendering branches:

```tsx
const handleAiCommand = useCallback(
  (cmd: DocEditorCommand) => {
    const selection = readSelection(editor);
    if (!selection) return;
    setSheetOpen(true);
    setActiveCommand(cmd); // already passed through to InlineDiffSheet
    void docEditor.run(noteId, cmd, {
      selection,
      documentContextSnippet: readSnippetAround(editor, selection),
    });
  },
  [editor, noteId, docEditor],
);
```

For `/factcheck`, after the run completes the comments query needs to refetch so the decorations show up. Either invalidate the SWR/React-Query key when `docEditor.state.status === "ready" && docEditor.state.outputMode === "comment"`, or rely on Hocuspocus presence broadcast (Phase 2B comments stream). Pick the existing pattern; add a small `useEffect`:

```tsx
useEffect(() => {
  if (
    docEditor.state.status === "ready" &&
    docEditor.state.outputMode === "comment"
  ) {
    refetchComments();
  }
}, [docEditor.state, refetchComments]);
```

For the "Show in comments" CTA in the sheet, scroll the right rail to the first new comment id:

```tsx
const onShowInComments = useCallback((ids: string[]) => {
  if (!ids[0]) return;
  document.getElementById(`comment-${ids[0]}`)?.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
  setSheetOpen(false);
  docEditor.reset();
}, [docEditor]);
```

(Each comment row in the right rail should already have `id={comment-${id}}`. If not, add it in the comment row component.)

- [ ] **Step 4: Run web tests + typecheck**

```
pnpm --filter @opencairn/web test
pnpm --filter @opencairn/web typecheck
```
Expected: PASS.

- [ ] **Step 5: Manual smoke**

```
FEATURE_DOC_EDITOR_SLASH=true FEATURE_DOC_EDITOR_RAG=true \
NEXT_PUBLIC_FEATURE_DOC_EDITOR_SLASH=true NEXT_PUBLIC_FEATURE_DOC_EDITOR_RAG=true \
pnpm dev
```

- Open a note in a project that already has indexed source notes (run an ingest first if blank).
- Highlight a sentence containing a factual claim ("MNIST has 84% accuracy").
- Type `/`, scroll to AI → click "Cite".
- Wait — InlineDiffSheet shows "Searching the wiki… (1)" then a diff with `[^1]` markers + bibliography. Click "Accept all".
- Highlight a similar passage; type `/factcheck`.
- Sheet shows "N fact-check comments added"; click "Show in comments".
- Right rail scrolls to the new comments (🟢/🟡/🔴 badges). Inline emoji markers appear in the editor at the claim ranges.

If anything breaks, fix before committing.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/editor/NoteEditor.tsx
git commit -m "feat(web): wire factcheck decorations + /cite + /factcheck callbacks (Plan 11B-B)"
```

---

## Task 15: Worker — observability for tool-progress events (optional but recommended)

**Files:**
- Modify: `apps/worker/src/worker/agents/doc_editor/agent.py`

The web hook reads `tool_progress` events from SSE — but the agent currently doesn't emit them. The API translates `ToolUse` events from the worker to `tool_progress` SSE events… except the worker activity path swallows them (the activity returns the final output dict, not an event stream).

**Decision for v1:** the API route knows how many `tool_progress` events to emit *deterministically* — it can synthesize one event per `result.tools_used` count. Add `tools_used: int` to the worker output:

- [ ] **Step 1: Add `tools_used` to `DocEditorOutput`**

```python
@dataclass(frozen=True)
class DocEditorOutput:
    command: str
    output_mode: str
    payload: dict[str, Any]
    tokens_in: int
    tokens_out: int
    tools_used: int = 0   # Phase B — non-zero when the tool loop fired
```

In `_run_tool_loop`, return the `LoopResult.tool_call_count` and propagate:

```python
        return (
            payload,
            result.total_input_tokens,
            result.total_output_tokens,
            latency_ms,
            result.tool_call_count,
        )
```

Update the call site in `run` to unpack `tools_used` and pass it into `DocEditorOutput(..., tools_used=tools_used)`. For the single-shot path return `0`.

- [ ] **Step 2: API emits one synthetic `tool_progress` per call**

In `apps/api/src/routes/doc-editor.ts`, after the workflow returns:

```ts
        if (result.tools_used && result.tools_used > 0) {
          for (let i = 1; i <= result.tools_used; i++) {
            await stream.write(
              encodeSseEvent({
                type: "tool_progress",
                tool: "search_notes",
                callCount: i,
              }),
            );
          }
        }
```

(This is *post-hoc* synthesis — the events arrive after the workflow finished. v1 acceptable: the hook still increments correctly; the UX delta vs. real-time progress is small. Real-time streaming requires worker→API event channel which is a Phase C / 2B-style separate spec.)

- [ ] **Step 3: Update the API test**

Adjust `streams diff hunks for /cite` to expect the synthetic events:

```ts
expect(body).toContain("event: tool_progress");
```

- [ ] **Step 4: Verify pass**

```
pnpm --filter @opencairn/worker exec pytest tests/agents/test_doc_editor_cite.py tests/agents/test_doc_editor_factcheck.py -v
pnpm --filter @opencairn/api test -- doc-editor
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker/agents/doc_editor/agent.py apps/api/src/routes/doc-editor.ts apps/api/tests/doc-editor.test.ts
git commit -m "feat(worker,api): tools_used counter + synthetic tool_progress SSE (Plan 11B-B)"
```

---

## Task 16: Docs sync + plans-status update

**Files:**
- Modify: `docs/architecture/api-contract.md`
- Modify: `docs/contributing/plans-status.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update api-contract**

In `docs/architecture/api-contract.md`, find the row Phase A added for `POST /api/notes/:id/doc-editor/commands/:command`. Append:

```
Phase B adds `cite` + `factcheck` (gated by `FEATURE_DOC_EDITOR_RAG`).
SSE event union also includes `factcheck_comments_inserted`,
`tool_progress`, and `output_mode='comment'` payloads.
For `factcheck`, the route inserts one `comments` row per claim
(authorId = triggering user, `bodyAst.agentKind='doc_editor'`,
`bodyAst.command='factcheck'`, full claim payload in `bodyAst`).
```

- [ ] **Step 2: Update plans-status**

In `docs/contributing/plans-status.md`, add (under whatever section Phase A lives in):

```
| `2026-04-28-plan-11b-phase-b-rag-slash-commands.md` | 🟡 ready, plan only | Plan 11B Phase B — adds `/cite` (diff hunks with footnote markers) + `/factcheck` (per-claim comments + inline 🟢/🟡/🔴 decorations) on top of Phase A. Reuses `search_notes` builtin (project-scoped). Comment author = triggering user; agent metadata in `comments.bodyAst`. No DB migration. Behind `FEATURE_DOC_EDITOR_RAG` (layered on `_SLASH`). Defers Tab Mode Diff View (C), save-suggestion (D), provenance (E), related-pages (F). |
```

- [ ] **Step 3: Append to CLAUDE.md Plans roster (if Phase A entry exists)**

In `CLAUDE.md`'s "🟡 Active / next" line, append `Plan 11B Phase B (/cite + /factcheck, plan only)`.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/api-contract.md docs/contributing/plans-status.md CLAUDE.md
git commit -m "docs: Plan 11B Phase B — api-contract, plans-status, CLAUDE.md (Plan 11B-B)"
```

---

## Task 17: End-to-end smoke + integration audit

**Files:** none (verification only)

- [ ] **Step 1: Run all package test suites**

```
pnpm --filter @opencairn/shared test
pnpm --filter @opencairn/db test
pnpm --filter @opencairn/api test
pnpm --filter @opencairn/web test
pnpm --filter @opencairn/worker exec pytest -q
```

Expected: all green. Phase A's audit-row test (`doc_editor_calls`) and i18n parity must still pass.

- [ ] **Step 2: i18n parity**

```
pnpm --filter @opencairn/web i18n:parity
```

- [ ] **Step 3: Real Temporal smoke (only if a Temporal env exists)**

```
TEMPORAL_INTEGRATION=1 \
FEATURE_DOC_EDITOR_SLASH=true FEATURE_DOC_EDITOR_RAG=true \
pnpm --filter @opencairn/api test -- doc-editor
```

The Phase A integration test already round-trips one workflow; if you have time, copy that block for `cite` and `factcheck`.

- [ ] **Step 4: Lint + typecheck**

```
pnpm typecheck
pnpm lint
```

- [ ] **Step 5: Final commit (if any docs/code drifted during audit)**

```bash
git status
# If anything changed:
git add -A
git commit -m "chore: post-audit fixes (Plan 11B-B)"
```

---

## Self-Review Checklist (run before declaring complete)

- [ ] Spec §6.1 rows for `/cite` + `/factcheck` both wired through agent → activity → workflow → API → web slash menu → InlineDiffSheet → (cite: diff apply / factcheck: comment lane + decorations).
- [ ] Spec §6.6 comment payload shape exactly matches the Zod schema in `packages/shared/src/doc-editor.ts` — `claims[]`, each with `blockId`, `range`, `verdict ∈ {supported, unclear, contradicted}`, `evidence[]`, `note`.
- [ ] Spec §6.9 error paths covered: empty evidence → `unclear` (not `supported`); off-spec verdict → coerced to `unclear`; selection race → 409 (Phase A path); RAG no results → handled by per-claim verdict + `evidence: []`.
- [ ] No DB migration files added.
- [ ] Phase A behavior (the four LLM-only commands) is regression-free — `_run_single_shot` carries the original Phase A logic verbatim.
- [ ] Both flags layered correctly: `_SLASH=false` → router not mounted; `_SLASH=true` + `_RAG=false` → cite/factcheck return 404; both true → all six AI commands work. Web slash menu mirrors via `NEXT_PUBLIC_*` flags.
- [ ] `comments.authorId` is the triggering user (no FK violation on synthetic agent users); `bodyAst.agentKind`/`command`/`triggeredBy` carry the agent identity.
- [ ] Plate decoration plugin is keyed by `(blockId, range)` so block reorders / edits inside the block invalidate cleanly. `computeFactcheckDecorations` is pure + unit-tested.
- [ ] No `/cite` or `/factcheck` references leak into Phase A files (commands `__init__.py` is the one shared touchpoint and grew correctly).
- [ ] No Tab Mode `diff` viewer references — Phase C still owns that.
- [ ] Tool loop bounded: max 4 turns + max 8 tool calls (LoopConfig). `/cite` system prompt caps at 3 search calls; `/factcheck` at 6.
- [ ] All commits include the standard `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` trailer (project commit convention; not shown in the plan's commit messages but enforced by repo hooks).
- [ ] `pnpm --filter @opencairn/web i18n:parity` green; new keys added to both `ko/doc-editor.json` and `en/doc-editor.json`.

---

## Follow-ups (out of Phase B)

- **Real-time `tool_progress`** — Task 15 synthesizes events post-hoc. Real-time requires a worker→API event channel (Redis pub/sub like the live-ingest visualization, or Temporal signals). Punt to Phase C alongside the Diff View redesign which already needs streaming hunks.
- **Per-claim resolve UX** — currently a factcheck comment is a normal comment. Mark-as-resolved + verdict-update from inline marker tooltip → Phase C.
- **Cross-project /cite** — `search_notes` is project-scoped. If a workspace-wide cite makes sense (cross-project knowledge), add a builtin `search_notes_workspace` that calls a new `/api/internal/notes/hybrid-search-workspace` endpoint (project filter optional). Defer until a user complaint.
- **Citation deduplication** — `/cite` may insert two `[^n]` markers pointing to the same source. The pure transform in `applyHunks` doesn't dedupe. Phase C tracks bibliography state across hunks.
- **Cost / token usage from provider** — token counts still mirror Phase A's heuristic (`len(msg) // 4`); replace once the runtime exposes provider-reported counts (parent issue across all agents per Phase A's follow-up list).
- **Mark preservation across factcheck decorations** — `FactcheckLeaf` collapses inline marks under the decorated range. Acceptable today (decorations are emoji-prefixed, not destructive) but revisit if an italic span underneath disappears visually.
