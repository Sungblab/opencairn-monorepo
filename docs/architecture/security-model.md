# Security Model

OpenCairn의 전역 보안 모델. BYOK 키 관리, 인가 레이어, 샌드박스, 전역 HTTP 정책, rate limit을 한 문서에서 다룬다. 신규 기능은 여기서 정의된 경계 안에서 동작해야 하며, 경계 확장이 필요하면 이 문서를 먼저 업데이트한 뒤 구현에 들어간다.

---

## 1. Threat Model

OpenCairn은 **단일 사용자(혹은 소규모 팀) 셀프호스트**가 기본 배포 형태다. 위협 모델은 다음에 초점을 둔다:

1. **공격자가 외부에서 HTTP/WebSocket으로 접근** — 세션 탈취, API 무단 호출, webhook 위조
2. **공격자가 이미 로그인한 사용자 계정을 탈취** — 다른 사용자 데이터 접근 금지
3. **사용자가 AI 에이전트에게 악성 입력을 넣음** — prompt injection, 비용 폭발, OOM
4. **사용자가 AI 생성 코드를 브라우저에서 실행** — 다른 탭·쿠키·호스트 접근 금지
5. **공격자가 저장된 BYOK 키를 노림** — DB 덤프 유출 시나리오
6. **공격자가 내부 endpoint를 찌름** — worker→API 호출 경로가 외부로 열려 있지 않은지

**범위 밖**: multi-tenant SaaS 수준의 tenant 격리(같은 프로세스에서 다른 사용자 워크플로우 엄격 격리). Enterprise 듀얼 라이선스 제품이 필요할 때 별도 모델로 확장.

---

## 2. Authentication & Session

- **Better Auth** + session cookies (`better_auth.session_token`, HttpOnly + Secure + SameSite=Lax).
- Redis로 세션 저장, Postgres를 backing store로 사용 (Redis down 시 degrade).
- OAuth(Google/GitHub)는 v0.2에서 추가. v0.1은 이메일/비밀번호 + Magic Link.
- 세션 만료: 30일 (slide on activity), Remember-me 없이 만료 시 재로그인.
- CSRF: Hono의 `csrf()` 미들웨어 전역 적용 (POST/PATCH/PUT/DELETE에 `Origin` 헤더 검증).

---

## 3. Authorization (인가 계층)

2026-04-18 협업 도입으로 인가 모델은 **3계층 권한 + 역할 기반**으로 전면 재설계됨. Supabase RLS 대신 **애플리케이션 레이어에서 `canRead`/`canWrite` 헬퍼 강제 경유**.

### 3.1 3계층 권한

```
Workspace (owner / admin / member / guest)
  └── Project (상속 + editor / viewer override)
       └── Page (상속 + editor / viewer / none override, inherit_parent=false로 상속 차단 가능)
```

- **Workspace 간은 절대 격리**: 다른 workspace 리소스는 존재 자체가 보이지 않음 (API 404)
- **상속 흐름**: 상위 → 하위로 상속, 하위에서 명시적 override 가능
- 상세 resolve 알고리즘 + 테이블 스키마: [collaboration-model.md §2~3](./collaboration-model.md)

### 3.2 구현 원칙

- **`resolveRole(userId, resource)` 헬퍼** (`apps/api/src/lib/permissions.ts`): 모든 read/write 전 호출 의무. API middleware만으로 부족 — 내부 호출·에이전트·webhook도 경유.
- **`canRead` / `canWrite` / `canAdmin`** 래퍼: boolean 반환, 라우트 핸들러에서 직접 사용.
- **`requireWorkspaceRole(minRole)` middleware**: workspace URL 파라미터가 있는 라우트에 적용.
- **Hono 미들웨어 `requireAuth`**: 모든 `/api/*` 라우트에 적용 (health, auth, webhook, public share 제외). `c.set('user', session)` 후 하위 미들웨어·핸들러가 `user.id` 사용.
- **Drizzle 쿼리에서 WHERE 필터 생략 금지**: `db.select().from(projects)` 만으로는 모든 workspace의 모든 프로젝트가 나옴. 반드시 `resolveRole` 경유 or `.where(eq(projects.workspaceId, ...))` 첨부.
- **Temporal 액티비티**: 모든 activity input에 `userId` + `workspaceId` 필수. 워커 내부에서 권한 재검증 (Temporal 내부망 트래픽도 신뢰 금지).

### 3.3 Hocuspocus WebSocket

