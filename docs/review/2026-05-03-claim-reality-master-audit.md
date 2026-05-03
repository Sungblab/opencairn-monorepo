# Claim Reality Master Audit - 2026-05-03

Purpose: consolidate the current claim-vs-implementation audit for OpenCairn.
This document exists because several public/docs claims sound like completed
product behavior while the repo often contains a mix of implemented paths,
feature flags, stubs, and roadmap language.

Detailed source audits:

- `docs/review/2026-05-03-agent-system-claim-audit.md`
- `docs/review/2026-05-03-product-claim-surface-audit.md`

## Bottom Line

OpenCairn is not empty or fake. Many foundations are real: workspaces/projects/
notes, ingestion, graph views, evidence bundles, BYOK settings, Drive/Notion
import, Deep Research, learning pages, share links, MCP plumbing, Docker
self-hosting, and several worker AI workflows.

The problem is claim inflation. The highest-risk copy and docs turn "designed",
"gated", "MVP", or "workflow-backed" into "default production product". That
creates exactly the failure mode the user called out: landing/docs sound much
more finished than the app a user can actually run.

## Highest-Risk Overclaims

### 1. "12 agents"

Current truth:

- The 12-role design exists.
- Only a subset are `runtime.Agent` subclasses.
- The project `/agents` UI exposes 5 Plan 8 agents.
- Deep Research, Socratic, Code, Visualization, and Synthesis Export are real
  or partially real, but they are not all uniform runtime agents.
- Code is default-off.

Required fix:

- Stop saying "12 production agents" or "12 agents full access" in public copy.
- Use "12-role AI architecture" in architecture docs.
- Use "AI workflows" in product copy.
- Keep an inventory table with class/workflow/API/UI/flag/tool-loop status.

### 2. Pricing and credits

Current truth:

- Billing UI is a stub.
- `credits_krw` is a stub.
- `.env.example` says payment rail waits on business registration.
- Landing has concrete prices, cash, refunds, team seats, auto top-up, and
  agent access claims.

Required fix:

- Hide pricing or mark it clearly as planned/hosted-preview.
- Do not imply card/simple-pay/refund/cash behavior exists in the OSS app.

### 3. Chat save and file artifacts

Current truth:

- Chat `save_suggestion` stores `{ title, body_markdown }`.
- Saving inserts Markdown into an existing Plate note or creates a new Plate
  note.
- It does not create `.docx`, `.pdf`, `.pptx`, `.tex`, HTML/React/SVG artifact
  tabs, or Canvas code notes.
- Synthesis Export is a separate gated feature.

Required fix:

- Keep chat save copy scoped to "save as note".
- Treat real file creation/viewer work as a separate product surface.

### 4. Import/connectors

Current truth:

- Drive import and Google OAuth are real, but Drive UI is file-ID paste MVP,
  not Google Picker or folder sync.
- Notion ZIP import is real.
- Connector platform is foundation/gated; broad provider account/source
  lifecycle is not a polished user feature.
- GitHub/Obsidian/Bear import paths are not verified as first-class product
  flows in this pass.

Required fix:

- Say "Google Drive file ID import" and "Notion ZIP import".
- Do not imply full app sync/connectors until provider UX and sync state exist.

### 5. Grounding/citations

Current truth:

- RAG chat emits source chips.
- Graph/card/mindmap evidence surfaces are real.
- Evidence bundles and graph edge evidence have permission filtering.
- A deterministic answer verifier exists with eval tests.
- `runChat` does not currently call the verifier, so "every sentence cites
  sources" is not enforced at runtime.

Required fix:

- Say "grounded answers with source chips and evidence panels".
- Avoid "all sentences are cited" until verifier enforcement is wired and
  tested in chat/writer paths.

### 6. BYOK

Current truth:

- User-level Gemini BYOK registration/replacement/deletion is implemented.
- The UI shows BYOK status.
- Full workspace default provider layering and all-path provider coverage were
  not verified here.

Required fix:

- Say "user-level Gemini BYOK for supported AI paths".
- Track workspace defaults, provider fallback, quota display, and non-Gemini
  coverage separately.

### 7. Collaboration/share

Current truth:

