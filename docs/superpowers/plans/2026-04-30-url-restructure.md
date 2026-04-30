# URL Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename `/{locale}/app/w/{slug}/p/{id}/notes/{nid}` → `/{locale}/workspace/{slug}/project/{id}/note/{nid}` and centralize 162 hardcoded path literals into `apps/web/src/lib/urls.ts` so the next rename is a one-file edit.

**Architecture:** Tools-first (urls + parser + tests) → filesystem `git mv` → callsite sweep → 301 redirects in `next.config.ts` → ESLint guard against regressions. Reserved slug list synced web↔api. Conditional DB migration only if existing slugs collide with new reserved words.

**Tech Stack:** Next.js 16 (App Router, file-based routing, `next.config.ts`), Hono 4 API, Drizzle ORM, ESLint flat config, Vitest + Playwright.

**Spec:** `docs/superpowers/specs/2026-04-30-url-restructure-design.md`

**Worktree:** Run on a dedicated branch (e.g., `feat/url-restructure`). Filesystem moves are large — keep this isolated from any active editor/sidebar work. CLAUDE.md rule: "병렬 세션 = 워크트리 필수".

---

## Pre-flight: branch + worktree

- [ ] **Step 0.1:** Create worktree

```bash
git worktree add .worktrees/url-restructure -b feat/url-restructure main
```

- [ ] **Step 0.2:** Verify clean state

Run: `git status` inside `.worktrees/url-restructure`
Expected: `nothing to commit, working tree clean`

---

## Task 1: Create `urls.ts` URL builder (TDD)

**Files:**
- Create: `apps/web/src/lib/urls.ts`
- Create: `apps/web/src/lib/urls.test.ts`

- [ ] **Step 1.1: Write failing tests**

Create `apps/web/src/lib/urls.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { urls } from "./urls";

describe("urls", () => {
  describe("app-level", () => {
    it("dashboard", () => {
      expect(urls.dashboard("ko")).toBe("/ko/dashboard");
      expect(urls.dashboard("en")).toBe("/en/dashboard");
    });
    it("onboarding", () => {
      expect(urls.onboarding("ko")).toBe("/ko/onboarding");
    });
  });

  describe("settings", () => {
    it("each section", () => {
      expect(urls.settings.ai("ko")).toBe("/ko/settings/ai");
      expect(urls.settings.mcp("ko")).toBe("/ko/settings/mcp");
      expect(urls.settings.billing("ko")).toBe("/ko/settings/billing");
      expect(urls.settings.notifications("ko")).toBe("/ko/settings/notifications");
      expect(urls.settings.profile("ko")).toBe("/ko/settings/profile");
      expect(urls.settings.providers("ko")).toBe("/ko/settings/providers");
      expect(urls.settings.security("ko")).toBe("/ko/settings/security");
    });
  });

  describe("workspace", () => {
    it("root", () => {
      expect(urls.workspace.root("ko", "acme")).toBe("/ko/workspace/acme");
    });
    it("note", () => {
      expect(urls.workspace.note("ko", "acme", "n123")).toBe(
        "/ko/workspace/acme/note/n123",
      );
    });
    it("project", () => {
      expect(urls.workspace.project("ko", "acme", "p1")).toBe(
        "/ko/workspace/acme/project/p1",
      );
    });
    it("projectNote", () => {
      expect(urls.workspace.projectNote("ko", "acme", "p1", "n2")).toBe(
        "/ko/workspace/acme/project/p1/note/n2",
      );
    });
    it("project sub-routes", () => {
      expect(urls.workspace.projectAgents("ko", "acme", "p1")).toBe(
        "/ko/workspace/acme/project/p1/agents",
      );
      expect(urls.workspace.projectGraph("ko", "acme", "p1")).toBe(
        "/ko/workspace/acme/project/p1/graph",
      );
      expect(urls.workspace.projectLearn("ko", "acme", "p1")).toBe(
        "/ko/workspace/acme/project/p1/learn",
      );
      expect(urls.workspace.projectLearnFlashcards("ko", "acme", "p1")).toBe(
        "/ko/workspace/acme/project/p1/learn/flashcards",
      );
      expect(urls.workspace.projectLearnFlashcardsReview("ko", "acme", "p1")).toBe(
        "/ko/workspace/acme/project/p1/learn/flashcards/review",
      );
      expect(urls.workspace.projectLearnScores("ko", "acme", "p1")).toBe(
        "/ko/workspace/acme/project/p1/learn/scores",
      );
      expect(urls.workspace.projectLearnSocratic("ko", "acme", "p1")).toBe(
        "/ko/workspace/acme/project/p1/learn/socratic",
      );
      expect(urls.workspace.projectChatScope("ko", "acme", "p1")).toBe(
        "/ko/workspace/acme/project/p1/chat-scope",
      );
    });
    it("workspace-level features", () => {
      expect(urls.workspace.chatScope("ko", "acme")).toBe("/ko/workspace/acme/chat-scope");
      expect(urls.workspace.research("ko", "acme")).toBe("/ko/workspace/acme/research");
      expect(urls.workspace.researchRun("ko", "acme", "r1")).toBe(
        "/ko/workspace/acme/research/r1",
      );
      expect(urls.workspace.settings("ko", "acme")).toBe("/ko/workspace/acme/settings");
      expect(urls.workspace.settingsSection("ko", "acme", "members")).toBe(
        "/ko/workspace/acme/settings/members",
      );
      expect(urls.workspace.settingsSection("ko", "acme", "members", "invites")).toBe(
        "/ko/workspace/acme/settings/members/invites",
      );
      expect(urls.workspace.synthesisExport("ko", "acme")).toBe(
        "/ko/workspace/acme/synthesis-export",
      );
      expect(urls.workspace.import("ko", "acme")).toBe("/ko/workspace/acme/import");
      expect(urls.workspace.importJob("ko", "acme", "job-1")).toBe(
        "/ko/workspace/acme/import/jobs/job-1",
      );
      expect(urls.workspace.newProject("ko", "acme")).toBe("/ko/workspace/acme/new-project");
    });
  });

  describe("share", () => {
    it("locale-less by design", () => {
      expect(urls.share("tok-abc")).toBe("/s/tok-abc");
    });
  });
});
```