- **Better Auth 세션 + page-level `canWrite` 검증**:
  ```typescript
  async function onAuthenticate({ documentName, token }) {
    const session = await betterAuth.verifySession(token);
    if (!session) throw new Error("Unauthenticated");
    const noteId = documentName.replace(/^page:/, "");
    const role = await resolveRole(session.userId, { type: "note", id: noteId });
    if (role === "none") throw new Error("Forbidden");
    return { userId: session.userId, readOnly: role === "viewer" };
  }
  ```
- **readOnly 강제**: viewer에게도 WebSocket은 열리지만 서버가 `onChange` hook에서 update를 drop (클라이언트는 Plate `readOnly` 모드).
- **Awareness (presence)** 전파는 모든 역할에 허용 (user, cursor — 읽기 수준 정보).

#### Hocuspocus readOnly 강제 (상세 메커니즘)

- Viewer/Guest는 WebSocket 연결은 열리지만 `connection.readOnly = true` 플래그.
- Yjs update 수신 시 서버가 drop + 해당 client에 `permission-denied` 이벤트 emit.
- 클라이언트는 에디터를 `editable={false}`로 강제. 낙관적 업데이트는 rollback.
- 권한 변경(멤버 제거/role 변경) 시 서버가 active connections에 `reload` 이벤트 → 클라이언트 재인증.

### 3.4 Internal endpoints

- `/internal/*` 라우트는 `X-Internal-Secret` 헤더를 검증 (`INTERNAL_API_SECRET` env와 일치). 헤더 없으면 401.
- 외부 HTTP로 노출하지 않음: Docker 네트워크 내부 port만 매핑하거나 reverse proxy에서 `/internal/`을 차단.
- Internal 경유라도 user_id 기반 권한 재검증 (worker가 임의 user_id로 호출할 가능성 차단).

### 3.5 Comment 권한 규칙

- **조회**: page `viewer` 이상
- **작성**: page `viewer` 이상 (읽기만 되어도 댓글 가능 — Notion 방식)
- **수정**: 본인 작성자만
- **삭제**: 본인 작성자 + page `editor` (관리자 삭제)
- **Resolve**: page `editor` + 스레드 참여자 (둘 중 하나)

### 3.6 공개 링크 보안

- `editor` 권한 발급 금지 (viewer / commenter만)
- 토큰은 32 bytes URL-safe random
- Rate limit per token: 분당 30 req
- 암호 보호 시 bcrypt 해시, verify-password 엔드포인트 실패 시도 IP별 throttle
- 검색엔진 기본 `noindex`, 옵트인 시에만 indexable

### 3.7 Guest 경계

- Workspace 멤버·프로젝트 목록 API 호출 시 403
- 본인에게 공유된 resource 외 API 응답은 404 (존재 자체 은닉)
- 다른 guest의 이메일·ID 노출 금지 (코멘트에서도 이름만)

---

## 4. BYOK Key Management

### 4.1 저장 (at-rest)

- **알고리즘**: AES-256-GCM
- **키**: `BYOK_ENCRYPTION_KEY` env (32바이트, base64 인코딩). 배포 시 **시크릿 매니저(Docker secrets, AWS SM, Fly.io secrets 등)**로 주입.
- **저장 컬럼** (billing-model.md `subscriptions` 테이블과 동일 이름):
  - `subscriptions.byok_gemini_key_ciphertext` (ciphertext, bytea). tag는 ciphertext 뒤쪽 16바이트로 concat.
  - `subscriptions.byok_gemini_key_iv` (nonce, bytea).
  - `subscriptions.byok_gemini_key_version` (int, 키 로테이션 추적).
- **사용 시점에만 복호화**: `resolveGeminiKey()` 미들웨어에서만, 요청 처리 동안만 메모리에. 로깅·trace에 절대 들어가지 않도록.

### 4.2 키 로테이션

분기 1회 또는 키 유출 의심 시:

1. 새 키 생성 → `BYOK_ENCRYPTION_KEY_NEW` 환경변수로 임시 주입.
2. 마이그레이션 스크립트 (`apps/api/scripts/rotate-byok-key.ts`):
   - `subscriptions` 전체 순회
   - 구 키로 복호화 → 새 키로 재암호화 → 동일 행에 업데이트
   - 롤백을 위해 직전 상태 스냅샷 (`backup-strategy.md`의 백업 스케줄 활용)
3. 성공 확인 후 `BYOK_ENCRYPTION_KEY`를 새 값으로 교체, `BYOK_ENCRYPTION_KEY_NEW` 제거.
4. 실패 시 롤백: 스냅샷 복원 + 구 키 유지.

