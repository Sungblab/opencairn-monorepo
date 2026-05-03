# OpenCairn

[English](README.md) | **한국어**

> 자체 호스팅 가능한 멀티 LLM · AI 에이전트 기반 개인 / 팀 지식 OS.

> ⚠️ **알파 단계입니다.** 스키마, API, 마이그레이션이 커밋 사이에 깨질 수 있습니다. 운영 환경에 도입하시기 전 별도 인스턴스에서 충분히 검증해 주세요.

## 무엇을 하는 도구인가요

OpenCairn은 PDF, DOCX, PPTX, XLSX, HWP, Markdown, Notion ZIP, Google Drive 등 다양한 입력을 받아 탐색 가능한 지식 그래프로 정리하고, 12개의 AI 에이전트 — Compiler · Research · Librarian · Curator · Connector · Synthesis · Staleness · Narrator · Visualization · Socratic · Code · DocEditor — 가 그 위에서 읽고 추론하고 글을 쓰도록 합니다. Docker 호스트에서 직접 동작하며, Google Gemini 또는 로컬 Ollama 모델을 통합 프로바이더 계층 뒤에서 사용합니다.

## 주요 특징

- **자체 호스팅 기본** — `docker compose up` 한 번이면 Postgres + pgvector, MinIO, Temporal, Redis, 선택적으로 Ollama가 모두 기동됩니다.
- **멀티 LLM** — Gemini(기본) 또는 Ollama를 환경 변수로 선택합니다. 워크스페이스 기본값 위에 사용자별 BYOK 키가 얹힙니다.
- **12개의 AI 에이전트** — Temporal과 자체 에이전트 런타임(`apps/worker/src/runtime/`)이 오케스트레이션합니다.
- **지식 그래프 + 위키 에디터** — Plate v49 기반 `[[wiki-link]]`, 백링크, Cytoscape 다중 뷰(그래프 / 보드 / 테이블 / 타임라인), 자동 개념 추출.
- **실시간 협업** — Hocuspocus / Yjs 기반 멀티 커서, 코멘트, `@mention`, 공유 링크, 페이지별 권한.
- **Deep research 모드** — 다단계 추론과 인용 · provenance 추적. BYOK 또는 managed PAYG 경로.
- **3계층 권한 모델** — Workspace → Project → Page, 상속과 override 지원.

## 아키텍처

```
apps/web         Next.js 16. UI + 브라우저 샌드박스 (Pyodide + iframe).
apps/api         Hono 4. 비즈니스 로직, 인증, 권한 헬퍼.
apps/worker      Python. Temporal 워커 + 에이전트 런타임 + 12개 에이전트.
apps/hocuspocus  Yjs 협업 서버. 페이지 수준 인증 hook.
packages/db      Drizzle ORM + pgvector + 3계층 워크스페이스 권한.
packages/llm     Python LLM 프로바이더 추상화 (Gemini / Ollama).
packages/emails  react-email v6 템플릿 + Resend.
packages/shared  Zod 스키마 (API 계약).
```

상세 설계: `docs/superpowers/specs/2026-04-09-opencairn-design.md`.

## Quick start

요구 사항: Node 22+, pnpm 9.15+, Python 3.12+, Docker.

```bash
# 1. 환경 설정
cp .env.example .env
# 최소 필수 항목:
#   POSTGRES_PASSWORD, S3_SECRET_KEY, BETTER_AUTH_SECRET, INTERNAL_API_SECRET,
#   INTEGRATION_TOKEN_ENCRYPTION_KEY  (`openssl rand -base64 32` 으로 생성),
#   그리고 GEMINI_API_KEY 또는 OLLAMA_BASE_URL 중 하나.

# 2. 인프라 기동 (Postgres, Redis, MinIO, Temporal)
docker compose up -d postgres redis minio temporal

# 3. 의존성 설치 + 마이그레이션
pnpm install
pnpm db:migrate

# 4. 모든 앱 실행
pnpm dev
```

기본 로컬 포트:

| 서비스      | 포트  |
| ----------- | ----- |
| web         | 3000  |
| api         | 4000  |
| hocuspocus  | 1234  |
| temporal    | 7233  |
| minio       | 9000  |

