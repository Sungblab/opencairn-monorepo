# OpenCairn

[English](README.md) | **한국어**

> 자체 호스팅 가능한 멀티 LLM 기반 개인 / 팀 지식 OS.

> ⚠️ **알파 단계입니다.** 스키마, API, 마이그레이션이 커밋 사이에 깨질 수 있습니다. 운영 환경에 도입하시기 전 별도 인스턴스에서 충분히 검증해 주세요.

## 무엇을 하는 도구인가요

OpenCairn은 PDF, DOCX, PPTX, XLSX, HWP, Markdown/CSV ZIP, Google Drive 등 다양한 입력을 받아 편집 가능한 노트, 탐색 가능한 지식 그래프, grounded Q&A 화면으로 정리합니다. 장기 아키텍처는 컴파일, 리서치, 학습, 종합, 내레이션, 시각화, 코드, 유지보수 역할의 AI 에이전트를 정의하지만, 모든 역할이 오늘 기본 활성 제품 에이전트인 것은 아닙니다. Docker 호스트에서 직접 동작하며, Google Gemini 또는 로컬 Ollama 모델을 통합 프로바이더 계층 뒤에서 사용합니다.

## 주요 특징

- **자체 호스팅 기본** — `docker compose up` 한 번이면 Postgres + pgvector, MinIO, Temporal, Redis, 선택적으로 Ollama가 모두 기동됩니다.
- **멀티 LLM** — Gemini(기본) 또는 Ollama를 환경 변수로 선택합니다. 워크스페이스 기본값 위에 사용자별 BYOK 키가 얹힙니다.
- **AI 워크플로우와 에이전트 역할** — Temporal과 자체 에이전트 런타임(`apps/worker/src/runtime/`)이 단계적으로 제공되는 런타임 에이전트, 워크플로우 기반 기능, feature flag 뒤의 제품 화면을 오케스트레이션합니다.
- **지식 그래프 + 위키 에디터** — Plate v49 기반 `[[wiki-link]]`, 백링크, Cytoscape 다중 뷰(그래프 / 보드 / 테이블 / 타임라인), 자동 개념 추출.
- **실시간 협업** — Hocuspocus / Yjs 기반 멀티 커서, 코멘트, `@mention`, 공유 링크, 페이지별 권한.
- **Deep research 모드** — 다단계 추론과 인용 · provenance 추적. managed hosted billing은 이후 호스팅 서비스 범위로 남아 있습니다.
- **3계층 권한 모델** — Workspace → Project → Page, 상속과 override 지원.

## 아키텍처

```
apps/web         Next.js 16. UI + 브라우저 샌드박스 (Pyodide + iframe).
apps/api         Hono 4. 비즈니스 로직, 인증, 권한 헬퍼.
apps/worker      Python. Temporal 워커 + 에이전트 런타임 + 워크플로우 기반 AI 기능.
apps/hocuspocus  Yjs 협업 서버. 페이지 수준 인증 hook.
packages/db      Drizzle ORM + pgvector + 3계층 워크스페이스 권한.
packages/llm     Python LLM 프로바이더 추상화 (Gemini / Ollama).
packages/emails  react-email v6 템플릿 + Resend.
packages/shared  Zod 스키마 (API 계약).
```

상세 설계: `docs/contributing/roadmap.md`.

## Technical Deep Dives