- [ ] **Step 1.2: Run tests to verify they fail**

Run: `pnpm --filter @opencairn/web test -- urls.test`
Expected: FAIL — module `./urls` not found.

- [ ] **Step 1.3: Implement `urls.ts`**

Create `apps/web/src/lib/urls.ts`:

```ts
// Single source of truth for all in-app URL paths.
// Every component, hook, server action, and test that builds an
// in-app URL must import from here. Raw `/workspace/...` template
// literals are forbidden by ESLint (see eslint.config.mjs).

const ws = (locale: string, slug: string) => `/${locale}/workspace/${slug}`;
const wsProject = (locale: string, slug: string, pid: string) =>
  `${ws(locale, slug)}/project/${pid}`;

export const urls = {
  // App-level
  dashboard: (locale: string) => `/${locale}/dashboard`,
  onboarding: (locale: string) => `/${locale}/onboarding`,

  // Account settings (per-user, not per-workspace)
  settings: {
    ai: (locale: string) => `/${locale}/settings/ai`,
    mcp: (locale: string) => `/${locale}/settings/mcp`,
    billing: (locale: string) => `/${locale}/settings/billing`,
    notifications: (locale: string) => `/${locale}/settings/notifications`,
    profile: (locale: string) => `/${locale}/settings/profile`,
    providers: (locale: string) => `/${locale}/settings/providers`,
    security: (locale: string) => `/${locale}/settings/security`,
  },

  // Workspace
  workspace: {
    root: (locale: string, slug: string) => ws(locale, slug),
    note: (locale: string, slug: string, noteId: string) =>
      `${ws(locale, slug)}/note/${noteId}`,
    project: (locale: string, slug: string, pid: string) => wsProject(locale, slug, pid),
    projectNote: (locale: string, slug: string, pid: string, nid: string) =>
      `${wsProject(locale, slug, pid)}/note/${nid}`,
    projectAgents: (locale: string, slug: string, pid: string) =>
      `${wsProject(locale, slug, pid)}/agents`,
    projectGraph: (locale: string, slug: string, pid: string) =>
      `${wsProject(locale, slug, pid)}/graph`,
    projectLearn: (locale: string, slug: string, pid: string) =>
      `${wsProject(locale, slug, pid)}/learn`,
    projectLearnFlashcards: (locale: string, slug: string, pid: string) =>
      `${wsProject(locale, slug, pid)}/learn/flashcards`,
    projectLearnFlashcardsReview: (locale: string, slug: string, pid: string) =>
      `${wsProject(locale, slug, pid)}/learn/flashcards/review`,
    projectLearnScores: (locale: string, slug: string, pid: string) =>
      `${wsProject(locale, slug, pid)}/learn/scores`,
    projectLearnSocratic: (locale: string, slug: string, pid: string) =>
      `${wsProject(locale, slug, pid)}/learn/socratic`,
    projectChatScope: (locale: string, slug: string, pid: string) =>
      `${wsProject(locale, slug, pid)}/chat-scope`,
    chatScope: (locale: string, slug: string) => `${ws(locale, slug)}/chat-scope`,
    research: (locale: string, slug: string) => `${ws(locale, slug)}/research`,
    researchRun: (locale: string, slug: string, runId: string) =>
      `${ws(locale, slug)}/research/${runId}`,
    settings: (locale: string, slug: string) => `${ws(locale, slug)}/settings`,
    settingsSection: (locale: string, slug: string, ...sub: string[]) =>
      `${ws(locale, slug)}/settings/${sub.join("/")}`,
    synthesisExport: (locale: string, slug: string) =>
      `${ws(locale, slug)}/synthesis-export`,
    import: (locale: string, slug: string) => `${ws(locale, slug)}/import`,
    importJob: (locale: string, slug: string, jobId: string) =>
      `${ws(locale, slug)}/import/jobs/${jobId}`,
    newProject: (locale: string, slug: string) => `${ws(locale, slug)}/new-project`,
  },

  // Public (locale-less by design — share links are universal)
  share: (token: string) => `/s/${token}`,
} as const;
```

- [ ] **Step 1.4: Run tests to verify pass**

Run: `pnpm --filter @opencairn/web test -- urls.test`
Expected: PASS — all `urls.*` cases.

- [ ] **Step 1.5: Commit**

```bash
git add apps/web/src/lib/urls.ts apps/web/src/lib/urls.test.ts
git commit -m "$(cat <<'EOF'
feat(web): central URL builder (urls.ts)

162 hardcoded path 리터럴을 흡수할 단일 진입점.
Sweep + ESLint 가드는 후속 task에서.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Path parser (`url-parsers.ts`) (TDD)

**Files:**
- Create: `apps/web/src/lib/url-parsers.ts`
- Create: `apps/web/src/lib/url-parsers.test.ts`

`useScopeContext` and `palette/extract-ws-slug` both reverse-parse `pathname` today. Centralize so future renames flip one file.

- [ ] **Step 2.1: Write failing tests**

Create `apps/web/src/lib/url-parsers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseWorkspacePath } from "./url-parsers";

