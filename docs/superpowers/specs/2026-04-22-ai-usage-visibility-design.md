# AI Usage Visibility — Cost Tracking, Dashboard, and Admin Controls

**Status:** Draft (2026-04-22)
**Owner:** Sungbin
**Related:**

- [2026-04-20-agent-runtime-standard-design.md](./2026-04-20-agent-runtime-standard-design.md) — Plan 12. `ModelEnd` 이벤트 + `TokenCounterHook` + `agent_runs` 테이블 이미 존재
- [2026-04-22-deep-research-integration-design.md](./2026-04-22-deep-research-integration-design.md) — Spec A. 본 spec은 Deep Research run의 사용량을 동일 파이프라인에 합류시킨다
- [2026-04-22-super-admin-console-design.md](./2026-04-22-super-admin-console-design.md) — Admin 권한 모델 + audit log. 본 spec은 Admin Console에 AI usage 탭을 확장
- [api-contract.md](../../architecture/api-contract.md) — Zod + requireAuth + 404 은닉
- [collaboration-model.md](../../architecture/collaboration-model.md) — workspace 3계층 권한
- 외부 레퍼런스: [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)

## Dependencies

- **Plan 1** — Better Auth, user/workspace 스키마
- **Plan 12** — `agent_runs` 테이블 + `ModelEnd` 이벤트 + `TokenCounterHook`. 본 spec은 Plan 12가 열어둔 "토큰/비용 필드 실제값 wiring" TODO를 닫는다
- **Plan 13** — `packages/llm` multi-LLM provider 패턴
- **Plan 3b** — Batch embeddings (본 spec의 `purpose="batch-embed"` 이벤트 소스)
- **Super Admin Console spec** — admin 권한 모델 + audit log (본 spec이 확장)
- **Spec A (Deep Research)** — Phase H에서 연결
- 이메일 인프라 — `apps/api/src/lib/email.ts` (Resend) 이미 존재. Plan 9b 대기 불필요.

---

## 1. Problem

OpenCairn에는 **모든 AI 호출의 사용량/비용이 보이지 않는다**:

1. Plan 12의 `agent_runs.totalCostKrw` · `totalTokensIn/Out` 컬럼은 **현재 전부 0**. 모든 에이전트가 `ModelEnd` 이벤트를 `prompt_tokens=0, cost_krw=0` 으로 하드코딩하며 실제 값 wiring 누락.
2. 에이전트 외부 (`pdf_activity` · `image_activity` · `enhance_activity` · `batch_embed_activities`) 의 직접 `provider.embed()`/`generate()` 호출은 **추적 경로 자체가 없음**. `runtime.Agent` 래핑이 없어 hook 파이프라인을 타지 않음.
3. Spec A (Deep Research)가 막 설계 완료 — 태스크당 $1–7 고비용인데 전체 비용 대시보드 없이 출시되면 사용자 자신도 얼마 쓰는지 모름.
4. 운영자(본인) 입장에서도 **누가 폭주시켰는지 감지할 수단 없음**. Super Admin Console spec이 "이상 사용자 정지" 기능을 정의했지만 **근거 데이터(사용량)가 없다**.

**이 spec은 이 4개의 공백을 한 번에 메운다**:
- 모든 LLM 호출 사용량 이벤트 기록 (에이전트 · 다이렉트 · Deep Research 공통)
- 실시간 일별 rollup 집계 (영구 보관)
- 사용자 설정 페이지 대시보드 (본인 소비 투명성)
- Admin 콘솔 확장 (이상 탐지 + drill-down + 강제 조치)

## 2. Goals & Non-Goals

### Goals

- **모든 AI 호출** (agent · activity · Deep Research) 의 개별 이벤트를 `ai_usage_events` 에 기록
- **실시간 일별 rollup** (`ai_usage_daily_agg`) — 호출과 같은 트랜잭션 UPSERT, 영구 보관, `hour_histogram` 시간대 분포 포함
- **사용자 대시보드** (`/settings/usage`) — 월별 총합 · 일별 차트 · heatmap · 모델/기능/billing_path breakdown · 최근 50건 호출 · 예산 위젯 (opt-in, 이메일 알림) · 월별 CSV
- **Admin 콘솔 확장** (`/admin/usage`) — 전체 overview · Top 10 헤비유저 · 이상 플래그 · user drill-down · 월 상한 강제 · BYOK 키 무효화 · audit log
- **이상 탐지** — `AI_USAGE_ANOMALY_THRESHOLD_KRW_24H` 초과 사용자를 매일 자동 플래그
- **90일 retention** (events) + **영구** (daily_agg)
- **프라이버시** — 이벤트 payload에 프롬프트/응답/문서 내용 절대 미포함
- **BYOK · Managed PAYG 구분 표시** (Spec A의 billing_path enum을 통합)

### Non-Goals

