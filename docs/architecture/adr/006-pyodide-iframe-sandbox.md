# ADR-006: Browser Sandbox (Pyodide + iframe) over Server gVisor

## Status: Accepted (2026-04-14)

## Context

[ADR-003](./003-gvisor-sandbox.md)은 AI 생성 코드를 gVisor 런타임 Docker 컨테이너에서 실행하는 방식을 채택했다. 몇 달간 설계·프로토타입을 거치며 다음 문제들이 드러났다.

1. **단일 사용자 모델과 부조화** — OpenCairn은 개인 지식 OS다. "본인의 에이전트가 생성한 본인 코드"를 본인 기기에서 돌리는 구조라 multi-tenant 커널 탈출을 방어할 근본적 이유가 없다. gVisor의 비용(시스템콜 인터셉트 레이어, 호환성 리스크)을 지불할 위협 모델이 실재하지 않는다.
2. **ARM 호환성 부담** — Raspberry Pi / Apple Silicon / Oracle Ampere 등 셀프호스트 타겟이 전부 ARM64를 포함한다. gVisor `runsc`의 linux/arm64 지원은 dev 빌드 수준이고, multi-arch Docker 이미지에서 runsc를 켜면 아키텍처별 테스트 부담이 2배가 된다.
3. **운영 복잡도** — 호스트에 `runsc` 설치 + Docker daemon 런타임 등록 + 사용자가 `runtime: runsc` 없이도 동작해야 함(graceful degradation) + Vite 빌더를 컨테이너 안에 내장하는 이미지 크기 폭발(~1.2GB). "Docker 한 방"이라는 셀프호스트 약속이 깨졌다.
4. **Claude Artifacts / Gemini Canvas의 검증** — 같은 시기 두 제품이 브라우저 샌드박스만으로 대중에 코드 실행을 제공했다. 기술 위험이 제품에 의해 이미 해소됐다는 증거.

## Decision

서버 사이드 코드 실행을 전면 폐기하고, 브라우저 내부 샌드박스로 전환한다.

