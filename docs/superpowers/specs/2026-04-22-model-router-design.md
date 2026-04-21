# Model Router — Adaptive Model & Thinking Budget Selection

**Status:** Draft (2026-04-22)
**Owner:** Sungbin
**Related:**
- [agent-runtime-standard-design.md](./2026-04-20-agent-runtime-standard-design.md) — `AgentEvent` / per-agent cost ceiling
- [multi-llm-provider-design.md](./2026-04-13-multi-llm-provider-design.md) — `LLMProvider` / `ProviderConfig`
- [agent-humanizer-design.md](./2026-04-22-agent-humanizer-design.md) — `route_decision` 이벤트 렌더링
- [billing-model.md](../../architecture/billing-model.md) — PAYG / plan 한도
- 레퍼런스: Cursor Auto Mode, Perplexity Auto/Pro/Deep, Claude.ai mobile 숨은 라우팅

## Dependencies

- **Plan 12 (Agent Runtime Standard)** — 각 에이전트의 `preferred_mode()` 메서드를 통해 Layer A 룰을 선언.
- **Plan 13 (Multi-LLM Provider)** — 라우터가 `ProviderConfig`를 생성. Gemini 전용 아님, Ollama 호환 필수.
- **Plan 9 (Billing)** — PAYG 잔액 조회 API를 라우터가 호출. 잔액 부족 시 강등.
- **본 spec 구현의 가장 빠른 진입 시점**: Plan 11A (최소 채팅) 직후. Humanizer spec과 병렬 진행 가능.

---

## 1. Problem

현재 모델 선택은 **전역 1개 + BYOK override** 구조다 (`user_preferences.llm_model = 'gemini-3-flash-preview'`). 문제:

1. **한 모델이 모든 작업에 최적은 아니다** — 단순 추출은 Flash 과잉, 긴 논문 작성은 Flash 부족
2. **Thinking 버젯을 사용자가 수동 조절 불가** — Gemini 3.x는 off/low/auto/high/max 스펙트럼이 있지만 노출 안 됨
3. **비용 예측성 낮음** — 어떤 질문이 Pro로 가고 어떤 질문이 Flash로 가는지 불투명, cost ceiling만 있음
4. **에이전트별 최적값이 하드코딩 예정** — Compiler=Flash Lite+think(low), Librarian=Pro+think(high) 같은 프리셋이 `runtime/` 안에 박힐 위험 (Plan 13이 이걸 막으려 추상화했는데)
5. **사용자에게 "빠르게 / 정확하게" 스위치가 없다** — Cursor/Perplexity가 제공하는 기본 UX

## 2. Goals & Non-Goals

**Goals**
- 사용자에게 5개 모드 노출 (`auto`, `fast`, `balanced`, `accurate`, `research`) — 그 이상 복잡도는 숨김
- `auto` 모드의 투명성 — 어떤 실제 모델로 결정됐는지 채팅에 작게 표시
- 에이전트별 프리셋을 선언형으로 등록 (`Agent.preferred_mode()`)
- 비용 폭발 방지 — `auto`는 `accurate`로 자동 승격 안 함 (사용자 명시적 선택만)
- Gemini / Ollama 모두 지원 — 라우터는 provider-agnostic
- 관찰성 — `route_decision` 이벤트로 모든 결정 로그

**Non-goals (v0.1)**
- 학습 기반 라우터 (ML 분류기 훈련) — 규칙 기반 + 작은 LLM 분류기로 충분
- 사용자 이력 기반 개인화 라우팅 — 프라이버시/복잡도 대비 이득 낮음
- 실시간 A/B 실험 프레임워크 — 로그만 쌓고 분석은 수동
- Multi-turn 대화 내 mode 자동 변경 — 세션 시작 시 1회 결정, 중간 변경은 사용자가 명시

## 3. 사용자 노출 모드 (5개)