### 4.3 삭제

- 사용자가 BYOK 키를 해제하면 `byok_gemini_key_ciphertext` / `byok_gemini_key_iv` 를 `NULL`로 업데이트. 별도 감사 로그에 이벤트 기록.
- 계정 삭제 시 전체 `subscriptions` 행과 함께 cascade 삭제.

### 4.4 절대 하지 말 것

- BYOK 키를 Sentry/로그/Error report에 포함
- HTTP 응답 body에 포함 (GET `/settings/api-key`는 마스킹된 "sk-...****"만)
- 프론트엔드 localStorage/sessionStorage 저장

---

## 5. Browser Sandbox (ADR-006)

코드 실행은 전부 브라우저에서 이루어진다. 서버는 코드 문자열 생성만 담당.

### 5.1 iframe sandbox 속성

- `sandbox="allow-scripts"` **only**. `allow-same-origin`은 **절대 추가 금지** (MDN 경고 — sandbox 탈출 가능).
- Blob URL origin은 `"null"`로 보고됨. `postMessage` 리스너에서 `event.origin === "null"` 및 `event.source === iframe.contentWindow` 이중 검증.
- Unmount 시 `URL.revokeObjectURL` 호출 (메모리 누수 방지).

### 5.2 Pyodide (Python WASM)

- 버전은 **고정**: `PYODIDE_VERSION` 상수로 박아둠 (floating `latest` 금지).
- `pyodide.setStdin()`으로 배열 pre-injection만. blocking `input()` 금지.
- Promise race로 `EXECUTION_TIMEOUT_MS` (기본 10초) 강제 종료.
- `micropip.install()` 허용 도메인은 기본적으로 pyodide CDN 한정.

### 5.3 Content Security Policy (CSP)

Hono에서 `Content-Security-Policy` 헤더 전역 주입 (marketing 페이지는 별도):

```
default-src 'self';
script-src 'self' 'unsafe-inline' https://esm.sh https://cdn.jsdelivr.net/pyodide/ ;
script-src-elem 'self' 'unsafe-inline' https://esm.sh https://cdn.jsdelivr.net/pyodide/ ;
style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net ;
img-src 'self' data: blob: https:;
font-src 'self' data: https://cdn.jsdelivr.net ;
connect-src 'self' wss://<hocuspocus-host> https://generativelanguage.googleapis.com https://esm.sh https://cdn.jsdelivr.net ;
frame-src 'self' blob:;
worker-src 'self' blob:;
object-src 'none';
base-uri 'self';
form-action 'self';
```

- Marketing/blog 페이지는 더 엄격한 CSP(외부 CDN 최소화).
- CSP 위반은 `/csp-report` 엔드포인트로 수집하여 Sentry에 전송.

### 5.4 COOP/COEP

- 기본: 설정하지 않음 (blocking stdin, SharedArrayBuffer 사용 안 함).
- 차후 Pyodide Web Worker 도입 시 `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` 필요. 그때 esm.sh, pyodide CDN의 CORP 호환성 재검토 필요. v0.1 범위 밖.

---

## 6. Rate Limiting

### 6.1 계층

| 계층 | 구현 | 한도 |
|------|------|------|
| 전역 per-IP | Cloudflare / nginx → 60 req/s | 공격 방어 최후 |
| 인증 없는 라우트 | Hono middleware (Redis token bucket) | `/api/auth/*`: 20 req/min per IP |
| 인증된 사용자 | Hono middleware | `/api/*`: 120 req/min per userId (Free), 600 req/min (Pro/BYOK) |
| LLM 호출 | `packages/llm` internal | provider 429 → 지수 백오프 (1s→2s→4s→8s, max 3회) |
| 업로드 | `/ingest/upload` | 10 req/min per userId (파일당 스캔/파싱 비용 고려) |
| Code Agent | `/code/run` | 30 req/min per userId (self-healing 폭주 방지) |
| Deep Research | `/agents/deep-research/run` | 5 req/hour per userId (Gemini Deep Research 비용 방어) |

- 구현: Redis 토큰 버킷 (`ratelimit:<scope>:<key>` 키). Hono 미들웨어 `rateLimit({ scope, keyFn, max, windowMs })`.
- Free 플랜 한도 초과는 `429 Too Many Requests` + `Retry-After` 헤더 + 남은 일일 한도 정보.

### 6.2 BYOK 사용자 예외

