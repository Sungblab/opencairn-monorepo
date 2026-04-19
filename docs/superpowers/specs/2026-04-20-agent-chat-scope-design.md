# Agent Chat Scope, Memory & Document Viewer — Design Spec

**Status:** Draft (2026-04-20)
**Owner:** Sungbin
**Related:**
- [collaboration-model.md](../../architecture/collaboration-model.md) §3.5 (agent scoping)
- [api-contract.md](../../architecture/api-contract.md) (chat endpoints)
- Plan 4 (agent core), Plan 5 (KG), Plan 10 (document skills)
- Reverse-engineering note: Claude Code CLI (CWD-keyed memory, two-tier compaction, MEMORY.md index pattern)

---

## 1. Problem

Agent chat in OpenCairn currently has only one line of spec ("프로젝트 / 글로벌 스코프", design.md:803) and one optional `scope?` field in the chat API. There is **no specification for**:

1. How a chat conversation knows which slice of the user's knowledge to search and answer from
2. How long-term memory (per-user, per-workspace) is stored, scoped, and surfaced
3. How auto-detected scope is made visible and overridable by the user
4. How chat answers respect the workspace permission model when pinned to shared pages
5. How original document sources (PDF/DOCX/PPTX/HWP) are viewed alongside the chat that cites them

This spec resolves all five.

## 2. Goals & Non-Goals

**Goals**
- Cursor/Claude-Code-grade context attachment UX, but in a **multi-user, workspace-isolated** product
- Notion-grade explicit scope visibility — every auto-decision is shown as a removable chip
- ChatGPT/Claude-grade personal memory + Notion-grade workspace memory, without violating workspace isolation
- A single in-browser viewer for all source formats so chat citations resolve to consistent positions
- v0.1 scope: ship the foundation. Defer cross-conversation history (L2 default), conversation sharing, workspace credit pool, native (non-PDF) viewers, and L4 admin approval to v0.2

**Non-goals (v0.1)**
- Conversation-level sharing or comments (Q5: 라 — pin-only sharing for now)
- Workspace credit pool (Q9: PAYG = per-user, even for L4 token cost)
- Native renderers per format (DOCX/PPTX/HWP all view via PDF in v0.1)
- Multi-conversation context (L2) defaulting to ON

## 3. Scope Model

### 3.1 Three-tier scope

`page` ⊂ `project` ⊂ `workspace`. **Workspace is a hard isolation boundary** — agents, RAG, KG, and Hocuspocus channels never cross it (collaboration-model §3.5).

### 3.2 Auto-detect rules (initial scope by entry point)

| Entry point | Initial scope |
|-------------|---------------|
| Right side panel inside a page (page-context chat) | `page` (current page) |
| Project home (after entering a project card) | `project` |
| Global sidebar chat (workspace-wide hotkey) | `workspace` |
| KG node right-click → "Ask about this concept" | `project` (the project containing the node) |

### 3.3 Scope attached to conversation

A conversation persists its scope (and full chip set) for its lifetime. Reopening the same conversation from a different location does **not** rescope it. Only explicit chip mutation changes scope.

This avoids the "I came back to find my chat 추론하는 게 달라졌어" problem and keeps citations stable.

## 4. Chip UI

### 4.1 Layout

A horizontal chip row sits directly above the chat input. **Auto-attached items appear as chips identically to manually-added ones** — the only difference is a small `auto` indicator on hover.

```
[📄 RoPE explained]  [📂 Thesis]  [🧠 Personal]  [🏢 ML Lab]  [💬 3 past chats]  [+]    🎯 Strict ▾
─────────────────────────────────────────────────────────────────────
How can I help? _
```

### 4.2 Chip types

| Icon | Type | Source |
|------|------|--------|
| 📄 | `page` context | A specific note in the workspace |
| 📂 | `project` context | All notes in a project |
| 🌐 | `workspace` context | All notes in the workspace |
| 🧠 | `memory:l3` | Personal memory entries |
| 🏢 | `memory:l4` | Workspace memory entries |
| 💬 | `memory:l2` | Past-conversation summaries |

### 4.3 Interactions

- `X` → remove chip immediately (auto-attached chips can be removed too)
- `+` → combobox: search pages / projects / memories. Multi-select.
- Hover → token estimate + cost estimate (`~2.3k tokens / ~38원`)
- Strict/Expand toggle → see §6

### 4.4 Persistence

Chip set is part of the `conversations` row (`attached_chips` jsonb). Survives reopen.

## 5. Memory Architecture

### 5.1 Four layers