describe("parseWorkspacePath", () => {
  it("workspace root", () => {
    expect(parseWorkspacePath("/ko/workspace/acme")).toEqual({
      locale: "ko",
      wsSlug: "acme",
      projectId: null,
      noteId: null,
    });
  });
  it("workspace note", () => {
    expect(parseWorkspacePath("/ko/workspace/acme/note/n1")).toEqual({
      locale: "ko",
      wsSlug: "acme",
      projectId: null,
      noteId: "n1",
    });
  });
  it("project root", () => {
    expect(parseWorkspacePath("/en/workspace/acme/project/p1")).toEqual({
      locale: "en",
      wsSlug: "acme",
      projectId: "p1",
      noteId: null,
    });
  });
  it("project note", () => {
    expect(parseWorkspacePath("/ko/workspace/acme/project/p1/note/n2")).toEqual({
      locale: "ko",
      wsSlug: "acme",
      projectId: "p1",
      noteId: "n2",
    });
  });
  it("project sub-route (learn)", () => {
    expect(parseWorkspacePath("/ko/workspace/acme/project/p1/learn/flashcards")).toEqual({
      locale: "ko",
      wsSlug: "acme",
      projectId: "p1",
      noteId: null,
    });
  });
  it("non-workspace path", () => {
    expect(parseWorkspacePath("/ko/dashboard")).toEqual({
      locale: "ko",
      wsSlug: null,
      projectId: null,
      noteId: null,
    });
  });
  it("non-localized path", () => {
    expect(parseWorkspacePath("/api/health")).toEqual({
      locale: null,
      wsSlug: null,
      projectId: null,
      noteId: null,
    });
  });
  it("trailing slash tolerated", () => {
    expect(parseWorkspacePath("/ko/workspace/acme/")).toEqual({
      locale: "ko",
      wsSlug: "acme",
      projectId: null,
      noteId: null,
    });
  });
  it("query/hash stripped", () => {
    expect(parseWorkspacePath("/ko/workspace/acme/project/p1?tab=foo#x")).toEqual({
      locale: "ko",
      wsSlug: "acme",
      projectId: "p1",
      noteId: null,
    });
  });
});
```

- [ ] **Step 2.2: Run tests to verify failure**

Run: `pnpm --filter @opencairn/web test -- url-parsers.test`
Expected: FAIL — module not found.

- [ ] **Step 2.3: Implement parser**

Create `apps/web/src/lib/url-parsers.ts`:

```ts
// Reverse of urls.ts. Reads URL pathname → structured workspace context.
// Used by useScopeContext and command palette.

const LOCALE_RE = /^(ko|en)$/;

export type WorkspacePath = {
  locale: string | null;
  wsSlug: string | null;
  projectId: string | null;
  noteId: string | null;
};

