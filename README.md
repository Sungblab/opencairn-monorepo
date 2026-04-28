# OpenCairn

**English** | [한국어](README.ko.md)

> Self-hosted, multi-LLM, agent-driven knowledge OS for individuals and teams.

> ⚠️ **Alpha.** Schemas, APIs, and migrations may break between commits. Evaluate on a private instance before relying on it.

## What it does

OpenCairn ingests your documents (PDF, DOCX, PPTX, XLSX, HWP, Markdown, Notion ZIP, Google Drive, …), turns them into a navigable knowledge graph, and lets a fleet of AI agents — Compiler, Research, Librarian, Curator, Connector, Synthesis, Staleness, Narrator, Visualization, Socratic, Code, DocEditor — read, reason, and write across that graph. It runs on your own Docker host, behind a unified provider layer that speaks Google Gemini or a local Ollama model.

## Highlights

- **Self-hosted by default** — `docker compose up` brings up Postgres + pgvector, MinIO, Temporal, Redis, and optionally Ollama.
- **Multi-LLM** — Gemini (default) or Ollama, selected via environment. Per-user BYOK keys layer on top of workspace defaults.
- **12 AI agents** orchestrated by Temporal and a custom agent runtime in `apps/worker/src/runtime/`.
- **Knowledge graph + wiki editor** — Plate v49 with `[[wiki-link]]`, backlinks, Cytoscape multi-view (graph / board / table / timeline), and automatic concept extraction.
- **Real-time collaboration** — Hocuspocus / Yjs with multi-cursor, comments, `@mentions`, share links, per-note permissions.
- **Deep research mode** — multi-step planning with citations and provenance; BYOK or managed PAYG path.
- **Three-tier permission model** — Workspace → Project → Page, with inheritance and override.

## Architecture

```
apps/web         Next.js 16. UI + browser sandbox (Pyodide + iframe).
apps/api         Hono 4. Business logic, auth, permission helpers.
apps/worker      Python. Temporal worker + agent runtime + 12 agents.
apps/hocuspocus  Yjs collaboration server with page-level auth hooks.
packages/db      Drizzle ORM + pgvector + 3-tier workspace permissions.
packages/llm     Python LLM provider abstraction (Gemini / Ollama).
packages/emails  react-email v6 templates + Resend.
packages/shared  Zod schemas (API contract).
```

Detailed design: `docs/superpowers/specs/2026-04-09-opencairn-design.md`.

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
| System design                                          | `docs/superpowers/specs/2026-04-09-opencairn-design.md`               |
| API contract                                           | `docs/architecture/api-contract.md`                                   |
| Data flow (ingest → wiki → Q&A)                        | `docs/architecture/data-flow.md`                                      |
| Collaboration model (permissions, Hocuspocus, comments) | `docs/architecture/collaboration-model.md`                            |
| Agent runtime                                          | `docs/superpowers/specs/2026-04-20-agent-runtime-standard-design.md`  |
| Operations                                             | `docs/contributing/ops.md`, `docs/runbooks/`                          |
| Plan status                                            | `docs/contributing/plans-status.md`                                   |

## Contributing

Issues, discussions, and pull requests are welcome — please skim [CONTRIBUTING.md](CONTRIBUTING.md) first. Commits follow Conventional Commits with project-specific scopes (`feat(api): …`, `fix(worker): …`).

## Security

Report vulnerabilities privately via GitHub Security Advisories. Details in [SECURITY.md](SECURITY.md).

## License

[AGPL-3.0-or-later](LICENSE).

If you run a modified OpenCairn as a network service for other users (for example as a hosted SaaS), the AGPL's network-use clause requires that the modified source be available to those users under the same license. Self-host privately, fork, modify, or contribute back — your choice within those terms.
