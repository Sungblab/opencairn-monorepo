# App Shell Fidelity + Built-but-Hidden Feature Audit

Date: 2026-04-30
Branch: main
Commits in scope: `e7e95f4` → `0f64942` (5 commits)

## Why this exists

The user reported that on first walkthrough of a freshly logged-in
workspace, several features that the codebase had clearly shipped were
not reachable from the UI — they only worked if you typed the URL by
hand. Separately, the live shell visually trailed
`docs/mockups/2026-04-23-app-shell/index.html` by enough that the panel
chrome no longer carried the design's intended hierarchy.

This audit (a) enumerates the gap between "implemented" and
"discoverable", (b) lists the visual deltas against the 2026-04-23
mockup, and (c) records which gaps were closed in this pass and which
were intentionally left for later.

## Audit method

1. Enumerate every route mounted under `apps/api/src/app.ts` (43).
2. Cross-reference with the frontend (`apps/web/src/lib/api-client.ts`
   + grep for `useQuery`/`fetch(` over components).
3. Walk every page directory in `apps/web/src/app/[locale]/**` (37
   page routes) and check whether each one is reachable from a sidebar
   link, account-shell tab, or notification.
4. For each mismatch, classify into:
   - **(A)** API exists, no UI entry point.
   - **(B)** UI component exists, never imported.
   - **(C)** Feature flag default OFF hides the path.
   - **(D)** Worker activity exists, no UI trigger.
   - **(E)** DB table populated, never queried.

## Gaps closed in this pass

### A. Synthesis Export → sidebar overflow menu
- **Before**: `/[locale]/app/w/[wsSlug]/(shell)/synthesis-export`
  page exists, all 7 backend routes work, but the only path was direct
  URL entry. `FEATURE_SYNTHESIS_EXPORT` default OFF further buried it.
- **After**: `MoreMenu` adds a flag-gated dropdown item. Flag threads
  through `layout.tsx` → `ShellProviders` → `AppShell` → `ShellSidebar`
  → `GlobalNav` → `MoreMenu`, mirroring the existing Deep Research
  rail icon pattern. When the flag is off the item still hides — the
  goal here is discoverability, not bypassing the gate.
- **i18n**: `sidebar.more_menu.synthesis_export` ko/en parity.
- **Commit**: `ed4b5aa`.