- **실시간 과금/결제 연동** — Plan 9b BLOCKED. 본 spec은 **추정 비용만** 표시, 실제 크레딧 차감/PG 연동은 Plan 9b 후속.
- **BYOK 사용자 측 "비용 보호 게이팅"** — 피드백 원칙에 따라 BYOK는 사용자가 지불하는 경로이므로 routine 가격 제한 금지 (admin abuse 대응용 강제 상한은 예외).
- **실시간 환율 API 연동** — env 상수 `USD_TO_KRW_RATE` (기본 1650) 유지, 분기별 수동 업데이트 (ADR-010).
- **Ollama에 대한 비용 계산** — Ollama self-host는 비용 $0. 토큰 수만 기록 (통계용), cost=0.
- **"최근 호출 리스트" 90일 이전 조회** — retention 경계. CSV 다운로드로 대체 안내.
- **수만 명 동시 사용 성능 최적화** — 별도 성능 plan (본 spec은 "수백 명 규모" 가정).

---

## 3. Architecture

```
[Agents / Activities]          [Deep Research (Spec A)]
        │                               │
        ▼                               ▼
┌────────────────────┐           ┌────────────────────┐
│ GeminiProvider     │           │ research_runs      │
│ OllamaProvider     │           │ persist_report     │
│ .generate/embed/…  │  →  emits │ activity           │
└──────┬─────────────┘           └──────┬─────────────┘
       │                                 │
       │   await usage_sink.emit(UsageEvent(…))
       └──────────────┬──────────────────┘
                      ▼
              ┌────────────────┐
              │  UsageSink     │ ──► async DB write (same tx):
              │  (db-backed)   │     ① INSERT ai_usage_events
              └────────────────┘     ② UPSERT ai_usage_daily_agg
                      │                  (+ hour_histogram slot++)
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ packages/db/schema/ai-usage.ts                              │
│ ├ ai_usage_events         (90일 retention, 개별 호출)        │
│ ├ ai_usage_daily_agg      (영구, user×day×model×purpose)    │
│ │   + hour_histogram jsonb (24-slot)                        │
│ ├ user_usage_preferences  (예산 + admin 강제 상한)           │
│ └ ai_usage_anomalies      (이상 탐지 플래그)                  │
└─────────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ apps/api /api/usage/* + /api/admin/usage/*                  │
└──────┬──────────────────────────────────────────────────────┘
       ▼
┌─────────────────────────────────────────────────────────────┐
│ apps/web                                                    │
│ ├ /settings/usage        (사용자 대시보드)                   │
│ └ /admin/usage           (admin overview + drill-down)      │
└─────────────────────────────────────────────────────────────┘

[Temporal scheduled workflows]
 ├ daily_anomaly_check_workflow  (KST 10:00, 24h 초과 플래그)
 ├ usage_retention_workflow      (KST 03:00, 90일 초과 events 삭제)
 └ budget_alert_workflow         (hourly, 80% 도달 이메일)

[Email]
 └ apps/api/src/lib/email.ts (기존 Resend) + sendBudgetAlertEmail
```

### 경계 원칙

- **`packages/llm` 이 sink 컨트랙트를 정의** — `UsageSink` Protocol, `UsageContext` dataclass, `emit_usage()` helper. 구체 구현체(`DbUsageSink`)는 worker 런타임이 주입. 테스트는 `InMemorySink` / `NullSink`.
- **Python `contextvars.ContextVar` 로 호출 컨텍스트 전달** — `userId`, `workspaceId`, `runId?`, `purpose`, `billing_path`. Temporal activity 진입점에서 `with usage_context(...)` 블록으로 세팅. agent 내부는 `ctx.run_id` 기반 자동.
- **이벤트 insert와 daily rollup UPSERT는 같은 트랜잭션** — 데이터 불일치 원천 차단.
- **Provider는 sink 실패 시에도 정상 call 결과 반환** — 추적 실패가 실제 작업을 블록하면 안 됨. `emit_usage` 내부 `try/except` + warn 로그.
- **ModelEnd 이벤트는 agent 경로에서 기존대로 발행** — `TokenCounterHook` → `agent_runs` 집계 유지. Usage sink는 **병행** 쓰기 경로이며, 이 spec은 둘 다 실제 값을 담도록 wiring.

---

## 4. Components & Data Model

### 4.1 DB 스키마 (Drizzle, `packages/db/src/schema/ai-usage.ts`)