| 모드 | 아이콘 | 실제 선택 | 언제 |
|---|---|---|---|
| **auto** ⭐ | — | 라우터가 결정 (기본값) | 대부분 |
| **fast** | ⚡ | Flash no-think | 단순 질문, 대화, 빠른 추출 |
| **balanced** | ⚖ | Flash + think(auto) | 일반 질문 / 기본 Q&A |
| **accurate** | 🎯 | Pro + think(high) | 논문 작성, 복잡 추론 |
| **research** | 🔬 | Deep Research Agent | 장시간 조사 (분 단위) |

### 3.1 설계 원칙

- **5개 이상 절대 금지** — Perplexity도 3개(Auto/Pro/Deep), Cursor도 2개(Auto/Pro) 구조. 옵션 과잉은 선택 마비.
- **thinking budget 숫자 노출 금지** — 파워유저도 귀찮아함. 모드 이름 = budget 정책.
- **mode별 expected cost 표시** — `⚖ balanced (~₩15)` 형식으로 UI에 힌트.

### 3.2 모드 권한

| 티어 | auto | fast | balanced | accurate | research |
|---|---|---|---|---|---|
| Free | ✅ | ✅ | ✅ | ❌ | ❌ |
| BYOK | ✅ | ✅ | ✅ | ✅ | ✅ (본인 키) |
| Pro (PAYG) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Enterprise | ✅ | ✅ | ✅ | ✅ | ✅ |

Free 티어가 `accurate` / `research` 누르면 업그레이드 CTA 표시.

## 4. 2-Layer Routing (`auto` 모드 내부)

### 4.1 Layer A — Rule-based (99% 케이스, 0ms)

에이전트가 고정 타입이면 룰로 즉시 결정:

```python
# packages/llm/src/router/rules.py

AGENT_MODE_MAP = {
    "compiler":     Mode.FAST_LITE_THINK,   # Flash Lite + think(low)
    "research":     Mode.BALANCED,          # Flash + think(auto)
    "librarian":    Mode.ACCURATE,          # Pro + think(high)
    "connector":    Mode.FAST_LITE_THINK,
    "curator":      Mode.FAST_LITE_NO_THINK,
    "socratic":     Mode.FAST,              # Flash no-think (대화)
    "narrator":     Mode.FAST,              # Flash no-think (대화)
    "temporal":     Mode.FAST_LITE_NO_THINK,
    "synthesis":    Mode.BALANCED,
    "code":         Mode.BALANCED,          # CoT 이득 큼
    "visualization": Mode.FAST,
    "deep_research": Mode.RESEARCH,         # 별도 agent
}
```

이 맵은 소스 진실: 바꾸면 `Agent.preferred_mode()` 선언과 같이 수정.

### 4.2 Layer B — Classifier (사용자 ad-hoc 질문)

사용자가 Research 에이전트에 자유 질문하면 Layer A만으론 부족 (질문별 복잡도 다름). 작은 LLM 1콜로 분류:

```python
async def classify(prompt: str) -> ClassifierResult:
    # Flash Lite, ~50 tokens output, cached by prompt hash (TTL 10min)
    response = await flash_lite.generate(
        system=CLASSIFIER_PROMPT,
        user=prompt,
        response_schema=ClassifierResult,
        thinking_budget=0,  # 분류기는 think off
    )
    return response
```

**ClassifierResult 스키마:**

```python
class ClassifierResult(BaseModel):
    complexity: Literal["low", "medium", "high"]
    needs_reasoning: bool       # 다단계 추론 필요?
    needs_long_context: bool    # 500k+ 토큰 입력?
    code_heavy: bool            # 코드 위주?
    recommended_mode: Literal["fast", "balanced", "accurate"]
    confidence: float           # 0.0-1.0
```

**CLASSIFIER_PROMPT** (한국어 프롬프트):
```
사용자 질문을 분류하세요. 출력은 JSON만.

분류 기준:
- low: 단순 사실 조회, 1-2문장 답변 가능
- medium: 여러 정보 결합, 요약·비교·설명
- high: 다단계 추론, 코드 생성, 수학, 창작

recommended_mode:
- low + !needs_reasoning → fast
- medium or high → balanced
- high + (long_context or code_heavy) → accurate

확신 < 0.7이면 한 단계 위로 (보수적).
```