- Public share links and per-note permission CRUD are real.
- The public share page is a read surface.
- Public `commenter` role exists in share UI, but public commenter behavior was
  not evident in the checked page.

Required fix:

- Either implement public commenting for commenter links or remove/rename that
  role in public-link UI.

### 8. Self-hosting/backup/E2E

Current truth:

- Docker compose and service Dockerfiles exist.
- README quick start is infra plus host `pnpm`, migration, and dev server.
- Backup strategy references scripts that are absent.
- Mocked E2E smokes exist; live full-stack ingest remains manual-only.

Required fix:

- Say "self-hostable" rather than "one-command production deployment".
- Add backup/restore/verify scripts before advertising operational backup.
- Keep E2E claims scoped to the tests actually run.

## Build Or Fix Next

P0 - copy honesty:

- Rewrite landing/auth/README "12 agents", pricing, ticker, and citation claims.
- Remove "12 agents full access" from pricing.
- Replace vague import/connectors wording with Drive file-ID and Notion ZIP.

P1 - product gates:

- Gate `CodeAgentPanel` behind `FEATURE_CODE_AGENT` or render a disabled state.
- Fix public share commenter behavior or remove the role from public links.
- Add an explicit Synthesis Export vs chat-save distinction in docs/UI copy.

P1 - maintained inventory:

- Add a checked-in agent inventory table with role, class, workflow, route, UI,
  flag, and tool-loop status.
- Make `docs/agents/agent-behavior-spec.md` state that some items are workflows,
  not `runtime.Agent` subclasses.

P2 - implementation gaps:

- Wire answer verifier into chat/writer runtime if "sentence-level grounding"
  remains a product promise.
- Implement backup/restore/verify scripts.
- Add Google Picker/folder import or reduce Drive copy permanently.
- Expand connector account/source UX before marketing a connector platform.
- Add live-stack smoke for ingest/import/deep research where feasible.

P2 - product cleanup:

- Decide whether OpenCairn wants "agents" to mean runtime inheritance,
  workflow-backed AI features, or marketing roles. The repo currently mixes all
  three definitions.
- Consolidate overlapping labels: Synthesis vs Synthesis Export, Temporal vs
  Staleness, Research vs API chat retrieval.

## Concrete Copy/File Remediation Map

The following files are the highest-impact correction targets found in this
audit. The goal is not to make the product sound smaller; it is to make public
claims match default behavior.

| File | Problematic claim shape | Current implementation reality | Recommended change |
| --- | --- | --- | --- |
| `README.md` | "fleet of AI agents" plus 12-agent worker architecture | Several listed items are workflows, feature-gated paths, or non-`runtime.Agent` classes | Replace with "AI workflows and agent roles"; point to the inventory audit |
| `README.md` | `apps/worker ... 12 agents` | Worker has a runtime plus workflows; not all 12 are runtime agents | Say "Temporal worker + agent runtime + workflow-backed AI features" |
| `README.md` | "Per-user BYOK keys layer on top of workspace defaults" | User-level Gemini BYOK settings exist; full workspace-default layering was not verified | Say "user-level Gemini BYOK for supported AI paths" |
| `apps/web/messages/{ko,en}/landing.json` | meta description and hero "12 agents" | 12-role design, not 12 default product agents | Use "AI workflows" or "12-role architecture activating in stages" consistently |
| `apps/web/messages/{ko,en}/landing.json` | hero `noCard`, metrics, live panel `12/12`, agents sidebar count | Presents staged/demo behavior as fully live | Mark as demo/staged or remove numeric runtime claims |
| `apps/web/messages/{ko,en}/landing.json` | pipeline "every sentence" / "all answers cited" | Chat emits source chips but verifier is not enforced in `runChat` | Use "source chips and evidence panels" wording |
| `apps/web/messages/{ko,en}/landing.json` | pipeline "format agnostic" | Many formats supported, but not literally format-agnostic; OCR/provider limits exist | List verified formats only and mention provider-dependent OCR |
| `apps/web/messages/{ko,en}/landing.json` | pricing with cash, refund, card/easy-pay, auto top-up, Team seats | Billing/credits are stubs pending Plan 9b/business registration | Hide pricing or label "planned hosted pricing preview" |
| `apps/web/messages/{ko,en}/landing.json` | "All 12 agents" / "12 에이전트 전체 접근" | Code is default-off; many roles are not product entry points | Remove from pricing bullets |
| `apps/web/messages/{ko,en}/landing.json` | FAQ says Notion/Obsidian/Bear major export formats are supported | Notion ZIP and Markdown-like import are real; Obsidian/Bear were not verified as first-class flows | Say "Markdown exports and Notion ZIP; additional app-specific importers planned" |
| `apps/web/messages/{ko,en}/auth.json` | "12 AI agents surface insights" | Same 12-agent mismatch | Use "AI workflows surface insights" |
| `apps/web/src/components/landing/StackTicker.tsx` | EPUB/GITHUB/WHISPER/LIGHTRAG/LANGGRAPH/SENTRY tokens | Not verified as implemented user product paths | Keep only shipped stack/product tokens or label as ecosystem/planned |
| `docs/agents/agent-behavior-spec.md` | Every agent subclasses `runtime.Agent` | False for Code, Visualization, Deep Research, Socratic, Synthesis Export | Add an inventory table and split runtime agents from workflow features |
| `docs/superpowers/specs/2026-04-09-opencairn-design.md` | 12 agents and completed pricing details are canonical | Design doc is ahead of default product | Add status notes that implementation is staged and refer to current audits/status |
| `docs/architecture/backup-strategy.md` | Backup scripts referenced | `scripts/backup.sh`, `restore.sh`, `backup-verify.sh` absent | Implement scripts or mark as planned strategy |

