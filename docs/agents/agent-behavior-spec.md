# Agent Behavior Specification

12개 에이전트 (v0.1)의 가드레일, 정지 조건, 충돌 해결 규칙, 피드백루프를 정의한다.

> **2026-04-14 명단**: Compiler / Librarian / Research / Connector / Socratic / Temporal / Synthesis / Curator / Narrator / Deep Research / Code / Visualization. Hunter는 v0.2로 이관됨.

---

## 1. Global Rules (모든 에이전트 공통)

### 실행 환경
- 모든 에이전트는 Temporal Activity로 실행됨
- 각 Activity는 독립적으로 재시도 가능 (최대 3회, 지수 백오프)
- Activity 타임아웃: 기본 5분, Deep Research는 30분

### Workspace 스코프 (2026-04-18 협업 도입)

- **모든 에이전트 activity의 input에 `workspace_id` + `user_id` 필수**. 누락 시 Zod 검증 실패로 즉시 reject.
- 에이전트가 읽는 모든 리소스는 `workspace_id`로 필터링. Cross-workspace 데이터 접근 절대 금지.
- 에이전트가 활용하는 권한:
  - 사용자 트리거: 해당 user의 권한으로 읽기·쓰기 (권한 상승 금지)
  - 자동 스케줄 (Librarian/Curator/Temporal): workspace `owner` 권한으로 실행
- LightRAG 인덱스, pgvector 검색, wiki_logs 조회 등 **모든** 쿼리가 `WHERE workspace_id = $1` 강제.

### 동시성 제어
- **워크스페이스·프로젝트 세마포어**: 같은 workspace + project 조합에서 위키를 수정하는 에이전트는 동시 실행 불가
  - Temporal의 `workflow.with_semaphore("ws:{wsId}:proj:{projectId}", max=1)` 사용
  - 읽기 전용 작업(Research Q&A)은 세마포어 불필요
- **우선순위**: Compiler > Librarian > 나머지 (제출이 가장 먼저)

### 위키 수정 규칙
- 모든 위키 변경은 `wiki_logs`에 기록 (agent, action, diff, reason)
- 사용자가 직접 수정한 내용(is_auto=false)은 AI가 덮어쓰지 않음
- 충돌 시 양쪽 내용 모두 보존 + 사용자에게 알림

### 비용 제어
- Free 티어: 일간 사용량 초과 시 에이전트 실행 거부 (usage_records 체크)
- Pro 티어: 토큰 단가 기반 월 사용량 과금 (usage_records)
- BYOK 티어: 자기 비용으로 실행, OpenCairn에서 요금 집계 제외 (`is_byok=true` 플래그)
- Context Caching: 같은 프로젝트 위키에 대한 반복 호출 시 캐시 활용
- **에이전트별 cost ceiling**: 개별 에이전트 섹션에 "cost ceiling" 필드가 있다면 단일 호출에서 해당 비용을 초과할 것으로 예상되면 실행 거부 (Pre-flight check는 토큰 견적 + provider 단가 기반 추정)

### 에러 처리
- Gemini API 429 (rate limit): 지수 백오프 (1s → 2s → 4s → 8s)
- Gemini API 500: 최대 3회 재시도 후 job status=failed
- LLM 환각 감지: 구조화 출력(Pydantic)으로 위키와 불일치 시 재시도

---

## 2. Agent-Specific Behavior

### 2.1 Compiler Agent

**트리거**: 소스 업로드 완료, 프로젝트 업로드 완료 시 (Temporal workflow에서 호출)
**입력**: source 엔트 ID (파싱된 텍스트를 포함)
**출력**: 생성/수정된 위키 페이지 ID 목록

```
가드레일:
- 한 번에 최대 20개의 위키 페이지 생성/수정
- 기존 위키 페이지 삭제 금지 (수정만 가능)
- 사용자가 직접 생성한 엔트(is_auto=false) 수정 금지 (반드시 제안/검토 PR 방식으로만 업데이트)

정지 조건:
- 추출된 개념이 0개면 즉시 종료 (빈 문서)
- 모든 개념이 기존 위키에 이미 존재하고 보완할 내용 없으면 종료
- 5분 타임아웃

Cost ceiling: 호출당 최대 500K 토큰(Flash-Lite 기준 약 $0.05). 초과 견적 시 청크 분할 또는 실행 거부.

피드백루프:
- 위키 생성 후 Librarian에게 건강 체크 트리거 (비동기)
- wiki_logs에 변경 기록 후 사용자에게 알림
```

