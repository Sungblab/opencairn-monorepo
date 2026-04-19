# Incident Response Runbook

1인 개발자가 OpenCairn 셀프호스트 인스턴스를 운영할 때 장애를 **감지 → 분류 → 대응 → 회고**하는 절차. 이 runbook은 당직/호출을 "내가 나에게" 하는 구조를 전제로 설계됐다. 외부 팀 운영으로 확장하려면 §7 에스컬레이션 테이블을 채운다.

---

## 1. 알림 채널

| 채널 | 용도 | 지연 목표 |
|------|------|----------|
| **Telegram 봇** (`@opencairn_ops_bot`) | 모든 Critical/High 알럿, 인앱 알림과 독립 | 30초 |
| **Email** (운영자 주 메일) | Medium 이하, 일일 요약, 백업/보안 리포트 | 5분 |
| **Discord #opencairn-ops** | 커뮤니티 셀프호스터 공유용 (opt-in) | 분 단위 |
| **Sentry** | Error 이벤트 대시보드, 스택트레이스 집계 | 실시간 |
| **Grafana / Uptime Kuma** | 헬스체크, 응답 시간, SLO 대시보드 | 분 단위 |

> **구성 메모**:
> - 각 서비스는 `OPS_WEBHOOK_URL` env로 알림 채널을 받는다. Prometheus Alertmanager가 Telegram + Email + Sentry로 팬아웃.
> - 1인 운영자 기본 채널은 Telegram (휴대폰 푸시 → 침묵 시간 무시) + Email (보관).

---

## 1.1 Monitoring Stack 설정

| 도구 | 역할 | 접속 | Secret 변수 |
|------|------|------|-------------|
| Sentry | 에러 트래킹 | sentry.io/org/opencairn | `SENTRY_DSN` (web/api/worker 각각) |
| Grafana | 메트릭 대시보드 | grafana.opencairn.com (staging/prod) | `GRAFANA_API_KEY` |
| Prometheus | 메트릭 수집 | prometheus 내부 | (없음, pull 기반) |
| Alertmanager | 알림 라우팅 | alertmanager 내부 | `ALERTMANAGER_CONFIG` |
| Telegram bot | 온콜 알림 | `@opencairn_ops_bot` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |

**Alert 라우팅**:
- P0 (가용성) → Telegram + Email (즉시)
- P1 (성능 저하) → Telegram (5분 집계)
- P2 (비즈니스 지표) → Email daily summary

**Dashboard ID** (임시 TBD — staging 구성 후 확정):
- API latency: [TBD]
- Ingest pipeline: [TBD]
- Agent cost: [TBD]

---

## 2. 심각도 분류 (Severity)

| 심각도 | 정의 | 대응 시간 SLO | 예시 |
|--------|------|--------------|------|
| **S1 Critical** | 전 서비스 다운 or 데이터 손실 위험 | **15분 내 액션** | API 5xx > 50%, DB 접속 불가, Temporal 클러스터 다운, BYOK 키 암호화 실패 |
| **S2 High** | 부분 장애, 핵심 기능 손상 | **1시간 내** | Ingest workflow 실패율 > 10%, LLM provider 다운, R2 업로드 실패 |
| **S3 Medium** | 저하된 서비스, 사용자 체감 가능 | **8시간 내** | 특정 에이전트 실패, Hocuspocus 연결 불안정, 캐시 히트율 급락 |
| **S4 Low** | UX 문제, 로그 노이즈 | 다음 근무일 | CSP 경고, deprecated API 사용 경고, 요금제 UI 표시 오류 |

---

## 3. 감지 자동화 (Alert Rules)

### 3.1 가용성

| 룰 | 임계값 | 심각도 |
|----|--------|--------|
| `up{job="api"} == 0` | 60초 | S1 |
| `up{job="worker"} == 0` | 60초 | S1 |
| `up{job="temporal"} == 0` | 60초 | S1 |
| `up{job="postgres"} == 0` | 30초 | S1 |
| `up{job="hocuspocus"} == 0` | 120초 | S2 |
| `up{job="tectonic"} == 0` | 300초 | S3 |

### 3.2 에러율

| 룰 | 임계값 | 심각도 |
|----|--------|--------|
| `rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.5` | S1 |
| `rate(temporal_activity_fail[5m]) > 0.1` on IngestWorkflow | S2 |
| `rate(llm_errors_total[5m]) > 10` | S2 |
| Sentry new issue (uncaught) | 즉시 | S3 |

### 3.3 보안

