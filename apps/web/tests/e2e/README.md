# Web E2E Full-Stack Fixture

Playwright starts or reuses both dev servers:

```bash
pnpm --filter @opencairn/web test:e2e
```

Local runs reuse `localhost:3000` and `localhost:4000` when they are already
up. To force a controlled pair of dev servers, run:

```bash
OPENCAIRN_E2E_REUSE_SERVERS=0 pnpm --filter @opencairn/web test:e2e
```

The controlled profile clears `GEMINI_API_KEY`/`GOOGLE_API_KEY` unless
`OPENCAIRN_E2E_ALLOW_LLM=1` is set. This keeps smoke tests deterministic and
prevents E2E from spending real Gemini tokens.

Required local services for seeded full-stack specs:

- API dev server at `http://localhost:4000/api/health`
- Web dev server at `http://localhost:3000`
- Postgres from `docker-compose.yml`, with migrations applied
- Redis/MinIO only for specs that exercise those routes
- Matching `INTERNAL_API_SECRET` in Playwright and `apps/api`

If `/api/internal/test-seed` returns a failed `insert into "user"` query, the
API is reachable but the local database is not at the expected migrated schema.
Start the compose database and rerun migrations before rerunning E2E.