### 2.2 Librarian Agent

**트리거**: Compiler 완료 후 / 정기 스케줄링 (cron)
**입력**: project_id
**출력**: 제안 목록 (검토 필요한 것들) + 자동 실행 목록

```
가드레일:
- 자동 실행 가능: 인덱스 갱신, 요약 업데이트, 연결 강화
- 검토 필요: 페이지 병합, 페이지 삭제 제안, 모순 해결, 사용자 엔트(is_auto=false) 내용 수정 제안

정지 조건:
- 검토할 위키 페이지가 0개면 즉시 종료
- 발견된 이슈가 0개면 즉시 종료
- 10분 타임아웃

Cost ceiling: 호출당 최대 1M 토큰 (대규모 프로젝트 스캔 포함, Flash-Lite 약 $0.10). 정기 스케줄은 일간 호출 1회 한도.

충돌 방지:
- Compiler가 실행 중이면 대기 (세마포어)
- Synthesis가 만든 페이지는 24시간 보호 기간 (즉시 삭제 방지)
```

### 2.3 Research Agent

**트리거**: 사용자 질문 (실시간)
**입력**: 질문 텍스트, conversation_id, scope (project | global)
**출력**: 답변 텍스트 + 출처 목록 + (선택) 캔버스 데이터

```
가드레일:
- 읽기 전용 — 위키를 수정하지 않음 (피류는 별도 트리거)
- 출처 없는 답변 금지 — 최소 1개의 위키 페이지 인용 필수
- 글로벌 스코프에서도 다른 사용자의 데이터 접근 금지

정지 조건:
- 관련 위키 페이지가 0개면 "관련 자료가 없습니다" 반환
- 3분 타임아웃 (입력 토큰은 3분 이내)

Cost ceiling: 호출당 최대 200K 토큰 (Context Caching 미스 가정, Flash-Lite 약 $0.02). 반복 질문은 캐시 히트로 90% 절감.

피드백루프:
- 빈 위키 페이지 발견 시 → wiki_feedback job 생성 (Compiler가 처리)
- 사용자 피드백 (thumbs up/down) → understanding_scores 업데이트
```

### 2.4 Connector Agent

**트리거**: 새 위키 페이지 생성 후 / 주기적 (주간)
**입력**: 전체 프로젝트 목록 (횡단)
**출력**: 다른 프로젝트 연결 제안 목록

```
가드레일:
- 제안만 생성, 자동 연결 금지 (사용자 확인 필요)
- 한 번에 최대 10개 제안
- 유사도 기준: cosine similarity > 0.85
- **같은 workspace 내 프로젝트 간에만 연결 제안 가능**. 다른 workspace의 프로젝트는 절대 crawl/비교하지 않음.

정지 조건:
- 프로젝트가 1개 이하면 즉시 종료
- 유효한 제안이 0개면 즉시 종료
- 5분 타임아웃

Cost ceiling: 호출당 최대 300K 토큰. 전체 프로젝트 cross-compare 시 임베딩 단계 비용이 지배적 (embedding 호출만 집계).

충돌 방지:
- 동시성 세마포어 불필요 (읽기 전용, 제안만 저장)
```

### 2.5 Socratic Agent

**트리거**: 사용자 요청 (Tool Template)
**입력**: 위키 페이지/개념 ID 목록, 템플릿 유형 (quiz, flashcard, etc.)
**출력**: 구조화된 JSON (퀴즈 문제, 플래시카드 세트)

```
가드레일:
- 위키에 없는 내용으로 문제 출제 금지
- 난이도 밸런스: 쉬움 30%, 보통 50%, 어려움 20%
- 플래시카드는 한 번에 최대 30개 생성

정지 조건:
- 소스 위키가 비어있으면 즉시 종료
- 2분 타임아웃

Cost ceiling: 호출당 최대 150K 토큰 (Flash-Lite 약 $0.015). 문제 30개 생성 기준으로 충분.

피드백루프:
- 문제 풀이 후 understanding_scores 업데이트
- 취약한 개념 감지 시 추가 플래시카드 자동 생성
```

### 2.6 Temporal Agent

**트리거**: 위키 페이지 업데이트 후 / 주기적 (일간)
**입력**: project_id
**출력**: 변경 감지 리포트 + 복습 알림