```typescript
// Enums
export const billingPathEnum = pgEnum("billing_path", ["byok", "managed"]);
// 참고: Spec A의 researchBillingPathEnum을 본 spec의 마이그레이션에서 이 enum으로 통합.
// Phase H에서 research_runs.billing_path 컬럼을 ALTER하여 단일 enum 참조.

export const aiUsagePurposeEnum = pgEnum("ai_usage_purpose", [
  "compiler", "research", "librarian", "deep-research",
  "ingest-embed", "ingest-pdf", "ingest-image", "ingest-enhance",
  "batch-embed", "tts", "unscoped",
]);

// 개별 호출 이벤트 — 90일 retention
export const aiUsageEvents = pgTable("ai_usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  runId: uuid("run_id"),              // agent_runs.runId 또는 research_runs.id (soft ref)
  purpose: aiUsagePurposeEnum("purpose").notNull(),
  modelId: text("model_id").notNull(),
  billingPath: billingPathEnum("billing_path").notNull(),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  cachedTokens: integer("cached_tokens"),
  embedTokens: integer("embed_tokens"),
  audioSeconds: integer("audio_seconds"),
  costKrw: integer("cost_krw").notNull(),
  costUsdCents: integer("cost_usd_cents"),
  latencyMs: integer("latency_ms"),
  ok: boolean("ok").notNull().default(true),
  errorClass: text("error_class"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("ai_usage_events_user_time_idx").on(t.userId, t.createdAt.desc()),
  index("ai_usage_events_workspace_time_idx").on(t.workspaceId, t.createdAt.desc()),
  index("ai_usage_events_retention_idx").on(t.createdAt),
]);

// 일별 집계 — 영구 보관
export const aiUsageDailyAgg = pgTable("ai_usage_daily_agg", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  dayKst: date("day_kst").notNull(),
  purpose: aiUsagePurposeEnum("purpose").notNull(),
  modelId: text("model_id").notNull(),
  billingPath: billingPathEnum("billing_path").notNull(),
  callCount: integer("call_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  promptTokens: bigint("prompt_tokens", { mode: "number" }).notNull().default(0),
  completionTokens: bigint("completion_tokens", { mode: "number" }).notNull().default(0),
  cachedTokens: bigint("cached_tokens", { mode: "number" }).notNull().default(0),
  embedTokens: bigint("embed_tokens", { mode: "number" }).notNull().default(0),
  audioSeconds: bigint("audio_seconds", { mode: "number" }).notNull().default(0),
  costKrw: bigint("cost_krw", { mode: "number" }).notNull().default(0),
  costUsdCents: bigint("cost_usd_cents", { mode: "number" }).notNull().default(0),
  hourHistogram: jsonb("hour_histogram").$type<number[]>().notNull()
    .default(sql`'[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]'::jsonb`),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("ai_usage_daily_agg_nat_key_idx").on(
    t.userId, t.dayKst, t.purpose, t.modelId, t.billingPath,
  ),
  index("ai_usage_daily_agg_user_day_idx").on(t.userId, t.dayKst.desc()),
  index("ai_usage_daily_agg_workspace_day_idx").on(t.workspaceId, t.dayKst.desc()),
]);

// 예산 + admin 강제 상한
export const userUsagePreferences = pgTable("user_usage_preferences", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  monthlyBudgetKrw: integer("monthly_budget_krw"),
  emailAlertEnabled: boolean("email_alert_enabled").notNull().default(false),
  alertThresholdPercent: integer("alert_threshold_percent").notNull().default(80),
  lastAlertSentAt: timestamp("last_alert_sent_at"),
  adminMonthlyLimitKrw: integer("admin_monthly_limit_krw"),
  adminLimitReason: text("admin_limit_reason"),
  adminLimitSetBy: text("admin_limit_set_by").references(() => user.id, { onDelete: "set null" }),
  adminLimitSetAt: timestamp("admin_limit_set_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// 이상 탐지 플래그
export const aiUsageAnomalies = pgTable("ai_usage_anomalies", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  thresholdKrw: integer("threshold_krw").notNull(),
  actualKrw: integer("actual_krw").notNull(),
  windowStart: timestamp("window_start").notNull(),
  windowEnd: timestamp("window_end").notNull(),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("ai_usage_anomalies_user_window_idx").on(t.userId, t.windowStart),
  index("ai_usage_anomalies_unresolved_idx").on(t.createdAt.desc()).where(sql`${t.resolvedAt} IS NULL`),
]);
```

### 4.2 Python — Usage Sink 컨트랙트 (`packages/llm/src/llm/usage.py` 신규)

```python
"""Usage tracking primitives shared across all LLM call sites."""
from __future__ import annotations
import logging
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Literal, Protocol

logger = logging.getLogger(__name__)

UsagePurpose = Literal[
    "compiler", "research", "librarian", "deep-research",
    "ingest-embed", "ingest-pdf", "ingest-image", "ingest-enhance",
    "batch-embed", "tts", "unscoped",
]
BillingPath = Literal["byok", "managed"]


@dataclass(frozen=True)
class UsageContext:
    user_id: str
    workspace_id: str
    run_id: str | None
    purpose: UsagePurpose
    billing_path: BillingPath


@dataclass
class UsageEvent:
    ctx: UsageContext
    model_id: str
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    cached_tokens: int | None = None
    embed_tokens: int | None = None
    audio_seconds: int | None = None
    cost_krw: int = 0
    cost_usd_cents: int | None = None
    latency_ms: int | None = None
    ok: bool = True
    error_class: str | None = None


class UsageSink(Protocol):
    async def emit(self, event: UsageEvent) -> None: ...


class NullSink:
    async def emit(self, event: UsageEvent) -> None:
        return None


_CURRENT_SINK: ContextVar[UsageSink] = ContextVar("usage_sink", default=NullSink())
_CURRENT_CTX:  ContextVar[UsageContext | None] = ContextVar("usage_ctx", default=None)


def set_usage_sink(sink: UsageSink) -> None:
    _CURRENT_SINK.set(sink)


async def emit_usage(event: UsageEvent) -> None:
    try:
        await _CURRENT_SINK.get().emit(event)
    except Exception:
        logger.exception("usage sink emit failed — ignoring (non-blocking)")


@contextmanager
def usage_context(ctx: UsageContext):
    token = _CURRENT_CTX.set(ctx)
    try:
        yield
    finally:
        _CURRENT_CTX.reset(token)


def current_context() -> UsageContext:
    c = _CURRENT_CTX.get()
    if c is None:
        return UsageContext(
            user_id="unknown", workspace_id="unknown",
            run_id=None, purpose="unscoped", billing_path="byok",
        )
    return c
```