### 4.3 Layer A vs B 분기

```
if agent_type in AGENT_MODE_MAP and agent_type != "research":
    return Layer A
if agent_type == "research" and user_query:
    return Layer B (classifier)
fallback: Mode.BALANCED
```

### 4.4 Cache

Classifier 결과는 prompt hash (sha256 첫 16자) + user_id 기준 캐시, TTL 10분. 같은 질문 반복 시 0 LLM 호출. 캐시 스토리지: Redis (이미 인프라에 있음).

## 5. Thinking Budget 매핑

### 5.1 내부 enum

```python
class ThinkingBudget(str, Enum):
    OFF  = "off"      # 0
    LOW  = "low"      # 1024
    AUTO = "auto"     # Gemini 자체 결정
    HIGH = "high"     # 8192
    MAX  = "max"      # 24576 (Gemini 3.x 상한)

BUDGET_TOKENS = {
    "off":  0,
    "low":  1024,
    "auto": None,
    "high": 8192,
    "max":  24576,
}
```

### 5.2 Mode → (model, thinking) 매핑

```python
MODE_CONFIG = {
    Mode.FAST:              ("flash", "off"),
    Mode.FAST_LITE_NO_THINK: ("flash_lite", "off"),
    Mode.FAST_LITE_THINK:   ("flash_lite", "low"),
    Mode.BALANCED:          ("flash", "auto"),
    Mode.ACCURATE:          ("pro", "high"),
    Mode.RESEARCH:          ("deep-research-preview-04-2026", "n/a"),
}
```

`Mode` enum은 내부용 (위 룰 + 분류기가 사용). 사용자에겐 `UserMode` (auto/fast/balanced/accurate/research) 5개만.

## 6. Cost Guardrails

### 6.1 Auto 모드 상한

**`auto`는 절대 `accurate`로 자동 승격하지 않는다.** 최대 `balanced`까지. `accurate` / `research`는 사용자 명시 선택.

이유: 자동 승격은 사용자 예상 비용을 초과하게 만듦. "왜 이렇게 비싸?" 신뢰 훼손.

### 6.2 PAYG 잔액 강등

```python
if user.payg_balance < threshold and mode == Mode.BALANCED:
    return downgrade_to(Mode.FAST, reason="payg_low_balance")
```

강등 시 `route_decision` 이벤트에 `downgraded: true` 플래그 + 사용자 인앱 알림 ("잔액이 낮아 빠른 모드로 전환됐어요. 충전하시면 원래 품질로 돌아갑니다").

### 6.3 Pre-flight 비용 추정

채팅 input 필드 옆에 예상 비용 힌트:

```
[auto ▾]  예상 ~₩8 (balanced 예정)
[accurate ▾]  예상 ~₩120 ⚠
```

₩100 이상일 때 ⚠ 경고. ₩500 이상이면 전송 전 명시 확인 다이얼로그 (이미 Deep Research는 billing-model.md §선결 정책 있음 — 그 재사용).

### 6.4 Cost ceiling 충돌

`agent-behavior-spec.md`의 per-run ceiling (Pro ₩500 등)과 라우터 선택이 충돌하면 **ceiling이 라우터를 누른다**. 라우터가 Pro+think(high)를 제안해도 ceiling이 ₩100이면 balanced로 강등 + 로그.

## 7. Ollama / Self-host 처리

Ollama는 티어 구조가 다름 (같은 모델의 크기 변형, thinking은 지원 모델에만).

```python
OLLAMA_MODE_MAP = {
    Mode.FAST:           ("llama3:8b", "off"),
    Mode.BALANCED:       ("llama3:70b", "off"),          # size↑로 compensate
    Mode.ACCURATE:       ("deepseek-r1:32b", "auto"),    # think 지원 모델
    Mode.RESEARCH:       None,  # Not supported — fallback to balanced + 수동 루프
}
```

**Fallback 규칙:**
- Ollama에서 think 지원 안 하는 모델 선택 시 → think off + AgentEvent에 `fallback: true`
- Deep Research는 Ollama 미지원 → balanced로 강등 + UI에 "Self-host에선 Deep Research 미지원" 고지