전체 Docker 경로(워커 컨테이너 포함), Ollama 프로파일, BYOK 키 회전, Cloudflare R2 스토리지 등의 운영 가이드는 `docs/contributing/dev-guide.md` 와 `docs/contributing/hosted-service.md` 를 참고해 주세요.

## 문서

| 주제                                              | 경로                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| 문서 인덱스                                       | `docs/README.md`                                                      |
| 개발 히스토리와 의사결정 로그                      | `docs/contributing/project-history.md`                                |
| 시스템 설계                                       | `docs/superpowers/specs/2026-04-09-opencairn-design.md`               |
| API 계약                                          | `docs/architecture/api-contract.md`                                   |
| 데이터 흐름 (ingest → wiki → Q&A)                 | `docs/architecture/data-flow.md`                                      |
| 협업 모델 (권한 · Hocuspocus · 코멘트)            | `docs/architecture/collaboration-model.md`                            |
| 에이전트 런타임                                    | `docs/superpowers/specs/2026-04-20-agent-runtime-standard-design.md`  |
| 운영                                              | `docs/contributing/ops.md`, `docs/runbooks/`                          |
| Plan 상태                                         | `docs/contributing/plans-status.md`                                   |

## 기여

이슈 · 토론 · PR 모두 환영합니다 — 시작하시기 전에 [CONTRIBUTING.md](CONTRIBUTING.md) 를 한 번 훑어 주세요. 커밋은 Conventional Commits 형식과 프로젝트 스코프를 따릅니다 (`feat(api): …`, `fix(worker): …`).

## 보안

취약점은 GitHub Security Advisories 비공개 채널로 제보해 주세요. 자세한 내용은 [SECURITY.md](SECURITY.md).

## 감사의 말

다음과 같은 훌륭한 오픈소스 프로젝트 위에 만들어졌습니다 — [Plate](https://platejs.org/), [Hocuspocus](https://tiptap.dev/hocuspocus) / [Yjs](https://github.com/yjs/yjs), [Temporal](https://temporal.io/), [Drizzle ORM](https://orm.drizzle.team/), [pgvector](https://github.com/pgvector/pgvector), [Better Auth](https://www.better-auth.com/), [Hono](https://hono.dev/), [Next.js](https://nextjs.org/), [react-email](https://react.email/), [Cytoscape.js](https://js.cytoscape.org/), [Pyodide](https://pyodide.org/), [MarkItDown](https://github.com/microsoft/markitdown).

## 연락처

- 메인테이너: [@Sungblab](https://github.com/Sungblab) — <sungblab@gmail.com>
- 버그 · 기능 제안: [GitHub Issues](https://github.com/Sungblab/opencairn-monorepo/issues)
- 질문 · 아이디어: [GitHub Discussions](https://github.com/Sungblab/opencairn-monorepo/discussions)
- 보안 제보: [SECURITY.md](SECURITY.md) 참고 (이메일 제보는 받지 **않습니다**)

## 라이선스

OpenCairn은 **듀얼 라이선스**로 배포됩니다:

- **기본**: [AGPL-3.0-or-later](LICENSE). 자체 호스팅, 포크, 수정, 재배포, 네트워크 서비스 운영 모두 AGPL 조건 내에서 자유이며, 네트워크 사용 조항에 따라 수정한 소스를 네트워크 너머 사용자에게 동일 라이선스로 공개해야 합니다.
- **상업용 라이선스**: AGPLv3의 네트워크 사용 조항을 따를 수 없거나, 내부 오픈소스 정책상 AGPL 컴포넌트 사용이 금지된 조직을 위해 별도 제공. 상세 범위와 문의 방법은 [`LICENSE-COMMERCIAL.md`](LICENSE-COMMERCIAL.md).

대부분의 사용자(개인, 내부 전용 배포, AGPL을 받아들일 수 있는 조직)에게는 상업용 라이선스가 필요하지 않습니다. 외부 기여자는 [Contributor License Agreement (CLA)](CLA.md) 승인이 요청되며, 이는 프로젝트가 기여분을 두 라이선스로 모두 배포할 수 있도록 허용합니다.
