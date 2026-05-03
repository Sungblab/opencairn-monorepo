# Product Claim Surface Audit - 2026-05-03

Scope: a follow-up to `docs/review/2026-05-03-agent-system-claim-audit.md`.
This pass checks high-visibility product claims against current code paths,
feature flags, and UI entry points. Treat this as a snapshot, not a release
certification.

## Summary

Several formerly-missing foundations are now real: Docker compose exists,
GitHub workflow files exist, ingest supports more than PDF/audio, source PDF
viewer exists, Deep Research has API/UI/workflow wiring, and synthesis export
has a real gated implementation.

The main risk is not "all fake". The risk is over-broad public copy:
landing/README text often describes roadmap or gated features as if they are
default product behavior. Default/off-by-flag paths, stub billing, and hidden
or experimental surfaces need clearer wording.

## Findings

### 1. Billing / pricing is still a stub in the app

Assessment: overclaimed in landing, honestly stubbed in account UI.

Evidence:

- `.env.example` explicitly says the payment rail is blocked until business
  registration and points to `billing-model.md`.
- `apps/web/src/components/views/account/billing-view.tsx` renders only the
  translated stub.
- `apps/web/messages/ko/account.json` says paid plans and credits activate
  after Plan 9b.
- `apps/api/src/routes/workspaces.ts` returns `credits_krw: 0` with a comment
  that it is a Plan 9b stub.
- `packages/db/src/schema/jobs.ts` has `usage_records`, but there is no current
  end-to-end payment/credit charging route.

Public-copy mismatch:

- `apps/web/messages/ko/landing.json` advertises concrete prices, permanent
  cash, card/simple-payment support, refunds, Team seats, auto top-up, and
  "12 agents full access".

Recommendation:

- Landing pricing should be marked as planned/preview, hidden behind hosted
  service copy, or removed until Plan 9b ships.

### 2. Code Agent is implemented but default-off, while Canvas still exposes it

Assessment: real code path, weak default UX.

Evidence:

- `.env.example` sets `FEATURE_CODE_AGENT=false`.
- `apps/api/src/routes/code.ts` returns 404 for every public endpoint when the
  feature flag is off.
- `apps/worker/src/worker/temporal_main.py` only registers Code Agent workflow
  when `FEATURE_CODE_AGENT=true`.
- `apps/web/src/components/tab-shell/viewers/canvas-viewer.tsx` always renders
  `CodeAgentPanel`; there is no matching client/server prop gate in this
  component.
- `apps/web/src/components/canvas/CodeAgentPanel.tsx` POSTs `/api/code/run`
  directly and does not render a feature-disabled state.

Public-copy mismatch:

- README and landing describe Code as one of the 12 active agents. In the
  default install it is not actually runnable, and the UI can fail with API 404.

Recommendation:

- Gate the Canvas Code Agent panel with the same flag, or make the panel render
  an explicit disabled/experimental state.

### 3. MCP is implemented as opt-in plumbing, not default user capability

Assessment: real foundation, default-off.

Evidence:

- `.env.example` sets `FEATURE_MCP_CLIENT=false` and
  `FEATURE_MCP_SERVER=false`.
- `apps/api/src/routes/mcp.ts` 404s the client routes when disabled.
- `apps/api/src/routes/mcp-server.ts` is separately feature-gated.
- `apps/web/src/app/[locale]/settings/mcp/page.tsx` probes the API and renders
  a friendly disabled message when both flags are off.
- Shared/db/api tests exist for MCP client/server contracts.

Public-copy mismatch:

- Architecture/docs can describe MCP as a strategic integration. User-facing
  copy should not imply it is a default enabled connector surface.

Recommendation:

- Keep README/landing wording to "optional MCP client/server support" until
  flags are default-on and the happy path is smoke-tested.

### 4. Synthesis Export is a real gated feature, not part of default chat save

Assessment: substantial implementation, default-off.

Evidence:

- `.env.example` sets `FEATURE_SYNTHESIS_EXPORT=false` and
  `FEATURE_TECTONIC_COMPILE=false`.
- `apps/api/src/routes/synthesis-export.ts` 404s all public routes when the
  feature is off.
- `apps/web/src/app/[locale]/workspace/[wsSlug]/(shell)/synthesis-export/page.tsx`
  calls `notFound()` when disabled.
- `apps/web/src/components/sidebar/more-menu.tsx` hides the menu item unless
  `synthesisExportEnabled` is passed.
- Worker compile supports `md`, `docx`, `pdf`, and LaTeX zip/PDF depending on
  format and Tectonic flag.
- Internal auto-search currently uses simple `ILIKE` over notes, not semantic
  retrieval.

Public-copy mismatch:

- Chat `save_suggestion` remains note/Markdown insertion, not file artifact
  creation. Synthesis Export is a separate gated surface.

Recommendation:

- Public/docs copy should say "multi-format export is gated/experimental" and
  not imply chat can directly create `.docx/.pdf/.pptx/.tex` files today.

### 5. Ingest format support is broader now, but landing ticker still overreaches

