# URL Restructure + Centralized URL Builder

**Date:** 2026-04-30
**Status:** Draft → 구현 대기
**Owner:** apps/web (frontend), apps/api (피영향)

## Problem

현재 워크스페이스 라우트 구조가 cryptic 약자 + 중첩 prefix로 가독성이 떨어진다.

```
/{locale}/app/w/{wsSlug}/p/{projectId}/notes/{noteId}
```

- `/app/`은 무의미한 namespace (전체 앱이 이미 이 도메인 안)
- `w/`, `p/`, `n/`은 한 글자 약자로 자명하지 않음
- 워크스페이스 slug가 짧을 때 `/app/w/work` 같이 중복처럼 읽힘

또한 `/app/w/...` 템플릿 리터럴이 **85파일·162곳**에 흩뿌려져 있어 다음 rename은 같은 비용을 또 치러야 한다. URL 빌더가 없는 게 근본 원인.

## Goal

1. URL을 자명한 단어로 — `/{locale}/workspace/{slug}/project/{id}/note/{nid}`
2. 다음 rename은 **한 파일** 수정으로 끝나도록 중앙 빌더(`apps/web/src/lib/urls.ts`)로 흡수
3. 기존 북마크/공유링크는 301 redirect로 한 릴리스 유지

## Non-Goals

- Notion-style flat (`/{slug}/...`) 채택
- account vs workspace settings tree 통합 정리
- dashboard 라우트와 workspace 사이드바 정합 재설계
- 워크스페이스 slug 자체 형식 변경

위 항목은 별도 plan에서 검토.

## URL Map

### Workspace 라우트 (`/app/w/` → `/workspace/`)

| 현재 | 변경 |
|---|---|
| `/{locale}/app/w/{slug}` | `/{locale}/workspace/{slug}` |
| `/{locale}/app/w/{slug}/(shell)/n/{noteId}` | `/{locale}/workspace/{slug}/(shell)/note/{noteId}` |
| `/{locale}/app/w/{slug}/(shell)/p/{projectId}` | `/{locale}/workspace/{slug}/(shell)/project/{projectId}` |
| `/{locale}/app/w/{slug}/(shell)/p/{projectId}/{agents,graph,learn,chat-scope}` | `/{locale}/workspace/{slug}/(shell)/project/{projectId}/{...}` |
| `/{locale}/app/w/{slug}/(shell)/p/{projectId}/learn/{flashcards,scores,socratic}` | `/{locale}/workspace/{slug}/(shell)/project/{projectId}/learn/{...}` |
| `/{locale}/app/w/{slug}/(shell)/{research,settings,synthesis-export,chat-scope}` | `/{locale}/workspace/{slug}/(shell)/{...}` (rest path 그대로) |
| `/{locale}/app/w/{slug}/{import,new-project}` | `/{locale}/workspace/{slug}/{...}` |
| `/{locale}/app/w/{slug}/p/{projectId}/notes/{noteId}` | `/{locale}/workspace/{slug}/project/{projectId}/note/{noteId}` (단수 통일) |

### App-level 라우트 (`/app/` 제거)

| 현재 | 변경 |
|---|---|
| `/{locale}/app/dashboard` | `/{locale}/dashboard` |
| `/{locale}/app/settings/ai` | `/{locale}/settings/ai` (account tree로 합침) |
| `/{locale}/app/settings/mcp` | **삭제** (`/{locale}/settings/mcp` 이미 존재) |
| `/{locale}/app/page.tsx` (=`/app`) | 삭제 + redirect → `/{locale}/dashboard` |

### 단수/복수 통일

`p/{id}/notes/{nid}` 만 `note`로 단수화. 다른 nested route(`learn/flashcards/`, `learn/scores/` 등)는 의미상 컬렉션이라 그대로.

## Centralized URL Builder

`apps/web/src/lib/urls.ts` 신설. 모든 web 코드는 이 모듈만 호출.

### API 스케치