### 4.3 Pricing 테이블 (`packages/llm/src/llm/pricing.py` 신규)

```python
"""Model → cost calculation.
Prices in USD per 1M tokens; deep-research uses flat per-task estimate.
Update policy: ADR-010 (documented in this spec's Rollout phase).
"""
import os

GEMINI_PRICES_USD_PER_1M_TOKENS = {
    "gemini-3.1-pro-preview":        {"input": 2.0,  "output": 12.0, "cached": 0.5},
    "gemini-3-flash-preview":        {"input": 0.3,  "output": 2.5,  "cached": 0.08},
    "gemini-3.1-flash-lite-preview": {"input": 0.10, "output": 0.40, "cached": 0.025},
    "gemini-embedding-001":          {"embed": 0.15},
    "gemini-2.5-flash-preview-tts":  {"audio_per_sec_usd": 0.0001},  # placeholder
    "gemini-2.5-pro-preview-tts":    {"audio_per_sec_usd": 0.0005},
    # Flat per-task for Deep Research (Spec A)
    "deep-research-preview-04-2026":     {"flat_usd_estimate": 2.0},
    "deep-research-max-preview-04-2026": {"flat_usd_estimate": 5.0},
}


def calculate_cost_krw(
    model_id: str,
    *,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    cached_tokens: int = 0,
    embed_tokens: int = 0,
    audio_seconds: int = 0,
    flat_override_usd: float | None = None,
    duration_minutes: float | None = None,
) -> tuple[int, int]:
    """Returns (cost_krw, cost_usd_cents). Unknown model → (0, 0) + log warn."""
    rate = int(os.environ.get("USD_TO_KRW_RATE", "1650"))
    prices = GEMINI_PRICES_USD_PER_1M_TOKENS.get(model_id)

    # Deep Research flat estimate
    if flat_override_usd is not None:
        usd = flat_override_usd
        if duration_minutes is not None:
            # §7 Spec A formula: clamp(duration_min / 20, 0.5, 1.5)
            factor = max(0.5, min(1.5, duration_minutes / 20.0))
            usd *= factor
    elif prices is None:
        import logging; logging.getLogger(__name__).warning(
            "unknown model %s — cost=0", model_id,
        )
        return (0, 0)
    elif "flat_usd_estimate" in prices:
        usd = prices["flat_usd_estimate"]
    elif "embed" in prices:
        usd = (embed_tokens / 1_000_000) * prices["embed"]
    elif "audio_per_sec_usd" in prices:
        usd = audio_seconds * prices["audio_per_sec_usd"]
    else:
        usd = (
            (prompt_tokens - cached_tokens) / 1_000_000 * prices["input"]
            + cached_tokens / 1_000_000 * prices["cached"]
            + completion_tokens / 1_000_000 * prices["output"]
        )

    cost_krw = int(round(usd * rate))
    cost_usd_cents = int(round(usd * 100))
    return (cost_krw, cost_usd_cents)
```

### 4.4 서비스 컴포넌트 매트릭스

| Layer | 경로 | 역할 |
|---|---|---|
| LLM | `packages/llm/src/llm/usage.py` | `UsageSink` · `UsageContext` · `UsageEvent` · ContextVar + `emit_usage` |
| LLM | `packages/llm/src/llm/pricing.py` | 가격 테이블 + `calculate_cost_krw` |
| LLM | `packages/llm/src/llm/gemini.py` | 각 `generate`/`embed`/`generate_multimodal`/`start_interaction` 끝에서 `emit_usage` |
| LLM | `packages/llm/src/llm/ollama.py` | 동일 emit, cost=0 |
| DB | `packages/db/src/schema/ai-usage.ts` | 4 테이블 + `billing_path` enum 통합 |
| Worker | `apps/worker/src/worker/lib/usage_sink_db.py` | `DbUsageSink` — event insert + daily_agg UPSERT + hour_histogram 슬롯 증가 (같은 트랜잭션) |
| Worker | `apps/worker/src/worker/workflows/usage_retention_workflow.py` | Temporal scheduled, KST 03:00 |
| Worker | `apps/worker/src/worker/workflows/usage_anomaly_workflow.py` | Temporal scheduled, KST 10:00 |
| Worker | `apps/worker/src/worker/workflows/budget_alert_workflow.py` | Temporal scheduled, hourly |
| API | `apps/api/src/routes/usage.ts` | `GET /me`, `GET /me/recent`, `GET /me/history?month=...`, `POST /me/budget`, `GET /me/export.csv` |
| API | `apps/api/src/routes/admin-usage.ts` | `GET /admin/usage/overview`, `GET /admin/usage/users/:id`, `GET /admin/anomalies`, `POST /admin/anomalies/:id/resolve`, `POST /admin/users/:id/byok-invalidate`, `POST /admin/users/:id/monthly-limit`, `DELETE /admin/users/:id/monthly-limit`, `GET /admin/usage/export.csv` |
| API | `apps/api/src/routes/internal.ts` | 신규 `POST /api/internal/budget-alert` — worker → api, X-Internal-Secret |
| API | `apps/api/src/lib/email.ts` | `sendBudgetAlertEmail(to, { percent, spentKrw, limitKrw })` 추가 |
| Web | `apps/web/src/app/[locale]/app/settings/usage/page.tsx` | 사용자 대시보드 |
| Web | `apps/web/src/app/[locale]/app/admin/usage/page.tsx` | admin overview |
| Web | `apps/web/src/app/[locale]/app/admin/usage/[userId]/page.tsx` | user drill-down |
| Web | `apps/web/src/components/usage/` | `UsageChart`, `UsageHeatmap`, `ModelBreakdownTable`, `PurposeBreakdownTable`, `BudgetWidget`, `RecentCallsList`, `CsvDownloadButton`, `AdminActionPanel` |
| i18n | `messages/ko/usage.json` + `messages/en/usage.json` | UI 문자열 |
| ADR | `docs/architecture/adr/010-ai-pricing-table.md` | 가격 테이블 유지 정책 (신규) |

