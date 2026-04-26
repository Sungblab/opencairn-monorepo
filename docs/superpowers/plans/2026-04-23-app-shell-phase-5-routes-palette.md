# App Shell Phase 5 — Routes, Palette & Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the remaining route views (dashboard, project, research hub, research run, import, workspace admin, account settings) and add two cross-cutting overlays — Command Palette (`⌘K`/`⌘⇧P`) and Notifications Drawer (sidebar `🔔`) with a real SSE channel. This closes the visible-feature gap introduced by the phased shell so that every URL in spec §3.1 + §7 renders real content.

**Architecture:**
- Route pages call server components for initial fetch where possible (`apps/web/src/app/[locale]/app/w/[wsSlug]/.../page.tsx`); interactive UI is co-located client components under `apps/web/src/components/views/*`.
- `CommandPalette` is a global `cmdk` overlay wired to `palette-store` (Phase 1). It searches notes via `/api/search/text` and `/api/search/semantic`, plus a curated action registry.
- `NotificationDrawer` renders `unread` notifications grouped by kind, reads from `GET /api/notifications`, subscribes to `/api/stream/notifications`, posts `PATCH /api/notifications/:id/read` on click.
- Account settings shell (`/settings/*`) lives **outside** `AppShell` — a separate `AccountShell` with its own sub-nav.

**Tech Stack:** Next.js 16 App Router, `cmdk`, shadcn `Sheet`, `@tanstack/react-query`, SSE, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-04-23-app-shell-redesign-design.md` §3.1 (routes), §7 (special routes), §8 (account shell), §11.4 (SSE), §11.3 (API).
**Depends on:** Phase 1~4 merged.

---

## File Structure

**New files:**

```
apps/web/src/app/[locale]/
├── app/w/[wsSlug]/
│   ├── page.tsx                                             # real dashboard (replaces Phase 1 placeholder)
│   ├── p/[projectId]/page.tsx                               # real project view
│   ├── research/page.tsx                                    # real research hub
│   ├── research/[runId]/page.tsx                            # real research run
│   ├── import/page.tsx                                      # real import wizard
│   └── settings/[[...slug]]/page.tsx                        # workspace admin subtabs
└── settings/
    ├── layout.tsx                                           # AccountShell wrapper
    ├── profile/page.tsx
    ├── providers/page.tsx
    ├── security/page.tsx
    └── billing/page.tsx

apps/web/src/components/views/
├── dashboard/
│   ├── dashboard-view.tsx
│   ├── stats-row.tsx
│   ├── active-research-list.tsx
│   └── recent-docs-grid.tsx
├── project/
│   ├── project-view.tsx
│   ├── project-meta-row.tsx
│   └── project-notes-table.tsx
├── research/
│   ├── research-hub-view.tsx
│   ├── research-run-card.tsx
│   └── research-run-view.tsx
├── import/
│   └── import-view.tsx                                      # 2-step wizard
├── workspace-settings/
│   ├── workspace-settings-view.tsx                          # tab router
│   ├── members-tab.tsx
│   ├── invites-tab.tsx
│   ├── integrations-tab.tsx
│   ├── shared-links-tab.tsx
│   └── trash-tab.tsx
└── account/
    ├── account-shell.tsx
    ├── profile-view.tsx
    ├── providers-view.tsx
    ├── security-view.tsx
    └── billing-view.tsx

apps/web/src/components/palette/
├── command-palette.tsx
├── palette-actions.ts                                       # action registry
└── palette-search.ts                                        # search adapters

apps/web/src/components/notifications/
├── notification-drawer.tsx
├── notification-item.tsx
└── use-notifications.ts

apps/api/src/routes/
├── notifications.ts
└── stream-notifications.ts

apps/api/src/lib/
└── notification-events.ts                                   # event bus
```

**Modified files:**

```
apps/web/src/components/shell/shell-providers.tsx            # mount CommandPalette + NotificationDrawer
apps/web/src/components/sidebar/sidebar-footer.tsx           # hook 🔔 to drawer
apps/api/src/routes/index.ts                                 # mount notifications routes
messages/{ko,en}/dashboard.json, project.json, research.json, import.json,
                workspace-settings.json, account.json, palette.json, notifications.json