## Runtime/Product Remediation Map

| Area | Evidence | Required product fix |
| --- | --- | --- |
| Code Agent | `FEATURE_CODE_AGENT=false`; API 404s when disabled; Canvas still renders panel | Gate `CodeAgentPanel` or render disabled state |
| Public share commenter | Public share role selector includes commenter; checked public page is read-only | Implement public comments or remove commenter option for public links |
| Chat verifier | `answer-verifier.ts` exists but `chat-llm.ts` does not call it | Wire verifier into chat/writer paths before claiming sentence-level grounding |
| Drive import | `DriveTab.tsx` file-ID textarea MVP | Add Google Picker/folder sync or keep copy explicit |
| Synthesis Export | Real but `FEATURE_SYNTHESIS_EXPORT=false`; chat save only stores Plate notes | Keep export as separate gated surface; do not conflate with chat save |
| Backup ops | Strategy doc references missing scripts | Add scripts plus restore rehearsal smoke |
| Billing | UI/API stubs | Complete Plan 9b before public hosted pricing claims |

## Completion Checklist For This Audit

| Objective item | Evidence produced |
| --- | --- |
| Check the "12 agents" claim | `2026-05-03-agent-system-claim-audit.md` includes runtime/workflow/API/UI/tool-loop matrix |
| Check whether docs/landing overstate implementation | `2026-05-03-product-claim-surface-audit.md` and this master audit list overclaimed files and claims |
| Check whether chat saves real files | Product audit documents that chat `save_suggestion` is title/body Markdown into Plate notes, not file artifacts |
| Check broader product claims, not only agents | Product audit covers billing, Code Agent, MCP, Synthesis Export, ingest, backup, self-hosting, E2E, import, BYOK, share, graph/evidence, learning |
| Store findings as repo docs | Three audit docs were added under `docs/review/` |
| Summarize what must be built or fixed | This master audit includes P0/P1/P2 remediation maps and concrete copy/runtime target tables |
| Avoid unsupported completion claims | The audits explicitly mark live-worker/import/BYOK-provider/full-E2E verification gaps instead of closing them as done |

## Suggested Truthful Public Framing

Use this style until the gaps are closed:

> OpenCairn is a self-hostable knowledge OS with document ingestion, grounded
> chat, graph/evidence views, learning tools, research workflows, and optional
> AI automation. Its long-term architecture defines 12 AI roles; today, the
> shipped app exposes a smaller set of workflow-backed capabilities while the
> agent runtime is being unified.

This is less flashy, but it matches the repo better.