Assessment: many ingest claims are now real; some ticker tokens are not.

Evidence:

- `apps/api/src/routes/ingest.ts` allows PDF, DOCX, PPTX, XLSX, DOC, PPT, XLS,
  HWP/HWPX, text/plain, text/markdown, audio/video/image, YouTube, and web URL.
- `apps/worker/src/worker/workflows/ingest_workflow.py` dispatches PDF, image,
  YouTube, web URL, audio/video, Office, HWP/HWPX, and text object paths.
- Office/HWP activities and tests exist.
- Scan PDF OCR path exists, but provider capability matters: Ollama does not
  support OCR in this path.

Public-copy mismatch:

- `apps/web/src/components/landing/StackTicker.tsx` includes `EPUB`, `GITHUB`,
  `WHISPER`, `LIGHTRAG`, `LANGGRAPH`, and `SENTRY`. Current ingest/API scans
  do not show EPUB or GitHub ingest as implemented product paths, and the
  codebase uses Gemini/Ollama provider abstractions rather than a direct
  Whisper product path.
- `landing.json` says "format agnostic" and includes "scan image" phrasing.
  That is too broad for a strict product claim.

Recommendation:

- Replace the ticker with only verified product paths, or separate "planned /
  ecosystem" tokens from implemented support.

### 6. Backup strategy is documented but scripts are absent

Assessment: architecture exists; implementation still missing.

Evidence:

- `docs/architecture/backup-strategy.md` references `scripts/backup.sh`,
  `scripts/restore.sh`, and `scripts/backup-verify.sh`.
- Current `scripts/` contains only guard/e2e helper scripts; no backup/restore
  scripts are present.

Recommendation:

- Keep backup as "documented strategy" until scripts and smoke verification
  exist, or implement the scripts before presenting it as an operational feature.

### 7. Self-hosting is real but not a one-command full app

Assessment: substantially real, but wording must be precise.

Evidence:

- Dockerfiles and `docker-compose.yml` exist for web/api/worker/hocuspocus and
  infra.
- README quick start correctly uses `docker compose up -d postgres redis minio
  temporal`, then host `pnpm install`, `pnpm db:migrate`, and `pnpm dev`.
- `docker compose up -d` alone is infra-first, not the full app; app services
  are behind profiles.
- Prior completion audit still notes host-run migrations and backup scripts as
  remaining self-hosting gaps.

Recommendation:

- Public copy should distinguish "self-hostable" from "single command production
  deployment".

### 8. E2E coverage improved, but still not end-to-end live stack

Assessment: better than before, still not full-stack confidence.

Evidence:

- `docs/review/2026-04-29-e2e-smoke-debt.md` records executable mocked
  Playwright smokes for save_suggestion, source PDF viewer, and live ingest UI.
- Active Plate-note insertion remains skipped because current routes do not
  mount the Plate editor and Agent Panel together in that path.
- Live ingest real workflow remains manual-only until Redis, MinIO, API, worker,
  Temporal, and upload path are running together.

Recommendation:

- Keep "smoke-tested" claims scoped to mocked web paths unless a live-stack
  command is run and documented.

### 9. Drive/Notion import exists, but provider UX is still MVP-depth

Assessment: real import plumbing, narrower than broad import copy.

Evidence:

- `apps/web/src/app/[locale]/workspace/[wsSlug]/import/ImportTabs.tsx` exposes
  only `drive` and `notion`.
- `DriveTab.tsx` explicitly documents the MVP tradeoff: no Google Picker yet;
  users paste Drive file IDs into a textarea.
- `NotionTab.tsx` accepts a Notion Markdown/CSV ZIP upload through a presigned
  object URL.
- `apps/api/src/routes/import.ts` starts Drive and Notion import jobs, applies
  workspace/user ownership checks, and exposes job list/detail/SSE/cancel.
- `apps/api/src/routes/integrations.ts` handles Google OAuth connect/callback
  and encrypted token storage for Google Drive.

Public-copy mismatch:

- README says OpenCairn ingests "Notion ZIP, Google Drive, ..." which is mostly
  fair, but landing/import copy should not imply a polished provider browser,
  one-click workspace sync, or broad Obsidian/Bear/GitHub import paths.

Recommendation:

- Keep current public wording to "Drive file-ID import" and "Notion ZIP import"
  until Google Picker, recursive Drive folder selection, provider sync state,
  and additional app exporters are implemented.

### 10. BYOK registration is real, but the provider-scope claim is too broad

Assessment: real user-level Gemini key management; not a full workspace-default
provider matrix.

Evidence:

- `apps/api/src/routes/users.ts` implements `GET/PUT/DELETE /me/byok-key`.
- The API encrypts the key with `encryptToken`, stores it on
  `userPreferences.byokApiKeyEncrypted`, and returns registration status plus
  `lastFour`.
- `apps/web/src/components/settings/ByokKeyCard.tsx` renders save, replace, and
  delete flows.