```
가드레일:
- 읽기 전용 — wiki_logs를 분석, 위키 수정 불가
- 복습 알림은 하루 최대 5개

정지 조건:
- wiki_logs가 비어있으면 즉시 종료
- 3분 타임아웃

Cost ceiling: 호출당 최대 100K 토큰 (변화 요약 + 복습 알림 생성, Flash-Lite 약 $0.01).
```

### 2.7 Synthesis Agent

**트리거**: 주기적 (주간) / 사용자 요청
**입력**: project_id 또는 전체
**출력**: 창발적 연결 제안 목록

```
가드레일:
- 제안만 생성, 사용자 확인 후에만 위키 페이지 생성
- 구조적 유사도 근거 필수 (단순 키워드 매칭 아님)
- 생성된 사이트 페이지는 24시간 보호 기간 (Librarian 삭제 방지)

정지 조건:
- 개념이 10개 미만이면 즉시 종료 (의미 있는 연결 불가)
- 5분 타임아웃

Cost ceiling: 호출당 최대 500K 토큰 (Pro 모델 사용, 약 $0.25). 주간 스케줄 고려 시 월간 상한 $2 내외.
```

### 2.8 Curator Agent

**트리거**: Librarian이 지식 부족 감지 / 사용자 요청
**입력**: 주제 또는 부족한 개념 목록
**출력**: 외부 자료 추천 목록 (URL, 제목, 요약, 신뢰도)

```
가드레일:
- Gemini Google Search Grounding을 사용 (직접 크롤링 금지)
- 추천만 생성, 자동 프로젝트 금지 (사용자 확인 필요)
- 한 번에 최대 10개 추천

정지 조건:
- 검색 결과가 0개면 즉시 종료
- 3분 타임아웃

Cost ceiling: 호출당 최대 100K 토큰 + Google Search Grounding 요금 (건당 약 $0.035 per query block).
```

### 2.9 Narrator Agent

**트리거**: 사용자 요청
**입력**: 위키 페이지 ID 목록 또는 project_id
**출력**: 오디오 파일 (Cloudflare R2 key) + 스크립트 텍스트

```
가드레일:
- Gemini MultiSpeakerVoiceConfig를 사용
- 스크립트 길이: 위키 내용 기준 5-15분 분량
- 오디오 파일 크기 제한: 50MB

정지 조건:
- 소스 위키가 비어있으면 즉시 종료
- 10분 타임아웃

비용 주의:
- TTS는 토큰 비용이 높음 → Free 티어는 월 3회 제한
```

### 2.10 Deep Research Agent

**트리거**: 사용자 요청
**입력**: 리서치 주제 + 위키 컨텍스트
**출력**: 리포트 (마크다운) + 소스 URL 목록

```
가드레일:
- Gemini interactions.create() API를 사용 (직접 웹 크롤링 금지)
- background=True로 비동기 실행
- 리포트는 바로 위키에 저장하지 않음 — 사용자 확인 후 Compiler가 처리

정지 조건:
- Gemini API가 실패하면 즉시 종료 (재시도 없음 — API 자체가 재시도를 포함)
- 30분 타임아웃

비용 주의:
- 건당 $2-5 이상 → Free 티어에게는 제공하지 않음 (Pro/BYOK만)
```

### 2.11 Code Agent

**트리거**: 사용자 요청 / Research Agent가 코드 실행 필요 시
**입력**: 코드 또는 코드 생성 요청 + 컨텍스트
**출력**: 코드 문자열 (language 메타데이터 포함) + (선택) 분석 노트

> **중요 (ADR-006)**: Code Agent는 **코드 문자열을 생성**만 한다. 실제 실행은 전부 **사용자 브라우저**에서 진행 (Python은 Pyodide WASM, JS/HTML/React는 `<iframe sandbox="allow-scripts">` + esm.sh). 서버는 코드를 한 줄도 실행하지 않는다.

```
가드레일:
- 코드 실행 책임은 클라이언트 — Agent는 LLM 호출만 관장
- 언어별 출력 가이드:
  * Python: print()로 stdout. input()/blocking stdin 금지 (Pyodide setStdin 패턴은 배열 pre-injection만 지원)
  * React/JS/HTML: 외부 라이브러리는 esm.sh 경유 import만 허용 (import React from "https://esm.sh/react@19")
  * iframe sandbox 속성 "allow-scripts"만 상정, "allow-same-origin" 절대 부여 금지
- 자체 self-healing 반복 max 3회 (brokePython 오류 → 재생성)
- 코드 생성 소스 크기 제한: 64KB

정지 조건:
- 3회 self-healing 실패 시 마지막 결과 반환
- Agent LangGraph 실행 타임아웃: 2분 (클라이언트 실행 대기 별도)
- 사용자가 cancel 요청 시 즉시 중단

Cost ceiling: 호출당 최대 200K 토큰 (생성 + self-healing 3회 포함, Flash-Lite 약 $0.02).

피드백루프:
- 브라우저에서 실행 후 stdout/stderr를 postMessage로 Agent에게 전달 → 다음 iteration에 주입
```