README는 의도적으로 짧게 유지합니다. agentic workflow ledger,
permission-aware RAG, Yjs 기반 위키 노트, Workflow Console 복구, 문서 생성,
code workspace 실행 루프 같은 긴 구현 이야기는
[OpenCairn 기술 딥다이브 시리즈](https://sungblab.com/blog/opencairn-technical-deep-dives)에
정리합니다.

- [Permission-aware RAG](https://sungblab.com/blog/opencairn-permission-aware-rag)
- [Agentic Workflow Ledger](https://sungblab.com/blog/opencairn-agentic-workflow-ledger)
- [Yjs-backed `note.update`](https://sungblab.com/blog/opencairn-yjs-note-update)
- [Workflow Console Recovery](https://sungblab.com/blog/opencairn-workflow-console-recovery)
- [Document Generation Pipeline](https://sungblab.com/blog/opencairn-document-generation-pipeline)
- [Code Workspace Execution Loop](https://sungblab.com/blog/opencairn-code-workspace-execution-loop)

## Quick start

요구 사항: Node 22+, pnpm 9.15+, Docker.

```bash
# 1. 환경 설정
cp .env.example .env
# 최소 필수 항목:
#   POSTGRES_PASSWORD, S3_SECRET_KEY, BETTER_AUTH_SECRET, INTERNAL_API_SECRET,
#   INTEGRATION_TOKEN_ENCRYPTION_KEY  (`openssl rand -base64 32` 으로 생성),
#   그리고 GEMINI_API_KEY 또는 OLLAMA_BASE_URL 중 하나.
#
# 선택적 관리형 서비스:
#   Supabase를 쓰면 DATABASE_URL / COMPOSE_DATABASE_URL을 설정하고
#   OPENCAIRN_DEV_LOCAL_POSTGRES=false 로 로컬 Postgres를 끕니다.
#   Cloudflare R2를 쓰면 S3_ENDPOINT / COMPOSE_S3_ENDPOINT를 설정하고
#   OPENCAIRN_DEV_LOCAL_MINIO=false 로 로컬 MinIO를 끕니다.

# 2. 의존성 설치 + 마이그레이션
pnpm install
pnpm db:migrate

# 3. Docker Compose로 OpenCairn 실행
pnpm dev
```

기본 로컬 포트:

| 서비스      | 포트  |
| ----------- | ----- |
| web         | 3000  |
| api         | 4000  |
| hocuspocus  | 1234  |
| temporal    | 7233  |
| temporal UI | 8233  |
| postgres    | 5432  |
| redis       | 6379  |
| minio       | 9000  |

`pnpm dev`는 Docker-first 경로입니다. API, web, Hocuspocus, worker, Redis,
Temporal을 한 번에 올립니다. 로컬 Postgres와 MinIO는 기본으로 켜지만,
`.env`가 Supabase/R2를 가리킬 때는 `OPENCAIRN_DEV_LOCAL_POSTGRES=false`,
`OPENCAIRN_DEV_LOCAL_MINIO=false`로 끌 수 있습니다. Ollama, BYOK 키 회전,
운영 배포 가이드는 `docs/contributing/dev-guide.md` 와
`docs/contributing/hosted-service.md` 를 참고해 주세요.
Temporal UI는 별도 `temporal-ui` 컨테이너가 아니라 `temporal` 컨테이너의
`http://localhost:8233`에서 제공됩니다. legacy `temporal-ui` 서비스는
`pnpm dev` 경로에 포함되지 않습니다.

## 문서

| 주제                                              | 경로                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| 문서 인덱스                                       | `docs/README.md`                                                      |
| 개발 히스토리와 의사결정 로그                      | `docs/contributing/project-history.md`                                |
| 시스템 설계                                       | `docs/contributing/roadmap.md`               |
| API 계약                                          | `docs/architecture/api-contract.md`                                   |
| 데이터 흐름 (ingest → wiki → Q&A)                 | `docs/architecture/data-flow.md`                                      |
| 협업 모델 (권한 · Hocuspocus · 코멘트)            | `docs/architecture/collaboration-model.md`                            |
| 에이전트 런타임                                    | `docs/contributing/roadmap.md`  |
| 운영                                              | `docs/contributing/ops.md`, `docs/runbooks/`                          |
| 기능 소유권과 중복 작업 방지                       | `docs/contributing/feature-registry.md`                               |

## 기여

이슈 · 토론 · PR 모두 환영합니다 — 시작하시기 전에 [CONTRIBUTING.md](CONTRIBUTING.md) 를 한 번 훑어 주세요. 커밋은 Conventional Commits 형식과 프로젝트 스코프를 따릅니다 (`feat(api): …`, `fix(worker): …`).

## 보안

취약점은 GitHub Security Advisories 비공개 채널로 제보해 주세요. 자세한 내용은 [SECURITY.md](SECURITY.md).

## 감사의 말

다음과 같은 훌륭한 오픈소스 프로젝트 위에 만들어졌습니다 — [Plate](https://platejs.org/), [Hocuspocus](https://tiptap.dev/docs/hocuspocus/introduction) / [Yjs](https://yjs.dev/), [Temporal](https://temporal.io/), [Drizzle ORM](https://orm.drizzle.team/), [PostgreSQL](https://www.postgresql.org/) / [pgvector](https://github.com/pgvector/pgvector), [Better Auth](https://www.better-auth.com/), [Hono](https://hono.dev/), [Next.js](https://nextjs.org/) / [React](https://react.dev/), [TanStack Query](https://tanstack.com/query/latest), [react-email](https://react.email/), [Cytoscape.js](https://js.cytoscape.org/), [Pyodide](https://pyodide.org/), [MarkItDown](https://github.com/microsoft/markitdown), [OpenDataLoader PDF](https://github.com/opendataloader-project/opendataloader-pdf), [PyMuPDF](https://pymupdf.readthedocs.io/), [LibreOffice](https://www.libreoffice.org/) / [unoserver](https://github.com/unoconv/unoserver), [Monaco Editor](https://microsoft.github.io/monaco-editor/), [Mermaid](https://mermaid.js.org/), [KaTeX](https://katex.org/), [Zod](https://zod.dev/), [MinIO](https://min.io/), [Redis](https://redis.io/).

## 연락처

- 메인테이너: [@Sungblab](https://github.com/Sungblab) — <sungblab@gmail.com>
- 버그 · 기능 제안: [GitHub Issues](https://github.com/Sungblab/opencairn-monorepo/issues)
- 질문 · 아이디어: [GitHub Discussions](https://github.com/Sungblab/opencairn-monorepo/discussions)
- 보안 제보: [SECURITY.md](SECURITY.md) 참고 (이메일 제보는 받지 **않습니다**)

## 라이선스

OpenCairn은 **듀얼 라이선스**로 배포됩니다:

- **기본**: [AGPL-3.0-or-later](LICENSE). 자체 호스팅, 포크, 수정, 재배포, 네트워크 서비스 운영 모두 AGPL 조건 내에서 자유이며, 네트워크 사용 조항에 따라 수정한 소스를 네트워크 너머 사용자에게 동일 라이선스로 공개해야 합니다.
- **상업용 라이선스**: AGPLv3의 네트워크 사용 조항을 따를 수 없거나, 내부 오픈소스 정책상 AGPL 컴포넌트 사용이 금지된 조직을 위해 별도 제공. 상세 범위와 문의 방법은 [`COMMERCIAL-LICENSING.md`](COMMERCIAL-LICENSING.md).

대부분의 사용자(개인, 내부 전용 배포, AGPL을 받아들일 수 있는 조직)에게는 상업용 라이선스가 필요하지 않습니다. 외부 기여자는 [Contributor License Agreement (CLA)](CLA.md) 승인이 요청되며, 이는 프로젝트가 기여분을 두 라이선스로 모두 배포할 수 있도록 허용합니다.