export function parseWorkspacePath(pathname: string): WorkspacePath {
  // Strip query/hash, normalize trailing slash, split.
  const clean = pathname.split(/[?#]/, 1)[0]!.replace(/\/+$/, "");
  const parts = clean.split("/").filter(Boolean);

  const out: WorkspacePath = {
    locale: null,
    wsSlug: null,
    projectId: null,
    noteId: null,
  };

  if (parts.length === 0) return out;
  if (!LOCALE_RE.test(parts[0]!)) return out;
  out.locale = parts[0]!;

  if (parts[1] !== "workspace" || !parts[2]) return out;
  out.wsSlug = parts[2];

  // /:locale/workspace/:slug/...
  const rest = parts.slice(3);
  if (rest.length === 0) return out;

  if (rest[0] === "note" && rest[1]) {
    out.noteId = rest[1];
    return out;
  }

  if (rest[0] === "project" && rest[1]) {
    out.projectId = rest[1];
    if (rest[2] === "note" && rest[3]) out.noteId = rest[3];
    return out;
  }

  return out;
}
```

- [ ] **Step 2.4: Run tests to verify pass**

Run: `pnpm --filter @opencairn/web test -- url-parsers.test`
Expected: PASS.

- [ ] **Step 2.5: Commit**

```bash
git add apps/web/src/lib/url-parsers.ts apps/web/src/lib/url-parsers.test.ts
git commit -m "$(cat <<'EOF'
feat(web): parseWorkspacePath helper

useScopeContext + palette extract-ws-slug 를 하나로 흡수할 reverse-parse 유틸.
교체는 후속 task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Reserved slug DB sanity check + RESERVED_SLUGS update

**Files:**
- Modify: `apps/web/src/lib/slug.ts`
- Modify: `apps/api/src/routes/workspaces.ts:32` (RESERVED_SLUGS)

- [ ] **Step 3.1: DB sanity check**

Run against dev DB (env: see `docker-compose.yml`):

```bash
# Connect to dev postgres (container name `postgres` per compose).
docker exec -i opencairn-postgres-1 psql -U opencairn -d opencairn -c \
  "SELECT id, slug, name FROM workspaces WHERE slug IN ('workspace', 'dashboard', 'project', 'note');"
```

Expected output paths:
- **0 rows**: skip Task 4 (migration). Continue.
- **≥1 row**: jump to Task 4 first, then return.

Record the result count in your task notes. If non-zero, also check `prod` DB before merge — flag in PR description.

- [ ] **Step 3.2: Add to web `RESERVED_SLUGS`**

Edit `apps/web/src/lib/slug.ts:2-6`:

```ts
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "app", "api", "admin", "auth", "www", "assets", "static", "public",
  "health", "onboarding", "settings", "billing", "share",
  "invite", "invites", "help", "docs", "blog",
  // 2026-04-30 URL restructure: new top-level + workspace path segments.
  "workspace", "dashboard", "project", "note",
]);
```

- [ ] **Step 3.3: Add to api `RESERVED_SLUGS`**

Edit `apps/api/src/routes/workspaces.ts` (around line 32) — add the same 4 entries to the matching set. Re-read the file first to get exact formatting.

- [ ] **Step 3.4: Run lint + types**

Run: `pnpm --filter @opencairn/web lint && pnpm --filter @opencairn/api typecheck`
Expected: PASS.

- [ ] **Step 3.5: Commit**

```bash
git add apps/web/src/lib/slug.ts apps/api/src/routes/workspaces.ts
git commit -m "$(cat <<'EOF'
chore(slug): reserve workspace/dashboard/project/note

URL restructure 의존성. DB 사전 점검은 PR description에 기록.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: (Conditional) Migration 0040 — slug collision rename

**Skip this task if Task 3.1 returned 0 rows.**

**Files:**
- Create: `packages/db/migrations/0040_reserved_slug_rename.sql`

- [ ] **Step 4.1: Write migration**

Create `packages/db/migrations/0040_reserved_slug_rename.sql`:

```sql
-- 2026-04-30 URL restructure: new RESERVED_SLUGS = workspace/dashboard/project/note.
-- Existing workspaces using these slugs are renamed with a deterministic suffix
-- (first 6 chars of id) so the workspace remains accessible at a stable URL.
-- Owners receive an admin notification (manual, post-merge) explaining the change.

UPDATE workspaces
SET slug = slug || '-' || substring(id::text, 1, 6)
WHERE slug IN ('workspace', 'dashboard', 'project', 'note');
```

- [ ] **Step 4.2: Generate Drizzle metadata if needed**

If the project uses `drizzle-kit migrate` from a metadata journal, regenerate:

Run: `pnpm db:generate`
Expected: new entry in `packages/db/migrations/meta/` referencing 0040. Inspect the diff before committing.

- [ ] **Step 4.3: Apply migration on dev**

Run: `pnpm db:migrate`
Expected: `0040_reserved_slug_rename` applied. Re-run Task 3.1 query — should return 0 rows.

- [ ] **Step 4.4: Commit**

```bash
git add packages/db/migrations/0040_reserved_slug_rename.sql packages/db/migrations/meta
git commit -m "$(cat <<'EOF'
feat(db): migration 0040 reserved-slug rename

URL restructure 가 workspace/dashboard/project/note 를 reserved slug 로
편입함에 따라 충돌 워크스페이스 slug 에 -<id6> 접미사를 부여.

영향 워크스페이스 owner 수동 통지: PR description 참조.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Filesystem rename — workspace tree

Use `git mv` so history is preserved. **All Step 5.x are one commit at the end** (intermediate states do not build).

**Files:**
- Move: `apps/web/src/app/[locale]/app/w/[wsSlug]/` → `apps/web/src/app/[locale]/workspace/[wsSlug]/`
- Rename inside: `(shell)/n/` → `(shell)/note/`, `(shell)/p/` → `(shell)/project/`, `p/[projectId]/notes/` → `project/[projectId]/note/`

- [ ] **Step 5.1: Move workspace root**

```bash
mkdir -p apps/web/src/app/\[locale\]/workspace
git mv "apps/web/src/app/[locale]/app/w/[wsSlug]" "apps/web/src/app/[locale]/workspace/[wsSlug]"
```

- [ ] **Step 5.2: Rename inner shorthand**

```bash
git mv "apps/web/src/app/[locale]/workspace/[wsSlug]/(shell)/n" "apps/web/src/app/[locale]/workspace/[wsSlug]/(shell)/note"
git mv "apps/web/src/app/[locale]/workspace/[wsSlug]/(shell)/p" "apps/web/src/app/[locale]/workspace/[wsSlug]/(shell)/project"
git mv "apps/web/src/app/[locale]/workspace/[wsSlug]/p" "apps/web/src/app/[locale]/workspace/[wsSlug]/project"
git mv "apps/web/src/app/[locale]/workspace/[wsSlug]/project/[projectId]/notes" "apps/web/src/app/[locale]/workspace/[wsSlug]/project/[projectId]/note"
```

(If a directory does not exist due to prior cleanup, skip that line.)

- [ ] **Step 5.3: Verify resulting structure**

Run: `find "apps/web/src/app/[locale]/workspace" -maxdepth 6 -type d | sort`
Expected: paths show `note/` and `project/` segments, no `n/` or `p/` or `notes/` remaining.

- [ ] **Step 5.4: Move `app/dashboard`, `app/settings/ai`; delete `app/settings/mcp` + `app/page.tsx`**

```bash
git mv "apps/web/src/app/[locale]/app/dashboard" "apps/web/src/app/[locale]/dashboard"
git mv "apps/web/src/app/[locale]/app/settings/ai" "apps/web/src/app/[locale]/settings/ai"
git rm -rf "apps/web/src/app/[locale]/app/settings/mcp"
git rm "apps/web/src/app/[locale]/app/page.tsx"
# Drop empty parent directories left behind.
rmdir "apps/web/src/app/[locale]/app/settings" 2>/dev/null || true
rmdir "apps/web/src/app/[locale]/app" 2>/dev/null || true
```

- [ ] **Step 5.5: Stop and do NOT commit yet**

The codebase is broken (callsites still reference old paths). Continue to Task 6.

---

## Task 6: Sweep hardcoded paths in `apps/web/src`

162 occurrences. Strategy: a one-shot codemod handles ~80%; the remainder is manual.

**Files affected:** see Task 6.1 grep output.

- [ ] **Step 6.1: Re-baseline the grep**

Run:
```bash
git grep -nE '/app/w/|/app/dashboard|/app/settings/ai|/app/settings/mcp' -- 'apps/web/src/**/*.{ts,tsx}' | tee /tmp/url-sweep-web.txt
```
Expected: list of pre-sweep occurrences. Save the count: `wc -l /tmp/url-sweep-web.txt`.

- [ ] **Step 6.2: Codemod template-literal forms**

For each file in the grep output, replace by hand or via `sed -i` using these patterns. Always verify with `git diff` before next file.

| Search regex | Replace with |
|---|---|
| `/${locale}/app/w/${...}/p/${...}/notes/${...}` | `urls.workspace.projectNote(locale, slug, pid, nid)` |
| `/${locale}/app/w/${...}/p/${...}` | `urls.workspace.project(locale, slug, pid)` |
| `/${locale}/app/w/${...}/n/${...}` | `urls.workspace.note(locale, slug, nid)` |
| `/${locale}/app/w/${...}` | `urls.workspace.root(locale, slug)` |
| `/${locale}/app/dashboard` | `urls.dashboard(locale)` |
| `/${locale}/app/settings/ai` | `urls.settings.ai(locale)` |
| `/${locale}/app/settings/mcp` | `urls.settings.mcp(locale)` |

For each file modified, prepend:
```ts
import { urls } from "@/lib/urls";
```
(or the relative equivalent).

When the variable holding the slug is named differently (e.g., `wsSlug`, `workspace.slug`, `params.wsSlug`), keep the existing identifier — only the URL shape changes.

- [ ] **Step 6.3: Replace `useScopeContext` reverse-parse with `parseWorkspacePath`**

Edit `apps/web/src/hooks/useScopeContext.ts`:
1. Replace inline `pathname.match(...)` regex with a call to `parseWorkspacePath(pathname)`.
2. Update the route-map comment to reflect new paths (`/workspace/{slug}/note/{noteId}` etc.).

- [ ] **Step 6.4: Replace `palette/extract-ws-slug.ts`**

Edit `apps/web/src/components/palette/extract-ws-slug.ts` and `extract-ws-slug.test.ts` to use `parseWorkspacePath`. If `extract-ws-slug` becomes a 1-line wrapper, decide whether to inline at callsites and delete the file. Update tests in either case.

- [ ] **Step 6.5: Re-run grep — should be zero**

Run:
```bash
git grep -nE '/app/w/|/app/dashboard|/app/settings/ai|/app/settings/mcp' -- 'apps/web/src/**/*.{ts,tsx}'
```
Expected: empty (excluding redirect destinations in `next.config.ts`, which we add in Task 8).

- [ ] **Step 6.6: Run web tests**

Run: `pnpm --filter @opencairn/web test`
Expected: all unit tests pass. Fix any path-string-asserting tests.

- [ ] **Step 6.7: Run typecheck**

Run: `pnpm --filter @opencairn/web typecheck`
Expected: PASS.

- [ ] **Step 6.8: Commit (with Task 5)**

```bash
git add -A apps/web/src
git commit -m "$(cat <<'EOF'
refactor(web): rename /app/w → /workspace + sweep callsites

- /{locale}/app/w/{slug}/p/{id}/notes/{nid}
  → /{locale}/workspace/{slug}/project/{id}/note/{nid}
- /{locale}/app/dashboard → /{locale}/dashboard
- /{locale}/app/settings/ai → /{locale}/settings/ai
- /{locale}/app/settings/mcp deleted (dupe of /{locale}/settings/mcp)
- /{locale}/app deleted (redirect added in next.config in follow-up commit)

Hardcoded paths swept to urls.* helper.
useScopeContext + extract-ws-slug 통합 to parseWorkspacePath.
301 redirects + ESLint guard 후속 task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Update API + emails callsites

**Files:**
- Modify: `apps/api/src/routes/integrations.ts:97`
- Modify: `apps/api/src/routes/workspaces.ts:128` (comment only)
- Modify: `packages/emails/tests/notification-templates.test.tsx:16`

These are the 3 known external-to-web hardcoded references found by `grep -rn "/app/w/\|/app/dashboard" packages/emails/ apps/api/src/`. Re-run the grep to confirm.

- [ ] **Step 7.1: Confirm grep**

Run:
```bash
git grep -nE '/app/w/|/app/dashboard|/app/settings' -- 'apps/api/src/**' 'packages/emails/**'
```
Expected: 3 matches above (re-confirm; flag any new ones).

- [ ] **Step 7.2: Update `apps/api/src/routes/integrations.ts:97`**

Replace:
```ts
? `${webBase()}/app/w/${wsSlug}/import?connected=true`
```
with:
```ts
? `${webBase()}/${locale}/workspace/${wsSlug}/import?connected=true`
```

**Locale source:** check if the route already has access to a `locale` param. If not, fall back to a server-side default (`'ko'`) and add a TODO comment — locale-aware OAuth callbacks are a separate concern. Document the choice in the commit message.

- [ ] **Step 7.3: Update `apps/api/src/routes/workspaces.ts:128` comment**

Replace `// slug → workspace 조회 (멤버만 접근). /app/w/:wsSlug redirect chain 용.` with `// slug → workspace 조회 (멤버만 접근). /:locale/workspace/:wsSlug redirect chain 용.`

- [ ] **Step 7.4: Update `packages/emails/tests/notification-templates.test.tsx:16`**

Replace `"https://example.com/ko/app/w/test/n/note-id"` with `"https://example.com/ko/workspace/test/note/note-id"`.

- [ ] **Step 7.5: Run API + emails tests**

Run: `pnpm --filter @opencairn/api test && pnpm --filter @opencairn/emails test`
Expected: PASS.

- [ ] **Step 7.6: Commit**

```bash
git add apps/api/src/routes/integrations.ts apps/api/src/routes/workspaces.ts packages/emails/tests/notification-templates.test.tsx
git commit -m "$(cat <<'EOF'
refactor(api,emails): switch hardcoded /app/w/ to /workspace/

- integrations.ts: Drive OAuth 성공 redirect URL 갱신
- workspaces.ts: /by-slug 코멘트 path 정정
- emails 테스트 픽스처 path 정정

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Add 301 redirects in `next.config.ts`

**Files:**
- Modify: `apps/web/next.config.ts`

- [ ] **Step 8.1: Add `redirects()` to `nextConfig`**

Edit `apps/web/next.config.ts` — add a new `async redirects()` adjacent to `headers()`:

```ts
const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: MONOREPO_ROOT,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: CSP_HEADER }],
      },
    ];
  },
  // 2026-04-30 URL restructure. Sunset 2026-05-14 (see plan §Sunset).
  async redirects() {
    return [
      // Most specific first — Next applies in order.
      {
        source: "/:locale/app/w/:slug/p/:pid/notes/:nid",
        destination: "/:locale/workspace/:slug/project/:pid/note/:nid",
        permanent: true,
      },
      {
        source: "/:locale/app/w/:slug/p/:pid/:rest*",
        destination: "/:locale/workspace/:slug/project/:pid/:rest*",
        permanent: true,
      },
      {
        source: "/:locale/app/w/:slug/n/:nid",
        destination: "/:locale/workspace/:slug/note/:nid",
        permanent: true,
      },
      {
        source: "/:locale/app/w/:slug/:rest*",
        destination: "/:locale/workspace/:slug/:rest*",
        permanent: true,
      },
      {
        source: "/:locale/app/w/:slug",
        destination: "/:locale/workspace/:slug",
        permanent: true,
      },
      {
        source: "/:locale/app/dashboard",
        destination: "/:locale/dashboard",
        permanent: true,
      },
      {
        source: "/:locale/app/settings/:rest*",
        destination: "/:locale/settings/:rest*",
        permanent: true,
      },
      {
        source: "/:locale/app",
        destination: "/:locale/dashboard",
        permanent: true,
      },
    ];
  },
};
```

- [ ] **Step 8.2: Add E2E redirect spec**

Create `apps/web/tests/e2e/url-redirects.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