| 룰 | 임계값 | 심각도 |
|----|--------|--------|
| 인증 실패 burst: `rate(auth_failures[1m]) > 50` | | S1 |
| BYOK 복호화 실패 burst: `rate(byok_decrypt_errors[5m]) > 3` | | S1 (키 유출 의심) |
| Toss webhook 서명 불일치 연속 5회 | | S2 |
| CSP 위반 보고 급증: `rate(csp_reports[5m]) > 100` | | S2 |

### 3.4 SLO

- **가용성 SLO**: 월 99.5% (허용 다운타임 3시간 40분).
- **업로드→위키 지연 SLO**: 95%ile < 60초 (PDF 20MB 기준), 위반 시 S3.
- **Q&A 응답 지연 SLO**: 95%ile < 8초 (비 deep-research), 위반 시 S3.

---

## 4. 시나리오별 대응

### 4.1 Postgres 다운

1. **감지**: `up{postgres}` 0 또는 API 5xx 폭증.
2. **즉시 확인**:
   ```bash
   docker-compose logs --tail=200 postgres
   docker-compose ps postgres
   ```
3. **복구 순서**:
   - 디스크 full 여부 확인 (`df -h`). full이면 backup 디렉토리·WAL 정리.
   - 컨테이너 재시작: `docker-compose restart postgres`.
   - 3분 내 회복 없으면 백업에서 복원 — [backup-strategy.md](../architecture/backup-strategy.md)의 "복구 절차" 참조.
4. **파급**: API, Hocuspocus, Temporal, Worker 모두 DB에 의존 → DB 복구 후 각 서비스 재시작.
5. **사후**: 원인 로그 아카이브, RCA 작성.

### 4.2 Temporal 클러스터 다운

1. **감지**: `up{temporal}` 0, 워크플로우가 진행 안 됨.
2. **행동**:
   - `docker-compose logs temporal | tail`
   - `temporal-ui` 접근 가능한지 확인
   - 데이터베이스 연결 문제면 §4.1 먼저 해결
3. **복구**: `docker-compose restart temporal`. Temporal은 상태를 Postgres에 저장하므로 무손실 재시작 가능.
4. **대기 중이던 IngestWorkflow**: 자동 재개. 실패한 activity는 Temporal retry policy로 재실행.

### 4.3 LLM Provider 다운 / 429 폭증

1. **감지**: `rate(llm_errors_total) > 10/5m`.
2. **즉시 조치**:
   - Provider 상태 페이지 확인 (status.google.com, Ollama)
   - `packages/llm`의 지수 백오프가 동작 중인지 로그 확인
   - Gemini 다운이면 Ollama 로컬로 수동 전환 (`LLM_PROVIDER=ollama`, worker 재시작).
3. **사용자 커뮤니케이션**: 상태 페이지(v0.2 예정)에 공지, 그때까지는 X/트위터 또는 Telegram 채널에 공지.
4. **파급 범위**:
   - Compiler/Research 에이전트 중단 → 사용자가 질문 실패
   - 진행 중이던 jobs: Temporal이 자동 재시도 (백오프 1h까지).

### 4.4 R2 업로드 실패

1. **감지**: `rate(r2_upload_errors) > 5/5m`.
2. **원인 구분**:
   - Cloudflare 장애: 상태 페이지 확인
   - credentials 만료: IAM 콘솔에서 키 로테이션
   - 버킷 quota 초과: 청크/문서 cleanup
3. **임시 우회**: MinIO 로컬로 기록 (`S3_ENDPOINT=http://minio:9000`) — dev 환경에 한정. Prod는 알려진 백업 버킷으로 failover.

### 4.5 BYOK 키 유출 의심

**S1 — 가장 심각**. 절차 엄수.

1. 즉시 **`BYOK_ENCRYPTION_KEY` 로테이션** ([security-model.md](../architecture/security-model.md) §4.2).
2. 세션 전체 무효화: `DELETE FROM sessions` + 사용자에게 재로그인 공지.
3. 사용자별 알림: 이메일로 "BYOK 키를 재등록해주세요" 안내.
4. Sentry·Grafana에서 영향 범위 추정: 유출 시점 ~ 감지 시점 사이 `resolveGeminiKey` 호출 로그 전부 아카이브.
5. 법적 대응 필요 시 한국 개인정보보호위원회 신고 72시간 기한 확인.
6. RCA 작성, 재발 방지 액션(env 접근 제한, secret manager 도입 등).

### 4.6 Hocuspocus 연결 불안정

1. 단독 장애는 S2 (핵심 기능은 API로 여전히 동작).
2. 재시작: `docker-compose restart hocuspocus`.
3. 세션 잔존이 길면 WebSocket 연결이 stale 할 수 있음 → 브라우저 reload 안내.

