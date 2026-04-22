# Text Search (exploring — not a decision)

> **Status: exploring** (2026-04-23). 의미 검색(RAG)과 **별개**로 "VSCode급 문자열 검색"(`Cmd+Shift+F`) 설계. **결정 아님.**

## 1. 왜 별도 표면인가

- AI 채팅/RAG는 "이 주제에 대해 뭐라고 썼지?" — 의미 검색
- 문자열 검색은 "정확히 `estimate_cost_usd_cents` 나오는 곳 어디?" — exact/regex
- 두 개는 **같은 입구 금지**. 탭으로 분리하거나 별도 단축키. 섞으면 둘 다 퀄리티 떨어짐
- 현재 Plan 4 Phase B에 BM25가 있지만 그건 semantic retrieval용. 사용자 기대의 "Ctrl+F 전역 버전"은 아님

## 2. 기능 사양 (v1 목표)

| 항목 | VSCode | OpenCairn 대응 |
|-----|--------|--------------|
| 진입 | `Cmd+Shift+F` | 동일 |
| Case-sensitive / whole-word / regex | ✅ | ✅ |
| Scope | include/exclude glob | 워크스페이스 / 프로젝트 / 현재 페이지 |
| 결과 UI | 파일 트리 + 라인 프리뷰 + 하이라이트 | 페이지 트리 + 블록 프리뷰 + 하이라이트 |
| 클릭 → 점프 | 파일+줄 | 페이지+블록 (`#block-id` 앵커) |
| Replace 모드 | ✅ | **v1 보류** (Yjs 충돌 위험) |
| 검색 히스토리 | 최근 검색어 | ✅ |

## 3. 백엔드 옵션

| 방식 | 장점 | 단점 |
|-----|-----|-----|
| **Postgres FTS** (tsvector + GIN) + `pg_trgm` | 이미 DB에 있음, 인프라 0 | 한국어 토크나이저 취약, regex 느림 |
| **Meilisearch** | 속도·타입소·한국어 지원 양호 | 별도 서비스, AGPL 셀프호스트 컴포넌트 추가 |
| **Tantivy / Quickwit** | ripgrep 급 성능 | 통합 비용 큼 |
| **BM25 재활용** (Plan 4 Phase B) | 존재함 | 의미검색용 파이프라인, exact match 품질 미검증 |

### 3.1 추천 방향 (draft)

**Postgres FTS + `pg_trgm` + regex 후필터** 로 시작, 추상화 유지 후 필요 시 Meilisearch 마이그레이션.

근거:
- 셀프호스트 배포 복잡도 유지 (추가 서비스 0)
- `pg_trgm` 의 trigram 인덱스로 한국어 substring·fuzzy 커버 가능
- regex는 FTS로 후보군 좁힌 뒤 `~*` 후필터 — 10K 페이지 기준 체감 OK 예상 (POC 필요)
- 검색 API를 `/api/search/text` 로 추상화해두면 백엔드 교체 시 UI 변경 없음

### 3.2 데이터 파이프라인

1. Plate AST → plain text 추출 → `pages.search_text` 컬럼 (Yjs 변경 훅 또는 주기적 재계산)
2. `to_tsvector('simple', search_text)` GIN 인덱스
3. `pg_trgm` 인덱스 병행 (substring·typo)
4. 블록 단위 하이라이트를 위해 `page_blocks` 캐시 (block_id + plain text) — 클릭 시 해당 블록 스크롤

## 4. API 설계

- `POST /api/search/text` — body: `{ query, regex, caseSensitive, wholeWord, scope, limit, cursor }`
- `POST /api/search/semantic` — 기존 RAG 경로
- UI 상단 탭: **"Find"** / **"Ask AI"** — 두 API 분리

## 5. 지뢰

- **tsvector 컬럼 생성 타이밍**: Yjs 저장과 동기 vs 비동기. 동기면 편집 레이턴시 영향, 비동기면 "방금 쓴 단어 검색 안 됨" 혼란. **debounce 비동기(500ms) + "방금 저장됨" 표시** 조합
- **한국어 토크나이저**: `tsvector('simple', ...)` 는 공백 기반이라 한국어 품사 단위 불가. `pg_trgm` 으로 보완. 필요 시 `pgroonga`(Mroonga 기반) 검토
- **권한 체크를 쿼리 후 수행하면 결과 잘림**: `WHERE user_id IN (...)` 형태로 쿼리 단계에서 필터
- **너무 긴 결과 페이징**: cursor pagination + 상한 (예: 200건)
- **regex ReDoS**: 사용자 regex 그대로 PG에 넘기면 DoS 가능. 타임아웃(`SET LOCAL statement_timeout`) + 복잡도 사전 체크

## 6. 권한 모델

- 검색 결과는 현재 사용자의 **read 권한 있는 페이지만**. 기존 workspace 3계층 권한 재사용
- 스코프 필터에 "내가 권한 있는 모든 페이지" / "공개 링크만" 옵션 고려

## 7. UX 세부

- `Cmd+Shift+F` 여는 순간 현재 선택된 텍스트 자동 채움 (VSCode 패리티)
- 결과 창에서 **키보드로 결과 이동** (↑↓ + Enter 점프)
- 페이지 내 하이라이트는 Plate 데코레이션으로 비파괴 (임시 overlay)
- 검색어 포함 **블록 단위로 접힌 프리뷰** + 클릭 펼침

## 8. Open Questions

- [ ] 한국어 품질 벤치: `pg_trgm` 으로 실제 한국어 노트에서 검색 체감은?
- [ ] Replace 모드 시점 — v2? Yjs 일괄 편집 안전 확보 필요
- [ ] Command Palette(`Cmd+K`) 에서 "파일명 검색"과 본 "본문 검색"의 관계 — 전자는 Palette, 후자는 `Cmd+Shift+F` 로 UX 분리
- [ ] 검색 결과 캐싱 — 동일 쿼리 재요청 시 클라 측 stale-while-revalidate

## 9. Next Steps

1. **POC**: Postgres FTS + `pg_trgm` 조합으로 1K 페이지 한국어 검색 벤치
2. Plate AST → plain text 추출기 (Plan 2A 구조 재사용)
3. `search_text` 컬럼 + 인덱스 migration 설계
4. API 계약 `/api/search/text` 스펙 (Zod)
5. UI 쉘: 탭 구조 "Find" / "Ask AI"