const cases = [
  ["/ko/app/w/test/p/p1/notes/n1", "/ko/workspace/test/project/p1/note/n1"],
  ["/ko/app/w/test/p/p1/agents", "/ko/workspace/test/project/p1/agents"],
  ["/ko/app/w/test/n/n1", "/ko/workspace/test/note/n1"],
  ["/ko/app/w/test/research", "/ko/workspace/test/research"],
  ["/ko/app/w/test", "/ko/workspace/test"],
  ["/ko/app/dashboard", "/ko/dashboard"],
  ["/ko/app/settings/ai", "/ko/settings/ai"],
  ["/ko/app/settings/mcp", "/ko/settings/mcp"],
  ["/ko/app", "/ko/dashboard"],
  ["/en/app/w/test", "/en/workspace/test"],
] as const;

for (const [from, to] of cases) {
  test(`301: ${from} → ${to}`, async ({ request }) => {
    const res = await request.get(from, { maxRedirects: 0 });
    expect(res.status()).toBe(308); // Next.js permanent: true uses 308
    expect(res.headers()["location"]).toBe(to);
  });
}
```

(308 vs 301: Next.js `permanent: true` emits 308. Confirm with one manual `curl -I` after deploy and adjust if your version differs.)

- [ ] **Step 8.3: Build to verify**

Run: `pnpm --filter @opencairn/web build`
Expected: build succeeds; no missing route warnings.

- [ ] **Step 8.4: Run redirect E2E**

Bring up the prod-style server and run the new spec.

```bash
pnpm --filter @opencairn/web build && pnpm --filter @opencairn/web start &
sleep 5
pnpm --filter @opencairn/web test:e2e -- url-redirects.spec.ts
```

Expected: all 10 cases pass. Kill background server when done.

- [ ] **Step 8.5: Commit**

```bash
git add apps/web/next.config.ts apps/web/tests/e2e/url-redirects.spec.ts
git commit -m "$(cat <<'EOF'
feat(web): 308 redirects /app/w → /workspace (sunset 2026-05-14)

