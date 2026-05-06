# OpenCairn

**English** | [한국어](README.ko.md)

> Self-hostable, multi-LLM knowledge OS for individuals and teams.

> ⚠️ **Alpha.** Schemas, APIs, and migrations may break between commits. Evaluate on a private instance before relying on it.

## What it does

OpenCairn ingests documents such as PDF, Office files, HWP/HWPX, Markdown, Notion ZIP exports, and Google Drive file-ID imports, then turns them into editable notes, a navigable knowledge graph, and grounded Q&A surfaces. Its long-term architecture defines AI roles for compiling, research, learning, synthesis, narration, visualization, code, and maintenance, but not every role is a default-on product agent today. It runs on your own Docker host, behind a provider layer that speaks Google Gemini or a local Ollama model.

## Highlights

- **Self-hostable by default** — Docker Compose brings up Postgres + pgvector, MinIO, Temporal, Redis, and optionally Ollama; the local dev path still runs migrations and app processes explicitly.
- **Multi-LLM** — Gemini (default) or Ollama, selected via environment. User-level Gemini BYOK is implemented for supported AI paths.
- **AI workflows and agent roles** — Temporal workflows plus `apps/worker/src/runtime/` power a staged set of runtime agents, workflow-backed features, and gated product surfaces.
- **Knowledge graph + wiki editor** — Plate v49 with `[[wiki-link]]`, backlinks, Cytoscape multi-view (graph / board / table / timeline), and automatic concept extraction.
- **Real-time collaboration** — Hocuspocus / Yjs with multi-cursor, comments, `@mentions`, share links, per-note permissions.
- **Deep research mode** — multi-step research with citations and provenance; managed hosted billing remains a later hosted-service surface.
- **Three-tier permission model** — Workspace → Project → Page, with inheritance and override.

## Architecture

```
apps/web         Next.js 16. UI + browser sandbox (Pyodide + iframe).
apps/api         Hono 4. Business logic, auth, permission helpers.
apps/worker      Python. Temporal worker + agent runtime + workflow-backed AI features.
apps/hocuspocus  Yjs collaboration server with page-level auth hooks.
packages/db      Drizzle ORM + pgvector + 3-tier workspace permissions.
packages/llm     Python LLM provider abstraction (Gemini / Ollama).
packages/emails  react-email v6 templates + Resend.
packages/shared  Zod schemas (API contract).
```

Detailed design: `docs/contributing/roadmap.md`.

## Technical Deep Dives

