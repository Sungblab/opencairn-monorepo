# Document Skills — Design Spec

**Date:** 2026-04-15
**Plan:** Plan 10 (new)
**Status:** ⚠️ **SUPERSEDED** by [`2026-04-27-multi-format-synthesis-export-design.md`](./2026-04-27-multi-format-synthesis-export-design.md) — 본 spec 은 server-side Tectonic MSA 단일 파이프라인 모델 (ADR-006 이전). 2026-04-27 synthesis export spec 이 Pyodide-first 생성 + 다중 포맷 (LaTeX/DOCX/PDF/MD) + 플래그 게이트로 재설계됨. 본 문서는 역사적 참고용으로만 유지.

---

## 1. Goal

Give OpenCairn a composable **document generation skill layer** — a set of independent, agent-callable skills that turn the user's knowledge graph into polished output artifacts (LaTeX papers, DOCX reports, HTML/PPTX slides, free-form PDFs, Anki decks, etc.).

This is **not** a monolithic "Document Studio" feature. It is a set of primitives (skills) that any agent can invoke and compose. "Deep research → write a LaTeX paper → review it 5 times" is not a hardcoded pipeline — it is an agent choosing to chain three skills.

### Design philosophy (from Claude Code reverse-engineering)

OpenCairn skills follow Claude Code's skill model at the pattern level, adapted pragmatically (approach **C** from brainstorming):

- **Frontmatter + body separation** — metadata decides *if* a skill runs, prompt body decides *how*
- **`context: inline | fork`** — some skills run in the current agent, others fork a sub-workflow with its own token budget
- **`allowed_tools` allowlisting** — each skill declares which LangGraph tools it can use
- **Lazy loading** — only skill name + short description is injected into the agent's prompt; full body + schemas load only on invocation
- **KG-anchored output** — every section/paragraph of generated content is tagged with source KG node IDs, giving hover-to-source traceability

### Differentiation from generic chat LLMs

The killer property is: **generated documents cite the user's own knowledge graph, not hallucinated generic content.** A paragraph traces back to the notes it was built from. A BibTeX entry in a LaTeX paper points to a KG source node. A flashcard deck is exportable to Anki. A PDF form is filled from the user's actual knowledge, not made up.

---

## 2. Scope

### In scope (v1)

Eleven skills plus one microservice. Grouped by role:

**Core output formats** (6 skills)

| Skill | Renderer | Compiler |
|---|---|---|
| `latex_paper` | LaTeX source | `apps/tectonic/` MSA |
| `docx_report` | structured JSON | `docx` npm in `apps/api` |
| `html_slides` | Reveal.js HTML | string → iframe in-app |
| `pptx_download` | structured outline | `pptxgenjs` in `apps/api` |
| `pdf_freeform` | HTML string | Playwright headless in `apps/api` |
| `review_document` | critique + revise | LLM only, no compile |

**OpenCairn-specific** (3 skills)

| Skill | Why it's unique |
|---|---|
| `pdf_form_fill` | Upload blank form PDF → extract form fields → AI fills using KG |
| `bibtex_from_kg` | KG source collection → `.bib` file; cite keys resolve to KG nodes |
| `anki_deck_export` | Plan 6 flashcards → `.apkg` file for Anki import |

**Meta-skills** (2 skills — chain other skills)

| Skill | Composition |
|---|---|
| `deep_research_paper` | `deep_research` (Plan 8) → `latex_paper` → `review_document` × N |
| `study_pack_generator` | One topic → `cheatsheet` + `flashcards` + `quiz` + `html_slides` |

**Infrastructure**

- `apps/tectonic/` — Rust Tectonic LaTeX compile microservice (Docker)
- `packages/templates/` — extended with `context`, `allowed_tools`, `compile_step` fields
- `apps/api/src/lib/document-compilers/` — DOCX / PPTX / PDF / Anki compile helpers
- `apps/web/src/app/(app)/studio/` — Document Studio UI (Monaco editor + preview pane)