---

## 5. Data Flow

### 5.1 이벤트 기록 — Agent 내부 호출 (예: ResearchAgent)

```
[Temporal workflow] research_workflow → research_activity
  ↓
  set_usage_sink(DbUsageSink(db_pool))   ← worker 부팅 시 1회
  with usage_context(UsageContext(
      user_id, workspace_id, run_id=ctx.run_id,
      purpose="research", billing_path=ctx.billing_path,
  )):
      await research_agent.run(input, ctx)
          ↓
        [ResearchAgent._decompose]
            await self.provider.generate(messages, response_mime_type="application/json")
                ↓
              [GeminiProvider.generate]
                  t0 = time.monotonic()
                  resp = await self._client.aio.models.generate_content(...)
                  t1 = time.monotonic()
                  usage = resp.usage_metadata
                  cost_krw, cost_usd_cents = calculate_cost_krw(
                      model_id,
                      prompt_tokens=usage.prompt_token_count,
                      completion_tokens=usage.candidates_token_count,
                      cached_tokens=usage.cached_content_token_count or 0,
                  )
                  await emit_usage(UsageEvent(
                      ctx=current_context(), model_id=model_id,
                      prompt_tokens=usage.prompt_token_count,
                      completion_tokens=usage.candidates_token_count,
                      cached_tokens=usage.cached_content_token_count,
                      cost_krw=cost_krw, cost_usd_cents=cost_usd_cents,
                      latency_ms=int((t1-t0)*1000), ok=True,
                  ))
                  return resp.text
                  ↓
                [DbUsageSink.emit]  (단일 트랜잭션)
                  BEGIN
                    INSERT INTO ai_usage_events (...);
                    INSERT INTO ai_usage_daily_agg (...)
                    ON CONFLICT (user_id, day_kst, purpose, model_id, billing_path)
                    DO UPDATE SET
                      call_count += 1,
                      prompt_tokens += EXCLUDED.prompt_tokens,
                      ...,
                      cost_krw += EXCLUDED.cost_krw,
                      hour_histogram = jsonb_set(
                        hour_histogram, ARRAY[<hour>::text],
                        to_jsonb((hour_histogram->><hour>)::int + 1)
                      ),
                      updated_at = now();
                  COMMIT
```

### 5.2 이벤트 기록 — Activity 직접 호출 (예: pdf_activity)

```
[Temporal activity entry]
  @activity.defn
  async def pdf_parse_activity(input: PdfParseInput):
      with usage_context(UsageContext(
          user_id=input.user_id, workspace_id=input.workspace_id,
          run_id=None, purpose="ingest-pdf", billing_path=input.billing_path,
      )):
          provider = get_provider(...)
          text = await provider.generate_multimodal(prompt, pdf_bytes=input.bytes)
          # generate_multimodal 내부에서 emit_usage 자동 호출
          ...
```

**컨벤션:** 모든 Temporal activity 진입점에서 `with usage_context(...)` 로 감싼다. `packages/llm` 에 `@with_usage_context` 데코레이터 제공.

### 5.3 이벤트 기록 — Deep Research (Spec A 연계)

```
[deep_research_workflow → persist_report_activity]
  with usage_context(UsageContext(
      user_id=run.user_id, workspace_id=run.workspace_id,
      run_id=run.id, purpose="deep-research", billing_path=run.billing_path,
  )):
      # Page 생성 후...
      cost_krw, cost_usd_cents = calculate_cost_krw(
          run.model,
          flat_override_usd=_base_usd_for(run.model),
          duration_minutes=duration_min,
      )
      await emit_usage(UsageEvent(
          ctx=current_context(), model_id=run.model,
          prompt_tokens=None, completion_tokens=None, cached_tokens=None,
          cost_krw=cost_krw, cost_usd_cents=cost_usd_cents,
          latency_ms=int(duration_min*60*1000), ok=True,
      ))
      # Spec A의 research_runs.total_cost_usd_cents 도 동시 업데이트
```