- `apps/web/src/lib/api-client-byok-key.ts` contains the client wrappers.
- `apps/web/src/components/sidebar/sidebar-footer.tsx` uses BYOK status to
  switch the plan label.

Public-copy mismatch:

- README says "Per-user BYOK keys layer on top of workspace defaults." Current
  checked code confirms a user-level Gemini key path, but not a general
  workspace-default/provider-routing UI that covers all LLM, OCR, TTS, and
  embedding paths.
- Landing pricing still treats BYOK as a paid hosted plan, while account UI
  says paid plans/credits activate later.

Recommendation:

- Reword to "user-level Gemini BYOK is implemented for supported AI paths" and
  separately track workspace defaults, provider fallback, quota display, and
  non-Gemini provider coverage.

### 11. Collaboration/share links are real, but public commenter semantics are incomplete

Assessment: meaningful implementation; one public-role claim needs tightening.

Evidence:

- `apps/api/src/routes/share.ts` implements public share token read, create/get/
  delete note share links, note permission CRUD, and workspace admin listing.
- `apps/web/src/components/share/share-dialog.tsx` exposes invite people and
  "share to web" controls with viewer/commenter role selection.
- `apps/web/src/app/[locale]/s/[token]/page.tsx` renders the public note page
  without credentials and sets noindex/no-referrer behavior.

Public-copy mismatch:

- The share dialog has a public `commenter` role option, but the public page
  path checked here is a read page. It does not obviously expose public comment
  or edit interaction for that role.

Recommendation:

- Either implement public comment rendering/posting for commenter share links,
  or hide/rename that role in the public-link UI until the behavior is real.

### 12. Grounded graph surfaces are real; "every sentence cites sources" is not

Assessment: graph evidence work is substantial, but chat/writing grounding
claims need precision.

Evidence:

- `apps/api/src/routes/graph.ts` supports `graph`, `mindmap`, `cards`,
  `timeline`, and `board` views.
- `apps/api/src/lib/evidence-bundles.ts` persists evidence bundles, validates
  chunk ownership, and exposes graph edge evidence with permission filtering.
- `apps/api/src/lib/knowledge-surface-evidence.ts` annotates graph/mindmap/card
  surfaces with support score, citation count, and supported/weak/stale/disputed/
  missing status.
- `apps/web/src/components/graph/views/EdgeEvidencePanel.tsx` and
  `ConceptCard.tsx` render evidence entries, quotes, citation labels, and
  support status.
- `apps/api/src/lib/answer-verifier.ts` and
  `apps/api/tests/lib/answer-verifier.eval.test.ts` implement deterministic
  citation/weak-support checks.

Public-copy mismatch:

- `apps/api/src/lib/chat-llm.ts` emits citations from packed RAG evidence and
  blocks some current/freshness answers when no grounding exists, but it does
  not call `verifyGroundedAnswer`. The verifier exists as a library/eval path,
  not an enforced chat runtime gate.
- Contradiction/staleness concepts are real in graph/curator/librarian paths,
  but not every generated note or every chat sentence is guaranteed to carry a
  source-level citation.

Recommendation:

- Public copy should say "grounded answers include source chips and graph
  evidence panels" rather than "every sentence is cited" until runtime
  verification is wired into chat/writer paths and tested end-to-end.

### 13. Learn/Socratic is a real product surface, but not an auto-learning agent suite

Assessment: real flashcard/review/Socratic pages; narrower than "AI tutor
system" marketing.

Evidence:

- `apps/api/src/routes/learning.ts` implements flashcard CRUD, due-card reads,
  SM-2 review scheduling, deck aggregation, and understanding-score reads.
- `apps/api/src/routes/socratic.ts` starts `SocraticGenerateWorkflow` and
  `SocraticEvaluateWorkflow`.
- `apps/web/src/app/[locale]/workspace/[wsSlug]/(shell)/project/[projectId]/learn/page.tsx`
  links flashcards, Socratic, and scores.
- `apps/web/src/components/learn/SocraticSession.tsx` generates questions,
  evaluates answers, and displays a "create flashcard" hint.

Public-copy mismatch:

- Socratic has no `runtime.Agent` subclass and is better described as a
  workflow-backed learning feature.
- The Socratic evaluation can recommend a flashcard, but the checked UI does
  not automatically create the card from that recommendation.

Recommendation:

- Describe this as "flashcards with SM-2 review plus Socratic question
  generation/evaluation" until automatic card creation and broader learning
  orchestration are wired.

## Next Audit Targets

1. Run focused tests for the verified surfaces before converting this audit
   into release copy changes.
2. Check README, landing, auth onboarding, and docs copy against these findings
   and replace roadmap wording with feature-flag/default-state language.
3. Verify collaboration edge cases with a browser smoke: public viewer,
   public commenter, invited commenter, and revoked link.
4. Verify BYOK runtime coverage by tracing Deep Research/chat/OCR/TTS/embedding
   provider resolution, not only the settings API.
5. Verify import jobs live against local MinIO/Temporal for Drive and Notion,
   because the UI/API path exists but this pass did not execute workers.
