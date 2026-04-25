# Super Admin Console — Operator Dashboard for Abuse Response

**Status:** Draft (2026-04-22)
**Owner:** Sungbin
**Related:**
- [security-model.md](../../architecture/security-model.md) — 인증/세션/감사 로그 규칙
- [collaboration-model.md](../../architecture/collaboration-model.md) — workspace 권한 (본 spec은 *플랫폼* 권한, 별개)
- [api-contract.md](../../architecture/api-contract.md) — 에러 코드, 404 은닉 규칙
- [incident-response.md](../../runbooks/incident-response.md) — 알럿 → 콘솔로 진입
- 레퍼런스: Supabase/Vercel 내부 admin, Notion operator tools (공개 정보 범위)

## Dependencies

- **Plan 1** — Better Auth + `user` 테이블 (여기에 `role` 컬럼 추가)
- **Plan 12** — `agent_runs` 테이블 (status/cost/error 감시)
- **Plan 9b (BLOCKED)** — 결제/PAYG 데이터가 없는 상태에서 MVP 설계. Plan 9b 완료 후 v2에서 결제 탭 추가.
- **Workspace admin UI** — 본 spec과 별개. Plan 2C에 흡수됨 (`plans-status.md` §Phase 1).

---

## 1. Problem

OpenCairn이 공개되는 즉시 서비스 운영자(= 본인)가 필요한 **최소한의 이상 사용자 대응 도구**가 없다. 현재 상태:

1. **이상 가입자 차단 수단 없음** — 스팸/봇 가입, 악성 프롬프트 반복 실행자를 `psql`로만 처리 가능
2. **워크스페이스 강제 삭제 수단 없음** — 약관 위반 공개 링크, 저작권 침해 노트를 내리려면 SQL 직접 실행
3. **최근 가입자/활성 계정 감시 UI 없음** — 정상/비정상 감별 근거 부족
4. **슈퍼어드민 권한 모델 자체가 없음** — `user.plan` 외에 "운영자" 역할 없음. `psql` 접근만 = 감사 로그 없음
5. **운영 행동이 감사되지 않음** — 본인이 한 수동 개입도 기록되어야 (법적 분쟁 대비)

**이 spec은 v0.1의 MVP만 다룬다.** 결제·impersonation·성장 지표 대시보드는 후속.

## 2. Goals & Non-Goals

**Goals (v0.1)**
- `user.role = 'super_admin'` 단일 플래그 + 플랫폼 레벨 가드 미들웨어
- `/admin` 라우트 세그먼트 (Next.js), 비 super_admin은 404
- **사용자 목록**: 검색(이메일/ID) + 상태별 필터 + 최근 가입 정렬
- **사용자 정지/해제**: suspend 플래그 → 로그인·API 호출 차단
- **사용자 삭제**: soft delete 30일 유예 후 hard delete (GDPR)
- **워크스페이스 목록**: 최근 생성/활성 순 + 검색
- **워크스페이스 강제 삭제**: soft delete + cascade 예약 (DLQ 아님)
- **감사 로그**: 모든 super_admin 액션 `admin_audit_log` 테이블에 기록
- **하드닝**: super_admin 엔드포인트에 step-up re-auth (최근 10분 내 비밀번호 재확인)

**Non-goals (v0.1)**
- **Impersonation** — 보안/감사 부담 큼. 별도 spec (v0.2+)
- **결제 수동 조정 / 환불** — Plan 9b 완료 후 추가
- **성장 대시보드 (DAU/리텐션)** — 데이터 쌓인 후. B/C 플로우는 별도 spec
- **에이전트 run 재시도 UI** — DLQ 작업은 CLI로 충분 (`pnpm dlq:retry`)
- **공지/브로드캐스트 발송** — v0.2+
- **모든 사용자 토큰 사용량 집계** — v0.2+ (Plan 9b 과금 데이터 붙은 뒤)
- **역할 세분화** (support / readonly admin / billing admin 등) — v1.0
- **다국어** — 운영자는 본인 1명, **ko only**. 영어 라벨은 필요할 때 추가 (non-blocking)

## 3. 권한 모델

### 3.1 `user.role`

```ts
// packages/db/src/schema/enums.ts (신규)
export const userRoleEnum = pgEnum("user_role", ["user", "super_admin"]);

// packages/db/src/schema/users.ts
role: userRoleEnum("role").notNull().default("user"),
```

