# Document I/O (exploring — not a decision)

> **Status: exploring** (2026-04-23). 문서 **생성**(DOCX/PPTX/XLSX/PDF 등)과 **뷰**(미리보기) 전략 논의 정리. **결정 아님.** 결정되는 시점에 spec/ADR로 승격.

## 1. 두 가지 문제 분리

| 문제 | 성격 | 기본 해법 후보 |
|------|------|---------------|
| **생성**: "이 Plate 페이지를 DOCX로 뽑아줘" | 코드 실행 필요 (python-docx, reportlab 등) | Pyodide (browser WASM) / 서버 샌드박스 |
| **뷰**: "업로드된 .xlsx 파일 미리보기" | 렌더링만 필요 | 브라우저 JS 라이브러리 |

생성과 뷰는 **완전히 다른 문제**. 뷰는 서버 필요 없음, 생성은 선택 필요.

---

## 2. 생성 전략

### 2.1 두 옵션

| 방식 | 위치 | OpenCairn 비용 | 퀄리티 상한 | AGPL 셀프호스트 |
|------|------|----------------|------------|----------------|
| **Pyodide 샌드박스** (현재 아키텍처 전제) | 유저 브라우저 (WASM) | 0원 | 중간 (WASM 휠 있는 라이브러리만) | ◎ 셀프호스터도 공짜 |
| **서버 샌드박스** (Firecracker/e2b.dev/Modal) | 우리 서버 / 셀프호스터 서버 | 중 (컴퓨트 청구) | 높음 (full CPython, 모든 라이브러리, 한글 폰트 등 자유) | △ 셀프호스터가 또 붙여야 |

### 2.2 Claude/ChatGPT는?

참고 (오해 방지):

- **Claude Analysis tool (JS)**: 브라우저 클라이언트 실행 ← Pyodide와 같은 포지션
- **Claude Code Execution tool (Python)**: **Anthropic 서버 컨테이너** 실행 ← 서버 샌드박스
- Claude의 DOCX/PPTX/XLSX 생성은 서버 실행임. 유저 로컬 아님

### 2.3 방향성 (draft)

**Pyodide-first**, 서버 샌드박스는 **POC 후 필요 시 Pro 전용 옵션**.

이유:
- 추가 인프라 0, AGPL 셀프호스트 궁합 ◎
- Claude/ChatGPT 경험 패리티는 "에이전트가 python-docx 코드 써서 실행 → 파일 다운로드" 한 경로로 DOCX/PPTX/XLSX/PDF/HTML 전부 커버 가능
- 포맷별 템플릿 별도 유지보수 안 함 = 포맷 늘어나도 유지보수 비용 선형 증가 X

**미검증 리스크** (POC 필요):
- [ ] Pyodide에서 `python-docx`, `openpyxl`, `reportlab`, `python-pptx` 휠 가용성 / 로딩 시간
- [ ] 한글 폰트 삽입 — 번들/프리로드 필요?
- [ ] 이미지/차트 삽입 시 메모리 상한
- [ ] 각주/목차/수식 같은 복잡 서식의 무결성

### 2.4 하이브리드 (권장 구도)

- **인라인 블록** (Plan 10B Document Studio): 인포그래픽/데이터테이블 같은 **구조화된 결과**는 Plate 블록으로 렌더 — 페이지 안에서 바로 살아있음, 내보낼 필요 없음
- **파일 내보내기**: 자유 Pyodide 경로. "DOCX로 내보내기" 버튼 = 내부적으로 `/export docx` → 에이전트가 python-docx 코드 작성 → 샌드박스 실행 → 다운로드
- **서버 샌드박스 (선택)**: POC에서 Pyodide가 한글 폰트 등에서 근본적으로 깨지는 경우만 Pro 전용으로 추가 검토

### 2.5 LLM 라우팅

자유 생성의 코드 작성 = LLM 토큰 소모. 이 부분은 `billing-routing.md` Chat/Agent 경로를 따름 (BYOK 우선 → 크레딧 폴백). **코드 실행 자체는 브라우저 Pyodide라 과금 없음.**

---

## 3. 뷰 전략

### 3.1 포맷별 가능성

| 포맷 | 브라우저 뷰 | 라이브러리 후보 | 비고 |
|------|-----------|----------------|------|
| **DOCX** | ✅ | `docx-preview` (~500KB) | 서식/이미지 대부분 보존 |
| **PPTX** | ✅ (보통 퀄리티) | `pptxjs` | 레이아웃 완전도 LibreOffice/MS 대비 낮음 |
| **XLSX** | ✅ (꽤 좋음) | `SheetJS` + `Univer`/`Luckysheet` | 수식·서식·차트까지 커버 |
| **PDF** | ✅ (이미 사용 중) | `PDF.js` | 표준 |
| **LaTeX 수식만** | ✅ (이미 Plan 2A) | `KaTeX` | 인라인/블록 수식 |
| **LaTeX 문서 전체** | ❌ | — | §3.3 참조 |

### 3.2 번들 크기

뷰어 라이브러리는 번들이 큼 (Univer MB급). **포맷별 dynamic import 필수** — `.docx` 클릭 시 해당 chunk만 로드.

### 3.3 LaTeX 문서 전체 — 유일한 서버 필요 지점

브라우저에서 풀 LaTeX 엔진 실행은 현실적으로 불가 (texlive = 수 GB).  
옵션:
- **(a) Pro 전용 서버 컴파일**: texlive Docker 이미지로 `.tex` → PDF 컴파일 → PDF.js로 뷰. 서버 비용 발생
- **(b) 수식만 지원, 풀 LaTeX 문서는 미지원**: KaTeX로 수식 블록만, 문서 전체 LaTeX는 "지원 안 함"으로 타협
- **(c) latex.js 같은 JS 부분 구현체**: 완전도 낮아 실용성 X

**방향성 (draft)**: 초기엔 (b). (a)는 수요 확인 후 Pro 전용 옵션으로 재검토.

---

## 4. 관련 문서와의 관계

- **Plan 10 Document Studio / Plan 10B Output Extensions**: 인라인 블록 (인포그래픽/데이터테이블/KnowledgeHealthReport) — 본 문서의 §2.4 "인라인 블록" 경로
- **Plan 2A Editor Core**: KaTeX 수식 지원 이미 완료 — §3.1 LaTeX 수식 행 참조
- **billing-routing.md**: §2.5 LLM 라우팅 참조

## 5. Open Questions

- [ ] Pyodide POC: `python-docx` + `openpyxl` + 한글 폰트 + 이미지/차트 조합의 실제 품질·속도
- [ ] 뷰어 라이브러리 라이선스 (특히 Luckysheet → Univer 전환 상황, AGPL 호환성)
- [ ] 서버 샌드박스 옵션 추가 시 AGPL 셀프호스트 매뉴얼에 선택적 컴포넌트로 넣을지, Pro 전용 SaaS 기능으로 할지
- [ ] LaTeX 수요 조사 — 대학·연구실 사용자 비중 기준 (a) 대 (b) 결정

## 6. Next Steps

1. **Pyodide POC 먼저** (문서 수정 전에): python-docx/openpyxl/reportlab 휠 로드, 한글 DOCX 1개 생성, 각주/이미지 조합 검증
2. POC 결과에 따라 §2.3 방향성 확정
3. 뷰어 라이브러리 번들 크기·라이선스 실측
4. 결정 완료 시점에 본 문서 → `../contributing/roadmap.md` 또는 ADR로 승격