### 5.4 조회 경로 — 사용자 대시보드

`GET /api/usage/me?month=2026-04` → 병렬 6 쿼리:
- 월 총합 (cost / calls / tokens, billing_path별 분리)
- 일별 시계열 (daily_agg GROUP BY day_kst)
- 모델별 breakdown (GROUP BY model_id ORDER BY cost DESC)
- 기능별 breakdown (GROUP BY purpose)
- billing_path별 합계
- 시간대 heatmap (hour_histogram 24-slot 합산)
- 예산 위젯 (user_usage_preferences)

`GET /api/usage/me/recent?limit=50` → 최근 50건 이벤트. 90일 이전 조회 시 빈 배열 + "CSV 이용 안내" 힌트.

`GET /api/usage/me/export.csv?month=2026-04` → daily_agg 스트리밍 CSV. `Content-Disposition: attachment`.

### 5.5 예산 경고 플로우

```
[budget_alert_workflow]  (매시간 정각 scheduled)
  For each user where monthly_budget_krw IS NOT NULL AND email_alert_enabled=true:
    spent = SUM(cost_krw) FROM ai_usage_daily_agg this month
    percent = spent / monthly_budget_krw * 100
    IF percent >= alert_threshold_percent AND
       (last_alert_sent_at IS NULL OR last_alert_sent_at < month_start):
      POST /api/internal/budget-alert  (X-Internal-Secret)
        → sendBudgetAlertEmail(email, { percent, spentKrw, limitKrw })
        → UPDATE user_usage_preferences SET last_alert_sent_at = now()
```

월 1회 발송 (다음 달 자동 초기화). Admin 강제 상한으로 갑자기 초과된 경우도 같은 경로.

### 5.6 이상 탐지 플로우

```
[usage_anomaly_workflow]  (매일 KST 10:00 scheduled)
  threshold = env AI_USAGE_ANOMALY_THRESHOLD_KRW_24H (기본 50000)
  window_end = now(), window_start = window_end - 24h

  SELECT user_id, SUM(cost_krw) AS spent
  FROM ai_usage_events
  WHERE created_at BETWEEN window_start AND window_end
  GROUP BY user_id HAVING SUM(cost_krw) > threshold;

  For each:
    INSERT INTO ai_usage_anomalies (...) ON CONFLICT (user_id, window_start) DO NOTHING;
```

### 5.7 Retention 플로우

```
[usage_retention_workflow]  (매일 KST 03:00 scheduled)
  cutoff = now() - 90 days
  LOOP:
    DELETE FROM ai_usage_events WHERE created_at < cutoff LIMIT 10000;
    IF deleted_count < 10000: EXIT
```

`ai_usage_daily_agg` 은 retention 대상 아님 (영구).

---

## 6. UI

### 6.1 사용자 대시보드 (`/settings/usage`)

- **헤더**: "AI 사용량" + 월 드롭다운 (daily_agg 있는 모든 월) + [CSV 다운로드]
- **상단 카드 3개**: (1) 이번 달 총 비용 ₩, BYOK/Managed 분리 표시 (2) 호출 수 (성공/실패) (3) 사용 토큰 (in+out+cached, 모델별은 아래 테이블)
- **예산 위젯 (opt-in)**: 진행도 바 + "80% 도달 시 이메일 알림" 체크 + [예산 변경]
- **일별 꺾은선 차트**: 이번 달 + 전월 대비
- **시간대 Heatmap (24h × 30일)**: hour_histogram 기반, 시간당 평균 호출 수
- **모델별 breakdown 테이블**: 모델 / 호출 / 토큰 / 비용 (내림차순)
- **기능별 breakdown 테이블**: purpose / 호출 / 비용
- **최근 50건 호출 리스트**: 시각 / 모델 / 기능 / 토큰 / 비용 / OK — 90일 이전 조회 시 안내
- **최상단 고지문**: "비용은 추정치입니다. 정확한 청구는 Google Cloud Console에서 확인하세요 (BYOK의 경우)."

### 6.2 Admin Overview (`/admin/usage`)

- **전체 집계**: 오늘 / 이번 주 / 이번 달 총 비용, 호출 수, 활성 사용자 수
- **모델별·기능별 전체 breakdown**
- **Top 10 헤비유저 테이블**: 사용자 / 이번 달 비용 / 호출 / 상한 / 이상 플래그 / drill-down
- **미해결 이상 탐지 리스트**: 시각 / 사용자 / 24h 사용 / 임계 / [해결] [상세]
- **사용자 selector 드롭다운** → drill-down 페이지로

### 6.3 Admin User Drill-down (`/admin/usage/[userId]`)