8 패턴, 가장 구체적인 룰 우선. Bookmark + 공유 링크 흡수용.
2주 후 제거 PR 은 /schedule 박제 (plan Sunset 항).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: ESLint regression guard

**Files:**
- Modify: `apps/web/eslint.config.mjs`

- [ ] **Step 9.1: Add `no-restricted-syntax` rule**

Append to the main rules block in `apps/web/eslint.config.mjs:20-51` (right after `i18next/no-literal-string`):

```js
"no-restricted-syntax": [
  "error",
  {
    selector: "Literal[value=/^\\/[a-z]{2}\\/(app\\/w\\/|app\\/dashboard|app\\/settings\\/(ai|mcp)|workspace\\/)/]",
    message: "Use urls.* helper from @/lib/urls instead of hardcoded paths.",
  },
  {
    selector: "TemplateElement[value.raw=/\\/app\\/w\\/|\\/app\\/dashboard|\\/app\\/settings\\/(ai|mcp)|\\/workspace\\//]",
    message: "Use urls.* helper from @/lib/urls instead of hardcoded paths.",
  },
],
```

Also exempt `next.config.ts` (legitimate redirect destinations) and `urls.ts` itself by adding a third config object:

```js
{
  files: ["next.config.ts", "src/lib/urls.ts", "src/lib/url-parsers.ts", "tests/e2e/url-redirects.spec.ts"],
  rules: { "no-restricted-syntax": "off" },
},
```