- 기본값 `"user"`. 수동 UPDATE로 부여 (배포 직후 `UPDATE user SET role='super_admin' WHERE email='kss19558@gmail.com';`)
- **자동 부여 없음** — 첫 가입자 자동 super_admin 같은 로직 금지 (셀프호스트 환경에서 첫 사용자 = 운영자라는 가정은 공용 SaaS에선 보안 구멍)
- self-host에선 env `SUPER_ADMIN_EMAIL`로 지정 가능, 일치하는 이메일이 가입·검증되면 마이그레이션에서 role 승격 (별도 스크립트, 자동 승격 아님)

### 3.2 가드

```ts
// apps/api/src/middleware/require-super-admin.ts
export function requireSuperAdmin() {
  return createMiddleware(async (c, next) => {
    const user = c.get("user");  // requireAuth에서 주입됨
    if (!user || user.role !== "super_admin") {
      // 권한 없음이 아니라 존재 은닉 — 경로 자체가 없는 것처럼
      return c.json({ error: "not_found" }, 404);
    }
    await next();
  });
}
```

- **404 반환** (`api-contract.md §에러코드` 규칙: 권한 없으면 존재 은닉)
- **`resolveRole`과 별개 축**: workspace 권한 검사는 여전히 필요. super_admin이라도 다른 사용자의 페이지를 *일반 채널로* 읽지 않음 (읽으려면 admin 전용 엔드포인트를 통해서만, 감사 로그 남김)

### 3.3 Step-up re-auth

super_admin 엔드포인트는 **최근 10분 내 비밀번호 재확인** 없으면 401.

```ts
// 세션에 lastStepUpAt 추가 (세션 메타)
if (!session.lastStepUpAt || Date.now() - session.lastStepUpAt > 10 * 60 * 1000) {
  return c.json({ error: "step_up_required" }, 401);
}
```

- 프론트는 401 `step_up_required` 수신 → 모달로 비밀번호 재입력 요구
- OAuth-only 계정 대응: 재입력 대신 최근 Google OAuth 재인증 (5분 이내 `reauth`) 요구
- `/admin` 라우트 진입 시에도 step-up 검증. 실패 시 재확인 페이지로 리다이렉트.

### 3.4 왜 workspace admin과 **다른 축**인가

Workspace admin은 **팀 내부 역할**(owner/admin/member/guest), Super admin은 **플랫폼 전체 운영자**. 둘을 한 테이블에서 섞으면 권한 확대 버그가 생김. 예: workspace admin이 `canAdmin` 통과 후 실수로 super_admin 엔드포인트 하나가 workspace 컨텍스트로 보호되면 타인 워크스페이스 조작 가능. 완전 분리.

## 4. UI 구조

### 4.1 라우트

```
apps/web/src/app/[locale]/admin/
  layout.tsx           — super_admin 가드 + step-up 체크 + 공용 네비
  page.tsx             — /admin 대시보드 (요약 카드 3개)
  users/
    page.tsx           — 사용자 목록
    [id]/page.tsx      — 사용자 상세 + 액션
  workspaces/
    page.tsx           — 워크스페이스 목록
    [id]/page.tsx      — 워크스페이스 상세 + 액션
  audit/
    page.tsx           — 감사 로그
```

- `/admin`은 `[locale]` 하위이나 **번역 파일은 ko만** 작성. en은 키만 추가 (`TODO`로 두고 parity CI 예외 처리: `messages/en/admin.json`은 parity 검사 제외 목록에 추가)
- 내부 사용자만 접근, SEO robots=noindex (layout에서 `<meta name="robots" content="noindex, nofollow" />`)

### 4.2 대시보드 (`/admin`)

3개 카드만:

| 카드 | 내용 | 소스 |
|---|---|---|
| **최근 24h 가입자** | N명, 최근 5명 리스트 (email, createdAt) 링크 | `user.createdAt > now() - 24h` |
| **정지 중인 사용자** | N명, 링크 → `/admin/users?status=suspended` | `user.suspendedAt IS NOT NULL` |
| **실패한 agent_runs (24h)** | N건, 에러 클래스 top 3 | `agent_runs.status='failed' AND startedAt > now() - 24h` |