- **Python**: [Pyodide](https://pyodide.org) (WASM) — numpy/pandas/matplotlib/scipy 기본 포함, `micropip.install()`로 추가 패키지.
- **JS / HTML / React**: `<iframe sandbox="allow-scripts">` + Blob URL + [esm.sh](https://esm.sh) 런타임 ESM CDN. `allow-same-origin`은 **절대 동시에 주지 않는다** (MDN 경고 — sandbox 탈출 가능).
- **Code Agent**: 코드 **생성**만 담당 (LLM → 문자열). 실행은 전부 클라이언트. `postMessage`로 stdout/에러를 에이전트에 피드백해 self-healing 반복.

`apps/sandbox/`, `services/sandbox/`, Vite builder, gVisor `runtime: runsc` 설정은 모두 폐기한다. `docker-compose.yml`에서 sandbox 서비스 제거.

## Reasoning

1. **서버 자원 0** — 코드 실행 워크로드가 서버에서 사라진다. 셀프호스트 최소 사양이 4 vCPU → 유지 가능. Vite 빌드 30초 × 동시 유저 수가 CPU를 점유하는 문제도 소멸.
2. **격리 모델이 브라우저 네이티브** — `iframe sandbox` + Same-Origin Policy는 브라우저 밴드 위협 모델(XSS, 쿠키/localStorage 유출)을 정확히 커버한다. 공격면이 브라우저 엔진으로 축소됨.
3. **ARM/멀티아키 부담 소멸** — Pyodide는 WASM이라 아키텍처 중립. gVisor 의존성이 사라지면서 Docker 이미지도 순수 Python/Node 베이스로 단순화.
4. **UX 일치** — Claude Artifacts / Gemini Canvas 사용자 멘탈 모델이 이미 "브라우저 안에서 돈다". 서버 실행은 낯선 경험이었다.
5. **패키지 커버리지 충분** — Pyodide의 내장 + `micropip`만으로 OpenCairn 학습/시각화 타겟(numpy, pandas, matplotlib, scipy, sympy)이 전부 커버된다. 실패 케이스(torch 같은 거대 네이티브 확장)는 원래 셀프호스트 격리 환경에서도 돌리기 힘들었음.

## Trade-offs & Limits

- **Blocking `input()` 미지원** — Pyodide `setStdin()`은 한 줄씩 pre-injected 배열만 소비. 진짜 blocking stdin은 Web Worker + SharedArrayBuffer + COOP/COEP 헤더 조합이 필요한데, 이 헤더가 외부 리소스(esm.sh, 팟캐스트 오디오 CDN)를 깬다. **결정**: 코테(BOJ/Codeforces) 패턴처럼 "UI에 stdin 전부 붙여넣기 → 배열 주입" 방식 채택. 인터랙티브 REPL은 로드맵 밖.
- **Pyodide 최초 다운로드 ~10MB** — 브라우저 캐시되지만 첫 방문 비용. Code Agent 호출 시 Lazy 로드 + 로딩 UI로 숨김.
- **네이티브 C 확장의 서브셋** — Pyodide가 빌드하지 않은 휠은 못 돌린다. 주요 과학 스택은 이미 커버. 필요한 경우 사용자에게 "이 라이브러리는 브라우저 환경에서 지원되지 않습니다" 명시적 에러.
- **서버에서의 CI/CD 검증이 다른 성격이 됨** — Playwright로 브라우저 안의 Pyodide를 돌리는 E2E 테스트가 필요. 단위 테스트는 기존 pytest/vitest로 불가. 세부는 [testing/sandbox-testing.md](../../testing/sandbox-testing.md).
- **격리 경계의 책임이 브라우저 엔진에 있음** — Chrome/Firefox zero-day는 우리가 패치할 수 없다. 위협 모델이 "내 에이전트가 내 브라우저에서 돈다"라 수용 가능.

## Consequences

- `apps/sandbox` / `services/sandbox` 제거. `docker-compose.yml`에서 `sandbox` 서비스와 `runtime: runsc` 삭제.
- 코드 실행 관련 API는 `POST /api/sandbox/execute` → `POST /api/code/run` (generate-only)로 재설계. 실제 실행은 클라이언트에서.
- 문서 영향: design.md §10 Canvas & Sandbox, agent-behavior-spec.md §2.11 Code Agent, data-flow.md §4 Canvas Flow, testing/strategy.md, contributing/dev-guide.md. Plan-7은 전면 재작성.
- ADR-003을 `Superseded`로 마크하고 본 ADR 링크.
- 보안 모델: iframe sandbox 속성 + postMessage origin 검증 + 전역 CSP. 상세는 [security-model.md](../security-model.md).

## Alternatives (Re-)Considered

| 대안 | 왜 아님 |
|------|---------|
| **gVisor 유지** (ADR-003 상태) | 위 Context 1~3 항목. 단일 사용자 모델에는 과잉. |
| **Firecracker MicroVM** | 격리는 최강이나 호스트 커널·네스티드 가상화 요구. 셀프호스트 난이도 폭증. |
| **E2B / Daytona / Modal 클라우드 샌드박스** | SaaS 버전에만 쓸 수 있고 AGPLv3 셀프호스트와 상충. BYOK 모델에 외부 의존. |
| **WebContainer (StackBlitz)** | 상용 라이선스 필요, Node.js 실행 전용(파이썬 없음), 오픈소스와 부조화. |
| **Deno subprocess + seccomp** | 서버 사이드 실행을 유지하는 대안이지만, 위 "서버 자원 0" 이득을 포기. |

## Migration

- 2026-04-14 커밋 `7587347`에서 문서·코드 일괄 전환 시작.
- 이 ADR이 기준 문서. 구 ADR-003은 Superseded 상태에서 historical context로 보존.
- 마이그레이션 체크리스트: Plan-7 구 Task 1~3 제거, design.md §10/§16 재작성, `apps/sandbox/` 디렉토리 삭제(존재 시), `.env.example`에서 `SANDBOX_URL`/`NEXT_PUBLIC_SANDBOX_ORIGIN` 제거.