```ts
// apps/web/src/lib/urls.ts
export const urls = {
  // App-level
  dashboard: (locale: string) => `/${locale}/dashboard`,
  onboarding: (locale: string) => `/${locale}/onboarding`,

  // Account settings
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
    root: (locale: string, ws: string) => `/${locale}/workspace/${ws}`,
    note: (locale: string, ws: string, noteId: string) =>
      `/${locale}/workspace/${ws}/note/${noteId}`,
    project: (locale: string, ws: string, pid: string) =>
      `/${locale}/workspace/${ws}/project/${pid}`,
    projectNote: (locale: string, ws: string, pid: string, nid: string) =>
      `/${locale}/workspace/${ws}/project/${pid}/note/${nid}`,
    projectAgents: (locale, ws, pid) => `/${locale}/workspace/${ws}/project/${pid}/agents`,
    projectGraph: (locale, ws, pid) => `/${locale}/workspace/${ws}/project/${pid}/graph`,
    projectLearn: (locale, ws, pid) => `/${locale}/workspace/${ws}/project/${pid}/learn`,
    projectLearnFlashcards: (locale, ws, pid) => `/${locale}/workspace/${ws}/project/${pid}/learn/flashcards`,
    projectLearnFlashcardsReview: (locale, ws, pid) => `/${locale}/workspace/${ws}/project/${pid}/learn/flashcards/review`,
    projectLearnScores: (locale, ws, pid) => `/${locale}/workspace/${ws}/project/${pid}/learn/scores`,
    projectLearnSocratic: (locale, ws, pid) => `/${locale}/workspace/${ws}/project/${pid}/learn/socratic`,
    projectChatScope: (locale, ws, pid) => `/${locale}/workspace/${ws}/project/${pid}/chat-scope`,
    chatScope: (locale, ws) => `/${locale}/workspace/${ws}/chat-scope`,
    research: (locale, ws) => `/${locale}/workspace/${ws}/research`,
    researchRun: (locale, ws, runId) => `/${locale}/workspace/${ws}/research/${runId}`,
    settings: (locale, ws) => `/${locale}/workspace/${ws}/settings`,
    settingsSection: (locale, ws, ...slug: string[]) =>
      `/${locale}/workspace/${ws}/settings/${slug.join("/")}`,
    synthesisExport: (locale, ws) => `/${locale}/workspace/${ws}/synthesis-export`,
    import: (locale, ws) => `/${locale}/workspace/${ws}/import`,
    importJob: (locale, ws, jobId) => `/${locale}/workspace/${ws}/import/jobs/${jobId}`,
    newProject: (locale, ws) => `/${locale}/workspace/${ws}/new-project`,
  },

  // Public
  share: (token: string) => `/s/${token}`, // locale-less by design
} as const;
```

### Path 파서 (역방향)

`apps/web/src/lib/url-parsers.ts` (또는 기존 `palette/extract-ws-slug.ts`를 흡수해서 일반화):

```ts
export function parseWorkspacePath(pathname: string): {
  locale: string | null;
  wsSlug: string | null;
  projectId: string | null;
  noteId: string | null;
} { /* ... */ }
```

기존 `useScopeContext`, `extract-ws-slug.ts`가 이 함수를 사용.

### ESLint 회귀 차단

`apps/web/.eslintrc` (또는 flat config)에 룰 추가:

```js
"no-restricted-syntax": [
  "error",
  {
    selector: "Literal[value=/^\\/[a-z]{2}\\/(app\\/w\\/|app\\/dashboard|app\\/settings\\/|workspace\\/)/]",
    message: "Use urls.* helper from @/lib/urls instead of hardcoded paths",
  },
  {
    selector: "TemplateElement[value.raw=/\\/app\\/w\\/|\\/workspace\\//]",
    message: "Use urls.* helper from @/lib/urls instead of hardcoded paths",
  },
],
```

(테스트 픽스처는 예외 처리 필요 — `tests/e2e/*` glob에서 룰 비활성.)

## Reserved Slugs

`apps/web/src/lib/slug.ts` + `apps/api/src/routes/workspaces.ts`의 `RESERVED_SLUGS`에 추가:

- `workspace`
- `dashboard`
- `project`
- `note`

기존(`app, api, admin, auth, www, assets, static, public, health, onboarding, settings, billing, share, invite, invites, help, docs, blog`)과 합치면 호환.

### DB 사전 점검

마이그 0040 작성 전 dev/prod DB에서:

```sql
SELECT id, slug FROM workspaces
WHERE slug IN ('workspace', 'dashboard', 'project', 'note');
```

- 0건 → 마이그레이션 스킵, 코드만 업데이트
- ≥1건 → 마이그 0040에서 충돌 워크스페이스 slug에 `-renamed-{shortid}` 접미사 부여 + 영향 받은 사용자 알림 메일 (`packages/emails`의 새 템플릿 또는 admin이 수동 처리)

## 301 Redirects

`apps/web/next.config.mjs`의 `async redirects()`:

```js
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
```

순서 중요: `notes/:nid` 룰이 `:rest*` 룰보다 먼저. `p/:pid/:rest*` 룰이 워크스페이스 일반 룰보다 먼저.

**Sunset:** 2026-05-14 (2주 후) redirect 블록 제거 PR을 `/schedule`로 박제.