차트·시계열 없음. 숫자 + 링크뿐. 운영자가 여기서 필터 페이지로 이동해 작업.

### 4.3 사용자 목록 (`/admin/users`)

- **검색**: 이메일 / user_id / 이름 (ILIKE + trigram index)
- **필터**: `status` (active | suspended | deleted), `plan` (free | pro | byok), `emailVerified`
- **정렬**: createdAt desc (기본), 최근 활동 desc
- **테이블 컬럼**: email · plan · status · createdAt · lastActiveAt · 워크스페이스 수 · [상세]
- **페이지네이션**: keyset (createdAt, id)

`lastActiveAt`는 session table의 마지막 활동 타임스탬프. 없으면 `-`.

### 4.4 사용자 상세 (`/admin/users/:id`)

섹션:

1. **Profile** — email, name, image, plan, role, emailVerified, createdAt, suspendedAt, deletedAt (read-only)
2. **Workspaces** — 이 사용자가 owner인 워크스페이스 목록 + 멤버인 워크스페이스 수
3. **최근 agent_runs** — 최근 20건 (agent_name, status, duration, cost_krw)
4. **BYOK 상태** — 키 등록 여부 (존재/미존재만, 복호화 없음. 버튼 "키 강제 삭제" 제공)
5. **액션**
   - `정지` — `suspendedAt = now()` 세팅. 활성 세션 전체 무효화. 사유 입력 필수 (감사 로그)
   - `정지 해제` — `suspendedAt = NULL`
   - `삭제 예약` — `deletedAt = now()` 세팅. 30일 후 hard delete Temporal cron. 사유 입력 필수
   - `삭제 취소` — `deletedAt = NULL` (30일 이내에만)
   - `BYOK 키 강제 삭제` — ciphertext/iv/version = NULL

**Plan 변경·이메일 변경은 v0.1 범위 외.** 결제 붙으면 플랜 변경 추가.

### 4.5 워크스페이스 목록 / 상세

목록: name, slug, ownerEmail, memberCount, createdAt, noteCount, status

상세: 소유자, 멤버 목록 (readonly), 노트 수, 최근 활성, 액션:
- `격리(quarantine)` — public share 즉시 비활성화 + `isQuarantined=true`. 멤버는 로그인은 가능하나 편집 차단
- `삭제 예약` — 30일 유예 후 cascade hard delete
- `삭제 취소` — 30일 이내에만

멤버·노트 *본문* 조회는 이 콘솔에서 제공하지 않음 (감사 사유). 수사/법 집행 요청 시 별도 스크립트로 export, 이 스크립트도 감사 로그.

### 4.6 감사 로그 (`/admin/audit`)

- 테이블: actorEmail · action · targetType · targetId · reason · createdAt
- 필터: actorEmail, action, targetType, 기간
- **자신의 액션도 표시** (super_admin이 자기 자신을 지울 순 없게 가드 따로)
- **Export**: CSV 다운로드 (법적 요청 대응)

## 5. Data Model

### 5.1 `user` 테이블 확장

```ts
// packages/db/src/schema/users.ts
export const user = pgTable("user", {
  // ...existing...
  role: userRoleEnum("role").notNull().default("user"),
  suspendedAt: timestamp("suspended_at"),
  suspendedReason: text("suspended_reason"),
  deletedAt: timestamp("deleted_at"),
  deletedReason: text("deleted_reason"),
  lastActiveAt: timestamp("last_active_at"),  // 세션 활동 시 갱신 (기존 session table 있으면 생략)
});
```

Index: `idx_user_status_created` on `(suspendedAt IS NOT NULL, createdAt DESC)` — 대시보드 카드 쿼리.

### 5.2 `workspaces` 테이블 확장

```ts
export const workspaces = pgTable("workspaces", {
  // ...existing...
  quarantinedAt: timestamp("quarantined_at"),
  quarantinedReason: text("quarantined_reason"),
  deletedAt: timestamp("deleted_at"),
  deletedReason: text("deleted_reason"),
});
```

### 5.3 `admin_audit_log` (신규)