The existing test-file override (`src/**/*.test.{ts,tsx}`, `tests/**/*.{ts,tsx}`) already disables `i18next/no-literal-string`; extend it to also disable `no-restricted-syntax` so test fixtures with fake URLs do not blow up:

```js
{
  files: ["src/**/*.test.{ts,tsx}", "tests/**/*.{ts,tsx}"],
  rules: {
    "i18next/no-literal-string": "off",
    "no-restricted-syntax": "off",
  },
},
```

- [ ] **Step 9.2: Run lint — must be clean**

Run: `pnpm --filter @opencairn/web lint`
Expected: PASS (the Task 6 sweep should leave zero violations; if any remain, fix and re-run).

- [ ] **Step 9.3: Verify the guard catches regressions**

Temporarily add `const x = "/ko/app/w/test"` to any non-test file. Re-run lint — expect ERROR. Remove the line.

- [ ] **Step 9.4: Commit**

```bash
git add apps/web/eslint.config.mjs
git commit -m "$(cat <<'EOF'
chore(web): ESLint guard against hardcoded /app/w/ + /workspace/ paths

urls.* helper 미경유 path literal 을 lint error 로 차단.
회귀 방지.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: E2E test path sweep

86 E2E specs reference old paths. Same playbook as Task 6 but for `apps/web/tests/e2e/`.

**Files:** see Task 10.1 grep output.

- [ ] **Step 10.1: Re-baseline grep**

Run:
```bash
git grep -nE '/app/w/|/app/dashboard|/app/settings/ai|/app/settings/mcp' -- 'apps/web/tests/e2e/**/*.ts' | tee /tmp/url-sweep-e2e.txt
```
Expected: list of E2E occurrences.

- [ ] **Step 10.2: Codemod E2E paths**

For each match, replace using the same mapping as Task 6.2. E2E specs typically use string literals (no `urls.*` helper — the test boundary). Plain-text replace is safe here:

```bash
# Inside the worktree:
files=$(git grep -lE '/app/w/|/app/dashboard|/app/settings/ai|/app/settings/mcp' -- 'apps/web/tests/e2e/**/*.ts')
for f in $files; do
  sed -i \
    -e 's#/app/w/\([^/]*\)/p/\([^/]*\)/notes/#/workspace/\1/project/\2/note/#g' \
    -e 's#/app/w/\([^/]*\)/p/#/workspace/\1/project/#g' \
    -e 's#/app/w/\([^/]*\)/n/#/workspace/\1/note/#g' \
    -e 's#/app/w/#/workspace/#g' \
    -e 's#/app/dashboard#/dashboard#g' \
    -e 's#/app/settings/#/settings/#g' \
    "$f"
done
```

(Inspect each diff with `git diff` — sed is line-based and may miss multi-line template literals; fix by hand.)

- [ ] **Step 10.3: Confirm zero hits**

Run:
```bash
git grep -nE '/app/w/|/app/dashboard|/app/settings/ai|/app/settings/mcp' -- 'apps/web/tests/e2e/**/*.ts'
```
Expected: empty (excluding `url-redirects.spec.ts` which intentionally hits old paths).

- [ ] **Step 10.4: Run a representative subset**

Some E2E specs need the dev stack. Smoke a few first:

```bash
pnpm --filter @opencairn/web test:e2e -- routes.spec.ts app-shell-phase1.spec.ts sidebar.spec.ts
```
Expected: PASS. If a spec fails because a UI element URL changed, fix the spec.

- [ ] **Step 10.5: Commit**

```bash
git add apps/web/tests/e2e
git commit -m "$(cat <<'EOF'
test(web,e2e): sweep /app/w/ → /workspace/ in E2E specs

86 spec 갱신. url-redirects.spec.ts 는 의도적으로 옛 path 유지 (308 검증).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Manual dev verification (memory rule: completion-claims discipline)

CLAUDE.md memory: **"완료 표기 전 user-facing 1-call 검증 의무"**.

- [ ] **Step 11.1: Bring up dev stack**

```bash
docker-compose up -d
pnpm dev &
sleep 15
```

- [ ] **Step 11.2: Hit each new path with curl**

```bash
# Login required for app routes — for this verification the redirect chain is enough.
curl -sI http://localhost:3000/ko/dashboard | head -1                        # 200 or 307→login
curl -sI http://localhost:3000/ko/workspace/test | head -1                    # 200 or 307
curl -sI http://localhost:3000/ko/settings/ai | head -1                       # 200 or 307
curl -sI http://localhost:3000/ko/app/w/test 2>&1 | grep -E '^(HTTP|location)' # 308 → /ko/workspace/test
curl -sI http://localhost:3000/ko/app/dashboard 2>&1 | grep -E '^(HTTP|location)' # 308 → /ko/dashboard
curl -sI http://localhost:3000/ko/app/settings/ai 2>&1 | grep -E '^(HTTP|location)' # 308 → /ko/settings/ai
```