## 8. Data Model

### 8.1 `user_preferences` 변경 (의미 변경)

```ts
// Before
llmModel: text("llm_model").notNull().default("gemini-3-flash-preview"),

// After (별도 마이그레이션 plan)
defaultMode: text("default_mode").notNull().default("auto"),
// llm_model은 deprecate (BYOK 하드 지정자만 사용), 한 버전 유예 후 삭제
```

### 8.2 `RouteDecision` 이벤트

```python
class RouteDecision(BaseModel):
    type: Literal["route_decision"] = "route_decision"
    user_mode: UserMode             # 사용자가 선택한 모드 (auto 포함)
    resolved_mode: Mode             # 실제 내부 해결된 모드
    provider: str                   # "gemini" | "ollama"
    model: str                      # 실제 model ID
    thinking_budget: ThinkingBudget
    layer: Literal["A", "B", "fallback"]
    reason: str                     # "rule:research", "classifier:medium", "downgraded:payg"
    estimated_cost_krw: int
    confidence: float               # Layer B classifier의 confidence, Layer A는 1.0
```

### 8.3 Humanizer와의 접점

`route_decision` 이벤트는 humanizer에서 짧은 status line으로 변환:

```
⚖ balanced → flash + think(auto)   (예상 ₩8)
```

UI에 status bar 하단에 작게 표시. 클릭하면 상세 (layer, reason, confidence) 노출.

## 9. API Surface

### 9.1 Router 함수

```python
# packages/llm/src/router/__init__.py

async def resolve(
    *,
    user: User,
    user_mode: UserMode,              # "auto" | "fast" | ...
    agent_type: AgentType | None,
    prompt: str | None,                # Layer B 필요 시
    context_size: int = 0,
) -> RouteDecision:
    """Return fully resolved routing decision. No LLM call for Layer A."""
```

### 9.2 Agent ABC 확장

```python
# apps/worker/src/runtime/agent.py

class Agent(ABC):
    @classmethod
    def preferred_mode(cls) -> Mode:
        """Layer A 룰 선언. 기본 BALANCED."""
        return Mode.BALANCED
```

각 에이전트는 override:

```python
class CompilerAgent(Agent):
    @classmethod
    def preferred_mode(cls) -> Mode:
        return Mode.FAST_LITE_THINK
```

`AGENT_MODE_MAP` 딕셔너리는 이 선언들의 자동 aggregation (런타임에 subclass 스캔).

### 9.3 API 엔드포인트

채팅 시작 시 클라이언트가 `user_mode`를 payload에 담음:

```ts
POST /api/agents/chat
{
  "conversation_id": "...",
  "message": "...",
  "user_mode": "auto"  // or "fast" | "balanced" | "accurate" | "research"
}
```

서버는 라우터 호출 → RouteDecision → AgentEvent로 먼저 emit → 에이전트 실행.

## 10. Anti-patterns

| 하지 말 것 | 왜 |
|---|---|
| Router가 LLM 호출 자체를 wrapping | Provider abstraction 깨짐. Router는 `ProviderConfig`만 생성, 호출은 Provider가. |
| Router 결정을 사용자에게 숨김 | "왜 느리지/비싸지?" 불신. 작게라도 표시 필수. |
| Thinking on/off를 mode 바깥 별도 토글 | "balanced인데 think 꺼짐?" 모순. 모드 안에 묶어야. |
| Classifier에 Pro 사용 | 1콜 때문에 Pro면 본말전도. Flash Lite 고정 + think off. |
| 사용자별 auto 학습 (v0.1) | 프라이버시 / "왜 내 계정만 느리지?" 디버그 지옥. Session-scoped. |
| Mode를 `user_preferences`에 저장 | 세션마다 다를 수 있음. 요청 payload로. 기본값만 DB에. |
| Free에서 accurate 클릭 시 silent fallback | 사용자 속임. 업그레이드 CTA를 명시적으로. |
| Research 에이전트 내부 호출도 라우터 통과 | 에이전트 내부 툴 호출 (hybrid_search 등)은 별도, 외부 호출만 라우터. |