### Explicitly out of scope (deferred to v2+)

- `markdown_blog_post`, `resume_cv_generator`, `email_draft`, `gantt_timeline_pdf`
- Image-based PPT generation (NotebookLM-style) — editable formats win
- In-browser WASM LaTeX (SwiftLaTeX) — Tectonic MSA strictly better
- Markdown export — already covered by Plan 9 data portability
- Mind-map image export — already covered by Plan 5 Cytoscape views
- Podcast audio — already covered by Plan 8 Narrator

---

## 3. Architecture

### 3.1 Execution topology

```
┌──────────────────────────────────────────────────┐
│ Python Worker — LangGraph agents                  │
│  • Agent picks a skill via SkillSelector          │
│  • Runs the skill's prompt → structured output    │
│  • Tags each section with source_node_ids[] (KG)  │
└──────────────────────────────────────────────────┘
            │
            ▼ POST /documents/compile
┌──────────────────────────────────────────────────┐
│ Compile layer                                     │
├──────────────────────────────────────────────────┤
│ LaTeX → POST apps/tectonic/compile  → PDF bytes   │
│ DOCX  → docx.js in apps/api         → .docx bytes │
│ HTML  → string passthrough           → HTML       │
│ PPTX  → pptxgenjs in apps/api        → .pptx bytes│
│ PDF   → Playwright in apps/api       → PDF bytes  │
│ Anki  → genanki-like in apps/api     → .apkg bytes│
└──────────────────────────────────────────────────┘
            │
            ▼ upload
         Cloudflare R2 → signed URL
            │
            ▼
         Document Studio UI (Monaco + preview)
```

### 3.2 Why Tectonic is the only new MSA

| Format | Why in-process, not MSA |
|---|---|
| DOCX | `docx` npm is pure JS, lightweight, no external binaries |
| PPTX | `pptxgenjs` is pure JS, lightweight |
| HTML | Passthrough string, no binary |
| PDF (HTML→PDF) | Playwright already a candidate dependency for tests; headless chrome runs fine as API sibling |
| Anki | SQLite + zip, pure JS |
| **LaTeX** | **TeX Live is ~4GB, compile paths touch binary packages on CTAN, package resolution is stateful** → must be isolated in its own container with its own cache volume |

### 3.3 Skill runtime (extension of Plan 6 `packages/templates/`)

Plan 6 already defines a template engine with `prompt_template + output_schema + renderer`. This spec extends the schema with three fields inspired by Claude Code skills:

```typescript
// packages/templates/src/types.ts (extended)
export type Skill = {
  // ── Identity ──────────────────────────────────────
  name: string                      // e.g. "latex_paper"
  description: string               // 1-line, for discovery
  when_to_use: string               // for agent's skill matcher

  // ── Execution ─────────────────────────────────────
  prompt_template: string           // Handlebars / simple {{var}}
  output_schema: ZodSchema          // validates LLM output

  // ── NEW: context isolation (from Claude Code) ─────
  context: "inline" | "fork"
  // inline = runs in current agent, shares context + messages
  // fork   = spawns a Temporal child workflow with its own token budget
  //          result only; parent context stays clean

  // ── NEW: tool allowlist ───────────────────────────
  allowed_tools?: string[]          // e.g. ["kg_search", "deep_research"]
  // Restricts which LangGraph tools the skill's LLM call can invoke.
  // Unset = all tools allowed.

  // ── NEW: compile step ─────────────────────────────
  compile_step?: {
    renderer: "latex" | "docx" | "html" | "pptx" | "pdf" | "anki" | "none"
    target: "tectonic-msa" | "api-inprocess"
    mime_type: string
    extension: string
  }

  // ── KG anchoring ──────────────────────────────────
  kg_anchored: boolean              // output sections get source_node_ids[]
}
```