```

**Tests:** one focused unit test per complex component + one e2e per major route + palette + drawer (list below under each task).

---

## Task 1: Dashboard view

**Files:** `apps/web/src/app/[locale]/app/w/[wsSlug]/page.tsx`, `components/views/dashboard/*.tsx`

- [x] **Step 1.1: Replace placeholder page**

```tsx
// apps/web/src/app/[locale]/app/w/[wsSlug]/page.tsx
import { DashboardView } from "@/components/views/dashboard/dashboard-view";

export default async function WorkspaceDashboard({
  params,
}: {
  params: Promise<{ wsSlug: string }>;
}) {
  const { wsSlug } = await params;
  return <DashboardView wsSlug={wsSlug} />;
}
```

- [x] **Step 1.2: Stats row**

```tsx
// apps/web/src/components/views/dashboard/stats-row.tsx
"use client";
import { useQuery } from "@tanstack/react-query";

export function StatsRow({ wsSlug }: { wsSlug: string }) {
  const { data } = useQuery({
    queryKey: ["dashboard-stats", wsSlug],
    queryFn: async () => (await fetch(`/api/workspaces/${wsSlug}/stats`)).json() as Promise<{
      docs: number; docs_week_delta: number;
      research_in_progress: number;
      credits_krw: number;
      byok_connected: boolean;
    }>,
  });
  if (!data) return null;

  const stat = (label: string, value: string, sub?: string) => (
    <div className="rounded border border-border p-4">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
      {stat("문서", String(data.docs), `+${data.docs_week_delta} 이번 주`)}
      {stat("Deep Research", `${data.research_in_progress} 진행 중`)}
      {stat("남은 크레딧", `₩${data.credits_krw.toLocaleString()}`)}
      {stat("BYOK 키", data.byok_connected ? "연결됨" : "미연결")}
    </div>
  );
}
```

If `/api/workspaces/:slug/stats` does not exist, add it in `apps/api/src/routes/workspaces.ts` — a small aggregation endpoint returning the fields above. The counts come from existing tables (pages count where deleted_at is null; research_runs count where status = 'researching'; user credit balance from billing table).

- [x] **Step 1.3: Active research + recent docs**

Stub both with React Query calls to existing endpoints:
- `GET /api/research/runs?workspace_id=<id>&status_in=researching,awaiting_approval` → `ActiveResearchList`
- `GET /api/workspaces/<slug>/recent-notes?limit=3` → `RecentDocsGrid`

Implementation follows the same pattern as StatsRow. Keep the DOM simple — 3-column grid for recent docs, stacked cards for research.

- [x] **Step 1.4: DashboardView composition**

```tsx
"use client";
import { StatsRow } from "./stats-row";
import { ActiveResearchList } from "./active-research-list";
import { RecentDocsGrid } from "./recent-docs-grid";

export function DashboardView({ wsSlug }: { wsSlug: string }) {
  return (
    <div data-testid="route-dashboard" className="flex flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">대시보드</h1>
          <p className="text-sm text-muted-foreground">
            최근 활동 · Deep Research 진행 상황 · 추천
          </p>
        </div>
        <a
          href={`/ko/app/w/${wsSlug}/new-project`}
          className="rounded bg-foreground px-3 py-1.5 text-sm text-background"
        >
          새 프로젝트
        </a>
      </header>
      <StatsRow wsSlug={wsSlug} />
      <section>
        <h2 className="mb-2 text-sm font-semibold">진행 중인 Deep Research</h2>
        <ActiveResearchList wsSlug={wsSlug} />
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold">최근 작업한 문서</h2>
        <RecentDocsGrid wsSlug={wsSlug} />
      </section>
    </div>
  );
}
```

- [x] **Step 1.5: Commit**

```bash
git add apps/web/src/app/[locale]/app/w/[wsSlug]/page.tsx \
        apps/web/src/components/views/dashboard/ \
        apps/api/src/routes/workspaces.ts
git commit -m "feat(web): real dashboard view with stats/research/docs"
```

---

## Task 2: Project view

**Files:** `apps/web/src/app/[locale]/app/w/[wsSlug]/p/[projectId]/page.tsx`, `components/views/project/*`

- [x] **Step 2.1: Route page**

```tsx
// page.tsx
import { ProjectView } from "@/components/views/project/project-view";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ wsSlug: string; projectId: string }>;
}) {
  const { wsSlug, projectId } = await params;
  return <ProjectView wsSlug={wsSlug} projectId={projectId} />;
}
```

- [x] **Step 2.2: Meta row + notes table**

```tsx
// project-meta-row.tsx
"use client";
export function ProjectMetaRow({
  name, pageCount, lastActivity,
}: { name: string; pageCount: number; lastActivity: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">{name}</h1>
      <p className="text-sm text-muted-foreground">
        {pageCount}개 문서 · 마지막 활동 {lastActivity}
      </p>
    </div>
  );
}
```

```tsx
// project-notes-table.tsx
"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

type Filter = "all" | "imported" | "research" | "manual";

export function ProjectNotesTable({ wsSlug, projectId }: { wsSlug: string; projectId: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const { data } = useQuery({
    queryKey: ["project-notes", projectId, filter],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/notes?filter=${filter}`);
      return (await r.json()).notes as Array<{
        id: string; title: string; kind: Filter; editor: string; updated_at: string;
      }>;
    },
  });

  const tabs: { id: Filter; label: string }[] = [
    { id: "all", label: "전체" },
    { id: "imported", label: "임포트" },
    { id: "research", label: "Deep Research" },
    { id: "manual", label: "직접 작성" },
  ];

  return (
    <div>
      <div className="mb-2 flex gap-1 text-xs">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setFilter(t.id)}
            className={`rounded border px-2 py-1 ${filter === t.id ? "border-foreground" : "border-border"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <table className="w-full text-sm">
        <thead className="text-[11px] uppercase text-muted-foreground">
          <tr><th className="pb-2 text-left">제목</th><th className="pb-2">유형</th><th className="pb-2">편집자</th><th className="pb-2">업데이트</th></tr>
        </thead>
        <tbody>
          {data?.map((n) => (
            <tr key={n.id} className="border-t border-border">
              <td className="py-2">
                <Link href={`/ko/app/w/${wsSlug}/n/${n.id}`} className="hover:underline">{n.title}</Link>
              </td>
              <td>{n.kind}</td>
              <td>{n.editor}</td>
              <td>{n.updated_at}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [x] **Step 2.3: View composition + action bar + commit**

```tsx
// project-view.tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { ProjectMetaRow } from "./project-meta-row";
import { ProjectNotesTable } from "./project-notes-table";

export function ProjectView({ wsSlug, projectId }: { wsSlug: string; projectId: string }) {
  const { data } = useQuery({
    queryKey: ["project-meta", projectId],
    queryFn: async () => (await fetch(`/api/projects/${projectId}`)).json() as Promise<{
      name: string; page_count: number; last_activity_at: string;
    }>,
  });
  return (
    <div data-testid="route-project" className="flex flex-col gap-6 p-6">
      <header className="flex items-start justify-between">
        <ProjectMetaRow
          name={data?.name ?? ""}
          pageCount={data?.page_count ?? 0}
          lastActivity={data?.last_activity_at ?? ""}
        />
        <div className="flex gap-2">
          <a href={`/ko/app/w/${wsSlug}/research?project=${projectId}`} className="rounded border border-border px-3 py-1.5 text-sm">Deep Research 시작</a>
          <a href={`/ko/app/w/${wsSlug}/import?project=${projectId}`} className="rounded border border-border px-3 py-1.5 text-sm">가져오기</a>
          <button className="rounded bg-foreground px-3 py-1.5 text-sm text-background">새 문서</button>
        </div>
      </header>
      <ProjectNotesTable wsSlug={wsSlug} projectId={projectId} />
    </div>
  );
}
```

```bash
git add apps/web/src/app/[locale]/app/w/[wsSlug]/p/[projectId]/page.tsx \
        apps/web/src/components/views/project/
git commit -m "feat(web): real project view (meta + filterable notes table)"
```

---

## Task 3: Research hub view

**Files:** `apps/web/src/app/[locale]/app/w/[wsSlug]/research/page.tsx`, `components/views/research/research-hub-view.tsx`

- [x] **Step 3.1: Hub view**

```tsx
"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ResearchRunCard } from "./research-run-card";

type Status = "all" | "researching" | "awaiting_approval" | "completed" | "failed";

export function ResearchHubView({ wsSlug }: { wsSlug: string }) {
  const [filter, setFilter] = useState<Status>("all");
  const { data } = useQuery({
    queryKey: ["research-runs", wsSlug, filter],
    queryFn: async () => {
      const url = new URL(`/api/research/runs`, location.origin);
      url.searchParams.set("workspace_slug", wsSlug);
      if (filter !== "all") url.searchParams.set("status", filter);
      return (await (await fetch(url)).json()).runs as any[];
    },
  });

  const tabs: { id: Status; label: string }[] = [
    { id: "all", label: "전체" },
    { id: "researching", label: "진행 중" },
    { id: "awaiting_approval", label: "승인 대기" },
    { id: "completed", label: "완료" },
    { id: "failed", label: "실패·취소" },
  ];

  return (
    <div data-testid="route-research-hub" className="flex flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Deep Research</h1>
          <p className="text-sm text-muted-foreground">
            주제를 입력하면 플랜을 검토하고, 최종 리포트가 워크스페이스에 문서로 저장됩니다.
          </p>
        </div>
        <a
          href={`/ko/app/w/${wsSlug}/research/new`}
          className="rounded bg-foreground px-3 py-1.5 text-sm text-background"
        >
          새 리서치 시작
        </a>
      </header>
      <div className="flex gap-1 text-xs">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setFilter(t.id)}
            className={`rounded border px-2 py-1 ${filter === t.id ? "border-foreground" : "border-border"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {data?.map((run) => <ResearchRunCard key={run.id} run={run} wsSlug={wsSlug} />)}
      </div>
    </div>
  );
}
```

- [x] **Step 3.2: Run card**

```tsx
"use client";
import Link from "next/link";

export function ResearchRunCard({ run, wsSlug }: { run: any; wsSlug: string }) {
  const status = run.status as "researching" | "awaiting_approval" | "completed" | "failed" | "cancelled";
  const badgeColor = {
    researching: "bg-blue-100",
    awaiting_approval: "bg-yellow-100",
    completed: "bg-green-100",
    failed: "bg-red-100",
    cancelled: "bg-muted",
  }[status];
  return (
    <Link
      href={`/ko/app/w/${wsSlug}/research/${run.id}`}
      className="flex items-center justify-between rounded border border-border px-4 py-3 hover:bg-accent"
    >
      <div className="flex flex-1 items-center gap-3">
        <span className="h-2 w-2 rounded-full bg-foreground" />
        <div>
          <p className="text-sm font-medium">{run.title}</p>
          <p className="text-xs text-muted-foreground">
            {run.project_name} · {run.mode} · {new Date(run.created_at).toLocaleString()}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className={`rounded px-2 py-0.5 text-[11px] ${badgeColor}`}>{status}</span>
        <span className="text-xs text-muted-foreground">
          {run.cost_krw ? `₩${run.cost_krw.toLocaleString()}` : "예상 $—"}
        </span>
        <span className="text-xs">열기 →</span>
      </div>
    </Link>
  );
}
```

- [x] **Step 3.3: Commit**

```bash
git add apps/web/src/app/[locale]/app/w/[wsSlug]/research/page.tsx \
        apps/web/src/components/views/research/{research-hub-view,research-run-card}.tsx
git commit -m "feat(web): real research hub with status tabs and run cards"
```

---

## Task 4: Research run view — route + lifecycle stub

The full lifecycle UI is Deep Research Phase D's territory. This task renders a stub that dispatches on `run.status` to named sub-components, each currently rendering a placeholder. Phase D fills them.

**Files:** `apps/web/src/app/[locale]/app/w/[wsSlug]/research/[runId]/page.tsx`, `components/views/research/research-run-view.tsx`

- [x] **Step 4.1: Implement**

```tsx
// research-run-view.tsx
"use client";
import { useQuery } from "@tanstack/react-query";

const labels: Record<string, string> = {
  planning: "플랜 수립 중",
  awaiting_approval: "플랜 승인 대기",
  researching: "리서치 진행 중",
  completed: "완료",
  failed: "실패",
  cancelled: "취소됨",
};

export function ResearchRunView({ runId }: { runId: string }) {
  const { data } = useQuery({
    queryKey: ["research-run", runId],
    queryFn: async () => (await (await fetch(`/api/research/runs/${runId}`)).json()),
  });

  if (!data) return null;
  return (
    <div data-testid="route-research-run" className="flex flex-col gap-4 p-6">
      <header>
        <h1 className="text-2xl font-semibold">{data.title}</h1>
        <p className="text-sm text-muted-foreground">상태: {labels[data.status] ?? data.status}</p>
      </header>
      <section className="rounded border border-border p-4 text-sm text-muted-foreground">
        lifecycle 뷰는 Deep Research Phase D에서 채워집니다. (status = {data.status})
      </section>
    </div>
  );
}
```

- [x] **Step 4.2: Commit**

```bash
git add apps/web/src/app/[locale]/app/w/[wsSlug]/research/[runId]/page.tsx \
        apps/web/src/components/views/research/research-run-view.tsx
git commit -m "feat(web): research run view stub dispatching on status"
```

---

## Task 5: Import wizard

**Files:** `apps/web/src/app/[locale]/app/w/[wsSlug]/import/page.tsx`, `components/views/import/import-view.tsx`

- [x] **Step 5.1: 2-step wizard**

Reuse existing import-jobs API (already built per memory). Front-end:

```tsx
"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

type Source = "drive" | "notion_zip";

export function ImportView({ wsSlug }: { wsSlug: string }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [source, setSource] = useState<Source | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const qc = useQueryClient();

  const start = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/import-jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, project_id: projectId }),
      });
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["import-jobs"] }),
  });

  if (step === 1) {
    return (
      <div data-testid="route-import" className="flex flex-col gap-4 p-6">
        <h1 className="text-2xl font-semibold">가져오기</h1>
        <p className="text-sm text-muted-foreground">어떤 소스에서 가져올까요?</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => { setSource("drive"); setStep(2); }}
            className="rounded border border-border p-4 text-left hover:bg-accent"
          >
            Google Drive
          </button>
          <button
            onClick={() => { setSource("notion_zip"); setStep(2); }}
            className="rounded border border-border p-4 text-left hover:bg-accent"
          >
            Notion ZIP
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="route-import" className="flex flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">가져오기 · 2/2</h1>
      <p className="text-sm">대상 프로젝트 선택</p>
      <ProjectSelect wsSlug={wsSlug} value={projectId} onChange={setProjectId} />
      <div className="flex gap-2">
        <button onClick={() => setStep(1)} className="rounded border border-border px-3 py-1.5 text-sm">뒤로</button>
        <button
          disabled={!projectId || start.isPending}
          onClick={() => start.mutate()}
          className="rounded bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-50"
        >
          가져오기 시작
        </button>
      </div>
    </div>
  );
}

function ProjectSelect({ wsSlug, value, onChange }: any) { /* fetch projects, render select */ return null; }
```

`ProjectSelect` is a minimal dropdown reading `/api/workspaces/:slug/projects`. Inline it — 20 lines.

- [x] **Step 5.2: Commit**

```bash
git add apps/web/src/app/[locale]/app/w/[wsSlug]/import/page.tsx \
        apps/web/src/components/views/import/import-view.tsx