### 2.12 Visualization Agent

**트리거**: 사용자가 지식 그래프 뷰 전환 / 필터 변경 시 / Librarian이 레이아웃 최적화를 요청할 때
**입력**: project_id, view_type (graph|mindmap|cards|canvas|timeline), filter options
**출력**: Cytoscape.js JSON 스펙 (노드/엣지/스타일/레이아웃 파라미터) + 뷰 메타데이터

```
가드레일:
- 읽기 전용 — concepts/concept_edges/wiki_logs 수정 불가
- 한 번에 최대 500개 노드 (초과 시 점진적 로드 또는 사용자 경고)
- Canvas 뷰의 사용자 저장 좌표는 `concept_positions` 테이블에 upsert만 허용, 개념 자체는 수정 금지
- 5뷰 중 하나만 처리 (view_type 검증)

정지 조건:
- concepts가 0개면 빈 스펙 반환
- 30초 타임아웃 (복잡한 레이아웃도 클라이언트에서 증분 렌더)

Cost ceiling: 호출당 최대 50K 토큰 (Gemini Flash-Lite 구조화 출력, 약 $0.005). 대부분의 레이아웃 계산은 클라이언트 Cytoscape가 담당하고, Agent는 파라미터 추천만.

피드백루프:
- 사용자가 레이아웃 수동 조정 후 "저장"하면 concept_positions 업데이트 (Visualization Agent 아닌 일반 API 경로)
- Librarian이 고아 페이지/그래프 복잡도 감지 시 Visualization Agent에게 재레이아웃 트리거 가능
```

---

## 3. Agent Interaction Matrix

어떤 에이전트가 어떤 에이전트를 트리거할 수 있는지:

| 트리거하는 에이전트 | Compiler | Librarian | Research | Connector | Socratic | Temporal | Synthesis | Curator | Narrator | Deep Research | Code | Visualization |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Compiler** | - | O (완료 후) | X | X | X | X | X | X | X | X | X | O (KG 갱신 반영) |
| **Librarian** | X | - | X | X | X | X | X | O (빈곳 감지) | X | X | X | O (복잡도 감지 시) |
| **Research** | O (피드백) | X | - | X | X | X | X | X | X | X | O (코드 필요 시) | X |
| **Connector** | X | X | X | - | X | X | X | X | X | X | X | X |
| **Socratic** | X | X | X | X | - | X | X | X | X | X | X | X |
| **Temporal** | X | X | X | X | X | - | X | X | X | X | X | X |
| **Synthesis** | X | X | X | X | X | X | - | X | X | X | X | X |
| **Curator** | O (프로젝트) | X | X | X | X | X | X | - | X | X | X | X |
| **Narrator** | X | X | X | X | X | X | X | X | - | X | X | X |
| **Deep Research** | O (결과 통합) | X | X | X | X | X | X | X | X | - | X | X |
| **Code** | X | X | X | X | X | X | X | X | X | X | - | X |
| **Visualization** | X | X | X | X | X | X | X | X | X | X | X | - |

O = 트리거 가능, X = 트리거 불가

---

## 4. Failure Modes & Recovery

| 실패 모드 | 영향 | 복구 전략 |
|-----------|------|-----------|
| Gemini API 다운 | 모든 에이전트 중단 | Temporal의 자동 재시도 (지수 백오프, 최대 1시간) |
| Worker 크래시 | 실행 중 에이전트 중단 | Temporal이 마지막 완료 Activity부터 재개 |
| DB 커넥션 풀 고갈 | 에이전트 쿼리 실패 | Activity 재시도 + 커넥션 풀 크기 모니터링 |
| 무한 루프 (에이전트 A → B) | 리소스 고갈 | 트리거 체인 깊이 제한 (최대 3단계) |
| LLM 환각 (잘못된 개념 추출) | 위키 오염 | Pydantic 스키마 검증 + Librarian 주기적 일관성 체크 |
| 대용량 파일 프로젝트 | 메모리 부족 | 청크 처리 (페이지/단락 단위), 메모리 제한 |