**Lazy loading contract:** Agents are given only `{name, description, when_to_use}` in their system prompt. Full `prompt_template`, `output_schema`, and `allowed_tools` are loaded by the skill runtime only when a skill is invoked. This keeps agent prompt overhead near-zero regardless of how many skills exist.

**Source layering:** Skills can come from `bundled/` (shipped with OpenCairn), `user/` (per-user custom skills stored in `~/.opencairn/skills/`), or `plugin/` (from installable marketplace plugins). Precedence: user > plugin > bundled. Implementation defers marketplace to v2 — v1 ships only bundled.

### 3.4 `inline` vs `fork` decision

| Skill | Mode | Rationale |
|---|---|---|
| `review_document` | `inline` | Just a prompt, agent already has context |
| `docx_report` | `inline` | Produces JSON, compiled by API, no heavy research |
| `html_slides` | `inline` | Same |
| `pptx_download` | `inline` | Same |
| `pdf_freeform` | `inline` | Same |
| `latex_paper` | `inline` | Same |
| `bibtex_from_kg` | `inline` | Pure KG query, short output |
| `anki_deck_export` | `inline` | Just transforms existing flashcards |
| `pdf_form_fill` | `inline` | Form extraction is deterministic; LLM fills in a single pass |
| **`deep_research_paper`** | **`fork`** | Runs Plan 8 `deep_research` (long, high token) + multi-round review loop — must isolate |
| **`study_pack_generator`** | **`fork`** | Runs four child skills sequentially — isolate so parent context stays small |

Fork mode maps directly to **Temporal child workflows** — parent workflow awaits child completion, gets only the structured result, not the intermediate transcript.

---

## 4. Skill Specifications

Each skill below gets its own JSON file under `packages/templates/templates/output/`. Zod schemas live in `packages/templates/src/schemas/output/`. This section gives the contract for each.

### 4.1 `latex_paper`

**Input:** `{ topic: string, sections?: string[], kg_query?: string, style?: "ieee"|"acm"|"article" }`
**LLM output schema:** `{ preamble: string, sections: Array<{title, content_tex, source_node_ids: string[]}>, bib_entries: BibEntry[] }`
**Compile:** POST full `.tex` (assembled from sections + bib) to `apps/tectonic/compile` → PDF bytes → R2
**KG anchor:** Each section's `source_node_ids` stored in `document_section_sources` table (§5.1)

### 4.2 `docx_report`

**Input:** `{ topic: string, format: "academic"|"business", include_citations: boolean }`
**LLM output schema:** `{ title: string, sections: Array<{heading, paragraphs: Paragraph[], footnotes: Footnote[]}>, bibliography?: Citation[] }`
**Compile:** `apps/api` calls `docx` npm library → `.docx` Buffer → R2
**KG anchor:** Footnote citations carry source KG node IDs; bibliography resolved via `bibtex_from_kg`

### 4.3 `html_slides`

**Input:** `{ topic: string, slide_count?: number, theme?: string }`
**LLM output schema:** `{ title: string, slides: Array<{title, bullets: string[], notes?: string, image_prompt?: string, source_node_ids: string[]}> }`
**Compile:** Render Reveal.js HTML string from outline → store as HTML artifact → Document Studio shows in iframe
**PDF export:** Optional secondary call to `pdf_freeform` with the rendered HTML

### 4.4 `pptx_download`

**Input:** Same as `html_slides`
**LLM output schema:** Same as `html_slides`
**Compile:** `apps/api` calls `pptxgenjs` → real `.pptx` file → R2
**Note:** `html_slides` and `pptx_download` share an outline schema — agent can generate once and ask for both exports

### 4.5 `pdf_freeform`

**Input:** `{ topic: string, length_hint?: "short"|"medium"|"long", style?: "report"|"essay"|"brief" }`
**LLM output schema:** `{ html_content: string, css?: string }`
**Compile:** Playwright launches headless chrome, loads HTML string, `page.pdf()` → PDF bytes → R2
**Use case:** Free-form output where LaTeX is overkill and DOCX is too rigid

