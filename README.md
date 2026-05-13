# OpenCairn

**English** | [한국어](README.ko.md)

[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](LICENSE)
[![Commercial license available](https://img.shields.io/badge/commercial%20license-available-0f766e.svg)](COMMERCIAL-LICENSING.md)
[![Self-hostable](https://img.shields.io/badge/self--host-Docker%20Compose-111827.svg)](docs/contributing/dev-guide.md)
[![Status: Alpha](https://img.shields.io/badge/status-alpha-f59e0b.svg)](docs/contributing/roadmap.md)

> Self-hostable, multi-LLM knowledge OS for individuals and teams.

OpenCairn turns PDFs, common office files, Markdown/CSV exports, Google Drive
imports, notes, and research artifacts into a permission-aware workspace with
collaborative wiki notes, a knowledge graph, grounded Q&A, and workflow-backed
AI actions.

OpenCairn is in alpha. Schemas, APIs, and migrations may change between commits.
Run it on a private instance before relying on it for important data.

## What You Get

| Area | Included today |
| --- | --- |
| Knowledge workspace | Workspaces, projects, pages, source notes, wiki links, backlinks |
| AI and retrieval | Configurable provider paths, grounded retrieval, citations, graph surfaces |
| Ingest pipeline | PDFs, common documents, Markdown/CSV ZIP, Google Drive file-ID import, supported media |
| Collaboration | Yjs/Hocuspocus editing, comments, mentions, share links, permissions |
| Workflow runtime | Workflow-backed jobs, action ledger, workflow console, recovery surfaces |
| Generated artifacts | Reviewable AI actions, generated project files, document generation foundations |
| Self-hosting | Docker Compose for local infrastructure and app services |

## Architecture

```text
apps/web         Next.js 16 UI and browser sandbox
apps/api         Hono API, auth, permissions, business logic
apps/worker      Python worker processes for ingest, workflow, and AI jobs
apps/hocuspocus  Yjs collaboration server
packages/db      Drizzle ORM, PostgreSQL, pgvector, workspace permissions
packages/llm     Python LLM provider abstraction
packages/emails  React Email templates and transports
packages/shared  Shared Zod contracts and TypeScript types
```

The public roadmap is in [docs/contributing/roadmap.md](docs/contributing/roadmap.md).
Feature ownership and duplicate-work guards are in
[docs/contributing/feature-registry.md](docs/contributing/feature-registry.md).

## Run OpenCairn

### Self-hosted server

Use Docker Compose when you want to run the app stack as a server.

```bash
cp .env.example .env
# Fill at least:
# POSTGRES_PASSWORD, S3_SECRET_KEY, BETTER_AUTH_SECRET, INTERNAL_API_SECRET,
# INTEGRATION_TOKEN_ENCRYPTION_KEY, and either GEMINI_API_KEY or OLLAMA_BASE_URL.

pnpm install

docker compose up -d postgres redis minio temporal
pnpm db:migrate

docker compose --profile app --profile worker --profile hocuspocus up -d --build
```

Restart an already-built stack without rebuilding images:

```bash
docker compose --profile app --profile worker --profile hocuspocus up -d
```

Stop the stack:

```bash
docker compose --profile app --profile worker --profile hocuspocus down
```

### Local development

For maintainers and contributors, the pnpm scripts wrap the same local services.

```bash
pnpm install
pnpm db:migrate
pnpm dev:docker          # rebuild changed app images and start the stack
pnpm dev:docker:no-build # start existing images without rebuilding
pnpm dev:host            # host hot-reload for app processes
```

`pnpm dev:docker:rebuild` performs a no-cache image rebuild and is intentionally
slow. Use it only when validating the full Docker build path.

## Default Ports

| Service | Port |
| --- | ---: |
| Web | 3000 |
| API | 4000 |
| Hocuspocus | 1234 |
| Temporal | 7233 |
| Temporal UI | 8233 |
| Postgres | 5432 |
| Redis | 6379 |
| MinIO | 9000 |

Temporal UI is served by the `temporal` container at `http://localhost:8233`.
The legacy `temporal-ui` service is not part of the default app stack.

## Configuration Notes

- Set `OPENCAIRN_DEV_LOCAL_POSTGRES=false` when `.env` points at Supabase or
  another external PostgreSQL database.
- Set `OPENCAIRN_DEV_LOCAL_MINIO=false` when `.env` points at Cloudflare R2 or
  another S3-compatible object store.
- Hosted-service legal, blog, analytics, contact, and SEO URLs are environment
  driven. See [docs/contributing/hosted-service.md](docs/contributing/hosted-service.md).
- Ollama is optional and runs through its own Compose profile.

## Documentation

| Topic | Link |
| --- | --- |
| Docs index | [docs/README.md](docs/README.md) |
| Roadmap and feature status | [docs/contributing/roadmap.md](docs/contributing/roadmap.md) |
| Development and self-hosting | [docs/contributing/dev-guide.md](docs/contributing/dev-guide.md) |
| Feature registry | [docs/contributing/feature-registry.md](docs/contributing/feature-registry.md) |
| API contract | [docs/architecture/api-contract.md](docs/architecture/api-contract.md) |
| Data flow | [docs/architecture/data-flow.md](docs/architecture/data-flow.md) |
| Collaboration model | [docs/architecture/collaboration-model.md](docs/architecture/collaboration-model.md) |
| Security model | [docs/architecture/security-model.md](docs/architecture/security-model.md) |
| Public release checklist | [docs/contributing/public-release-checklist.md](docs/contributing/public-release-checklist.md) |

## Technical Deep Dives

Long-form implementation writeups live in the
[OpenCairn technical deep-dive series](https://sungblab.com/blog/opencairn-technical-deep-dives).

- [Permission-aware RAG](https://sungblab.com/blog/opencairn-permission-aware-rag)
- [Agentic Workflow Ledger](https://sungblab.com/blog/opencairn-agentic-workflow-ledger)
- [Yjs-backed `note.update`](https://sungblab.com/blog/opencairn-yjs-note-update)
- [Workflow Console Recovery](https://sungblab.com/blog/opencairn-workflow-console-recovery)
- [Document Generation Pipeline](https://sungblab.com/blog/opencairn-document-generation-pipeline)
- [Code Workspace Execution Loop](https://sungblab.com/blog/opencairn-code-workspace-execution-loop)

## Contributing

Issues, discussions, and pull requests are welcome. Start with
[CONTRIBUTING.md](CONTRIBUTING.md), then check the
[feature registry](docs/contributing/feature-registry.md) before creating a new
surface. Commits follow Conventional Commits with project scopes such as
`feat(api):`, `fix(worker):`, and `docs(readme):`.

## Security

Report vulnerabilities privately via GitHub Security Advisories. See
[SECURITY.md](SECURITY.md). Please do not send security reports by email.

## Acknowledgments

OpenCairn builds on open-source infrastructure across the web app, API,
database, collaboration server, workers, sandbox, and AI provider layers. See
the package manifests and public architecture docs for the current dependency
surface.

## Contact

- Author: [@Sungblab](https://github.com/Sungblab) — <sungblab@gmail.com>
- Bugs and feature requests: [GitHub Issues](https://github.com/Sungblab/opencairn-monorepo/issues)
- Questions and ideas: [GitHub Discussions](https://github.com/Sungblab/opencairn-monorepo/discussions)

## License

OpenCairn is dual-licensed:

- **Default**: [AGPL-3.0-or-later](LICENSE). Self-host, fork, modify,
  redistribute, or run as a network service under AGPL terms.
- **Commercial license**: available for organizations that cannot comply with
  AGPLv3's network-use clause or whose internal open-source policy prohibits
  AGPL components. See [COMMERCIAL-LICENSING.md](COMMERCIAL-LICENSING.md).

Most individuals, internal deployments, and organizations comfortable with AGPL
do not need a commercial license. Non-trivial contributors are asked to accept
the [Contributor License Agreement](CLA.md) so the project can distribute
contributions under both licenses.