- 사용자 본인 대시보드를 **동일 레이아웃으로 재사용** (읽기 전용)
- 상단 추가 섹션 **"Admin 조치"**:
  - [월 상한 강제 부여] — 모달: 상한 ₩ + 사유(필수 텍스트) → `admin_monthly_limit_krw` 설정, audit log 기록
  - [BYOK 키 무효화] — 모달: 사유 확인 → `user_preferences.byokApiKey = null`, audit log 기록
  - [사용자 정지] — 기존 Super Admin spec 기능으로 링크
- 하단: 해당 사용자 이상 플래그 히스토리

### 6.4 i18n

- 네임스페이스: `messages/{locale}/usage.json`
- 핵심 키:
  - `usage.title`, `usage.summary.cost`, `usage.summary.calls`, `usage.summary.tokens`
  - `usage.budget.set`, `usage.budget.progress`, `usage.budget.email_opt_in`, `usage.budget.alert_threshold`
  - `usage.table.model`, `usage.table.purpose`, `usage.table.cost_approx`
  - `usage.purposes.compiler`, `usage.purposes.research`, `usage.purposes.librarian`, `usage.purposes.deep_research`, `usage.purposes.ingest_embed`, `usage.purposes.ingest_pdf`, `usage.purposes.ingest_image`, `usage.purposes.ingest_enhance`, `usage.purposes.batch_embed`, `usage.purposes.tts`
  - `usage.recent.retention_notice`, `usage.recent.see_csv`
  - `usage.disclaimer.estimate`, `usage.disclaimer.google_billing`
  - `usage.admin.overview`, `usage.admin.heavy_users`, `usage.admin.anomalies`, `usage.admin.monthly_limit`, `usage.admin.byok_invalidate`, `usage.admin.limit_reason_required`
- 톤: 존댓말, 경쟁사 미언급, 기술 스택 상세 최소화
- ko 먼저, en 런칭 직전 배치 번역

---

## 7. Error Handling · Privacy · Security

### 7.1 Error Handling

| 상황 | 처리 |
|---|---|
| Sink emit 실패 (DB down) | `emit_usage` 내부 warn 로그, 원래 LLM 호출 결과는 정상 반환 |
| 토큰 usage 필드 파싱 실패 | `prompt_tokens=None` 저장, `cost_krw=0`, `error_class="usage_parse_failed"` |
| 가격 테이블에 없는 모델 | `cost_krw=0` + 로그 warn. 주기적 admin 이메일 1회 알림 (가격표 업데이트 필요) |
| Deep Research duration 없음 | time_factor=1.0 (base 그대로) |
| Retention workflow 실패 | Temporal 재시도, 연속 3회 실패 시 Sentry. events 삭제 지연 OK |
| Budget alert Resend 실패 | Sentry + 다음 시간 재시도 (멱등) |
| Anomaly 중복 | `(user_id, window_start)` unique → ON CONFLICT DO NOTHING |
| `/me` 조회 중 부분 쿼리 실패 | 해당 섹션만 에러 상태로 렌더, 나머지는 정상 표시 |

### 7.2 Privacy

- **프롬프트/응답/문서 스니펫 포함 절대 금지** — 오직 메타데이터 (model, tokens, cost, purpose, latency, ok). 코드 리뷰 체크리스트 항목.
- `usage_context` 는 user_id + workspace_id만 전달 — ContextVar는 task-local이라 세션 오염 불가.
- CSV export는 본인 데이터만. admin은 별도 경로.

### 7.3 Security

- `requireSuperAdmin` 미들웨어 재사용 + step-up re-auth (Super Admin spec §3.2)
- Admin 조치 (BYOK invalidate / monthly_limit) 는 `admin_audit_log` 에 기록 (Super Admin spec §6)
- 다른 사용자 데이터 조회 시도 → 404 (존재 은닉, api-contract rule)
- Admin action rate-limit — monthly_limit 변경 분당 10회
- Internal webhook (`/api/internal/budget-alert`) — `X-Internal-Secret` (Plan 3 스킴 재사용)

---

## 8. Testing Strategy

### 8.1 Unit (pytest, `packages/llm/tests/`)

- `test_usage_sink.py` — NullSink / InMemorySink round-trip
- `test_pricing.py` — 각 모델 경계값, USD_TO_KRW_RATE override, unknown model
- `test_gemini_usage_emission.py` — `generate/embed/generate_multimodal/start_interaction` 이 올바른 `UsageEvent` 로 emit하는지 (InMemorySink 검증)
- `test_usage_context.py` — ContextVar 격리, `with usage_context` 데코레이터
- `test_ollama_usage.py` — cost=0, 토큰만 기록

### 8.2 Integration (pytest, `apps/worker/tests/`)

- `test_db_usage_sink.py` — 실제 Postgres testcontainer:
  - 첫 호출 → events + daily_agg 생성
  - 같은 자연키 2번째 → UPSERT (count++, tokens+=, cost+=, hour_histogram slot++)
  - 실패 → 양쪽 rollback
  - 동시 emit → 경합 없음
- `test_usage_retention_workflow.py` — Temporal TestEnvironment: 91일 삭제 / 89일 보존 / 배치 루프 / 재실행 idempotent
- `test_usage_anomaly_workflow.py` — threshold 초과만 insert / 중복 방지 / env override
- `test_budget_alert_workflow.py` — 80% 도달 1회 발송 / 같은 달 중복 방지 / 다음 달 초기화 / disabled 무발송

