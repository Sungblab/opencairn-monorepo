# Data Flow Architecture

전체 시스템의 데이터 흐름.

---

## 1. Ingest Flow (자료 → 위키)

```
사용자가 PDF 업로드  |
  v
[1] Next.js → Hono API (POST /api/ingest/upload)
  |  - 파일 크기·타입 검증
  |  - Cloudflare R2에 원본 업로드 → file_key 반환
  |  - usage_records에 기록
  |  - Free 플랜 용량 한도 체크
  |
  v
[2] Hono → Temporal (IngestWorkflow 시작)
  |  - workflow_id를 jobs 테이블에 저장
  |  - 즉시 job_id를 프론트엔드에 반환
  |
  v
[3] Temporal → Python Worker (parse_source Activity)
  |  - PDF (디지털): LibreOffice headless → PDF → Docling (텍스트/수식/표)
  |  - PDF (스캔/수기): Docling 텍스트 부족 감지 → chandra OCR
  |  - DOCX/PPTX/XLSX: LibreOffice headless → PDF → Docling
  |  - HWP: pyhwp → 텍스트 추출 + LibreOffice headless → PDF (뷰어용)
  |  - HWPX: XML 직접 파싱 (텍스트) + LibreOffice headless → PDF (뷰어용)
  |  - 오디오: LLM provider 멀티모달 처리 (Gemini: gemini-3-flash-preview에 오디오 전달)
  |  - 영상: yt-dlp(YouTube) or ffmpeg 추출 → LLM provider 멀티모달 처리
  |  - 이미지/도식: LLM provider 멀티모달 (Gemini: gemini-3-flash-preview)
  |  - URL: trafilatura (HTML 스크래핑)
  |
  v
[4] Temporal → Python Worker (enhance_with_gemini_multimodal Activity)
  |  - 복잡한 페이지 (다이어그램, 차트) → Gemini Files API
  |  - 시각적 설명 생성 → 파싱 결과에 병합
  |
  v
[5] Temporal → Python Worker (generate_embeddings Activity)
  |  - LLM provider embed (Gemini: gemini-embedding-2-preview 3072d, OpenAI: 1536d, Ollama: 768d)
  |  - 텍스트 청크 → 임베딩 → 데이터베이스에 저장
  |
  v
[6] Temporal → Python Worker (create_source_note Activity)
  |  - notes 테이블에 source 타입 노트 생성
  |  - type=source, source_type=pdf|audio|..., source_file_key=Cloudflare R2 key
  |  - embedding 저장, content_tsv 트리거로 갱신
  |
  v
[7] Temporal → Python Worker (run_compiler_agent Activity)
  |  *** 프로젝트 세마포어 획득 ***
  |  - LangGraph 상태 머신:
  |    a. 개념 추출 (Pydantic AI)
  |    b. 기존 위키 검색 (벡터 + BM25 + 그래프)
  |    c. 새 개념 → 위키 페이지 생성
  |    d. 기존 개념 보완 → 위키 페이지 업데이트
  |    e. 충돌 → 양쪽 기록 + 알림
  |    f. 지식 그래프 노드/엣지 추가
  |    g. wiki_logs 기록
  |  *** 세마포어 해제 ***
  |
  v
[8] Temporal → MaintenanceWorkflow (비동기)
  |  - Librarian → 건강 체크
  |  - Temporal Agent → 변화 추적
  |
  v
[9] 사용자가 브라우저에서 결과 확인
    - jobs 테이블에서 status=completed 확인
    - 새 위키 페이지로 이동
    - 지식 그래프 업데이트
```

---

## 2. Q&A Flow (질문 → 응답)

```
사용자가 질문 입력: "Transformer의 attention이란?"
  |
  v
[1] Next.js → Hono API (POST /api/chat/message)
  |  - conversation에 사용자 메시지 저장
  |  - usage_records 기록
  |
  v
[2] Hono → Temporal (ResearchWorkflow 시작)
  |  - SSE 연결 열어두고 스트리밍 준비
  |
  v
[3] Python Worker (hybrid_search Activity)
  |  - [벡터] 질문 임베딩 → pgvector cosine similarity
  |  - [BM25] 질문 → tsvector plainto_tsquery
  |  - [그래프] 관련 개념 → 2-hop 탐색 → 연결된 노트
  |  - [RRF] 세 결과 합산 → 상위 10개
  |
  v
[4] Python Worker (run_research_agent Activity)
  |  - Context Caching에 위키 + 검색 결과 주입
  |  - Gemini API 호출 (Thinking Mode 선택적)
  |  - 응답 생성 + 출처 링크
  |  - 캔버스 필요 시 React/HTML 코드 생성
  |
  v
[5] Hono → Next.js (SSE 스트리밍)
  |  - 토큰 단위로 응답 스트리밍
  |  - 완료 후 messages 테이블에 저장
  |
  v
[6] (선택) 위키 업류
    - 새 인사이트 발견 시 Compiler Activity 트리거
    - 위키에 새 내용 추가
```

