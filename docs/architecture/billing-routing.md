# Billing Routing (exploring — not a decision)

> **Status: exploring** (2026-04-23). 대표 제안("임베딩 = 서버 Admin 키, 채팅 = BYOK") 기반으로 논의 정리. **결정 아님.** 결정되는 시점에 ADR로 승격.

`billing-model.md` 가 "누구에게 얼마 청구하냐"의 모델이라면, 본 문서는 "한 요청이 어느 키를 쓰냐"의 **라우팅 정책**.

## 1. 문제 정의

Pro + BYOK 동시 보유 사용자 & 크레딧 잔액 보유 사용자가 증가할 때 어느 키로 어떤 호출을 돌릴지 모호함. 구체적으로:

1. **Gemini 임베딩 API는 paid tier 키만 허용** → free-tier BYOK 사용자는 임베딩 불가
2. 사용자가 동시에 보유할 수 있는 "AI 비용 출처":
   - 본인 BYOK 키 (무료 한도 있음, 초과 시 본인 카드에 과금)
   - 크레딧 잔액 (Pro 전용, 충전식)
   - 서버 Admin 키 (우리 돈, Free/BYOK의 숨은 기본값)
3. 기능별 특성이 다름:
   - **임베딩**: 대량·저단가·paid 강제
   - **Chat/Agent**: 중단가·BYOK free-tier 충분
   - **DeepResearch**: 고단가(Grounded Search 실비)

## 2. 제안 기본 정책 (draft)

> 99% 사용자는 이 기본값 그대로. 커스터마이징은 §3 고급 설정에서.

| 기능 | 기본 키 | 폴백 | 이유 |
|------|--------|-----|------|
| **임베딩** (ingest, RAG) | 서버 Admin 키 | — | Paid tier 강제 + 속도 보장 + BYOK 실수로 크레딧/쿼터 소진 사고 방지 |
| **Chat / Agent** | BYOK (있으면) → 크레딧 (Pro) → Admin (Free만) | 다음 우선순위로 자동 폴백 | BYOK free-tier가 충분한 경우가 많음 |
| **DeepResearch** | 크레딧 (Pro, 선결제 확보) → BYOK 허용 | — | Grounded Search 실비를 BYOK 무료한도에서 돌리면 한 번에 터짐 |
| **STT (Whisper fallback)** | 서버(CPU) | — | Provider-free |

**전제**: 서버 Admin 키로 부담한 임베딩 비용은 요금제 가격에 녹이고, 이상사용자는 `super_admin_spec` MVP로 차단 (대량 업로드 스팸 케이스).

## 3. 고급 설정 (`설정 > 사용 경로`)

Pro 사용자 한정으로 노출, 기본 접힘.

- [ ] `임베딩도 내 BYOK로`  
  ⚠️ Gemini paid tier 키 필요. Free-tier 키면 즉시 명시적 에러 (silent fallback 금지 — `feedback_byok_cost_philosophy` 원칙).
- **Chat/Agent 우선순위**: BYOK-first / Credit-first / Admin-only
- **폴백 허용**: 우선 경로 실패 시 다음 경로로 자동 넘어갈지 (on/off)
- **DeepResearch 키 소스**: Credit-only / BYOK 허용

## 4. 원칙 (깨면 안 되는 것)

- **`feedback_byok_cost_philosophy`**: 사용자가 지불하는 경로는 "사용자 보호" 명목으로 선제 차단 금지. 관리형의 "선결제 확보" 목적만 게이팅 허용.
- **`feedback_llm_provider_env_only`**: provider 자체는 env 고정. UI에서 provider 노출 금지. 본 문서의 "키 소스" 선택은 provider 선택이 아닌 **같은 provider 내의 키 출처** 선택.
- **Silent fallback 금지**: 정책 기본값 외의 폴백이 발동하면 UI에 "이 요청은 [크레딧/Admin]으로 처리됨" 로그/토스트 표시.

## 5. Open Questions

- [ ] 임베딩 서버 Admin 키 부담을 플랜별로 어디까지 허용할지 (Free 월 한도? BYOK는 무제한?). `billing-model.md` §Free 한도와 크로스 참조 필요.
- [ ] 이상사용자 임계값 — 1일 임베딩 토큰 N 이상이면 자동 제한? `super_admin_spec`에서 다룸.
- [ ] 크레딧 + BYOK 동시 소지자가 "크레딧 먼저 다 쓰고 BYOK로 넘어가기" UX 원할 가능성. §3에 `Credit-first` 옵션으로 커버되는지 확인.
- [ ] Agent 내부의 개별 tool 호출(예: 웹 스크레이프 후 요약)이 다른 키 소스를 써야 하는 경우가 생기는지 — 에이전트 단위 vs 호출 단위 라우팅.

## 6. Next Steps

1. `billing-model.md` §Free 한도와의 정합성 크로스체크
2. `super_admin_spec` 이상사용자 임계값과 통합 스펙 작성
3. UI 목업: 설정 > 사용 경로 (고급 섹션)
4. 구현 시점 확정되면 본 문서 → ADR로 승격, `docs/architecture/adr/` 로 이동