Capture the output in your verification notes. **Do not declare task complete without this evidence.**

- [ ] **Step 11.3: Browser sanity (Playwright MCP if available, or manual)**

Open `http://localhost:3000/ko/workspace/{your-dev-ws-slug}` in a browser. Verify:
1. Sidebar links point to `/workspace/...`
2. Click a note → URL becomes `/workspace/{slug}/note/{id}` (or `/workspace/{slug}/project/{id}/note/{id}` if inside a project).
3. Open `/ko/app/w/{your-dev-ws-slug}` → browser redirects to `/ko/workspace/{slug}`.
4. Command palette navigation lands on new URLs.

- [ ] **Step 11.4: Stop dev**

```bash
pkill -f "pnpm dev" || true
docker-compose stop
```

---

## Task 12: Documentation update

**Files:**
- Modify: `CLAUDE.md` (Hierarchy section + plans-status pointer if needed)
- Modify: `docs/contributing/plans-status.md`
- Modify: `docs/architecture/api-contract.md` (any path examples)

- [ ] **Step 12.1: Update CLAUDE.md**

The `Hierarchy: Workspace → Project → Page` line is unchanged. But scan CLAUDE.md for any URL reference (`/app/w/`, `/app/dashboard`, `/app/settings/`) and update.

Run: `git grep -nE '/app/w/|/app/dashboard|/app/settings/' -- CLAUDE.md docs/`
Expected: any matches in human-readable docs need updating. Skip changelogs/audits — those are historical records.

- [ ] **Step 12.2: Update plans-status.md**

Add a new entry under "Active / next" or as completed:

```markdown
- ✅ Complete: ... URL Restructure (2026-04-30, plan 2026-04-30-url-restructure):
  /app/w/{slug}/p/{id}/notes/{nid} → /workspace/{slug}/project/{id}/note/{nid},
  central urls.ts builder, 308 redirect sunset 2026-05-14.
```

- [ ] **Step 12.3: Update api-contract / data-flow path examples if any**

Run: `git grep -nE '/app/w/|/app/dashboard|/app/settings/' -- docs/architecture/`
Expected: update any non-historical examples.

- [ ] **Step 12.4: Commit docs**

```bash
git add CLAUDE.md docs
git commit -m "$(cat <<'EOF'
docs: URL restructure 반영

CLAUDE.md / plans-status / architecture 의 path 예시 갱신.
역사적 audit / changelog 는 그대로 유지.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Open PR + sunset reminder

- [ ] **Step 13.1: Push branch**

```bash
git push -u origin feat/url-restructure
```

- [ ] **Step 13.2: Open PR**

```bash
gh pr create --title "refactor: /app/w → /workspace + central URL builder" --body "$(cat <<'EOF'
## Summary
- Renames `/{locale}/app/w/{slug}/p/{id}/notes/{nid}` → `/{locale}/workspace/{slug}/project/{id}/note/{nid}`
- Drops `/app/` from dashboard + settings
- Centralizes 162 hardcoded path literals into `apps/web/src/lib/urls.ts`
- 308 redirects from old paths (sunset 2026-05-14)
- ESLint `no-restricted-syntax` guard against regressions
- Reserved slugs: + workspace/dashboard/project/note (DB sanity check: <fill in row count>)

## Test plan
- [x] `pnpm --filter @opencairn/web test` (urls + url-parsers + sweep)
- [x] `pnpm --filter @opencairn/web typecheck`
- [x] `pnpm --filter @opencairn/web lint` (regression guard active)
- [x] `pnpm --filter @opencairn/web test:e2e -- url-redirects.spec.ts`
- [x] Manual dev verification (Task 11 evidence in PR comment)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 13.3: Schedule sunset agent**

Use the `schedule` skill to register a one-time agent for 2026-05-14:

> Cleanup PR: remove the `/app/w → /workspace` redirect block from `apps/web/next.config.ts` and the `url-redirects.spec.ts` cases. Verify access logs do not show meaningful traffic on the old paths first.

---

## Spec Coverage Self-Check

Spec sections vs tasks:

| Spec section | Task |
|---|---|
| URL Map (workspace tree) | Task 5, 6 |
| URL Map (app-level) | Task 5, 6 |
| Central URL Builder (urls.ts) | Task 1 |
| Path parser (url-parsers.ts) | Task 2 |
| Reserved Slugs + DB check | Task 3 |
| Migration 0040 (conditional) | Task 4 |
| 301 Redirects | Task 8 |
| ESLint guard | Task 9 |
| External URLs (api/emails) | Task 7 |
| i18n grep | Task 12.3 |
| E2E sweep | Task 10 |
| Manual verification | Task 11 |
| Sunset schedule | Task 13.3 |

All spec sections have implementing tasks.

## Risk re-check

- **OAuth callback URL**: `apps/api/src/routes/integrations.ts:97` is the success-redirect (web URL), not the OAuth provider callback (`/api/...`). Provider-side config: no change needed.
- **Email invite URLs**: `packages/emails` test fixture is the only hit; production templates use `webBase()` from config — verify in PR review that no template hardcodes `/app/w/`.
- **Redirect order bug**: covered by Task 8.4 E2E spec with 10 cases.
- **Codemod misses**: Task 6.5 + Task 10.3 grep gates catch leftovers; ESLint then prevents reintroduction.