```ts
export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorId: text("actor_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    actorEmail: text("actor_email").notNull(),  // denormalize — actor 삭제 시도에도 로그 보존
    action: text("action").notNull(),           // 'user.suspend' | 'user.delete' | 'workspace.quarantine' | ...
    targetType: text("target_type").notNull(),  // 'user' | 'workspace'
    targetId: text("target_id").notNull(),
    reason: text("reason"),
    metadata: jsonb("metadata"),                // before/after diff (민감 필드 마스킹)
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("admin_audit_actor_idx").on(t.actorId, t.createdAt.desc()),
    index("admin_audit_target_idx").on(t.targetType, t.targetId),
  ],
);
```

- `actorId`는 `onDelete: "restrict"` — super_admin 삭제 시도 시 FK가 막음 (강제 삭제는 별도 스크립트 + 이 로그도 아카이브)
- **retention**: 무제한 보관 (작은 테이블, 법적 분쟁 대비)
- **개인 정보**: reason/metadata에 BYOK key / 세션 토큰 / 노트 본문 절대 금지. `security-model.md §9` 규칙 준수

### 5.4 Session 무효화

suspend 시점에 해당 유저의 모든 세션을 DB에서 삭제. Better Auth session table 직접 DELETE:

```sql
DELETE FROM session WHERE user_id = $1;
```

Hocuspocus WebSocket은 세션 쿠키 재검증에서 실패 → `reload` 이벤트로 연결 끊김.

## 6. API Surface

모든 경로 `/api/admin/*`. 전역 미들웨어: `requireAuth` → `requireSuperAdmin` → `requireStepUp`.

### 6.1 엔드포인트

| Method | Path | 설명 | Body | Audit action |
|---|---|---|---|---|
| GET | `/api/admin/summary` | 대시보드 3카드 숫자 | - | - |
| GET | `/api/admin/users` | 목록 + 검색/필터 | query params | - |
| GET | `/api/admin/users/:id` | 상세 | - | - |
| POST | `/api/admin/users/:id/suspend` | 정지 | `{ reason }` | `user.suspend` |
| POST | `/api/admin/users/:id/unsuspend` | 해제 | `{ reason }` | `user.unsuspend` |
| POST | `/api/admin/users/:id/delete` | 삭제 예약 | `{ reason }` | `user.delete` |
| POST | `/api/admin/users/:id/undelete` | 취소 | `{ reason }` | `user.undelete` |
| POST | `/api/admin/users/:id/byok/reset` | BYOK 키 리셋 | `{ reason }` | `user.byok_reset` |
| GET | `/api/admin/workspaces` | 목록 | query | - |
| GET | `/api/admin/workspaces/:id` | 상세 | - | - |
| POST | `/api/admin/workspaces/:id/quarantine` | 격리 | `{ reason }` | `workspace.quarantine` |
| POST | `/api/admin/workspaces/:id/unquarantine` | 해제 | `{ reason }` | `workspace.unquarantine` |
| POST | `/api/admin/workspaces/:id/delete` | 삭제 예약 | `{ reason }` | `workspace.delete` |
| POST | `/api/admin/workspaces/:id/undelete` | 취소 | `{ reason }` | `workspace.undelete` |
| GET | `/api/admin/audit` | 감사 로그 | query | - |
| GET | `/api/admin/audit/export.csv` | CSV export | query | `audit.export` |

### 6.2 Zod 스키마 (공통)

```ts
// packages/shared/src/schemas/admin.ts
export const adminActionSchema = z.object({
  reason: z.string().min(1).max(500),  // 감사 사유 필수
});

export const adminUserListQuerySchema = z.object({
  q: z.string().optional(),
  status: z.enum(["active", "suspended", "deleted"]).optional(),
  plan: z.enum(["free", "pro", "byok"]).optional(),
  emailVerified: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
```

### 6.3 감사 로그 자동 기록

```ts
// apps/api/src/middleware/audit-admin.ts
export function auditAdmin(action: string, targetType: "user" | "workspace") {
  return createMiddleware(async (c, next) => {
    await next();  // 먼저 실행, 성공해야 기록
    if (c.res.status >= 400) return;  // 실패 건은 별도 로그 경로
    const user = c.get("user");
    const targetId = c.req.param("id");
    const body = await c.req.json();
    await db.insert(adminAuditLog).values({
      actorId: user.id,
      actorEmail: user.email,
      action,
      targetType,
      targetId,
      reason: body.reason,
      ipAddress: c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip"),
      userAgent: c.req.header("user-agent"),
    });
  });
}
```