| Level | Content | Storage | Permission | Default chip state |
|-------|---------|---------|------------|--------------------|
| **L1** Conversation compaction | In-conversation summary as length grows | `conversations.session_memory_md` + `.full_summary` | Owner only | Always on (automatic, not chip-controlled) |
| **L2** Past-conversation context | Summaries of prior chats on same page/project | `conversation_summaries` (denormalized) | Owner only | Visible chip, **default OFF** (token cost) |
| **L3** Personal memory | "Reply in Korean", "PhD ML student" | `user_global_memory_entries` + `user_workspace_memory_entries` | Owner only | Visible chip, default ON |
| **L4** Workspace memory | "Lab citation = IEEE", "No external links" | `workspace_memory_entries` | `member`+ read & write, owner/admin policy | Visible chip, default ON |

### 5.2 L1 — two-tier compaction (Claude Code pattern)

```
Context fill ratio
├─ < 50%   → no compaction
├─ 50–87%  → Session Memory extraction (lossless, semantic)
│            * background worker writes to conversations.session_memory_md
│            * mirrors Claude Code's SESSION_MEMORY.md pattern
└─ > 87%   → Full LLM summary (lossy, fallback)
             * keep last N turns + Session Memory; LLM-summarize the rest
             * stored in conversations.full_summary
```

Threshold constants (from Claude Code, validated):
- Warning: `effective_window − 20k`
- Auto-compact trigger: `effective_window − 13k`
- Hard block: `effective_window − 3k`

### 5.3 L3 — dual storage (global + per-workspace)

```sql
user_global_memory_entries
  id              uuid PK
  user_id         text FK
  name            text
  type            enum (preference, fact, style, instruction)
  description     text  -- search/embedding source
  body            text
  created_at, updated_at

user_workspace_memory_entries
  id              uuid PK
  user_id         text FK
  workspace_id    uuid FK
  name, type, description, body
  created_at, updated_at
  INDEX (user_id, workspace_id)
```

**Default for new entries: workspace-scoped** (preserves the §3.5 isolation guarantee). Promoting an entry to global requires an explicit toggle in the memory editor — making the boundary crossing visible.

### 5.4 L4 — workspace memory (Notion-style trust)

```sql
workspace_memory_entries
  id              uuid PK
  workspace_id    uuid FK ON DELETE CASCADE
  name            text                       -- e.g. "ieee_citation_style"
  type            enum (style, fact, rule, reference)
  description     text                       -- one-line, indexed for retrieval
  body            text
  created_by      text FK users
  updated_by      text FK users
  created_at, updated_at
  INDEX (workspace_id, type)
```

- `member` and above can create/edit/delete
- Every mutation logs to `activity_events` (verb: `memory_created` / `memory_updated` / `memory_deleted`)
- Workspace settings allow narrowing write access to `admin`+ for regulated industries

### 5.5 MEMORY.md index pattern

For L3 and L4, store a separate `index_md` text per scope (max 25KB, ~200 lines). Format mirrors Claude Code's auto-memory:

```markdown
- [IEEE Citation Style](ieee_citation_style.md) — bibliography & in-text format we use
- [No External Links](no_external_links.md) — security policy, all links must be internal
```

The index is always loaded into agent context. Entry bodies are loaded selectively by:
1. Embedding similarity (entry.description ↔ user query): top-K
2. Type filter (e.g., document skills always load `style` entries)

### 5.6 Background auto-extraction

A background worker extracts user preferences and facts from conversations into L3 (workspace-scoped by default).

- Trigger: conversation idle for 10 min, or every N turns, or session end
- Feature flag (default ON, user-toggleable in settings)
- User can also explicitly say "기억해줘" (natural language) or `/remember` (slash command)

## 6. RAG Retrieval

### 6.1 Strict vs Expand toggle

A small dropdown to the right of the chip row. Default = `Strict`.

- **🎯 Strict**: Search only the corpora attached as chips (page → that page only; project → that project only; workspace → entire workspace)
- **🌐 Expand**: 1st-pass search the chips, then fall back to workspace if results are sparse. Answers tag cross-corpus citations as "Found in another project: …"

When Expand is on, the chip row shows a faint auxiliary chip `+ workspace fallback` so the user always knows where answers can come from.

### 6.2 Retrieval pipeline

Already RRF-fused (pgvector + tsvector BM25 + LightRAG hops, plan-4). Scope filter is applied **at the query boundary**:

- `page` scope → `WHERE note_id = $1`
- `project` scope → `WHERE note_id IN (SELECT id FROM notes WHERE project_id = $1)`
- `workspace` scope → `WHERE workspace_id = $1`

Workspace scope is **never** a `WHERE TRUE` query — there is always a workspace_id predicate to enforce §1 hard isolation.

## 7. Conversation Data Model

### 7.1 Tables