git commit -m "feat(web): 2-step import wizard"
```

---

## Task 6: Workspace settings subtabs

**Files:** `apps/web/src/app/[locale]/app/w/[wsSlug]/settings/[[...slug]]/page.tsx`, `components/views/workspace-settings/*`

- [x] **Step 6.1: Router view**

```tsx
// workspace-settings-view.tsx
"use client";
import Link from "next/link";
import { MembersTab } from "./members-tab";
import { InvitesTab } from "./invites-tab";
import { IntegrationsTab } from "./integrations-tab";
import { SharedLinksTab } from "./shared-links-tab";
import { TrashTab } from "./trash-tab";

export function WorkspaceSettingsView({ wsSlug, sub }: { wsSlug: string; sub: string }) {
  const tabs = [
    { id: "members", label: "멤버" },
    { id: "invites", label: "초대" },
    { id: "integrations", label: "통합" },
    { id: "shared-links", label: "공유 링크" },
    { id: "trash", label: "휴지통" },
  ];
  const current = sub || "members";

  const body = (() => {
    switch (current) {
      case "members": return <MembersTab wsSlug={wsSlug} />;
      case "invites": return <InvitesTab wsSlug={wsSlug} />;
      case "integrations": return <IntegrationsTab wsSlug={wsSlug} />;
      case "shared-links": return <SharedLinksTab wsSlug={wsSlug} />;
      case "trash": return <TrashTab wsSlug={wsSlug} />;
      default: return null;
    }
  })();

  return (
    <div data-testid="route-ws-settings" className="flex gap-6 p-6">
      <aside className="w-40 shrink-0 border-r border-border pr-4">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={`/ko/app/w/${wsSlug}/settings/${t.id}`}
            className={`block rounded px-2 py-1 text-sm ${current === t.id ? "bg-accent" : ""}`}
          >
            {t.label}
          </Link>
        ))}
      </aside>
      <main className="flex-1">{body}</main>
    </div>
  );
}
```

- [x] **Step 6.2: Subtab bodies**

Each subtab is a short component that calls an existing API:
- `MembersTab` → `GET /api/workspaces/:slug/members` (list + role PATCH)
- `InvitesTab` → `GET /api/workspaces/:slug/invites` (list + cancel)
- `IntegrationsTab` → `GET /api/user-integrations` scoped + connect/disconnect
- `SharedLinksTab` → `GET /api/share-links?workspace_slug=...` + revoke
- `TrashTab` → `GET /api/workspaces/:slug/trash` + restore/purge

If any of these endpoints don't exist yet, leave a stub view + an open TODO in the task: *"Replace stub once API `<path>` lands (track via Plan 2C follow-up)."* Do not block on API work here.

Example stub pattern:
```tsx
"use client";
export function SharedLinksTab({ wsSlug }: { wsSlug: string }) {
  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold">공유 링크</h2>
      <p className="text-sm text-muted-foreground">
        이 섹션은 공유 링크 API 합류 후 활성화됩니다.
      </p>
    </div>
  );
}
```

- [x] **Step 6.3: Route page**

```tsx
// apps/web/src/app/[locale]/app/w/[wsSlug]/settings/[[...slug]]/page.tsx
import { WorkspaceSettingsView } from "@/components/views/workspace-settings/workspace-settings-view";

export default async function WsSettings({
  params,
}: {
  params: Promise<{ wsSlug: string; slug?: string[] }>;
}) {
  const { wsSlug, slug } = await params;
  return <WorkspaceSettingsView wsSlug={wsSlug} sub={slug?.[0] ?? "members"} />;
}
```

- [x] **Step 6.4: Commit**

```bash
git add apps/web/src/app/[locale]/app/w/[wsSlug]/settings/ \
        apps/web/src/components/views/workspace-settings/
git commit -m "feat(web): workspace admin subtabs (members/invites/integrations/shared/trash)"
```

---

## Task 7: Account settings shell (outside AppShell)

**Files:** `apps/web/src/app/[locale]/settings/layout.tsx`, 4 page files, `components/views/account/*`

- [x] **Step 7.1: AccountShell**

```tsx
// account-shell.tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function AccountShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const tabs = [
    { id: "profile", label: "프로필" },
    { id: "providers", label: "BYOK" },
    { id: "security", label: "보안" },
    { id: "billing", label: "청구·크레딧" },
  ];
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r border-border p-4">
        <Link href="/ko" className="mb-6 block text-xs text-muted-foreground">
          ← 워크스페이스로
        </Link>
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={`/ko/settings/${t.id}`}
            className={`block rounded px-2 py-1 text-sm ${pathname.endsWith(t.id) ? "bg-accent" : ""}`}
          >
            {t.label}
          </Link>
        ))}
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
```

- [x] **Step 7.2: Layout**

```tsx
// apps/web/src/app/[locale]/settings/layout.tsx
import { AccountShell } from "@/components/views/account/account-shell";
import { requireSession } from "@/lib/session";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  return <AccountShell>{children}</AccountShell>;
}
```

- [x] **Step 7.3: 4 page files**

Each page is ~40 lines: fetch user / BYOK / sessions / billing data and render forms. Skeletons:

```tsx
// apps/web/src/app/[locale]/settings/profile/page.tsx
import { ProfileView } from "@/components/views/account/profile-view";
export default function Page() { return <ProfileView />; }

// apps/web/src/components/views/account/profile-view.tsx
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

export function ProfileView() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await fetch("/api/users/me")).json() as Promise<{
      id: string; name: string; locale: string; timezone: string;
    }>,
  });
  const [name, setName] = useState("");
  const save = useMutation({
    mutationFn: async () => fetch("/api/users/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
  if (!data) return null;
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
      className="flex max-w-md flex-col gap-3"
    >
      <h1 className="text-xl font-semibold">프로필</h1>
      <label className="flex flex-col gap-1 text-sm">
        <span>이름</span>
        <input
          defaultValue={data.name}
          onChange={(e) => setName(e.target.value)}
          className="rounded border border-border px-2 py-1"
        />
      </label>
      <button className="self-start rounded bg-foreground px-3 py-1.5 text-sm text-background">저장</button>
    </form>
  );
}
```

Providers / Security / Billing follow the same pattern: fetch, local state, mutation, form. Keep forms minimal; richer billing UI is a later concern.

- [x] **Step 7.4: Commit**

```bash
git add apps/web/src/app/[locale]/settings/ \
        apps/web/src/components/views/account/
git commit -m "feat(web): account settings shell with profile/byok/security/billing"
```

---

## Task 8: Command Palette (`cmdk`)

**Files:** `apps/web/src/components/palette/command-palette.tsx`, `palette-actions.ts`, `palette-search.ts`

- [x] **Step 8.1: Action registry**

```ts
// palette-actions.ts
import { Router } from "next/navigation";

export interface Action {
  id: string;
  label: string;
  keywords?: string[];
  shortcut?: string;
  run(router: ReturnType<typeof useRouter>): void;
}

// import via useMemo; static for now.
export function buildActions(router: any, wsSlug?: string): Action[] {
  const base = wsSlug ? `/ko/app/w/${wsSlug}` : "/ko";
  return [
    { id: "dashboard", label: "대시보드로 이동", run: () => router.push(`${base}/`) },
    { id: "research", label: "Deep Research 허브", run: () => router.push(`${base}/research`) },
    { id: "import", label: "가져오기", run: () => router.push(`${base}/import`) },
    { id: "ws-settings", label: "워크스페이스 설정", run: () => router.push(`${base}/settings`) },
    { id: "profile", label: "프로필", run: () => router.push(`/ko/settings/profile`) },
    { id: "new-project", label: "새 프로젝트 만들기", run: () => router.push(`${base}/new-project`) },
    { id: "toggle-sidebar", label: "사이드바 토글", shortcut: "⌘\\", run: () => {
      // use panel-store directly
      const { usePanelStore } = require("@/stores/panel-store");
      usePanelStore.getState().toggleSidebar();
    }},
    { id: "toggle-agent", label: "에이전트 패널 토글", shortcut: "⌘J", run: () => {
      const { usePanelStore } = require("@/stores/panel-store");
      usePanelStore.getState().toggleAgentPanel();
    }},
  ];
}
```

- [x] **Step 8.2: Search adapter**

```ts
// palette-search.ts
export async function searchNotes(q: string, wsSlug: string): Promise<Array<{ id: string; title: string; kind: string }>> {
  if (!q) return [];
  const r = await fetch(`/api/search/text?q=${encodeURIComponent(q)}&workspace_slug=${wsSlug}`);
  if (!r.ok) return [];
  return (await r.json()).results.slice(0, 20);
}
```

- [x] **Step 8.3: Palette UI**

```tsx
// command-palette.tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Command } from "cmdk";
import { usePaletteStore } from "@/stores/palette-store";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { buildActions } from "./palette-actions";
import { searchNotes } from "./palette-search";

export function CommandPalette() {
  const router = useRouter();
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const isOpen = usePaletteStore((s) => s.isOpen);
  const open = usePaletteStore((s) => s.open);
  const close = usePaletteStore((s) => s.close);
  const query = usePaletteStore((s) => s.query);
  const setQuery = usePaletteStore((s) => s.setQuery);
  const [notes, setNotes] = useState<Array<{ id: string; title: string; kind: string }>>([]);

  useKeyboardShortcut("mod+k", (e) => { e.preventDefault(); open(); });

  useEffect(() => {
    if (!isOpen || !wsSlug) return;
    const id = setTimeout(async () => setNotes(await searchNotes(query, wsSlug)), 120);
    return () => clearTimeout(id);
  }, [query, isOpen, wsSlug]);

  const actions = useMemo(() => buildActions(router, wsSlug), [router, wsSlug]);

  if (!isOpen) return null;

  return (
    <Command.Dialog
      open={isOpen}
      onOpenChange={(o) => (o ? open() : close())}
      label="Command Palette"
      className="fixed left-1/2 top-20 w-[520px] -translate-x-1/2 rounded-lg border border-border bg-background shadow-lg"
    >
      <Command.Input
        value={query}
        onValueChange={setQuery}
        placeholder="무엇을 찾고 있나요?"
        className="w-full border-b border-border bg-transparent px-3 py-3 text-sm outline-none"
        autoFocus
      />
      <Command.List className="max-h-80 overflow-auto p-1">
        <Command.Empty className="p-3 text-xs text-muted-foreground">결과 없음</Command.Empty>
        {notes.length > 0 && (
          <Command.Group heading="노트">
            {notes.map((n) => (
              <Command.Item
                key={n.id}
                onSelect={() => { router.push(`/ko/app/w/${wsSlug}/n/${n.id}`); close(); }}
                className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-sm aria-selected:bg-accent"
              >
                <span className="truncate">{n.title}</span>
                <span className="text-[10px] text-muted-foreground">{n.kind}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        <Command.Group heading="액션">
          {actions.map((a) => (
            <Command.Item
              key={a.id}
              onSelect={() => { a.run(router); close(); }}
              className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-sm aria-selected:bg-accent"
            >
              <span>{a.label}</span>
              {a.shortcut ? <kbd className="text-[10px] text-muted-foreground">{a.shortcut}</kbd> : null}
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
```

- [x] **Step 8.4: Mount globally**

In `shell-providers.tsx` add `<CommandPalette />` at the bottom of the render tree so every route has it mounted.

- [x] **Step 8.5: Commit**

```bash
git add apps/web/src/components/palette/ \
        apps/web/src/components/shell/shell-providers.tsx
git commit -m "feat(web): command palette with search + action registry"
```

---

## Task 9: Notifications API (server)

**Files:** `apps/api/src/routes/notifications.ts`, `stream-notifications.ts`, `apps/api/src/lib/notification-events.ts`, `apps/api/tests/notifications.test.ts`

- [x] **Step 9.1: Event bus**

```ts
// apps/api/src/lib/notification-events.ts
import { EventEmitter } from "node:events";

export type NotificationKind = "mention" | "comment_reply" | "research_complete" | "share_invite" | "system";
export interface Notification {
  id: string;
  userId: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
  createdAt: string;
  seenAt: string | null;
  readAt: string | null;
}

class NotificationBus extends EventEmitter {
  publish(n: Notification) { this.emit(`user:${n.userId}`, n); }
  subscribe(userId: string, handler: (n: Notification) => void) {
    const ch = `user:${userId}`;
    this.on(ch, handler);
    return () => this.off(ch, handler);
  }
}
export const notificationBus = new NotificationBus();
notificationBus.setMaxListeners(1000);
```

- [x] **Step 9.2: Persistence**

Add a DB table `notifications` via the standard migration flow (schema file + auto-numbered migration). Columns: `id uuid pk, user_id text fk users, kind text, payload jsonb, created_at timestamptz default now(), seen_at timestamptz, read_at timestamptz, index on (user_id, created_at desc) where read_at is null`.

Wire `notificationBus.publish` at the existing mutation sites — mentions in `apps/api/src/routes/mentions.ts`, comments in `comments`, research completion in the worker, share invites in invites route. Small `persistAndPublish(notification)` helper lives alongside `notification-events.ts`.

- [x] **Step 9.3: REST + SSE**

```ts
// notifications.ts (GET list + PATCH mark-read)
export const notificationsRoute = new Hono()
  .get("/notifications", async (c) => {
    const session = await requireSession(c);
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, session.userId))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    return c.json({ notifications: rows });
  })
  .patch("/notifications/:id/read", async (c) => {
    const session = await requireSession(c);
    const id = c.req.param("id");
    await db.update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, session.userId)));
    return c.json({ ok: true });
  });
```

```ts
// stream-notifications.ts
export const streamNotificationsRoute = new Hono().get("/stream/notifications", async (c) => {
  const session = await requireSession(c);
  return streamSSE(c, async (stream) => {
    const unsub = notificationBus.subscribe(session.userId, (n) => {
      stream.writeSSE({ event: n.kind, data: JSON.stringify(n) });
    });
    c.req.raw.signal.addEventListener("abort", () => unsub());
    await new Promise<void>((r) => c.req.raw.signal.addEventListener("abort", () => r()));
  });
});
```

- [x] **Step 9.4: Test + commit**

Minimal test: create a mention, see it in `GET /api/notifications`, PATCH mark-read, confirm `read_at` set.

```bash
git add apps/api/src/routes/notifications.ts \
        apps/api/src/routes/stream-notifications.ts \
        apps/api/src/lib/notification-events.ts \
        apps/api/src/routes/index.ts \
        packages/db/ \
        apps/api/tests/notifications.test.ts
git commit -m "feat(api,db): notifications table, rest, and sse stream"
```

---

## Task 10: Notifications drawer (client)

**Files:** `apps/web/src/components/notifications/*`

- [x] **Step 10.1: Hook**

```ts
// use-notifications.ts
"use client";
import { useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";

export function useNotifications() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => (await (await fetch("/api/notifications")).json()).notifications,
  });

  useEffect(() => {
    const src = new EventSource("/api/stream/notifications");
    const invalidate = () => qc.invalidateQueries({ queryKey: ["notifications"] });
    ["mention", "comment_reply", "research_complete", "share_invite", "system"].forEach((e) =>
      src.addEventListener(e, invalidate),
    );
    return () => src.close();
  }, [qc]);

  const markRead = useMutation({
    mutationFn: async (id: string) =>
      fetch(`/api/notifications/${id}/read`, { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return { items: list.data ?? [], markRead };
}
```

- [x] **Step 10.2: Drawer**

```tsx
// notification-drawer.tsx
"use client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useNotifications } from "./use-notifications";
import { NotificationItem } from "./notification-item";

export function NotificationDrawer({ open, onOpenChange }: { open: boolean; onOpenChange(v: boolean): void }) {
  const { items, markRead } = useNotifications();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[360px]">
        <SheetHeader><SheetTitle>알림</SheetTitle></SheetHeader>
        <div className="mt-4 flex flex-col gap-2">
          {items.map((n: any) => (
            <NotificationItem
              key={n.id}
              item={n}
              onClick={() => markRead.mutate(n.id)}
            />
          ))}
          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground">알림이 없습니다.</p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [x] **Step 10.3: Item**

```tsx
// notification-item.tsx
"use client";
export function NotificationItem({ item, onClick }: any) {
  const label = ({
    mention: "멘션", comment_reply: "코멘트 응답", research_complete: "리서치 완료",
    share_invite: "공유 초대", system: "공지",
  } as const)[item.kind as keyof any] ?? item.kind;
  return (
    <button
      onClick={onClick}
      className={`rounded border border-border p-2 text-left text-sm ${item.read_at ? "opacity-60" : ""}`}
    >
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="truncate">{item.payload.summary ?? item.payload.title ?? ""}</p>
      <p className="text-[10px] text-muted-foreground">{new Date(item.created_at).toLocaleString()}</p>
    </button>
  );
}
```

- [x] **Step 10.4: Hook drawer into Sidebar footer**

Edit `sidebar-footer.tsx`: wrap the `🔔` button with state to open `NotificationDrawer` and pass `open`/`onOpenChange`.

- [x] **Step 10.5: Commit**

```bash
git add apps/web/src/components/notifications/ \
        apps/web/src/components/sidebar/sidebar-footer.tsx
git commit -m "feat(web): notifications drawer with SSE live updates"
```

---

## Task 11: i18n parity + cleanup

- [x] **Step 11.1: Extract all Korean literals**

Run:
```bash
pnpm --filter @opencairn/web i18n:parity
```

Expected: `i18next/no-literal-string` failures for all the new Phase 5 views. Move strings to `messages/ko/*.json` and corresponding `messages/en/*.json`. Common namespaces:
- `dashboard.json`, `project.json`, `research.json`, `import.json`, `workspace-settings.json`, `account.json`, `palette.json`, `notifications.json`.

Replace literals in components with `useTranslations(ns)`.

- [x] **Step 11.2: Commit per namespace**

```bash
git add messages/ko/dashboard.json messages/en/dashboard.json apps/web/src/components/views/dashboard/
git commit -m "i18n(web): dashboard strings"
# repeat per namespace
```

---

## Task 12: E2E coverage

**Files:** `apps/web/tests/e2e/palette.spec.ts`, `notifications.spec.ts`, `routes.spec.ts`

- [x] **Step 12.1: Palette spec**

```ts
import { test, expect } from "@playwright/test";
import { loginAsTestUser, seedWorkspaceWithFirstProject } from "./helpers";

test("opens with Ctrl+K, runs dashboard action", async ({ page }) => {
  await loginAsTestUser(page);
  const { slug } = await seedWorkspaceWithFirstProject();
  await page.goto(`/ko/app/w/${slug}/research`);
  await page.keyboard.press("Control+k");
  await expect(page.getByPlaceholder("무엇을 찾고 있나요?")).toBeVisible();
  await page.getByPlaceholder("무엇을 찾고 있나요?").fill("대시보드");
  await page.keyboard.press("Enter");
  await page.waitForURL(new RegExp(`/ko/app/w/${slug}/$`));
});
```

- [x] **Step 12.2: Notifications spec**

```ts
import { test, expect } from "@playwright/test";
import { loginAsTestUser, seedWorkspaceWithFirstProject, insertNotification } from "./helpers";

test("drawer shows inserted notification", async ({ page }) => {
  await loginAsTestUser(page);
  const { slug } = await seedWorkspaceWithFirstProject();
  await insertNotification({ userId: "test-user", kind: "mention", payload: { summary: "@me hello" } });
  await page.goto(`/ko/app/w/${slug}/`);
  await page.getByLabel("알림").click();
  await expect(page.getByText("@me hello")).toBeVisible();
});
```

- [x] **Step 12.3: Route smoke spec**

```ts
import { test, expect } from "@playwright/test";
import { loginAsTestUser, seedWorkspaceWithFirstProject } from "./helpers";

const routes = [
  { path: "/", testid: "route-dashboard" },
  { path: "/research", testid: "route-research-hub" },
  { path: "/import", testid: "route-import" },
  { path: "/settings", testid: "route-ws-settings" },
];

test.describe("Phase 5 routes", () => {
  test.beforeEach(async ({ page }) => loginAsTestUser(page));
  for (const r of routes) {
    test(`renders ${r.path}`, async ({ page }) => {
      const { slug } = await seedWorkspaceWithFirstProject();
      await page.goto(`/ko/app/w/${slug}${r.path}`);
      await expect(page.getByTestId(r.testid)).toBeVisible();
    });
  }

  test("account settings profile", async ({ page }) => {
    await page.goto("/ko/settings/profile");
    await expect(page.getByText("프로필")).toBeVisible();
  });
});
```

- [x] **Step 12.4: Commit**

```bash
git add apps/web/tests/e2e/palette.spec.ts \
        apps/web/tests/e2e/notifications.spec.ts \
        apps/web/tests/e2e/routes.spec.ts
git commit -m "test(web): e2e palette, notifications, and route smokes"
```

---

## Task 13: Post-feature

- [x] **Step 13.1: Full suite**

```bash
pnpm --filter @opencairn/api test
pnpm --filter @opencairn/web test
pnpm --filter @opencairn/web test:e2e
pnpm --filter @opencairn/web i18n:parity
pnpm --filter @opencairn/web typecheck
pnpm --filter @opencairn/web lint
```

- [x] **Step 13.2: Plans-status + memory + commit**

Mark Plan Phase 5 complete. Record HEAD SHA. Write memory entry.

```bash
git add docs/contributing/plans-status.md
git commit -m "docs(docs): mark app shell phase 5 complete"
```

---

## Completion Criteria

- [x] Dashboard renders 4 stats + active research + recent docs
- [x] Project view filters between all/imported/research/manual
- [x] Research hub shows status tabs + run cards; run route renders stub dispatching on status
- [x] Import wizard covers 2 steps (source → project)
- [x] Workspace admin has 5 subtabs routed
- [x] Account shell (`/settings/*`) renders outside AppShell
- [x] `⌘K` opens palette; action and note selection work
- [x] `🔔` opens drawer; SSE pushes a new notification live
- [x] Full e2e across palette/notifications/routes passes
- [x] All user-facing strings live in `messages/{ko,en}/*.json`
- [x] Manual smoke: round-trip every URL in spec §3.1

## What's NOT in this plan

| Item | Where |
|------|-------|
| Deep Research run lifecycle UI (planning/awaiting_approval/researching/completed/failed bodies) | Deep Research Phase D |
| Real shared-links / trash / billing UIs (stubs here) | Plan 2C / Plan 9b (billing) |
| Account-level session revocation, 2FA | Out of scope v1 |
| Full palette action catalog (slash commands, AI toolbelt) | Plan 11A + Plan Agent UX Specs |
| Multi-select sidebar + bulk-op palette entries | Follow-up |