**실패한 시도도 기록 필요** — 별도 경로로 `action: 'user.suspend.failed'` 같은 형식 추가 (운영자의 실수/공격 시도 추적). v0.1은 성공만, v0.2에 추가.

## 7. Temporal 배치

### 7.1 Hard delete (30일 후)

```python
# apps/worker/src/workflows/admin_hard_delete.py
@workflow.defn
class AdminHardDeleteScheduled:
    @workflow.run
    async def run(self) -> None:
        # 매일 03:00 (KST) 실행
        # user.deletedAt < now() - 30 days → cascade hard delete
        # workspace.deletedAt < now() - 30 days → cascade hard delete
        ...
```

Temporal Schedule (cron) 로 등록. 감사 로그엔 `user.hard_delete` / `workspace.hard_delete` + `actor = system`.

### 7.2 Suspend 시 세션 무효화

API 응답 전에 sync 수행 (Temporal 필요 없음. DELETE 한 방).

## 8. 보안 고려

| 위협 | 완화 |
|---|---|
| super_admin 세션 탈취 → 대규모 조작 | step-up re-auth 10분 + 쿠키 HttpOnly/Secure/SameSite=Strict (일반 세션보다 엄격) |
| super_admin 자신을 suspend/delete | DB 제약: `actor_id == target_id` 차단. 또한 super_admin 전체 카운트 < 2면 role 박탈 차단 |
| 권한 상승 (user → super_admin) | role 변경 엔드포인트 *없음*. SQL 직접 또는 `SUPER_ADMIN_EMAIL` env 일치 마이그레이션만 |
| 감사 로그 위조 | `admin_audit_log`는 INSERT-only. UPDATE/DELETE 권한 미부여 (DB role 분리). 앱 코드에서 UPDATE 호출 자체 없음 |
| CSRF | 일반 API와 동일. 추가로 super_admin 엔드포인트는 Origin 헤더 엄격 검증 (admin 도메인 분리 고려) |
| 내부자 위협 | 감사 로그 + 주간 본인 리뷰 (v1.0) |
| IP 제한 | v0.1 없음. v0.2에 `SUPER_ADMIN_ALLOWED_IPS` env 옵션 추가 |

### 8.1 감사 로그의 신뢰성

**DB 레벨에서 INSERT-only 강제**:

```sql
-- 별도 DB role 'app_admin' 생성
REVOKE UPDATE, DELETE ON admin_audit_log FROM app_admin;
GRANT INSERT, SELECT ON admin_audit_log TO app_admin;
```

일반 앱은 `app_main` role (UPDATE/DELETE 가능), admin 라우트 핸들러는 `app_admin` role로 connection pool 분리. v0.1 범위 — 구현 복잡. v0.2에서 필수. v0.1은 앱 코드 리뷰로만 강제.

### 8.2 정지된 사용자의 API 동작

`requireAuth` 미들웨어가 session lookup 시 `user.suspendedAt IS NOT NULL`이면 401 + 세션 무효화 메시지. 로그인 폼도 차단.

Hocuspocus: `onAuthenticate` hook이 suspend 체크 → 연결 거부.

### 8.3 `SUPER_ADMIN_EMAIL` 환경변수

- **프로덕션**: 단일 이메일. 해당 사용자가 가입+이메일 검증 완료 시 최초 1회 role 자동 승격 (마이그레이션 스크립트 `apps/api/scripts/grant-initial-super-admin.ts`, 수동 실행)
- **Self-host**: 동일 메커니즘. 셀프호스트 운영자가 자기 이메일 지정
- **테스트**: 무관 (fixture로 직접 INSERT)

## 9. i18n

- **MVP는 ko only**. `apps/web/messages/ko/admin.json` 신규 생성
- `apps/web/messages/en/admin.json`은 빈 파일로 생성 (`{}`) + parity CI 예외
- Next-intl 설정에 `namespaces: ["admin"]` 추가, `locales: ["ko"]`로 제한하는 옵션 없으니 라우트 레벨에서 ko 아닌 locale은 404

```ts
// apps/web/src/app/[locale]/admin/layout.tsx
export default async function AdminLayout({ params, children }) {
  const { locale } = await params;
  if (locale !== "ko") notFound();  // 영어 admin 라우트 자체 차단
  // ...super_admin 가드
}
```

