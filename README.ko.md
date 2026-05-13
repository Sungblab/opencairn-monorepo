# OpenCairn

[English](README.md) | **한국어**

[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](LICENSE)
[![Commercial license available](https://img.shields.io/badge/commercial%20license-available-0f766e.svg)](COMMERCIAL-LICENSING.md)
[![Self-hostable](https://img.shields.io/badge/self--host-Docker%20Compose-111827.svg)](docs/contributing/dev-guide.md)
[![Status: Alpha](https://img.shields.io/badge/status-alpha-f59e0b.svg)](docs/contributing/roadmap.md)

> 자체 호스팅 가능한 멀티 LLM 기반 개인 / 팀 지식 OS.

OpenCairn은 PDF, 일반 문서 파일, Markdown/CSV 내보내기, Google Drive
가져오기, 노트, 리서치 자료를 권한 기반 워크스페이스로 정리합니다. 협업 위키
노트, 지식 그래프, grounded Q&A, 검토 가능한 AI 액션을 한 제품 안에서
다룹니다.

OpenCairn은 알파 단계입니다. 스키마, API, 마이그레이션이 커밋 사이에 바뀔 수
있습니다. 중요한 데이터에 쓰기 전에는 별도 비공개 인스턴스에서 먼저 검증해
주세요.

## 제공 기능

| 영역 | 현재 포함된 기능 |
| --- | --- |
| 지식 워크스페이스 | 워크스페이스, 프로젝트, 페이지, 소스 노트, 위키 링크, 백링크 |
| AI와 검색 | 설정 가능한 provider 경로, grounded retrieval, 인용, 그래프 표면 |
| 인제스트 파이프라인 | PDF, 일반 문서, Markdown/CSV ZIP, Google Drive file-ID import, 지원되는 미디어 |
| 협업 | Yjs/Hocuspocus 편집, 코멘트, 멘션, 공유 링크, 권한 |
| 워크플로우 런타임 | workflow-backed job, action ledger, Workflow Console, 복구 surface |
| 생성 산출물 | 검토 가능한 AI 액션, 생성 프로젝트 파일, 문서 생성 기반 |
| 자체 호스팅 | 로컬 인프라와 app service용 Docker Compose |

## 아키텍처

```text
apps/web         Next.js 16 UI와 브라우저 샌드박스
apps/api         Hono API, 인증, 권한, 비즈니스 로직
apps/worker      인제스트, 워크플로우, AI 작업을 처리하는 Python worker 프로세스
apps/hocuspocus  Yjs 협업 서버
packages/db      Drizzle ORM, PostgreSQL, pgvector, 워크스페이스 권한
packages/llm     Python LLM provider 추상화
packages/emails  React Email 템플릿과 전송 계층
packages/shared  공유 Zod 계약과 TypeScript 타입
```

공개 로드맵은 [docs/contributing/roadmap.md](docs/contributing/roadmap.md)에
있습니다. 기능 소유권과 중복 작업 방지는
[docs/contributing/feature-registry.md](docs/contributing/feature-registry.md)를
확인해 주세요.

## OpenCairn 실행

### 자체 호스팅 서버

서버처럼 app stack을 실행할 때는 Docker Compose를 사용합니다.

```bash
cp .env.example .env
# 최소 필수 항목:
# POSTGRES_PASSWORD, S3_SECRET_KEY, BETTER_AUTH_SECRET, INTERNAL_API_SECRET,
# INTEGRATION_TOKEN_ENCRYPTION_KEY, 그리고 GEMINI_API_KEY 또는 OLLAMA_BASE_URL.

pnpm install

docker compose up -d postgres redis minio temporal
pnpm db:migrate

docker compose --profile app --profile worker --profile hocuspocus up -d --build
```

이미 빌드된 이미지로 다시 켤 때:

```bash
docker compose --profile app --profile worker --profile hocuspocus up -d
```

중지:

```bash
docker compose --profile app --profile worker --profile hocuspocus down
```

### 로컬 개발

메인테이너와 기여자는 pnpm 스크립트로 같은 로컬 서비스를 감쌀 수 있습니다.

```bash
pnpm install
pnpm db:migrate
pnpm dev:docker          # 바뀐 app 이미지를 다시 빌드하고 stack 실행
pnpm dev:docker:no-build # 기존 이미지로만 stack 실행
pnpm dev:host            # app process를 host hot-reload로 실행
```

`pnpm dev:docker:rebuild`는 캐시를 쓰지 않는 전체 이미지 재빌드입니다. 전체
Docker build 경로를 검증할 때만 사용하세요.

## 기본 포트

| 서비스 | 포트 |
| --- | ---: |
| Web | 3000 |
| API | 4000 |
| Hocuspocus | 1234 |
| Temporal | 7233 |
| Temporal UI | 8233 |
| Postgres | 5432 |
| Redis | 6379 |
| MinIO | 9000 |

Temporal UI는 `temporal` 컨테이너의 `http://localhost:8233`에서 제공됩니다.
legacy `temporal-ui` 서비스는 기본 app stack에 포함되지 않습니다.

## 설정 메모

- `.env`가 Supabase 또는 외부 PostgreSQL을 가리키면
  `OPENCAIRN_DEV_LOCAL_POSTGRES=false`를 설정하세요.
- `.env`가 Cloudflare R2 또는 외부 S3 호환 스토리지를 가리키면
  `OPENCAIRN_DEV_LOCAL_MINIO=false`를 설정하세요.
- hosted-service의 legal, blog, analytics, contact, SEO URL은 환경 변수로
  설정합니다. [docs/contributing/hosted-service.md](docs/contributing/hosted-service.md)를
  참고하세요.
- Ollama는 선택 사항이며 별도 Compose profile로 실행합니다.

## 문서

| 주제 | 링크 |
| --- | --- |
| 문서 인덱스 | [docs/README.md](docs/README.md) |
| 로드맵과 기능 상태 | [docs/contributing/roadmap.md](docs/contributing/roadmap.md) |
| 개발과 자체 호스팅 | [docs/contributing/dev-guide.md](docs/contributing/dev-guide.md) |
| 기능 레지스트리 | [docs/contributing/feature-registry.md](docs/contributing/feature-registry.md) |
| API 계약 | [docs/architecture/api-contract.md](docs/architecture/api-contract.md) |
| 데이터 흐름 | [docs/architecture/data-flow.md](docs/architecture/data-flow.md) |
| 협업 모델 | [docs/architecture/collaboration-model.md](docs/architecture/collaboration-model.md) |
| 보안 모델 | [docs/architecture/security-model.md](docs/architecture/security-model.md) |
| 공개 릴리스 체크리스트 | [docs/contributing/public-release-checklist.md](docs/contributing/public-release-checklist.md) |

## 기술 딥다이브

긴 구현 설명은
[OpenCairn 기술 딥다이브 시리즈](https://sungblab.com/blog/opencairn-technical-deep-dives)에
정리되어 있습니다.

- [Permission-aware RAG](https://sungblab.com/blog/opencairn-permission-aware-rag)
- [Agentic Workflow Ledger](https://sungblab.com/blog/opencairn-agentic-workflow-ledger)
- [Yjs-backed `note.update`](https://sungblab.com/blog/opencairn-yjs-note-update)
- [Workflow Console Recovery](https://sungblab.com/blog/opencairn-workflow-console-recovery)
- [Document Generation Pipeline](https://sungblab.com/blog/opencairn-document-generation-pipeline)
- [Code Workspace Execution Loop](https://sungblab.com/blog/opencairn-code-workspace-execution-loop)

## 기여

이슈, 토론, PR을 환영합니다. 먼저 [CONTRIBUTING.md](CONTRIBUTING.md)를
읽고, 새 surface를 만들기 전
[feature registry](docs/contributing/feature-registry.md)를 확인해 주세요.
커밋은 `feat(api):`, `fix(worker):`, `docs(readme):` 같은 프로젝트 스코프가
있는 Conventional Commits 형식을 따릅니다.

## 보안

취약점은 GitHub Security Advisories 비공개 채널로 제보해 주세요. 자세한
내용은 [SECURITY.md](SECURITY.md)를 참고하세요. 보안 제보는 이메일로 받지
않습니다.

## 감사의 말

OpenCairn은 web app, API, database, collaboration server, worker, sandbox,
AI provider layer 전반에서 오픈소스 인프라를 사용합니다. 정확한 dependency
surface는 package manifest와 공개 architecture 문서를 기준으로 확인합니다.

## 연락처

- 메인테이너: [@Sungblab](https://github.com/Sungblab) — <sungblab@gmail.com>
- 버그와 기능 제안: [GitHub Issues](https://github.com/Sungblab/opencairn-monorepo/issues)
- 질문과 아이디어: [GitHub Discussions](https://github.com/Sungblab/opencairn-monorepo/discussions)

## 라이선스

OpenCairn은 듀얼 라이선스로 배포됩니다.

- **기본**: [AGPL-3.0-or-later](LICENSE). AGPL 조건 안에서 자체 호스팅,
  포크, 수정, 재배포, 네트워크 서비스 운영이 가능합니다.
- **상업용 라이선스**: AGPLv3의 네트워크 사용 조항을 따를 수 없거나 내부
  오픈소스 정책상 AGPL 컴포넌트 사용이 금지된 조직을 위해 제공됩니다.
  [COMMERCIAL-LICENSING.md](COMMERCIAL-LICENSING.md)를 참고하세요.

대부분의 개인, 내부 전용 배포, AGPL을 받아들일 수 있는 조직에는 상업용
라이선스가 필요하지 않습니다. 외부 기여자는 [Contributor License Agreement](CLA.md)
승인이 요청되며, 이는 프로젝트가 기여분을 두 라이선스로 모두 배포할 수 있도록
허용합니다.