- BYOK 사용자는 Rate limit 자체는 적용 (서비스 보호), 하지만 Gemini 비용은 **본인 부담**이므로 OpenCairn의 과금에서 제외.
- LLM 호출 자체에 대한 한도는 user-provided API key의 Gemini quota가 1차 방어선.

---

## 7. Secrets & Env

- **`.env.example`**만 git에 커밋. `.env`, `.env.prod`, `.env.local`, `docker-compose.prod.yml`은 `.gitignore`.
- 운영 시크릿 목록 (누출 시 최우선 로테이션):
  - `BETTER_AUTH_SECRET` — 세션 토큰 서명
  - `INTERNAL_API_SECRET` — worker→API 호출
  - `BYOK_ENCRYPTION_KEY` — BYOK 키 AES 래핑
  - `TOSS_SECRET_KEY`, `TOSS_WEBHOOK_SECRET`
  - `LLM_API_KEY` (Production Gemini 키)
  - `S3_ACCESS_KEY` / `S3_SECRET_KEY` (R2 credentials)
  - `DATABASE_URL` (Postgres 비밀번호 포함)
- 프로덕션은 Docker secrets 또는 호스팅사 시크릿 매니저 사용. env 파일은 로컬 개발용.

---

## 8. Webhook 검증

### 8.1 Toss Payments

- 웹훅 요청 본문 + `TOSS_WEBHOOK_SECRET` → HMAC SHA-256 → 헤더 `Toss-Signature`와 상수시간 비교.
- 시계 오차 허용: ±5분 (timestamp 헤더 검증).
- 불일치 시 401, 감사 로그에 기록.

### 8.2 기타

- GitHub webhook (v0.2 플러그인)도 동일 패턴.

---

## 9. 로깅 & 추적 시 금지 항목

다음은 **로그, Sentry, OpenTelemetry trace, error body**에 절대 포함되면 안 된다:

- BYOK API 키, 복호화된 평문
- 세션 토큰 (`better_auth.session_token`)
- 사용자 이메일 전체 (마스킹: `k***@gmail.com`)
- Toss payment key 전체 (뒤 4자리만)
- 파일 내용 (PDF/문서 raw bytes) — 메타데이터(`mime_type`, `size`)까지만
- 위키 본문 (디버깅 시에도 해시만)

PII 필터는 Sentry `beforeSend` hook 또는 OpenTelemetry `SpanProcessor`에서 구현.

---

## 10. Incident Response

보안 사고 감지/대응 절차는 [incident-response.md](../runbooks/incident-response.md)에 별도 정의.

- **트리거**: 인증 실패 폭증, 비정상 BYOK 복호화 시도, CSP 위반 스파이크, Toss 서명 불일치 반복
- **On-call**: 1인 개발자 환경 — Telegram/Discord 봇 알림 + 이메일
- **긴급 롤백**: `BYOK_ENCRYPTION_KEY` 노출 의심 시 세션 전체 무효화 + BYOK 키 전원 리셋 마이그레이션 실행

---

## 11. 체크리스트 (feature PR에 추가)

새 기능을 머지하기 전 최소 확인:

- [ ] 인증이 필요한 라우트는 `requireAuth` 적용
- [ ] **모든 read/write 쿼리가 `resolveRole` / `canRead` / `canWrite` / `canAdmin` 헬퍼 경유** (원시 Drizzle 쿼리 거부)
- [ ] Workspace URL 파라미터가 있는 라우트에 `requireWorkspaceRole(...)` middleware 적용
- [ ] 외부 입력은 Zod 스키마 검증
- [ ] 비밀을 코드/로그에 평문으로 남기지 않음
- [ ] Rate limit 적용이 필요한 엔드포인트는 middleware 추가
- [ ] 브라우저 샌드박스에 생성된 코드 주입 시 `sandbox="allow-scripts"`만 사용
- [ ] CSP 허용 도메인 확장이 필요하면 본 문서 §5.3 업데이트 먼저
- [ ] Webhook 추가 시 HMAC 검증 의무
- [ ] **Hocuspocus 연결 추가 시 auth hook이 role 기반 readOnly 반환하는지 확인**
- [ ] **Temporal activity input에 workspace_id 포함, activity 내부에서 권한 재검증**
- [ ] **Guest 사용자가 노출되면 안 될 리소스 API는 403이 아닌 404 반환** (존재 은닉)

---

## 12. 변경 이력

- 2026-04-17: 최초 작성. ADR-006(Pyodide), 2026-04-15 OpenAI 제거, 2026-04-14 Toss 전환, BYOK 키 로테이션 절차를 반영.