- `eslint-plugin-i18next/no-literal-string` 는 `src/app/[locale]/admin/**` 디렉터리에선 **완화** (`overrides`) — 운영 전용이라 번역 키 생성 비용 > 이득

## 10. Anti-patterns

| 하지 말 것 | 왜 |
|---|---|
| super_admin이 일반 워크스페이스 API로 타인 데이터 조회 | 일반 경로는 감사 로그 없음. 반드시 `/api/admin/*` 경유 |
| `resolveRole` 내부에서 super_admin 자동 승인 | workspace 권한 모델이 오염됨. 두 축 분리 유지 |
| 첫 가입자 자동 super_admin 승격 | SaaS 배포 직후 악용 (봇이 먼저 가입). 명시적 env 또는 SQL만 |
| 감사 로그를 앱 일반 로깅 (Sentry 등)으로 대체 | Sentry는 수정/삭제 가능 + retention 짧음. 별도 DB 테이블 필수 |
| suspend 대신 세션만 만료시키기 | 재로그인 가능 → suspend 무의미. DB 플래그 필수 |
| soft delete 없이 즉시 hard delete | 오조작 복구 불가. 30일 유예 필수 |
| BYOK 키를 admin UI에 평문 노출 | security-model §9 위반. 존재 여부만, 리셋만 가능 |
| admin 감사 로그를 일반 `audit_log` 테이블과 합치기 | 권한/쿼리 패턴 다름. 분리 유지 |
| reason 필드 optional | 나중에 "왜 이 계정 지웠지?" 답 없음. 1자 이상 강제 |
| super_admin 라우트를 일반 도메인과 공유 | 공격 표면 넓어짐. v0.2에 `admin.opencairn.com` 서브도메인 고려 |
| 운영자가 자신의 감사 로그 편집 | INSERT-only 강제 (앱 코드 + DB role) |

## 11. Testing Strategy

### 11.1 권한 가드 (필수)

```ts
// apps/api/test/admin.guard.test.ts
test("/api/admin/* requires super_admin role", async () => {
  const regularUser = await createUser({ role: "user" });
  const res = await request(app).get("/api/admin/summary").set(authCookie(regularUser));
  expect(res.status).toBe(404);  // 존재 은닉
});

test("/api/admin/* requires step-up within 10min", async () => {
  const admin = await createUser({ role: "super_admin" });
  const res = await request(app).get("/api/admin/summary").set(authCookie(admin));
  expect(res.status).toBe(401);
  expect(res.body.error).toBe("step_up_required");
});

test("super_admin cannot suspend self", async () => {
  const admin = await createUser({ role: "super_admin" });
  const res = await request(app)
    .post(`/api/admin/users/${admin.id}/suspend`)
    .set(authCookie(admin, { stepUp: true }))
    .send({ reason: "test" });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/self/);
});

test("suspended user cannot authenticate", async () => {
  const u = await createUser({ suspendedAt: new Date() });
  const res = await request(app).get("/api/workspaces").set(authCookie(u));
  expect(res.status).toBe(401);
});
```

### 11.2 감사 로그 (필수)

```ts
test("successful suspend writes audit log with actor/reason", async () => {
  const admin = await createUser({ role: "super_admin" });
  const target = await createUser();
  await request(app)
    .post(`/api/admin/users/${target.id}/suspend`)
    .set(authCookie(admin, { stepUp: true }))
    .send({ reason: "spam" });
  const logs = await db.select().from(adminAuditLog).where(eq(adminAuditLog.targetId, target.id));
  expect(logs).toHaveLength(1);
  expect(logs[0].action).toBe("user.suspend");
  expect(logs[0].actorEmail).toBe(admin.email);
  expect(logs[0].reason).toBe("spam");
});
```

### 11.3 E2E

Playwright 1개 시나리오만:
- super_admin 로그인 → step-up → `/admin` → 사용자 목록 → 상세 → suspend(사유 입력) → 해당 사용자로 로그인 시도 → 실패 확인 → `/admin/audit`에서 로그 확인

### 11.4 DB 제약 (유닛)