## 11. Testing Strategy

### 11.1 Router 단위 테스트

```python
def test_router_layer_a_compiler():
    decision = asyncio.run(resolve(
        user=pro_user, user_mode="auto", agent_type="compiler", prompt=None
    ))
    assert decision.resolved_mode == Mode.FAST_LITE_THINK
    assert decision.layer == "A"
    assert decision.reason.startswith("rule:")

def test_router_layer_b_classifier_cached():
    # 같은 프롬프트 2번 → 2번째는 classifier LLM 호출 안 됨
    ...

def test_router_downgrade_payg_low():
    user = pro_user.with_balance(100)
    decision = asyncio.run(resolve(user=user, user_mode="auto", ...))
    assert decision.resolved_mode == Mode.FAST
    assert "downgraded" in decision.reason

def test_router_free_tier_accurate_blocked():
    with pytest.raises(PermissionError, match="accurate requires Pro"):
        asyncio.run(resolve(user=free_user, user_mode="accurate", ...))
```

### 11.2 Eval set (정확도 회귀 방지)

`apps/worker/tests/eval/router_eval.py`:

100개 정답 세트 (query → expected_mode). 라우터 변경 시 회귀 비율 측정. 90% 이상 유지.

| Query | Expected |
|---|---|
| "오늘 날씨는?" | fast |
| "내 노트에서 CNN 찾아줘" | balanced |
| "이 논문을 한국어로 요약해줘 (1만자)" | accurate |
| "삼성전자 반도체 경쟁력 딥리서치" | research |

### 11.3 Classifier 품질 모니터링

주간 로그 집계:
- Classifier confidence < 0.7 비율 → 높으면 프롬프트 개선 신호
- 사용자가 mode 수동 변경 비율 → auto 부정확 신호
- Downgrade 발생률 → threshold 튜닝 신호

## 12. Rollout

| Phase | 범위 |
|---|---|
| v0.1 | Layer A (룰 기반)만. 모든 에이전트 `preferred_mode()` 선언. `auto` = Layer A만. |
| v0.2 | Layer B 분류기 추가. Research 에이전트 ad-hoc 질문에 적용. Eval set 초기 구축. |
| v0.3 | Cost guardrail + PAYG 강등. 사용자 UI 모드 선택기. RouteDecision → humanizer 표시. |
| v0.4 | Ollama tier 매핑. Self-host 사용자 피드백 수집. |
| v1.0 | Eval set 200개로 확대, 모니터링 대시보드. |

## 13. Open Questions

1. **Mode를 conversation 단위로 저장할지, turn 단위로 할지** — Cursor는 conversation 단위, Claude는 turn 단위. OpenCairn은 turn 권장 (사용자가 질문마다 복잡도 다름)
2. **`auto` 기본값을 사용자 프로필에 저장 허용?** — `defaultMode: "balanced"` 저장 원하는 파워유저 있을 수 있음. 옵션 제공, 기본은 `auto`.
3. **Classifier 프롬프트의 언어** — 한국어로만? 영어 질문 들어오면? → langdetect + 자동 전환, 실패 시 영어 프롬프트 fallback
4. **Mode 선택 키보드 단축키** — 채팅 입력에서 `Alt+1~5`로 모드 전환? 파워유저 가속
5. **Accurate 모드에 빈번한 승격 CTA** — 사용자 질문이 일관되게 복잡하면 auto → accurate 제안 인앱 프롬프트? 아니면 noise?

## 14. Success Metrics

- **비용 효율**: 동일 품질 대비 총 LLM 비용 v0.1 대비 25% 절감 (auto가 과잉 Pro 호출 안 함)
- **사용자 만족**: "모델 선택이 혼란스럽다" 설문 피드백 < 10%
- **Auto 정확도**: Layer A/B 결정이 사용자 수동 변경과 일치하는 비율 > 80%
- **비용 폭발 사고**: "예상보다 비쌌다" 불만 < 월 5건
- **관찰성**: 모든 `auto` 결정이 `route_decision` 이벤트로 로깅됨 (100%)