### 4.6 `review_document`

**Input:** `{ document_content: string, format: "latex"|"html"|"docx_json", criteria?: string[] }`
**LLM output schema:** `{ critique: string, weaknesses: Array<{section, issue, severity}>, revised_content: string, score: number /* 0-10 */ }`
**Compile:** none — returns revised content for caller to use
**Use in meta-skills:** Loop N times with early-exit on `score >= threshold`

### 4.7 `pdf_form_fill`

**Input:** `{ form_pdf_url: string, guidance?: string, kg_query?: string }`
**Process:**
1. `apps/api` uses `pdf-lib` to read the uploaded PDF, extract form fields (`form.getFields()`)
2. Agent queries KG for values matching each field's label/hint
3. LLM fills a `{field_name → value}` map
4. `apps/api` writes values back into the form via `pdf-lib`, flattens optional
**Output:** Filled PDF bytes → R2
**This is unique.** No other KG tool does this.

### 4.8 `bibtex_from_kg`

**Input:** `{ source_ids?: string[], kg_query?: string }` (if neither given, all sources in current project)
**Output:** `.bib` file string, each entry referencing a KG source node
**Use:** Called by `latex_paper` to assemble the bibliography
**Cite keys:** Stable format `kg:{short_node_id}` — agents can insert `\cite{kg:abc123}` and it resolves

### 4.9 `anki_deck_export`