- `actor_id == target_id` 차단
- super_admin 카운트 0 방지 (role 변경 자체가 엔드포인트로 없으니 v0.1엔 SQL 레벨 트리거는 불필요. 마이그레이션 스크립트 체크만)
- `admin_audit_log` UPDATE/DELETE 권한 체크 (v0.2)

## 12. Rollout

| Phase | 범위 |
|---|---|
| v0.1 | 본 spec 전체: 가드 + 사용자 CRUD 액션 + 워크스페이스 CRUD 액션 + 감사 로그 + step-up |
| v0.2 | IP 제한 env, 실패 시도 감사 로그, DB role 분리 (INSERT-only), 서브도메인 분리 검토 |
| v0.3 | Impersonation (별도 spec 필수) |
| v0.4 | Plan 9b 완료 후: 결제 조회/환불, 수동 크레딧 지급, **Promotion Engine** (§ 15) |
| v1.0 | 성장 지표 대시보드 (별도 spec), support role 추가 |

## 13. Open Questions

1. **`user.role`을 `users` 테이블에 둘지 별도 `user_roles` 테이블에 둘지** — 현재 단일 플래그라 단일 컬럼 OK. 역할 늘어나면 테이블 분리. v0.1은 컬럼.
2. **Step-up 지속시간 10분이 적절한가** — Vercel은 5분, Supabase는 15분. 10분은 중간값. 피드백 받고 조정.
3. **감사 로그 export를 admin이 할지, 별도 스크립트로만 할지** — UI에서 export 가능하면 편리, 그러나 역시 export 이벤트도 감사 (재귀). v0.1은 UI에서 CSV 제공, 감사 로그에 `audit.export` 기록.
4. **Self-host에서 super_admin UI 숨길 옵션 필요한가** — 이미 role=user 기본이므로 자동으로 안 보임. 별도 설정 불필요.
5. **Slack/Telegram 알럿과 연동?** — `incident-response.md`의 알럿 채널로 super_admin 액션 스트리밍? 과할 수 있음. v0.2에 검토.
6. **`/admin` 서브도메인 분리 (`admin.opencairn.com`)** — v0.2에 검토. 쿠키 격리 이점 vs 인증 플로우 복잡성 트레이드오프.
7. **workspace 강제 삭제 시 owner에게 알림 이메일 자동 발송 여부** — 법적 분쟁 대응상 필요. v0.1 포함할지, v0.2로 미룰지.

## 14. Success Metrics

- **이상 사용자 대응 시간** — 신고 접수 → 정지까지 < 10분 (SQL 수동 대비 극적 단축)
- **감사 로그 누락** — 모든 super_admin 액션이 로그에 있음 (감사 샘플링 1%로 확인, 100%)
- **자체 장애** — admin 콘솔 오작동으로 정상 사용자 영향 = 0건
- **운영자 오조작 복구율** — soft delete 유예 덕에 "잘못 지움" 복구 = 100% (30일 이내 시도 시)
- **외부 감사 대응** — 법적 요청 수신 → CSV export 시간 < 5분

## 15. Promotion Engine (TBD · Plan 9b)

> **Status:** placeholder. 상세 설계는 Plan 9b 시작 시 본 spec 의 § 15 로 채워 넣는다.
> **Source spec:** [`2026-04-25-billing-pricing-redesign-design.md`](./2026-04-25-billing-pricing-redesign-design.md) § 9.1 — Promotion Engine 은 별도 spec 보다 본 super-admin spec 의 확장이 더 적합 (admin UI · 감사 로그 · 권한 가드 모두 본 spec 의 인프라 재사용).

### 15.1 범위 (예정)

- 4 grant type 관리 UI: signup-bonus / card-bonus / domain-bonus (`*.ac.kr`) / manual-grant (운영자 수동)
- abuse watchlist UI: 의심 가입자 (도메인 패턴, IP 패턴, 행동 패턴) 모니터 + 차단
- promotion CRUD + redemption 로그 조회
- `blocked_email_domains` 관리

### 15.2 재사용 인프라

- § 3 권한 모델 (`super_admin` 역할 그대로)
- § 5 데이터 모델 (`admin_audit_log` 에 promotion 이벤트 추가)
- § 6 API 패턴 (`/admin/promotions/*`, `/admin/abuse-watchlist/*`)
- § 8 보안 (step-up re-auth · 감사 자동 기록)