The README stays intentionally short. Longer implementation writeups live in
the [OpenCairn technical deep-dive series](https://sungblab.com/blog/opencairn-technical-deep-dives),
covering the agentic workflow ledger, permission-aware RAG, Yjs-backed wiki
notes, Workflow Console recovery, document generation, and code workspace
execution loop.

## Quick start

Requirements: Node 22+, pnpm 9.15+, Python 3.12+, Docker.

```bash
# 1. Configure
cp .env.example .env
# Fill in at minimum:
#   POSTGRES_PASSWORD, S3_SECRET_KEY, BETTER_AUTH_SECRET, INTERNAL_API_SECRET,
#   INTEGRATION_TOKEN_ENCRYPTION_KEY  (generate with `openssl rand -base64 32`),
#   and either GEMINI_API_KEY or OLLAMA_BASE_URL.

# 2. Bring up infra (Postgres, Redis, MinIO, Temporal)
docker compose up -d postgres redis minio temporal

# 3. Install dependencies and run migrations
pnpm install
pnpm db:migrate

# 4. Run all apps
pnpm dev
```

Default local ports:

| Service     | Port  |
| ----------- | ----- |
| web         | 3000  |
| api         | 4000  |
| hocuspocus  | 1234  |
| temporal    | 7233  |
| minio       | 9000  |

For the all-in-Docker path (including the worker container, Ollama profile, BYOK key rotation, and Cloudflare R2 storage), see `docs/contributing/dev-guide.md` and `docs/contributing/hosted-service.md`.

## Documentation

| Topic                                                  | Path                                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------- |
| Doc index                                              | `docs/README.md`                                                      |
| Project history and decision log                       | `docs/contributing/project-history.md`                                |
| System design                                          | `docs/contributing/roadmap.md`               |
| API contract                                           | `docs/architecture/api-contract.md`                                   |
| Data flow (ingest → wiki → Q&A)                        | `docs/architecture/data-flow.md`                                      |
| Collaboration model (permissions, Hocuspocus, comments) | `docs/architecture/collaboration-model.md`                            |
| Agent runtime                                          | `docs/contributing/roadmap.md`  |
| Operations                                             | `docs/contributing/ops.md`, `docs/runbooks/`                          |
| Feature ownership and duplicate-work guard              | `docs/contributing/feature-registry.md`                               |
| RAG, parser, and agent benchmark plan                   | `docs/testing/rag-agent-benchmark-plan.md`                            |
| Public release checklist                                | `docs/contributing/public-release-checklist.md`                       |

## Contributing

Issues, discussions, and pull requests are welcome — please skim [CONTRIBUTING.md](CONTRIBUTING.md) first. Commits follow Conventional Commits with project-specific scopes (`feat(api): …`, `fix(worker): …`).

## Security

Report vulnerabilities privately via GitHub Security Advisories. Details in [SECURITY.md](SECURITY.md).

## Acknowledgments

Built on top of excellent open-source work, including [Plate](https://platejs.org/), [Hocuspocus](https://tiptap.dev/docs/hocuspocus/introduction) / [Yjs](https://yjs.dev/), [Temporal](https://temporal.io/), [Drizzle ORM](https://orm.drizzle.team/), [PostgreSQL](https://www.postgresql.org/) / [pgvector](https://github.com/pgvector/pgvector), [Better Auth](https://www.better-auth.com/), [Hono](https://hono.dev/), [Next.js](https://nextjs.org/) / [React](https://react.dev/), [TanStack Query](https://tanstack.com/query/latest), [react-email](https://react.email/), [Cytoscape.js](https://js.cytoscape.org/), [Pyodide](https://pyodide.org/), [MarkItDown](https://github.com/microsoft/markitdown), [OpenDataLoader PDF](https://github.com/opendataloader-project/opendataloader-pdf), [PyMuPDF](https://pymupdf.readthedocs.io/), [LibreOffice](https://www.libreoffice.org/) / [unoserver](https://github.com/unoconv/unoserver), [Monaco Editor](https://microsoft.github.io/monaco-editor/), [Mermaid](https://mermaid.js.org/), [KaTeX](https://katex.org/), [Zod](https://zod.dev/), [MinIO](https://min.io/), and [Redis](https://redis.io/).

## Contact

- Author: [@Sungblab](https://github.com/Sungblab) — <sungblab@gmail.com>
- Bugs & feature requests: [GitHub Issues](https://github.com/Sungblab/opencairn-monorepo/issues)
- Questions & ideas: [GitHub Discussions](https://github.com/Sungblab/opencairn-monorepo/discussions)
- Security: see [SECURITY.md](SECURITY.md) (please do **not** email security reports)

## License

OpenCairn is **dual-licensed**:

- **Default**: [AGPL-3.0-or-later](LICENSE). Self-host, fork, modify, redistribute, or run as a network service — all permitted under AGPL terms, including the network-use clause that requires modified source to be available to network users.
- **Commercial license**: available for organizations that cannot comply with AGPLv3's network-use clause or whose internal open-source policy prohibits AGPL components. See [`COMMERCIAL-LICENSING.md`](COMMERCIAL-LICENSING.md) for scope and how to inquire.

For most users — individuals, internal-only deployments, organizations comfortable with AGPL — no commercial license is needed. Non-trivial contributors are asked to accept the [Contributor License Agreement](CLA.md), which lets the project distribute their contribution under both licenses.