## i18n

URL path는 영문 고정이라 `messages/{locale}/*.json`은 영향 없음. 다만 다음을 점검:

- `messages/ko/`·`messages/en/` 안에 `/app/w/`·`/app/dashboard/` 같은 path 리터럴이 우연히 박혀있는지 grep
- 라벨("워크스페이스 설정 보기" 등)은 그대로 유효

## Migration 순서

1. **urls.ts + 단위 테스트** (DRY 도구 먼저, 회귀 베이스라인)
2. **Reserved slug DB 점검** → 필요 시 마이그 0040 작성
3. **디렉토리 이동** — `git mv`로 history 보존
   - `app/[locale]/app/w/[wsSlug]/` → `app/[locale]/workspace/[wsSlug]/`
   - `(shell)/n/` → `(shell)/note/`
   - `(shell)/p/` → `(shell)/project/`
   - `p/[projectId]/notes/` → `project/[projectId]/note/`
   - `app/[locale]/app/dashboard/` → `app/[locale]/dashboard/`
   - `app/[locale]/app/settings/ai/` → `app/[locale]/settings/ai/`
   - `app/[locale]/app/settings/mcp/` → 삭제 (dupe)
   - `app/[locale]/app/page.tsx` → 삭제 (redirect로 대체)
4. **Hardcoded path sweep** — 162곳을 `urls.*`로 치환 (codemod 후 수동 보정)
5. **Path parser 업데이트** — `useScopeContext`, `extract-ws-slug.ts` + 단위 테스트
6. **next.config.mjs redirects** 추가
7. **ESLint 룰** 추가 + `pnpm lint` 통과 확인
8. **E2E sweep** — 86곳 path 업데이트, `pnpm test:e2e` 통과
9. **외부 노출 URL 점검**
   - `packages/emails` invite/notification 템플릿
   - `apps/api/src/routes/integrations.ts`·`workspaces.ts`의 redirect_to URL 빌드
   - `apps/api/src/routes/users.ts`·`internal.ts` 동일
10. **dev 띄워서 user-facing 1-call 직접 검증** (memory rule: completion claims discipline)
    - `/ko/dashboard` 200
    - `/ko/workspace/{slug}` 200
    - `/ko/workspace/{slug}/note/{noteId}` 200
    - `/ko/app/w/{slug}` → 301 → `/ko/workspace/{slug}` (redirect 동작)
11. **변경사항 박제** — `docs/contributing/plans-status.md` + `CLAUDE.md` Hierarchy 섹션 업데이트

## Risks

- **OAuth callback URL**: provider 콘솔 등록 URL은 `/api/...` 콜백 (예: `/api/integrations/google/callback`)으로 web 라우트가 아니라 영향 없음. **점검만**.
- **이메일 invite/공유 링크**: `packages/emails` 템플릿에 박힌 URL이 있을 수 있음. sweep 9번에 포함.
- **Bookmarks/share links 외부 유입**: 301로 한 릴리스 흡수.
- **Reserved slug 추가로 기존 워크스페이스 깨짐**: DB 사전 점검(2번)으로 차단.
- **next.config 리다이렉트 순서 버그**: 순서 의존적이라 테스트 필요. E2E에 redirect 검증 케이스 추가.
- **codemod 부작용**: 템플릿 리터럴 치환 시 변수명이 다른 경우(예: `wsId` vs `slug`) 컴파일 에러 → 수동 보정 비용. `tsc` + ESLint로 잡는다.

## Test Strategy

- **단위**: `urls.ts` 모든 helper에 대한 snapshot test (locale ko/en × ws/project/note 조합).
- **단위**: `parseWorkspacePath`에 대한 round-trip test (urls.* output → parser → 동일한 컴포넌트 복원).
- **E2E**: 기존 86곳 path 업데이트. 추가로 `tests/e2e/url-redirects.spec.ts` 신설:
  - 옛 path 5종 → 새 path 301 검증
  - 옛 path가 다른 locale에서도 redirect 되는지
- **수동**: dev 서버에서 user-facing 1-call (memory rule).

## Out of Scope (재확인)

- Notion-style flat (`/{slug}/...`)
- settings tree 통합 정리 (account vs workspace)
- dashboard ↔ workspace 사이드바 정합
- 워크스페이스 slug 형식 변경

## Sunset Schedule

- **2026-04-30**: 본 PR 머지, 301 redirect 활성
- **2026-05-14**: redirect 블록 제거 PR (`/schedule` 박제)

---

**다음 단계:** `superpowers:writing-plans` skill로 실행 plan 생성.