```sql
conversations
  id                  uuid PK
  workspace_id        uuid FK ON DELETE CASCADE
  owner_user_id       text FK users
  title               text
  scope_type          enum (page, project, workspace)
  scope_id            text                          -- page_id / project_id / workspace_id
  attached_chips      jsonb NOT NULL                -- [{type, id, label, manual}, …]
  rag_mode            enum (strict, expand) NOT NULL DEFAULT 'strict'
  memory_flags        jsonb NOT NULL                -- {l3_global, l3_workspace, l4, l2}
  session_memory_md   text                          -- L1 lossless extract
  full_summary        text                          -- L1 lossy compaction
  total_tokens_in     bigint NOT NULL DEFAULT 0
  total_tokens_out    bigint NOT NULL DEFAULT 0
  total_cost_krw      numeric NOT NULL DEFAULT 0
  created_at, updated_at
  INDEX (workspace_id, owner_user_id, updated_at DESC)
  INDEX (scope_type, scope_id, updated_at DESC)

conversation_messages
  id                  uuid PK
  conversation_id     uuid FK ON DELETE CASCADE
  role                enum (user, assistant, system, tool)
  content             text
  citations           jsonb                          -- [{source_type, source_id, snippet, locator}, …]
  tokens_in, tokens_out int
  cost_krw            numeric
  created_at
  INDEX (conversation_id, created_at)

pinned_answers
  id                  uuid PK
  message_id          uuid FK conversation_messages ON DELETE CASCADE
  note_id             uuid FK notes ON DELETE CASCADE
  block_id            text                            -- Plate block ID
  pinned_by           text FK users
  pinned_at           timestamptz
  INDEX (note_id)
```

### 7.2 Default visibility — Private (Q5: 라)

`conversations` are owner-only (`owner_user_id`). A conversation is not visible to other workspace members even though `workspace_id` is set (workspace_id is for hard-isolation enforcement, not for sharing).

Sharing happens at **answer level** via `pinned_answers`: pinning a single message to a page surfaces that answer in the page's normal block stream, where workspace permissions apply.

### 7.3 Pin-time permission check (Q9: A + C)

When a user clicks "Pin to page":

1. Resolve `viewer`+ users for the target page
2. For each citation in the message, check whether those users can read the cited source
3. If any citation is hidden from any of those viewers, show a confirmation:
   ```
   ⚠ This answer cites: [Page X], [Page Y]
   Pinning to "Page Z" will expose the answer to: [User A, User B]
   These users cannot see: [Page X]
   
   The pinned answer will be visible. Continue?
   [Cancel]  [Pin anyway]
   ```
4. On confirm → insert `pinned_answers` row + log `activity_events` (`verb=pinned_answer`, `reason=user_confirmed_permission_warning`)