**Input:** `{ deck_name: string, card_ids?: string[], tags?: string[] }`
**Process:** Query `flashcards` table (Plan 6), build SQLite database in Anki's schema, zip as `.apkg`
**Output:** `.apkg` bytes → R2
**Library:** Implement in `apps/api` using `better-sqlite3` + `archiver` (don't depend on `genanki` Python — API is Node)
**Card format:** Front/back preserved; media not supported in v1 (text-only cards)

### 4.10 `deep_research_paper` (meta-skill, `fork`)

**Input:** `{ topic: string, depth: "shallow"|"deep", review_rounds: number, mode: "auto"|"step" }`
**Composition:**
1. Invoke `deep_research` (Plan 8) — returns research context
2. Invoke `latex_paper` with research context as input — returns draft
3. Loop `review_document` up to `review_rounds` times
   - Early exit if `score >= 9`
   - In `step` mode, pause at Temporal workflow signal points for user approval
4. Final `latex_paper` compile → PDF → R2
**Temporal integration:** Implemented as a Temporal workflow in `apps/worker/src/worker/workflows/document_workflows.py`
**Signals:** `approve_research`, `approve_draft`, `approve_review_round`, `abort`

### 4.11 `study_pack_generator` (meta-skill, `fork`)

**Input:** `{ topic: string, include: Array<"cheatsheet"|"flashcards"|"quiz"|"slides">, difficulty?: string }`
**Composition:** Calls Plan 6 skills (`cheatsheet`, `flashcards`, `quiz`) + this spec's `html_slides` with shared research context
**Output:** Bundle of artifacts uploaded to R2, returned as manifest with per-artifact URLs
**Use case:** "Give me everything I need to study X" — one command, four artifacts

---

## 5. Data Model

### 5.1 New tables

```typescript
// packages/db/src/schema/documents.ts
export const documents = pgTable("documents", {
  id:           uuid().defaultRandom().primaryKey(),
  userId:       uuid().notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId:    uuid().references(() => projects.id, { onDelete: "cascade" }),
  skillName:    text().notNull(),       // e.g. "latex_paper"
  topic:        text().notNull(),
  status:       text().notNull(),       // "pending"|"running"|"ready"|"failed"
  format:       text().notNull(),       // "latex"|"docx"|"html"|"pptx"|"pdf"|"anki"
  sourceContent:text(),                 // .tex or HTML source, editable
  compiledUrl:  text(),                 // R2 signed URL to compiled artifact
  workflowId:   text(),                 // Temporal workflow id, for meta-skills
  reviewRounds: jsonb().$type<ReviewRound[]>(),  // history of review passes
  createdAt:    timestamp().defaultNow().notNull(),
  updatedAt:    timestamp().defaultNow().notNull(),
})

export const documentSectionSources = pgTable("document_section_sources", {
  documentId:   uuid().notNull().references(() => documents.id, { onDelete: "cascade" }),
  sectionIdx:   integer().notNull(),
  sourceNodeId: uuid().notNull().references(() => nodes.id, { onDelete: "cascade" }),
  // PK: (documentId, sectionIdx, sourceNodeId)
})
```

### 5.2 `ReviewRound` shape

```typescript
type ReviewRound = {
  round: number
  score: number       // 0-10
  critique: string
  weaknesses: Array<{ section: string; issue: string; severity: "low"|"med"|"high" }>
  diffSummary: string // short LLM-generated description of what changed
  durationMs: number
}
```

---

## 6. API Surface

```
apps/api/src/routes/documents.ts

POST   /api/documents                       Create document + start workflow
  body: { skill: string, input: object, mode?: "auto"|"step" }
  → { documentId, workflowId?, status }

GET    /api/documents                       List user's documents
GET    /api/documents/:id                   Document metadata + current state
GET    /api/documents/:id/source            Editable source (LaTeX/HTML/JSON)
PUT    /api/documents/:id/source            Update source → triggers recompile
GET    /api/documents/:id/compiled          Redirect to R2 signed URL
GET    /api/documents/:id/review-rounds     Review loop history

POST   /api/documents/:id/compile           Manual recompile (after edit)
POST   /api/documents/:id/approve           Signal Temporal workflow (step mode)
  body: { gate: "research"|"draft"|"round"|..., round_idx?: number }
POST   /api/documents/:id/abort             Signal Temporal workflow abort

POST   /api/documents/compile/latex         Raw Tectonic proxy (admin/debug only)
POST   /api/documents/compile/docx          Raw docx.js compile (no skill wrapper)
POST   /api/documents/compile/pptx          Raw pptxgenjs compile
POST   /api/documents/compile/pdf-freeform  Raw Playwright HTML→PDF
```

---

## 7. UI — Document Studio

`apps/web/src/app/(app)/studio/` — a new route group, not replacing the Plan 5 canvas.

### Layout

```
┌──────────────────────────────────────────────────────────┐
│  Studio Header                                            │
│  [format: LaTeX ▾] [review rounds: 3] [mode: auto|step] │
├───────────────────────┬──────────────────────────────────┤
│                       │                                   │
│   Monaco Editor       │   Preview Pane                    │
│   (source)            │   (PDF via pdf.js                 │
│                       │    or HTML iframe)                │
│                       │                                   │
│                       │                                   │
├───────────────────────┴──────────────────────────────────┤
│  Review Timeline: [R1: 6.2 ►] [R2: 7.8 ►] [R3: 8.9 ►]   │
├──────────────────────────────────────────────────────────┤
│  Source Anchors: hover a paragraph → shows KG notes       │
└──────────────────────────────────────────────────────────┘
```

### Key UX decisions

- **Monaco** for LaTeX/HTML source editing (TypeScript support built in, syntax highlighting free)
- **PDF preview** via `pdf.js` — works for compiled LaTeX and Playwright-rendered freeform PDFs
- **HTML preview** via sandboxed iframe for `html_slides`
- **Review timeline** — click a round to see diff from the previous one
- **Source hover** — cursor on a paragraph queries `document_section_sources` and shows a popover with linked KG nodes
- **Step mode** — workflow status indicator shows where the pipeline is paused; "Approve" button sends Temporal signal

---

## 8. KG Anchoring Mechanism

Every skill that produces content declares `kg_anchored: true`. For those:

1. **Prompt instruction:** the skill's `prompt_template` instructs the LLM to output a `source_node_ids: string[]` alongside each section
2. **Validation:** `output_schema` enforces this field's presence
3. **Persistence:** on compile, the worker inserts rows into `document_section_sources` — one row per (document, section index, source node)
4. **UI:** the Document Studio queries this on hover/selection to show source notes

For agent runtime: skills receive the KG via `allowed_tools: ["kg_search", "kg_fetch_node"]` and the agent's system prompt is augmented with instructions to cite every factual claim.

---

## 9. Review Loop Mechanism (for `deep_research_paper` and ad-hoc use)

```python
# apps/worker/src/worker/workflows/document_workflows.py (sketch)

@workflow.defn
class DeepResearchPaperWorkflow:
    @workflow.run
    async def run(self, input: DeepResearchPaperInput) -> DocumentResult:
        # Phase 1: Deep research
        research = await workflow.execute_activity(run_deep_research, input.topic)
        if input.mode == "step":
            await workflow.wait_condition(lambda: self._approved("research"))

        # Phase 2: Draft
        draft = await workflow.execute_activity(run_latex_paper_skill, research)
        if input.mode == "step":
            await workflow.wait_condition(lambda: self._approved("draft"))

        # Phase 3: Review loop
        current = draft
        rounds: list[ReviewRound] = []
        for i in range(input.review_rounds):
            review = await workflow.execute_activity(run_review_document_skill, current)
            rounds.append(review)
            current = review.revised_content

            if review.score >= 9.0:
                break  # early exit
            if input.mode == "step":
                await workflow.wait_condition(lambda: self._approved(f"round_{i}"))

        # Phase 4: Compile
        pdf_url = await workflow.execute_activity(compile_latex_via_tectonic, current)
        return DocumentResult(content=current, compiled_url=pdf_url, rounds=rounds)

    @workflow.signal
    def approve(self, gate: str): self._gates.add(gate)

    @workflow.signal
    def abort(self): self._aborted = True
```

---

## 10. Tectonic Microservice

### 10.1 Service shape

```
apps/tectonic/
  Dockerfile           # FROM debian:slim + tectonic binary (~50MB)
  server.py            # FastAPI (Python 3.12, thin HTTP wrapper)
  cache/               # bind-mounted CTAN package cache (volume)
```

### 10.2 API

```
POST /compile
Content-Type: application/json
{
  "tex_source": "\\documentclass{article}...",
  "bib_source": "@article{...}",     // optional
  "engine": "xelatex" | "pdflatex",  // default pdflatex
  "timeout_ms": 60000
}

Response:
  200 application/pdf (bytes)  — success
  400 {error, log}             — TeX error
  504 {error: "timeout"}       — compile exceeded
```

### 10.3 Security

- Container is **network-isolated** except for egress to `ctan.org` mirrors during package fetch (required for Tectonic's on-demand package resolution)
- Compile runs with `--untrusted` flag (disables `\write18` shell escape)
- `timeout_ms` enforced by process kill
- Input size limited to 2MB per request
- Runs as non-root user

### 10.4 Docker compose entry

```yaml
# docker-compose.yml (addition)
services:
  tectonic:
    build: ./apps/tectonic
    restart: unless-stopped
    networks: [opencairn-internal]
    volumes:
      - tectonic-cache:/app/cache
    environment:
      MAX_CONCURRENT_COMPILES: 4
      DEFAULT_TIMEOUT_MS: 60000

volumes:
  tectonic-cache:
```

---

## 11. Security & Privacy

- **Uploaded form PDFs** (from `pdf_form_fill`) — stored temporarily in R2 with a 24-hour auto-delete lifecycle rule, deleted immediately after filling completes
- **Playwright HTML→PDF** — HTML content is sanitized through DOMPurify-equivalent **before** being passed to headless chrome; no user-controlled `<script>` or external resource loads (CSP locked down)
- **Tectonic**: `\write18` shell escape disabled; compile runs in a separate container
- **Source node ID exposure** — `document_section_sources` rows are scoped to the document's `userId`, enforced at Drizzle query level with `requireAuth` middleware
- **BYOK usage** — LLM calls within skills use the user's registered provider (per Plan multi-LLM spec); Tectonic/docx/pptx compilation is free-tier regardless of LLM provider

---

## 12. Dependency Impact

### New dependencies

| Package | Where | Size | Rationale |
|---|---|---|---|
| `docx` | `apps/api` | ~1.2 MB | DOCX generation with footnotes/citations |
| `pptxgenjs` | `apps/api` | ~900 KB | Real `.pptx` generation |
| `playwright` | `apps/api` | ~280 MB (browsers) | HTML → PDF (already a test-time candidate) |
| `pdf-lib` | `apps/api` | ~500 KB | Form field extraction and filling |
| `better-sqlite3` | `apps/api` | ~3 MB | Anki `.apkg` database construction |
| `archiver` | `apps/api` | ~150 KB | Zip `.apkg` files |
| `monaco-editor` | `apps/web` | ~4 MB (lazy) | Source editing UI |
| `pdf.js` | `apps/web` | ~2 MB (lazy) | PDF preview |

Playwright is the heaviest addition. It's worth it: one binary covers HTML→PDF for `pdf_freeform` *and* serves as the e2e test runner for Plan 7 browser sandbox, so the disk cost is amortized.

### No new dependencies in worker

Python worker generates structured content only — compile happens in `apps/api` or `apps/tectonic`. This keeps the worker image lean.

---

## 13. Testing Strategy

- **Per-skill unit test**: fixture KG → run skill → assert output schema validates + compile succeeds
- **Tectonic integration test**: golden `.tex` files → POST to service → assert PDF byte signature (`%PDF-`) + page count via `pdf-lib`
- **`pdf_form_fill` test**: sample form PDF with known fields → assert fields get filled with expected values
- **Review loop test**: mock LLM that returns improving scores → assert early-exit at threshold
- **UI test (Playwright)**: open Studio, create a skill run, assert preview renders

---

## 14. Open Questions (for implementation plan phase)

1. **Skill file format on disk** — JSON (Plan 6 precedent) vs YAML-frontmatter Markdown (Claude Code precedent)? JSON is safer for structured schemas. *Leaning JSON.*
2. **Skill discovery UI** — should users see a "Skill Library" page, or are skills purely agent-invoked? *v1 = agent-invoked only; Library view is v2.*
3. **Anki media support** — images/audio in flashcards → `.apkg` with media files. Deferred to v2.
4. **Monaco bundle size** — lazy-loaded on route enter only. Acceptable.
5. **Multi-user concurrent compiles** — Tectonic MSA bottleneck? Set `MAX_CONCURRENT_COMPILES` = CPU count, queue overflow. Metric: `compile_queue_depth` in Sentry.
6. **Skill versioning** — if a bundled skill changes, old `documents` rows still reference the old prompt. Store `skill_version` on document rows. Defer semantics decision (regenerate vs freeze) to v2.

---

## 15. Handoff to Implementation Plan

This spec becomes **Plan 10** in `docs/superpowers/plans/2026-04-15-plan-10-document-skills.md`. The implementation plan will break this into task-sized checkboxes following the repo convention. Rough task groupings:

1. `packages/templates/` — extend schema with `context`, `allowed_tools`, `compile_step` fields + lazy loader
2. `apps/tectonic/` — Docker MSA + Hono health check + compile endpoint + cache volume
3. `apps/api` — document compilers (DOCX, PPTX, PDF-freeform, Anki) + document routes
4. `apps/worker` — 11 skill files + two Temporal meta-workflows + activity wrappers
5. `packages/db` — `documents` + `document_section_sources` tables + migration
6. `apps/web` — Studio page, Monaco editor, PDF preview, review timeline, source anchors
7. Tests — per-skill, Tectonic integration, form-fill, review-loop, e2e studio

---

*End of spec.*