### 8.3 Integration (vitest, `apps/api/tests/`)

- `usage-routes.test.ts` — 권한 / 월 집계 정확성 / CSV 스트리밍 / Zod
- `admin-usage-routes.test.ts` — super_admin 아니면 404 / drill-down / monthly_limit audit / BYOK invalidate audit

### 8.4 E2E (Playwright)

- 사용자 smoke: 로그인 → `/settings/usage` → 렌더 → CSV 다운로드
- admin smoke: super_admin 로그인 → `/admin/usage` → drill-down → monthly_limit 설정 → audit log 확인

### 8.5 Non-goals

- 실제 Google API 과금 검증 (추정치라 불가)
- 90일치 실제 retention (workflow 동작만 검증, 시간 경과는 mock)
- 대규모 성능 (별도 plan)

---

## 9. Rollout

### 9.1 Feature flag

- `FEATURE_AI_USAGE_DASHBOARD` env (기본 `false`) — 활성화 전에는 `/settings/usage` + `/admin/usage` 라우트 404
- **sink emit은 flag에 관계없이 항상 동작** → 데이터는 계속 쌓임 → flag on 시점에 과거 데이터도 즉시 조회 가능

### 9.2 Phase 순서 (atomic PR 단위)

1. **Phase A** — `packages/llm` Usage 인프라: `usage.py`, `pricing.py`, Gemini/Ollama emit + unit tests
2. **Phase B** — DB 스키마 4 테이블 + `DbUsageSink` + integration tests
3. **Phase C** — Agent 경로 wiring: Compiler/Research/Librarian 의 `ModelEnd` 실제 값 + `agent_runs` flush + activity 진입점 `usage_context` 래핑
4. **Phase D** — Temporal scheduled workflows 3개 + `sendBudgetAlertEmail`
5. **Phase E** — `apps/api /api/usage/*` + `/api/admin/usage/*` + `/api/internal/budget-alert` + Zod
6. **Phase F** — `apps/web /settings/usage` + 컴포넌트
7. **Phase G** — `apps/web /admin/usage` + `admin_audit_log` 연결
8. **Phase H** — Deep Research 연결: `persist_report_activity` emit_usage + `billing_path` enum 통합 ALTER
9. **Phase I** — i18n ko/en parity + feature flag on + E2E smoke + 출시

Phase A–D는 UI 없이 독립적으로 landable (파이프라인만). Phase E 이후 UI.

### 9.3 기존 코드 정리 (본 spec 범위 안)

- **`default_hooks.py`의 `TokenCounterHook`** — 현재 totals 로컬 dict만 쌓음. Phase C에서 `agent_runs` 레코드에 AgentEnd 시점 flush. Plan 12 TODO 종료.
- **ADR-010 신규** — `docs/architecture/adr/010-ai-pricing-table.md` (가격표 업데이트 정책, 환율 가정, 출처)

---

## 10. Open Questions

1. **Gemini SDK `usage_metadata` 필드명** — `candidates_token_count` vs `completion_token_count` 등 SDK 버전에 따라 상이. Phase A에서 실제 호출 후 확정.
2. **Ollama 토큰 수 파싱** — `/api/chat` 응답의 `eval_count` / `prompt_eval_count` 사용. 버전별 누락 가능성 → fallback=None 처리.
3. **환율 고정 vs 실시간** — 결정: **env 상수 유지**, 분기별 수동 업데이트 (ADR-010).
4. **Deep Research estimate 보정** — 실제 Google Cloud 청구서와 추정치 오차가 ±30% 이상이면 계수 조정. 운영 1~2달 후 admin 직접 튜닝. MVP는 현재 공식 그대로.
5. **`billing_path` enum 통합 마이그레이션** — Spec A의 `researchBillingPathEnum` → 본 spec의 `billingPathEnum` 으로 ALTER. Phase H에서 `research_runs.billing_path` 컬럼 타입 변경.
6. **`email_alert_enabled` 기본값** — 결정: **false (opt-in)**. 사용자 첫 진입 시 온보딩 체크박스로 안내.
7. **TTS 가격** — `GEMINI_PRICES_USD_PER_1M_TOKENS` 의 `audio_per_sec_usd` 는 placeholder. TTS 실제 사용 시점에 Gemini 공식 가격표로 업데이트 (현재 TTS는 spec 미구현이라 미확정으로 둠).

---

## 11. Decomposition → Implementation Plan

본 spec은 brainstorming 출력이고, 실행 plan은 superpowers `writing-plans` skill로 별도 생성한다. **Plan 생성 시점은 Deep Research (Spec A) 구현 완료 후** (사용자 결정, 2026-04-22).

9개 Phase를 각각 atomic PR 단위로 분해. Phase A–D는 UI 없이 landable이며, Phase E–G는 UI + API 세트로 묶어 출시할 수 있다. Phase H는 Spec A의 `persist_report_activity` 가 존재해야 하므로 Spec A Phase C 이후에만 실행.

각 Phase 내부에서는 Red-Green-Refactor TDD (superpowers rule).