This is an A + C combination: ownership stays simple (answer = chat owner's), but pinning surfaces the implicit permission delta explicitly at the moment it matters.

## 8. Cost Attribution

### 8.1 Per-user PAYG (Q9: 다)

All conversation tokens — including L4 workspace memory loaded into the request — are billed to the chat-initiating user's PAYG balance. Workspace memory shared across the team is treated like any other context the user opted into (and can opt out of via the chip).

### 8.2 Transparency

- Chip row: each chip shows token estimate on hover (client-side tiktoken-style estimator)
- After each assistant response, the SSE stream emits a final `cost` event: `{ tokens_in, tokens_out, cost_krw }` displayed inline (`-12원`)
- `conversation_messages.cost_krw` records the actual debit per message
- Existing PAYG aggregation (`billing_usage`) is unchanged — just new rows

### 8.3 Defensive UX

If a workspace admin loads expensive L4 entries that inflate every member's chat cost, the per-chat token estimate makes this visible. Members can disable the L4 chip per-conversation, or in their settings page set L4 default-off.

## 9. Settings Page (`/settings/chat`)

### 9.1 Auto-attach defaults

- ☑ Page chat auto-attaches the page (default ON)
- ☑ Project chat auto-attaches the project (default ON)
- ☑ Personal memory (L3) auto-loaded (default ON)
- ☑ Workspace memory (L4) auto-loaded (default ON)
- ☐ Past conversation context (L2) auto-loaded (default OFF — token cost)
- Default RAG mode: `Strict` ▾ / `Expand` (default Strict)

### 9.2 Memory management

- L3 entries — global / per-workspace tabs, edit/delete, "promote to global" toggle per entry
- ☑ Background auto-extraction (default ON)
- L4 entries — list view; admin sees policy controls ("Restrict L4 edits to admin only")
- L4 mutation history (admin only, paginated activity_events filter)

### 9.3 Cost

- ☑ Show token estimate in chat header (default ON)
- ☑ Show actual cost after response (default ON)
- Low-balance threshold for PAYG email alert (default ₩1,000)

## 10. API Surface (additions to api-contract.md)

```
POST /api/chat/conversations
  body: {
    workspaceId, scopeType, scopeId,
    attachedChips: [{ type, id, manual }],
    ragMode, memoryFlags
  }
  → 201 { id }

PATCH /api/chat/conversations/:id
  body: { ragMode?, memoryFlags?, title? }

POST /api/chat/conversations/:id/chips
  body: { type, id }
DELETE /api/chat/conversations/:id/chips/:chipKey

POST /api/chat/message  (SSE stream)
  body: { conversationId, content }
  events: delta, citation, cost, done

POST /api/chat/messages/:id/pin
  body: { noteId, blockId }
  → 200 { pinned: true }
   | 409 { warning: { hiddenSources, hiddenUsers }, requireConfirm: true }
POST /api/chat/messages/:id/pin/confirm
  body: { noteId, blockId }
  → 200 { pinned: true }

# Memory
POST   /api/memory/personal               body: { workspaceId?, type, name, description, body }
PATCH  /api/memory/personal/:id
DELETE /api/memory/personal/:id
GET    /api/memory/personal               ?workspaceId&type
POST   /api/memory/personal/:id/promote   → moves entry from workspace-scope to global

POST   /api/memory/workspace              body: { workspaceId, type, name, description, body }
PATCH  /api/memory/workspace/:id
DELETE /api/memory/workspace/:id
GET    /api/memory/workspace              ?workspaceId&type
GET    /api/memory/workspace/activity     ?workspaceId  (admin only)
```

All routes pass through `canRead` / `canWrite` (collaboration-model §11.1).

## 11. Document Viewer (PDF.js + native download)

### 11.1 Strategy — hybrid (Q-viewer: 다)

Every uploaded source format (PDF, DOCX, PPTX, HWP, EPUB) is **converted to PDF at ingest time** and viewed inline via PDF.js. The original file is always downloadable via a "Download original" button.

This standardizes citation locators (page + line) across formats and keeps the viewer code surface small for v0.1.

### 11.2 Conversion pipeline (extends existing parsing stack)

The current ingest pipeline (Plan 3) already invokes `unoserver` (LibreOffice headless) and `H2Orestart` for HWP. Extend it to emit **two artifacts**:

1. Markdown (existing — for RAG and wiki ingest)
2. PDF (new — for inline view)

```
upload  →  unoserver / opendataloader-pdf / H2Orestart
            ├─→ markdown.md  (RAG, wiki)
            └─→ rendered.pdf (viewer)
```

PDF artifacts are stored in object storage with the same `source_id` key. Citation locators are stored as `{ page, line_range }` against the PDF.

### 11.3 Viewer component

- `apps/web/src/components/SourceViewer.tsx` — wraps PDF.js
- Mounts in: page side panel ("Source preview" tab), citation popover ("Jump to source"), and Document Studio
- Citation jump: `viewer.scrollToPage(page).highlight(line_range)`
- "Download original" button serves the **original** uploaded file (not the converted PDF)

### 11.4 Native viewer escape hatch (v0.2)

Out of scope for v0.1, noted for posterity:
- DOCX → docx-preview.js for editor-grade fidelity
- PPTX → reveal.js conversion or PPTX-as-image fallback
- HWP → hwp.js after server-side normalization

These can be added behind a per-format setting without changing v0.1's PDF-first viewer contract.

## 12. Out of Scope (v0.2+)

- L2 default-on (decide based on usage data; off for now to control PAYG cost)
- Conversation-level workspace sharing + comments + @mentions
- Workspace credit pool (currently PAYG is strictly per-user)
- L4 admin approval queue (currently member-write with activity logging)
- Native non-PDF viewers (DOCX/PPTX/HWP)
- Cross-workspace memory federation (intentionally never)

## 13. Migration Notes

This spec adds **new** tables only; no schema breaking change. The existing `conversations` table from Plan 4 (`chat`) is extended with the columns in §7.1 — additive migration.

The `scope?` field already in `POST /api/chat/conversations` (api-contract.md:171) gets a concrete shape (§10).

## 14. Open Questions for Plan Phase

These are detail-level decisions to surface during implementation planning:

1. Token-estimator library choice (tiktoken JS port vs. Gemini-specific tokenizer)
2. Background extraction worker — Temporal activity vs. lightweight Node cron in `apps/api`
3. PDF.js bundling strategy — full bundle vs. CDN
4. Citation locator format for non-paginated sources (audio: `{ start_ms, end_ms }`; web: `{ scroll_y, css_selector }`)
5. L4 entry size cap (suggest 4KB body, 512B description)
6. Embedding model for memory description retrieval (reuse existing `text-embedding-004` from Plan 4)