### B. Project sidebar → Learn entry
- **Before**: `/p/[projectId]/learn/{flashcards,scores,...}` (Plan 6,
  PR #50) had four pages but no project-sidebar entry; sibling
  `ProjectGraphLink` and `ProjectAgentsLink` existed for the same
  pattern.
- **After**: New `ProjectLearnLink` component, mounted in
  `ShellSidebar` after the agents link. Same `mx-3 mb-2` rounded
  border style, GraduationCap icon.
- **i18n**: `sidebar.learn.entry` ko/en parity.
- **Commit**: `ed4b5aa`.

### C. BYOK key UI → account-shell `providers` tab
- **Before**: Account shell already had a `providers` tab labelled
  "BYOK" but its `ProvidersView` was a one-line stub ("BYOK key
  registration ships with Deep Research Phase E"). The real
  `ByokKeyCard` lived only at `/[locale]/app/settings/ai`, accessed
  exclusively from `ResearchRunView` on key-missing errors.
- **After**: `ProvidersView` now renders `ByokKeyCard` directly.
  `/[locale]/app/settings/ai` stays mounted for inbound research
  failure links, but the user-discoverable entry is now the account
  nav.
- **i18n**: `account.providers.description` (new explanatory line);
  `providers.stub` kept for now in case a fallback is needed.
- **Commit**: `ed4b5aa`.

### D. MCP servers → account-shell `mcp` tab
- **Before**: `/[locale]/app/settings/mcp` (MCP Client Phase 1, main
  `1a36177`) had a working `McpSettingsClient` plus the 404 probe for
  `FEATURE_MCP_CLIENT=false`, but no nav linked to it.
- **After**: New `mcp` entry in `AccountShell.TABS`. New
  `/[locale]/settings/mcp/page.tsx` reuses `McpSettingsClient` +
  the same flag probe. Account shell layout (`requireSession` in
  `settings/layout.tsx`) replaces the manual auth dance the original
  page did.
- **i18n**: `account.tabs.mcp` ko/en parity.
- **Commit**: `ed4b5aa`.

### E. Sidebar visual fidelity to 2026-04-23 mockup
- **WorkspaceSwitcher**: full-width bottom-bordered bar →
  `mx-3 mb-2 mt-3` rounded card with `border-[1.5px] border-muted-foreground/40`
  and a 5×5 inverted-fg avatar. Hover hardens the border to
  `foreground` instead of swapping the background.
- **GlobalNav**: dropped the `border-b` and bumped icons to 15×15
  with the workspace `app-hover` 6% wash; `MoreMenu` trigger matched
  to the rail's icon size + hover treatment so it doesn't read as
  foreign.
- **ProjectHero**: thicker `1.5px` foreground border + inline
  `box-shadow: 0 2px 0 0 var(--theme-fg)` to mark the active project
  identity. Hover stays `app-hover` (6% wash) — explicitly NOT the
  mockup's `bg-fg/text-bg` full invert (deviation: full flips are
  reserved for landing/auth).
- **SidebarFooter**: two-line identity (name + plan · credits
  subtitle), inverted-fg avatar, ghost-button bell + settings. Plan
  label resolves via the BYOK key query — "BYOK" when registered,
  "Free" otherwise. Credits stay at ₩0 (Plan 9b stub) but the slot
  exists so the layout stays stable when billing flips on.
- **i18n**: `sidebar.footer.{plan_free,plan_byok,credits_amount}` ko/en
  parity.
- **Commit**: `5d62bf2`.

### F. Dashboard fidelity to 2026-04-23 mockup
- **`/recent-notes` API**: now returns `excerpt` (≤120-char slice
  of `notes.contentText`, whitespace-collapsed, null when empty).
  Cheap because `content_text` is already an indexed column.
- **StatsRow**: every KPI card reserves a sub-line so the grid never
  reflows; research card splits "n in progress" so the number reads
  as a numeral; credits card carries a rough "≈ N Deep Research runs"
  estimate (₩4,000/run, Plan 8 ballpark); BYOK card adds a steady
  foreground dot when connected and a "Gemini API" provider label.
- **ActiveResearchList**: card-style rows with pulse-dot for
  `researching`, a static muted dot otherwise. Status chip: filled
  for researching, outlined for the planning/awaiting branches.
  Relative timestamp + Korean status hint + "Open →" ghost link.
- **RecentDocsGrid**: 4-line stack (project label / title / 2-line
  excerpt / relative time). When `excerpt` is null we render an
  italic "본문이 비어 있어요" placeholder instead of a hollow row.
- **DashboardView**: section headers carry a "전체 보기 →" link to
  the research list (recent-docs gets the same header treatment for
  visual consistency even though there's no destination yet).
- **i18n**: `dashboard.{statusChip,statusHint,sections.viewAll,
  lists.emptyExcerpt,stats.{researchActiveSuffix,researchHint,
  creditsEstimate,creditsEmpty,byokProvider}}` ko/en parity.
- **Commits**: `0f64942` (feat), `d575a40` (test fix for
  `next/headers` in node test env).

### G2. Project view fidelity to 2026-04-23 mockup
- **Before**: `ProjectView` used `hover:bg-accent` on header buttons (forbidden
  full-tone wash inside the workspace shell), generic `border-border` rounded
  rectangles for the filter tabs, and a bare `<table>` with no surrounding
  card. The notes table had no per-row hover affordance, no chip column for
  the kind, and rendered timestamps as raw `toLocaleString()` strings instead
  of relative times.
- **After**:
  - Header actions all run on the `app-hover` 1.5px-bordered control rhythm;
    "새 문서" stays the lone `app-btn-primary` CTA. Layout shifted to
    `max-w-6xl mx-auto px-8 py-8` to match the mockup container.
  - `ProjectMetaRow` renders a tracked-tight `text-2xl` heading; serif is
    deliberately omitted (brand rule: only the logo uses serif).
  - Filter chips are rounded-full with the active state filled
    (`bg-foreground text-background`) and inactive chips on `app-hover`.
    Counts derive from the unfiltered list — `ProjectView` reduces the
    `allNotes` payload into per-kind totals and passes them down so the
    chip labels stay in sync with `filter=all` without a second fetch.
  - Notes table is now wrapped in a `1.5px` rounded card with a
    `bg-surface` header and `app-hover` rows; kind cell carries a chip,
    update column shows `format.relativeTime` instead of full timestamp.
- **i18n**: existing `project.tabs.*` / `project.table.*` keys reused —
  no new strings.
- **Test fix**: `project-notes-table.test.tsx` now mocks `useFormatter` so
  `format.relativeTime` resolves under jsdom.

### G3. Note editor route (`(shell)/n/[noteId]`) wired to real editor + chrome
- **Before**: `(shell)/n/[noteId]/page.tsx` rendered a `NoteBody` placeholder
  with the i18n string `appShell.routes.note.placeholder` ("Phase 3가 이
  자리를 채웁니다."). The real editor only worked from the legacy
  `p/[projectId]/notes/[noteId]/page.tsx` deep-link route, which the
  App Shell sidebar never linked to. Tabs that promoted from preview to
  sticky on first edit landed on the placeholder.
- **After**: Page now mirrors the SSR fan-out from the legacy route —
  parallel `GET /notes/:id`, `/notes/:id/role`, `/auth/me` — but derives
  `projectId` from the note JSON since the URL doesn't carry it. The
  project name is fetched separately for the breadcrumb (best-effort, the
  page renders if the project is unreadable). Result: real `NoteEditorClient`
  mount inside `NoteWithBacklinks` (Backlinks/Enrichment toggles already
  wired), prefixed by a new `NoteRouteChrome` component.
- **`NoteRouteChrome`**: sticky breadcrumb row above the editor (mockup
  §screen-note line 889~899). Project name is a link back to
  `/p/[projectId]`, current title in foreground, autosave pill renders
  `format.relativeTime(updated_at)`. Lives in `components/notes/` so the
  legacy route can pick it up later if we delete the placeholder there.
- **Deviation D5** (added below): the mockup chrome row also carries
  ghost icon buttons for 댓글/공유/더보기. The existing NoteEditor
  already owns the comments panel and Share dialog inside its title row;
  duplicating those handlers in chrome would either be misleading
  (two share buttons, only one opens the dialog) or require lifting
  state out of NoteEditor (out of scope for this chrome-only sweep).
- **i18n**: new `appShell.routes.note.chrome.{breadcrumb_label,
  project_unknown,autosave}` ko/en parity.

### G4. Research hub fidelity to 2026-04-23 mockup
- **Before**: `ResearchHub` rendered runs as a `<table>` with three text
  columns and a single "new run" button styled with `bg-primary`. Status
  was a plain word in a cell, no progress affordance, no filter strip,
  no empty hint at the bottom.
- **After**:
  - Header: title without serif (brand rule), `app-btn-primary` CTA on the
    right, subtitle promoted to its own row with the mockup's longer
    explanatory copy.
  - Status filter strip: 5 buckets matching the mockup (전체/진행 중/
    승인 대기/완료/실패·취소). `bucketOf()` collapses
    `planning + researching → active` and `failed + cancelled → terminal`
    so the count math stays readable. Counts derive from the unfiltered
    list — same pattern as the project view.
  - Card rows replace the table: 1.5px-bordered `app-hover` cards with
    `StatusIndicator` (pulse-dot for `researching`, checkmark for
    `completed`, danger dot for `failed`, quiet steady dot otherwise),
    title + `StatusChip` pair, model + relative-time meta, and a right
    column for cost + billing path. The whole card stays clickable
    (`role=link` + `Enter`/`Space`), preserving the existing keyboard
    contract the test asserts.
  - Bottom hint mirrors the mockup's "이전 리서치는 해당 프로젝트의
    문서로 보관됩니다…" copy so the user understands where completed
    runs go.
- **Deviation**: the mockup row also surfaces a project label per run
  (`투자노트 · deep-research-max · 12분 전`). `ResearchRunSummary`
  doesn't carry `projectId`, so the live row drops the project segment
  rather than triggering a per-row N+1 fetch. Tracked as a future API
  payload extension.
- **i18n**: new `research.hub.{empty_filtered, footer_hint, filter.*,
  billing.*, cost.actual}` ko/en parity. The original `hub.subtitle`
  copy was replaced with the mockup's longer explainer.

### G. SSR cookie forwarding (carried over from prior session)
- Was sitting modified in the working copy. SSR fetches relied on
  `credentials: "include"` which is browser-only, so the dashboard's
  server-component fetches all 401'd. Read Better Auth's cookie jar
  via `next/headers` and forward it explicitly. Headers merged into
  a single `Record<string,string>` so tsc doesn't wander into the
  `Headers | string[][]` branches of `HeadersInit`.
- **Commit**: `e7e95f4`.

## Gaps NOT closed in this pass

These were identified in the audit but deferred because they need
either (a) backend work, (b) Plan 9b billing data, or (c) a clear
product decision before the UI ships.

| # | Gap | Why deferred |
|---|---|---|
| H1 | Notification preferences UI grid | **Already shipped** — `NotificationsView` already renders the per-kind email + frequency selector grid. Audit error. |
| H2 | Staleness Agent manual trigger | **Already shipped** — `agent-entrypoints-view.tsx:100-101` mounts the staleness launch panel with a "Run" button. Audit error. |
| H3 | Literature search trigger UI | Needs a search modal + import flow. The backend is fully wired (`lit_import_activities.py` + 4 provider integrations), but the UI scope is large enough to warrant its own plan rather than bundling here. |
| H4 | Note view enrichment panel | **CLOSED 2026-04-30**. `EnrichmentPanel` ships beside `BacklinksPanel` as a right-rail (Cmd+Shift+I to toggle). Reads from new `GET /api/notes/:id/enrichment` (`canRead`-gated, 404 → panel empty state). Renders status pill, content-type chip, outline (level-indented), figures (caption · pageRef), tables (caption · pageRef), word count, provider, skip reasons, error. Forward-compat with worker artifact additions: `artifact` is wire-typed `Record<string,unknown>` and the panel `safeParse`s only the slices it renders. Deviation from mockup: the 2026-04-23 mockup didn't model an enrichment surface, so the panel adopts `BacklinksPanel`'s `w-72 border-l` chrome verbatim. Flag-OFF stays correct: with `FEATURE_CONTENT_ENRICHMENT=false` no rows exist → 404 → "no analysis yet" empty state, so the toggle is never silently broken. |
| H5 | Doc Editor slash menu UI hint | `FEATURE_DOC_EDITOR_SLASH=false` gates the four LLM-only slash commands (PR #61). Even with the flag on, no UI hint surfaces the feature. Needs a slash menu or composer placeholder edit. |
| H6 | Socratic Agent learning trigger | `POST /socratic/run` exists but no frontend caller. Belongs in a Learning page polish PR. |
| H7 | Plan 9b billing — real `credits_krw` and plan tier | Footer + dashboard show ₩0/Free until billing lands. Layout is stable for the swap. |
| H8 | Code Agent (Canvas Phase 2) flag flip | `FEATURE_CODE_AGENT=false` keeps the route 404'd. Phase 2 is technically complete (PR #47) but the prod env flip is a separate decision. |

## Deviations from mockup

| # | Mockup | Live | Why |
|---|---|---|---|
| D1 | Project hero hover = `bg-fg text-bg` (full invert) | Project hero hover = `app-hover` (6% wash) | The user's standing rule: full inverts are landing/auth only; the workspace shell uses subtle hover throughout. |
| D2 | KPI card border = `1px var(--theme-border)` | KPI card border = `1.5px var(--theme-border)` (inline style) | Tailwind's `border-border` rounds to 1px on the edge between accent and surface in some palettes; bumping to 1.5px makes the cards read as cards in cairn-light without darkening the divider tokens. |
| D3 | Recent docs excerpt always present (mock data) | Recent docs excerpt nullable + italic empty placeholder | Real notes can be created without a body; the mockup didn't model that branch. |
| D4 | Footer = "Pro · ₩12,300" | Footer = "BYOK · ₩0" / "Free · ₩0" until Plan 9b | No real plan tier or credit value yet; layout is stable for the swap. |
| D5 | Note chrome row carries ghost icon buttons (댓글/공유/더보기) | Chrome row carries breadcrumb + autosave pill only | NoteEditor already owns comments + Share inside its title row. Duplicating handlers in chrome would be misleading; lifting them out is a separate refactor. |

## Verification

| Check | Result |
|---|---|
| `pnpm --filter @opencairn/web i18n:parity` | 30 namespaces parity, all green |
| `pnpm --filter @opencairn/web exec tsc --noEmit` | clean |
| `pnpm --filter @opencairn/web lint` | clean (`--max-warnings 0`) |
| `pnpm --filter @opencairn/web test` | 670/670 pass |
| `pnpm --filter @opencairn/api exec tsc --noEmit` | clean |
| `pnpm --filter @opencairn/api test` | not run locally (needs Postgres on :5432) |

E2E + dev-server walkthrough are deferred — the changes here are
visual + entry-point only, all paths still 200 in unit tests, and the
existing E2E specs (notification drawer, sidebar, dashboard) all
pass.

## Follow-ups

Candidates ordered by user-visible impact:

1. **H3** — Literature search modal + import flow.
2. **H5** — Doc editor slash menu hint + flag flip for dogfooding.
3. **H7** — Plan 9b billing wires up real credit + tier values.
4. **H6** — Socratic Agent trigger in the learning UI.
5. **H8** — Decide Code Agent prod flag flip with rollback playbook.

H4 closed 2026-04-30 in the same fidelity sweep — see the closed row in the
table above for the implementation summary.

Each warrants its own plan; bundling them here would have made this
PR unreviewable.