### 4.7 Ingest workflow 연속 실패 (특정 파일 포맷)

1. Temporal UI에서 실패 activity 스택트레이스 확인.
2. 포맷 자체 문제라면: `plan-3` quarantine 경로로 자동 이동됐는지 확인.
3. opendataloader/unoserver 버그라면: 관련 issue 트래커 확인 + 임시 rollback 검토.

### 4.8 비용 폭발 (agent 비용 ceiling 초과)

1. **감지**: Grafana 대시보드의 `gemini_token_cost_hour`가 임계 초과.
2. **즉시**: `docker-compose stop worker` — 에이전트 일시 정지.
3. **분석**: agent-behavior-spec의 cost ceiling 위반 agent 찾기. Temporal UI에서 어떤 workflow가 폭주했는지.
4. **해소**: 문제 agent의 rate limit 강화, 버그라면 롤백.

---

## 5. 정기 점검

| 주기 | 항목 |
|------|------|
| 일간 | Sentry 신규 에러 확인, 백업 잡 성공 확인 |
| 주간 | SLO 리포트, 리소스 사용 추이, quarantine 폴더 검토 |
| 월간 | 백업 복구 리허설 (backup-strategy §7), 접근 권한 감사, 시크릿 로테이션 검토 |
| 분기 | DR 시나리오 시뮬레이션, BYOK 키 로테이션, 알럿 룰 튜닝 |

---

## 6. On-call 스크립트 (1인 운영)

**하루 루틴**:
1. 오전: Grafana 대시보드 대략 훑기 (30초)
2. Sentry 미해결 이슈 큐 확인 (1분)
3. Temporal UI에서 failed workflow 0건인지 확인 (30초)

**퇴근/취침 전**:
- Telegram 봇 활성화 상태 확인
- S1 알럿이 들어오면 즉시 일어날 수 있는 상태로 설정 (iPhone Emergency Bypass 등)

**휴가 중 (>3일)**:
- 셀프호스터 커뮤니티에 사전 공지
- 자동 응답 이메일 설정 (긴급 연락처 없음을 명시)
- 분기별 "maintenance mode" toggle env (`MAINTENANCE_MODE=true`): 사용자 접근을 읽기 전용으로 제한 — 새 ingest/billing 차단.

---

## 7. 에스컬레이션 (팀 확장 시)

| 심각도 | 1차 | 2차 (45분 후) | 3차 (2시간 후) |
|--------|------|--------------|----------------|
| S1 | Primary on-call | Secondary | Engineering lead |
| S2 | Primary on-call | Secondary (optional) | — |
| S3 | Primary on-call | 다음 근무일 | — |
| S4 | 티켓화 | — | — |

v0.1 (1인 운영)에는 빈 칸으로 두고, 팀 합류 시 채운다.

---

## 8. Post-Mortem (RCA) 양식

장애 종결 후 48시간 내 작성.

```markdown
# Incident <date> - <short title>

**Severity:** S1|S2|S3|S4
**Duration:** <start> - <end> (UTC)
**Detected by:** <alert|user report|manual>
**Resolved by:** <engineer>

## Timeline
- HH:MM - 이벤트
- HH:MM - 감지
- HH:MM - 대응 시작
- HH:MM - 복구
- HH:MM - 정상화 확인

## Impact
- 영향 받은 사용자 수 / 기능 / 지연 시간
- 데이터 손실 여부 (yes/no)
- 금전적 손실 추정

## Root Cause
- 직접 원인
- 기여한 요인 (contributing factors)

## What Went Well
- 감지가 빨랐던 부분, 도구가 도움 된 부분

## What Went Wrong
- 감지 지연, 대응 혼선, 정보 부족

## Action Items
- [ ] <owner> <due> — <설명>
```

작성된 RCA는 `docs/runbooks/post-mortems/YYYY-MM-DD-<slug>.md`에 보관. PR로 커밋해 히스토리 추적.

---

## 9. 관련 문서

- [backup-strategy.md](../architecture/backup-strategy.md) — 백업·복구 세부 절차
- [security-model.md](../architecture/security-model.md) — 보안 경계 및 BYOK 키 로테이션
- [agent-behavior-spec.md](../agents/agent-behavior-spec.md) §4 Failure Modes — 에이전트별 장애 모드
- [testing/strategy.md](../testing/strategy.md) — CI 파이프라인

---

## 10. 변경 이력

- 2026-04-18: 최초 작성. 1인 운영 전제, Telegram/Email 2 채널, S1~S4 기준 + 시나리오 7종.
