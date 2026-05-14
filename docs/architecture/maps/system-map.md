# System Map

This map shows the high-level package/runtime boundary. For feature-level
ownership, use the feature registry and [feature-verification-map.md](./feature-verification-map.md).

```mermaid
flowchart TD
  Web[apps/web<br/>Next.js UI] --> ApiClient[API clients / TanStack Query]
  ApiClient --> Api[apps/api<br/>Hono routes]
  Api --> Db[packages/db<br/>Drizzle + pgvector]
  Api --> Shared[packages/shared<br/>Zod contracts]
  Web --> Shared

  Api --> WorkerQueue[Temporal tasks]
  Worker[apps/worker<br/>Temporal + runtime.Agent] --> WorkerQueue
  Worker --> Llm[packages/llm<br/>provider abstraction]
  Worker --> Api
  Worker --> Shared

  Hocuspocus[apps/hocuspocus<br/>Yjs collaboration] --> Api
  Hocuspocus --> Db

  Emails[packages/emails] --> Api
```

## Boundary Rules

- `apps/web` must not import `packages/db`, `apps/api`, or Server Actions.
- `packages/shared` must not import application packages or database code.
- `packages/db` must not import application packages.
- Worker agents must extend the local runtime and must not introduce LangGraph
  or LangChain as the control-plane abstraction.
- Long-running work belongs in Temporal-backed worker flows, not web request
  handlers.