---

## 3. Learning Flow (학습)

```
사용자가 "퀴즈 생성" 클릭 (위키 페이지 3개 선택)
  |
  v
[1] Next.js → Hono API (POST /api/tools/execute)
  |  - template_id: "quiz"
  |  - scope: [note_id_1, note_id_2, note_id_3]
  |
  v
[2] Hono → Temporal (LearningWorkflow 시작)
  |
  v
[3] Python Worker
  |  - 선택된 위키 페이지 컨텍스트 수집
  |  - Socratic Agent (LangGraph):
  |    a. 개념 추출
  |    b. 난이도 분배 (쉬움 30%, 보통 50%, 어려움 20%)
  |    c. 문제 생성 (Pydantic 스키마 검증)
  |
  v
[4] Hono → Next.js (JSON 응답)
  |  - 구조화된 퀴즈 데이터 반환
  |  - 프론트엔드에서 인터랙티브 컴포넌트로 렌더링
  |
  v
[5] 사용자가 퀴즈 풀기
  |
  v
[6] Next.js → Hono (POST /api/learning/submit-answer)
  |  - 정답 채점
  |  - understanding_scores 업데이트
  |  - 약한 개념 → 자동 플래시카드 생성
```

---

## 4. Canvas Flow (인터랙티브 캔버스)

```
Research Agent가 차트 생성 결정
  |
  v
[1] Agent가 React 컴포넌트 코드 생성
  |
  v
[2] Python Worker → Sandbox API (POST /execute)
  |  - React 코드 전달
  |  - gVisor 컨테이너에서:
  |    a. Vite로 빌드
  |    b. 정적 파일 생성
  |    c. 로컬 서버 실행 (포트 할당)
  |  - 프리뷰 URL 반환
  |
  v
[3] Hono → Next.js (canvas_data in message)
  |  - { type: "canvas", url: "http://sandbox:PORT/..." }
  |
  v
[4] Next.js
  |  - sandboxed iframe으로 URL 렌더링
  |  - 사용자 인터랙션 가능 (버튼, 슬라이더 등)
```

---

## 5. Background Agent Flow (자동화 에이전트)

```
매일 03:00 UTC → Temporal Cron Schedule
  |
  v
MaintenanceWorkflow (모든 프로젝트에 실행)
  |
  ├── [1] Librarian Agent
  |   ├── 고아 페이지 정리
  |   ├── 모순 감지
  |   ├── 중복 병합 제안
  |   └── 인덱스 갱신
  |
  ├── [2] Temporal Agent
  |   ├── 변화 추적 (wiki_logs 분석)
  |   ├── 지식 트렌드 감지
  |   └── 복습 알림 생성
  |
  ├── [3] Synthesis Agent
  |   ├── 새로운 테마·주제 탐색
  |   └── 인사이트 제안 생성
  |
  └── [4] Curator Agent
      ├── 지식 격차 분석
      ├── Google Search Grounding
      └── 관련 자료 추천

매주 일요일 04:00 UTC
  |
  v
ConnectorWorkflow
  └── 새로운 프로젝트 연결 탐색

결과
  → 알림 배지 (다음 접속 시)
  → 제안 목록 (사용자 확인 후)
```

---

## 6. Billing Flow

```
사용자 액션 (인제스트, Q&A, 오디오 등)
  |
  v
Hono Middleware (checkUsage)
  |  - usage_records에서 월간 사용량 조회
  |  - 현재 plan 확인 (free/pro/byok)
  |
  ├── Free + 한도 초과 → 402 Payment Required 반환
  ├── Pro / BYOK → 통과
  └── BYOK → 복호화된 Gemini API 키로 호출 (복호화)
  |
  v
액션 실행
  |
  v
usage_records에 토큰 사용량 기록
```
