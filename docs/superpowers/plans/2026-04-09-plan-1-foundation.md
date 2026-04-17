# Plan 1: Foundation ??Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **⚠️ Multi-LLM 업데이트 (2026-04-13):** `vector3072` 커스텀 타입 하드코딩 대신 `VECTOR_DIM` env 변수로 동적 설정. `const VECTOR_DIM = parseInt(process.env.VECTOR_DIM ?? "3072")`. 상세: `docs/superpowers/specs/2026-04-13-multi-llm-provider-design.md`

**Goal:** Initialize the OpenCairn monorepo with Turborepo, set up the database schema with Drizzle ORM, wire up Hono API with authentication, implement project/folder/tag/note CRUD, and create a working Docker Compose dev environment.

**Architecture:** Turborepo monorepo with `apps/web` (Next.js 16), `apps/api` (Hono on Node.js), and `packages/db` (Drizzle ORM + PostgreSQL + pgvector). Better Auth handles authentication with Redis sessions. All business logic lives in `apps/api`; the web app only calls the API.

**Tech Stack:** Turborepo, Next.js 16, Hono 4, Drizzle ORM 0.45, PostgreSQL 16 + pgvector, Better Auth, Redis 7, Zod, TypeScript 5.x, Tailwind CSS 4, pnpm

> **⚠️ 인프라 추가 결정 (2026-04-14):** 다음 항목들이 본 plan 범위에 포함된다 (구현 task는 본 문서 후반에 별도 추가 예정):
> - **이메일**: Resend (default) + SMTP fallback. env: `EMAIL_PROVIDER=resend|smtp`
> - **에러/로깅**: Sentry (옵션). env: `SENTRY_DSN` 미설정 시 비활성화. 셀프호스트 사용자는 GlitchTip 대안.
> - **테스트 전략**:
>   - `apps/api`, `apps/web` (TS): **Vitest** (단위) + **testcontainers** (PostgreSQL 통합)
>   - `apps/worker` (Python): **pytest** + Temporal test framework
>   - E2E: **Playwright**
>   - 원칙: mocking 최소, 실제 PostgreSQL/Redis 통합 테스트 우선
> - **CI/CD**: GitHub Actions
>   - `ci.yml` (PR): lint + typecheck + test (Node + Python matrix)
>   - `build.yml` (main): `docker buildx` → ghcr.io 멀티아치 (linux/amd64 + linux/arm64)
>   - Renovate (의존성 자동 PR), CodeQL (보안 스캔)
> - **백업 스크립트**: 셀프호스트 사용자용 내장 스크립트
>   - `scripts/backup.sh` — `pg_dump | gzip` + 옵션 R2 업로드 (`--to-r2`)
>   - `scripts/restore.sh` — 백업 파일 → 컨테이너 복원
>   - `scripts/backup-verify.sh` — 임시 컨테이너에 복원해서 무결성 검증
>   - 리텐션 자동 정리 (env: `BACKUP_RETENTION_DAYS=7`)
>   - cron 등록 가이드 README 포함
>   - 상세: `docs/architecture/backup-strategy.md`
> - **호스팅 환경 미고정**: 모든 Docker 이미지는 x86_64 + arm64 멀티아치 빌드 필수. Production 호스팅 결정은 후반 plan에서.

---

## File Structure

```
opencairn/
  package.json                    -- root workspace config (pnpm + turborepo)
  turbo.json                      -- turborepo pipeline config
  tsconfig.base.json              -- shared TS config
  .env.example                    -- env template
  docker-compose.yml              -- dev services (postgres, redis)

  apps/
    api/
      package.json
      tsconfig.json
      src/
        index.ts                  -- Hono app entry, listen on port 4000
        app.ts                    -- Hono app factory (routes, middleware)
        routes/
          auth.ts                 -- Better Auth handler mount
          projects.ts             -- project CRUD routes
          folders.ts              -- folder CRUD routes
          tags.ts                 -- tag CRUD routes
          notes.ts                -- note CRUD routes
          health.ts               -- health check route
        middleware/
          auth.ts                 -- session validation middleware
          error.ts                -- global error handler
        lib/
          auth.ts                 -- Better Auth server instance
          db.ts                   -- re-export db from @opencairn/db
      Dockerfile                  -- production build

    web/
      package.json
      tsconfig.json
      next.config.ts
      tailwind.config.ts          -- Tailwind v4
      src/
        app/
          layout.tsx              -- root layout
          page.tsx                -- landing placeholder
          (auth)/
            login/page.tsx        -- login page
            signup/page.tsx       -- signup page
          (app)/
            layout.tsx            -- app layout (authenticated)
            dashboard/page.tsx    -- dashboard placeholder
      Dockerfile                  -- production build (standalone)

  packages/
    db/
      package.json
      tsconfig.json
      drizzle.config.ts           -- Drizzle Kit config
      src/
        index.ts                  -- public exports
        client.ts                 -- db client (postgres-js + drizzle)
        schema/
          enums.ts                -- shared enums (userPlan, noteType, etc.)
          users.ts                -- user table (Better Auth)
          auth.ts                 -- session, account, verification tables
          projects.ts             -- projects table
          folders.ts              -- folders table
          tags.ts                 -- tags + note_tags tables
          notes.ts                -- notes + note_links tables
          concepts.ts             -- concepts + concept_edges + concept_notes
          wiki-logs.ts            -- wiki_logs table
          learning.ts             -- flashcards, review_logs, understanding_scores
          jobs.ts                 -- jobs + usage_records tables
          conversations.ts        -- conversations + messages tables
          custom-types.ts         -- tsvector, vector custom type helpers
        migrate.ts                -- migration runner script
      drizzle/                    -- generated migration SQL files

    config/
      package.json
      tsconfig.json
      eslint.config.mjs           -- shared ESLint config
      tsconfig.base.json          -- shared TS config

    shared/
      package.json
      tsconfig.json
      src/
        index.ts                  -- public exports
        api-types.ts              -- API request/response Zod schemas
        constants.ts              -- shared constants
```

---

### Task 1: Monorepo Initialization

**Files:**
- Create: `package.json`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `pnpm-workspace.yaml`
- Create: `.gitignore`
- Create: `.npmrc`

- [ ] **Step 1: Initialize git repo**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
git init
```

- [ ] **Step 2: Create root package.json**

```json
{
  "name": "opencairn",
  "private": true,
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "lint": "turbo lint",
    "db:generate": "turbo db:generate --filter=@opencairn/db",
    "db:migrate": "turbo db:migrate --filter=@opencairn/db",
    "db:studio": "turbo db:studio --filter=@opencairn/db"
  },
  "devDependencies": {
    "turbo": "^2.5.0",
    "typescript": "^5.8.0"
  },
  "packageManager": "pnpm@9.15.0"
}
```

- [ ] **Step 3: Create pnpm-workspace.yaml**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 4: Create turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "dev": {
      "cache": false,
      "persistent": true
    },
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**"]
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "db:generate": {
      "cache": false
    },
    "db:migrate": {
      "cache": false
    },
    "db:studio": {
      "cache": false,
      "persistent": true
    }
  }
}
```

- [ ] **Step 5: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 6: Create .gitignore**

```
node_modules/
dist/
.next/
.turbo/
.env
.env.local
*.log
drizzle/meta/
```

- [ ] **Step 7: Create .npmrc**

```
auto-install-peers=true
```

- [ ] **Step 8: Create .env.example**

```env
# Database
DATABASE_URL=postgresql://opencairn:changeme@localhost:5432/opencairn

# Redis
REDIS_URL=redis://localhost:6379

# Auth
BETTER_AUTH_SECRET=change-me-to-random-32-chars
BETTER_AUTH_URL=http://localhost:4000

# Gemini (required for AI features)
GEMINI_API_KEY=your-gemini-api-key

# Storage (Cloudflare R2)
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=opencairn

# Billing (optional)
BILLING_ENABLED=false
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

- [ ] **Step 9: Install dependencies and verify**

```bash
pnpm install
pnpm turbo --version
```

Expected: Turborepo version prints, no errors.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: initialize monorepo with Turborepo and pnpm workspaces"
```

---

### Task 2: Docker Compose (Dev Services)

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Create docker-compose.yml**

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: opencairn
      POSTGRES_USER: opencairn
      POSTGRES_PASSWORD: changeme

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data

  minio:
    # Dev 환경 S3 호환 스토리지. Production은 Cloudflare R2로 교체.
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - miniodata:/data
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:-minioadmin}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-minioadmin}

volumes:
  pgdata:
  redisdata:
  miniodata:
```

- [ ] **Step 2: Start services and verify**

```bash
docker-compose up -d
docker-compose ps
```

Expected: 3 services running (postgres, redis, minio).

- [ ] **Step 3: Verify PostgreSQL connection**

```bash
docker exec -it opencairn-monorepo-postgres-1 psql -U opencairn -d opencairn -c "SELECT 1;"
```

Expected: Returns `1`.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "infra: add Docker Compose for dev services (PostgreSQL, Redis, Cloudflare R2)"
```

---

### Task 3: packages/db ??Schema & Client

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/schema/custom-types.ts`
- Create: `packages/db/src/schema/enums.ts`
- Create: `packages/db/src/schema/users.ts`
- Create: `packages/db/src/schema/auth.ts`
- Create: `packages/db/src/schema/projects.ts`
- Create: `packages/db/src/schema/folders.ts`
- Create: `packages/db/src/schema/tags.ts`
- Create: `packages/db/src/schema/notes.ts`
- Create: `packages/db/src/schema/concepts.ts`
- Create: `packages/db/src/schema/wiki-logs.ts`
- Create: `packages/db/src/schema/learning.ts`
- Create: `packages/db/src/schema/jobs.ts`
- Create: `packages/db/src/schema/conversations.ts`

- [ ] **Step 1: Create packages/db/package.json**

```json
{
  "name": "@opencairn/db",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "drizzle-orm": "^0.45.0",
    "postgres": "^3.4.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.31.0",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Create packages/db/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create packages/db/drizzle.config.ts**

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/*.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

- [ ] **Step 4: Create packages/db/src/schema/custom-types.ts**

```typescript
import { customType } from "drizzle-orm/pg-core";

export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const vector3072 = customType<{ data: string }>({
  dataType() {
    return "vector(3072)";
  },
});
```

- [ ] **Step 5: Create packages/db/src/schema/enums.ts**

```typescript
import { pgEnum } from "drizzle-orm/pg-core";

export const userPlanEnum = pgEnum("user_plan", ["free", "pro", "byok"]);

export const noteTypeEnum = pgEnum("note_type", ["note", "wiki", "source"]);

export const sourceTypeEnum = pgEnum("source_type", [
  "manual",
  "pdf",
  "audio",
  "video",
  "image",
  "youtube",
  "web",
]);

export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);

export const wikiActionEnum = pgEnum("wiki_action", [
  "create",
  "update",
  "merge",
  "link",
  "unlink",
]);

export const conversationScopeEnum = pgEnum("conversation_scope", [
  "project",
  "global",
]);

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant"]);
```

- [ ] **Step 6: Create packages/db/src/schema/users.ts**

```typescript
import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { userPlanEnum } from "./enums";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  plan: userPlanEnum("plan").notNull().default("free"),
  geminiApiKeyEncrypted: text("gemini_api_key_encrypted"),
  geminiApiKeyIv: text("gemini_api_key_iv"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

- [ ] **Step 7: Create packages/db/src/schema/auth.ts**

```typescript
import { pgTable, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { user } from "./users";

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

- [ ] **Step 8: Create packages/db/src/schema/projects.ts**

```typescript
import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { user } from "./users";

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("projects_user_id_idx").on(t.userId)]
);
```

- [ ] **Step 9: Create packages/db/src/schema/folders.ts**

```typescript
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";

export const folders = pgTable(
  "folders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => folders.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("folders_project_id_idx").on(t.projectId)]
);
```

- [ ] **Step 10: Create packages/db/src/schema/tags.ts**

```typescript
import { pgTable, uuid, text, timestamp, index, primaryKey } from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { notes } from "./notes";

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").default("#6b7280"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("tags_project_id_idx").on(t.projectId)]
);

export const noteTags = pgTable(
  "note_tags",
  {
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.noteId, t.tagId] })]
);
```

- [ ] **Step 11: Create packages/db/src/schema/notes.ts**

```typescript
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projects } from "./projects";
import { folders } from "./folders";
import { noteTypeEnum, sourceTypeEnum } from "./enums";
import { tsvector, vector3072 } from "./custom-types";

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").references(() => folders.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull().default("Untitled"),
    content: jsonb("content").$type<Record<string, unknown>>(),
    contentText: text("content_text").default(""),
    contentTsv: tsvector("content_tsv"),
    embedding: vector3072("embedding"),
    type: noteTypeEnum("type").notNull().default("note"),
    sourceType: sourceTypeEnum("source_type"),
    sourceFileKey: text("source_file_key"),
    isAuto: boolean("is_auto").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("notes_project_id_idx").on(t.projectId),
    index("notes_folder_id_idx").on(t.folderId),
    index("notes_type_idx").on(t.type),
  ]
);

export const noteLinks = pgTable(
  "note_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    targetId: uuid("target_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    context: text("context"),
  },
  (t) => [
    index("note_links_source_id_idx").on(t.sourceId),
    index("note_links_target_id_idx").on(t.targetId),
  ]
);
```

- [ ] **Step 12: Create packages/db/src/schema/concepts.ts**

```typescript
import {
  pgTable,
  uuid,
  text,
  real,
  timestamp,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { notes } from "./notes";
import { vector3072 } from "./custom-types";

export const concepts = pgTable(
  "concepts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").default(""),
    embedding: vector3072("embedding"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("concepts_project_id_idx").on(t.projectId)]
);

export const conceptEdges = pgTable(
  "concept_edges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    targetId: uuid("target_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull().default("related-to"),
    weight: real("weight").notNull().default(1.0),
    evidenceNoteId: uuid("evidence_note_id").references(() => notes.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("concept_edges_source_id_idx").on(t.sourceId),
    index("concept_edges_target_id_idx").on(t.targetId),
  ]
);

export const conceptNotes = pgTable(
  "concept_notes",
  {
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.conceptId, t.noteId] })]
);
```

- [ ] **Step 13: Create packages/db/src/schema/wiki-logs.ts**

```typescript
import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { notes } from "./notes";
import { wikiActionEnum } from "./enums";

export const wikiLogs = pgTable(
  "wiki_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    agent: text("agent").notNull(),
    action: wikiActionEnum("action").notNull(),
    diff: jsonb("diff"),
    reason: text("reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("wiki_logs_note_id_idx").on(t.noteId)]
);
```

- [ ] **Step 14: Create packages/db/src/schema/learning.ts**

```typescript
import {
  pgTable,
  uuid,
  text,
  real,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { concepts } from "./concepts";
import { notes } from "./notes";
import { user } from "./users";

export const flashcards = pgTable(
  "flashcards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id").references(() => concepts.id, {
      onDelete: "set null",
    }),
    noteId: uuid("note_id").references(() => notes.id, {
      onDelete: "set null",
    }),
    front: text("front").notNull(),
    back: text("back").notNull(),
    easeFactor: real("ease_factor").notNull().default(2.5),
    intervalDays: integer("interval_days").notNull().default(1),
    nextReview: timestamp("next_review").notNull().defaultNow(),
    reviewCount: integer("review_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("flashcards_project_id_idx").on(t.projectId)]
);

export const reviewLogs = pgTable("review_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  flashcardId: uuid("flashcard_id")
    .notNull()
    .references(() => flashcards.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(),
  reviewedAt: timestamp("reviewed_at").notNull().defaultNow(),
});

export const understandingScores = pgTable(
  "understanding_scores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    score: real("score").notNull().default(0),
    lastAssessed: timestamp("last_assessed").notNull().defaultNow(),
  },
  (t) => [index("understanding_scores_user_id_idx").on(t.userId)]
);
```

- [ ] **Step 15: Create packages/db/src/schema/jobs.ts**

```typescript
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./users";
import { projects } from "./projects";
import { jobStatusEnum } from "./enums";

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    type: text("type").notNull(),
    status: jobStatusEnum("status").notNull().default("queued"),
    progress: jsonb("progress"),
    input: jsonb("input"),
    output: jsonb("output"),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    index("jobs_user_id_idx").on(t.userId),
    index("jobs_status_idx").on(t.status),
  ]
);

export const usageRecords = pgTable(
  "usage_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // action: 'ingest' | 'qa' | 'audio' — plan-9 enforcePlanLimit에서 사용
    action: text("action").notNull(),
    // month: 'YYYY-MM' 형식 — plan-9 incrementUsage upsert 키
    month: text("month").notNull(),
    // count: 월별 누적 카운트 (tokensUsed 대신)
    count: integer("count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("usage_records_user_id_idx").on(t.userId),
    // plan-9 incrementUsage onConflictDoUpdate 대상 복합 unique
    uniqueIndex("usage_records_user_action_month_idx").on(t.userId, t.action, t.month),
  ]
);
```

- [ ] **Step 16: Create packages/db/src/schema/conversations.ts**

```typescript
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { conversationScopeEnum, messageRoleEnum } from "./enums";

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").default(""),
    scope: conversationScopeEnum("scope").notNull().default("project"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("conversations_project_id_idx").on(t.projectId)]
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    sources: jsonb("sources"),
    canvasData: jsonb("canvas_data"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_id_idx").on(t.conversationId)]
);
```

- [ ] **Step 17: Create packages/db/src/client.ts**

```typescript
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as users from "./schema/users";
import * as auth from "./schema/auth";
import * as projects from "./schema/projects";
import * as folders from "./schema/folders";
import * as tags from "./schema/tags";
import * as notes from "./schema/notes";
import * as concepts from "./schema/concepts";
import * as wikiLogs from "./schema/wiki-logs";
import * as learning from "./schema/learning";
import * as jobs from "./schema/jobs";
import * as conversations from "./schema/conversations";

const schema = {
  ...users,
  ...auth,
  ...projects,
  ...folders,
  ...tags,
  ...notes,
  ...concepts,
  ...wikiLogs,
  ...learning,
  ...jobs,
  ...conversations,
};

const globalForDb = globalThis as unknown as {
  _pgClient?: ReturnType<typeof postgres>;
};

const sql =
  globalForDb._pgClient ??
  postgres(process.env.DATABASE_URL!, {
    prepare: false,
    max: 10,
    idle_timeout: 20,
    max_lifetime: 60 * 5,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb._pgClient = sql;
}

export const db = drizzle(sql, { schema });
export type DB = typeof db;
```

- [ ] **Step 18: Create packages/db/src/index.ts**

```typescript
export { db, type DB } from "./client";

export * from "./schema/enums";
export * from "./schema/users";
export * from "./schema/auth";
export * from "./schema/projects";
export * from "./schema/folders";
export * from "./schema/tags";
export * from "./schema/notes";
export * from "./schema/concepts";
export * from "./schema/wiki-logs";
export * from "./schema/learning";
export * from "./schema/jobs";
export * from "./schema/conversations";

export { eq, and, or, desc, asc, sql, inArray, isNull } from "drizzle-orm";
```

- [ ] **Step 19: Install deps, generate migration, run migration**

```bash
cd packages/db
pnpm install
cp ../../.env.example ../../.env
# Edit .env with correct DATABASE_URL
pnpm db:generate
pnpm db:migrate
```

Expected: Migration SQL generated in `drizzle/` folder, tables created in PostgreSQL.

- [ ] **Step 20: Verify tables exist**

```bash
docker exec -it opencairn-monorepo-postgres-1 psql -U opencairn -d opencairn -c "\dt"
```

Expected: All tables listed (user, session, projects, folders, tags, notes, etc.).

- [ ] **Step 21: Commit**

```bash
cd ../..
git add packages/db/
git commit -m "feat(db): add complete Drizzle schema with pgvector and BM25 support"
```

---

### Task 4: packages/shared ??API Types

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/api-types.ts`
- Create: `packages/shared/src/constants.ts`

- [ ] **Step 1: Create packages/shared/package.json**

```json
{
  "name": "@opencairn/shared",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Create packages/shared/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create packages/shared/src/api-types.ts**

```typescript
import { z } from "zod";

// ── Projects ──────────────────────────────────────────────────────────────────────
export const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(""),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
});

// ── Folders ───────────────────────────────────────────────────────────────────────
export const createFolderSchema = z.object({
  projectId: z.string().uuid(),
  parentId: z.string().uuid().nullable().default(null),
  name: z.string().min(1).max(100),
});

export const updateFolderSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  parentId: z.string().uuid().nullable().optional(),
  position: z.number().int().min(0).optional(),
});

// ── Tags ──────────────────────────────────────────────────────────────────────────
export const createTagSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6b7280"),
});

// ── Notes ─────────────────────────────────────────────────────────────────────────
export const createNoteSchema = z.object({
  projectId: z.string().uuid(),
  folderId: z.string().uuid().nullable().default(null),
  title: z.string().max(300).default("Untitled"),
  content: z.record(z.unknown()).nullable().default(null),
  type: z.enum(["note", "wiki", "source"]).default("note"),
});

export const updateNoteSchema = z.object({
  title: z.string().max(300).optional(),
  content: z.record(z.unknown()).nullable().optional(),
  folderId: z.string().uuid().nullable().optional(),
});
```

- [ ] **Step 4: Create packages/shared/src/constants.ts**

```typescript
export const FREE_PLAN_LIMITS = {
  monthlyIngests: 10,
  monthlyQA: 50,
  monthlyAudio: 3,
  storageBytes: 100 * 1024 * 1024, // 100MB
} as const;

export const PRO_PLAN_LIMITS = {
  monthlyIngests: Infinity,
  monthlyQA: Infinity,
  monthlyAudio: Infinity,
  storageBytes: 10 * 1024 * 1024 * 1024, // 10GB
} as const;
```

- [ ] **Step 5: Create packages/shared/src/index.ts**

```typescript
export * from "./api-types";
export * from "./constants";
```

- [ ] **Step 6: Install and commit**

```bash
cd packages/shared && pnpm install && cd ../..
git add packages/shared/
git commit -m "feat(shared): add API Zod schemas and plan constants"
```

---

### Task 5: apps/api ??Hono Server + Auth

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/index.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/lib/auth.ts`
- Create: `apps/api/src/lib/db.ts`
- Create: `apps/api/src/middleware/auth.ts`
- Create: `apps/api/src/middleware/error.ts`
- Create: `apps/api/src/routes/auth.ts`
- Create: `apps/api/src/routes/health.ts`

- [ ] **Step 1: Create apps/api/package.json**

```json
{
  "name": "@opencairn/api",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsx src/index.ts"
  },
  "dependencies": {
    "hono": "^4.12.0",
    "@hono/node-server": "^1.14.0",
    "better-auth": "^1.2.0",
    "@opencairn/db": "workspace:*",
    "@opencairn/shared": "workspace:*",
    "ioredis": "^5.6.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Create apps/api/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create apps/api/src/lib/db.ts**

```typescript
export { db } from "@opencairn/db";
```

- [ ] **Step 4: Create apps/api/src/lib/auth.ts**

```typescript
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@opencairn/db";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: { enabled: true },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
  },
});
```

- [ ] **Step 5: Create apps/api/src/middleware/error.ts**

```typescript
import type { Context } from "hono";

// Hono onError 핸들러 — app.use('*', ...) 가 아니라 app.onError()에 등록
export function errorHandler(err: Error, c: Context) {
  // production에서 내부 에러 메시지 노출 금지 (보안 리뷰 M-1)
  const isProd = process.env.NODE_ENV === "production";
  const message = isProd ? "Internal server error" : err.message;
  console.error("[API Error]", err.name, isProd ? "(hidden in prod)" : err.message);
  return c.json({ error: message }, 500);
}
```

- [ ] **Step 6: Create apps/api/src/middleware/auth.ts**

```typescript
import type { Context, Next } from "hono";
import { auth } from "../lib/auth";

// authMiddleware — 모든 plan에서 이 이름으로 사용
// requireAuth는 하위 호환 alias
export async function authMiddleware(c: Context, next: Next) {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("user", session.user);
  c.set("session", session.session);
  // userId도 세팅 — plan 6/7/8/9에서 c.get("userId")로 사용
  c.set("userId", session.user.id);
  await next();
}

export const requireAuth = authMiddleware; // alias
```

- [ ] **Step 7: Create apps/api/src/routes/health.ts**

```typescript
import { Hono } from "hono";

export const healthRoutes = new Hono().get("/", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});
```

- [ ] **Step 8: Create apps/api/src/routes/auth.ts**

```typescript
import { Hono } from "hono";
import { auth } from "../lib/auth";

export const authRoutes = new Hono().all("/*", (c) => {
  return auth.handler(c.req.raw);
});
```

- [ ] **Step 9: Create apps/api/src/app.ts**

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { errorHandler } from "./middleware/error";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";

export function createApp() {
  const app = new Hono();

  // logger는 use()로 등록
  app.use("*", logger());

  // CORS — origin은 env로 관리 (보안 리뷰 H-4)
  app.use(
    "*",
    cors({
      origin: process.env.CORS_ORIGIN?.split(",") ?? ["http://localhost:3000"],
      credentials: true,
    })
  );

  app.route("/api/health", healthRoutes);
  app.route("/api/auth", authRoutes);

  // errorHandler는 app.onError()에 등록 — use()에 넣으면 thrown error를 못 잡음
  app.onError(errorHandler);

  return app;
}
```

- [ ] **Step 10: Create apps/api/src/index.ts**

```typescript
import { serve } from "@hono/node-server";
import { createApp } from "./app";

const app = createApp();
const port = Number(process.env.PORT) || 4000;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[API] Server running on http://localhost:${info.port}`);
});
```

- [ ] **Step 11: Install deps, start server, verify health endpoint**

```bash
cd apps/api && pnpm install && cd ../..
pnpm --filter @opencairn/api dev
```

In another terminal:
```bash
curl http://localhost:4000/api/health
```

Expected: `{"status":"ok","timestamp":"..."}`

- [ ] **Step 12: Commit**

```bash
git add apps/api/
git commit -m "feat(api): add Hono server with Better Auth and health endpoint"
```

---

### Task 6: apps/api ??Project CRUD Routes

**Files:**
- Create: `apps/api/src/routes/projects.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Create apps/api/src/routes/projects.ts**

```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@opencairn/db";
import { projects, eq, and, desc } from "@opencairn/db";
import { createProjectSchema, updateProjectSchema } from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";

export const projectRoutes = new Hono()
  .use("*", requireAuth)

  .get("/", async (c) => {
    const user = c.get("user");
    const result = await db
      .select()
      .from(projects)
      .where(eq(projects.userId, user.id))
      .orderBy(desc(projects.createdAt));
    return c.json(result);
  })

  .get("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, user.id)));
    if (!project) return c.json({ error: "Not found" }, 404);
    return c.json(project);
  })

  .post("/", zValidator("json", createProjectSchema), async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");
    const [project] = await db
      .insert(projects)
      .values({ ...body, userId: user.id })
      .returning();
    return c.json(project, 201);
  })

  .patch("/:id", zValidator("json", updateProjectSchema), async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const [project] = await db
      .update(projects)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(projects.id, id), eq(projects.userId, user.id)))
      .returning();
    if (!project) return c.json({ error: "Not found" }, 404);
    return c.json(project);
  })

  .delete("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const [deleted] = await db
      .delete(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, user.id)))
      .returning();
    if (!deleted) return c.json({ error: "Not found" }, 404);
    return c.json({ success: true });
  });
```

- [ ] **Step 2: Add zod-validator dep**

```bash
cd apps/api && pnpm add @hono/zod-validator && cd ../..
```

- [ ] **Step 3: Mount project routes in apps/api/src/app.ts**

Add import and route after auth routes:

```typescript
import { projectRoutes } from "./routes/projects";

// ... in createApp():
app.route("/api/projects", projectRoutes);
```

- [ ] **Step 4: Verify with curl** (requires auth session, test manually or write integration test later)

- [ ] **Step 5: Commit**

```bash
git add apps/api/
git commit -m "feat(api): add project CRUD routes"
```

---

### Task 7: apps/api ??Folder, Tag, Note CRUD Routes

**Files:**
- Create: `apps/api/src/routes/folders.ts`
- Create: `apps/api/src/routes/tags.ts`
- Create: `apps/api/src/routes/notes.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Create apps/api/src/routes/folders.ts**

```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db, folders, eq, and, asc } from "@opencairn/db";
import { createFolderSchema, updateFolderSchema } from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";

export const folderRoutes = new Hono()
  .use("*", requireAuth)

  .get("/by-project/:projectId", async (c) => {
    const projectId = c.req.param("projectId");
    const result = await db
      .select()
      .from(folders)
      .where(eq(folders.projectId, projectId))
      .orderBy(asc(folders.position));
    return c.json(result);
  })

  .post("/", zValidator("json", createFolderSchema), async (c) => {
    const body = c.req.valid("json");
    const [folder] = await db.insert(folders).values(body).returning();
    return c.json(folder, 201);
  })

  .patch("/:id", zValidator("json", updateFolderSchema), async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const [folder] = await db
      .update(folders)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(folders.id, id))
      .returning();
    if (!folder) return c.json({ error: "Not found" }, 404);
    return c.json(folder);
  })

  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    const [deleted] = await db
      .delete(folders)
      .where(eq(folders.id, id))
      .returning();
    if (!deleted) return c.json({ error: "Not found" }, 404);
    return c.json({ success: true });
  });
```

- [ ] **Step 2: Create apps/api/src/routes/tags.ts**

```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db, tags, noteTags, eq } from "@opencairn/db";
import { createTagSchema } from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { z } from "zod";

export const tagRoutes = new Hono()
  .use("*", requireAuth)

  .get("/by-project/:projectId", async (c) => {
    const projectId = c.req.param("projectId");
    const result = await db
      .select()
      .from(tags)
      .where(eq(tags.projectId, projectId));
    return c.json(result);
  })

  .post("/", zValidator("json", createTagSchema), async (c) => {
    const body = c.req.valid("json");
    const [tag] = await db.insert(tags).values(body).returning();
    return c.json(tag, 201);
  })

  .post(
    "/:tagId/notes/:noteId",
    async (c) => {
      const tagId = c.req.param("tagId");
      const noteId = c.req.param("noteId");
      await db.insert(noteTags).values({ tagId, noteId }).onConflictDoNothing();
      return c.json({ success: true }, 201);
    }
  )

  .delete("/:tagId/notes/:noteId", async (c) => {
    const tagId = c.req.param("tagId");
    const noteId = c.req.param("noteId");
    await db
      .delete(noteTags)
      .where(and(eq(noteTags.tagId, tagId), eq(noteTags.noteId, noteId)));
    return c.json({ success: true });
  })

  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    const [deleted] = await db
      .delete(tags)
      .where(eq(tags.id, id))
      .returning();
    if (!deleted) return c.json({ error: "Not found" }, 404);
    return c.json({ success: true });
  });
```

- [ ] **Step 3: Create apps/api/src/routes/notes.ts**

```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db, notes, eq, and, desc, isNull } from "@opencairn/db";
import { createNoteSchema, updateNoteSchema } from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";

export const noteRoutes = new Hono()
  .use("*", requireAuth)

  .get("/by-project/:projectId", async (c) => {
    const projectId = c.req.param("projectId");
    const result = await db
      .select()
      .from(notes)
      .where(and(eq(notes.projectId, projectId), isNull(notes.deletedAt)))
      .orderBy(desc(notes.updatedAt));
    return c.json(result);
  })

  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const [note] = await db
      .select()
      .from(notes)
      .where(and(eq(notes.id, id), isNull(notes.deletedAt)));
    if (!note) return c.json({ error: "Not found" }, 404);
    return c.json(note);
  })

  .post("/", zValidator("json", createNoteSchema), async (c) => {
    const body = c.req.valid("json");
    const [note] = await db.insert(notes).values(body).returning();
    return c.json(note, 201);
  })

  .patch("/:id", zValidator("json", updateNoteSchema), async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const [note] = await db
      .update(notes)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(notes.id, id))
      .returning();
    if (!note) return c.json({ error: "Not found" }, 404);
    return c.json(note);
  })

  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    const [note] = await db
      .update(notes)
      .set({ deletedAt: new Date() })
      .where(eq(notes.id, id))
      .returning();
    if (!note) return c.json({ error: "Not found" }, 404);
    return c.json({ success: true });
  });
```

- [ ] **Step 4: Mount all routes in apps/api/src/app.ts**

```typescript
import { folderRoutes } from "./routes/folders";
import { tagRoutes } from "./routes/tags";
import { noteRoutes } from "./routes/notes";

// ... in createApp():
app.route("/api/folders", folderRoutes);
app.route("/api/tags", tagRoutes);
app.route("/api/notes", noteRoutes);
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/
git commit -m "feat(api): add folder, tag, and note CRUD routes"
```

---

### Task 8: apps/web ??Next.js 16 Skeleton

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/globals.css`
- Create: `apps/web/src/app/(app)/layout.tsx`
- Create: `apps/web/src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Create apps/web/package.json**

```json
{
  "name": "@opencairn/web",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/postcss": "^4.0.0",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Create apps/web/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "esnext",
    "paths": {
      "@/*": ["./src/*"]
    },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "src/**/*", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create apps/web/next.config.ts**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

- [ ] **Step 4: Create apps/web/postcss.config.mjs**

```javascript
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

- [ ] **Step 5: Create apps/web/src/app/globals.css**

```css
@import "tailwindcss";
```

- [ ] **Step 6: Create apps/web/src/app/layout.tsx**

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenCairn",
  description: "AI knowledge base for learning, research, and work.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-neutral-950 text-neutral-50 antialiased">
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 7: Create apps/web/src/app/page.tsx**

```tsx
export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center">
      <h1 className="text-5xl font-bold tracking-tight">OpenCairn</h1>
      <p className="mt-4 text-lg text-neutral-400">
        AI knowledge base for learning, research, and work.
      </p>
      <a
        href="/app/dashboard"
        className="mt-8 rounded-lg bg-amber-500 px-6 py-3 text-sm font-semibold text-neutral-950 hover:bg-amber-400"
      >
        Get Started
      </a>
    </main>
  );
}
```

- [ ] **Step 8: Create apps/web/src/app/(app)/layout.tsx**

```tsx
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-64 border-r border-neutral-800 p-4">
        <h2 className="text-sm font-semibold text-neutral-400">OpenCairn</h2>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 9: Create apps/web/src/app/(app)/dashboard/page.tsx**

```tsx
export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="mt-2 text-neutral-400">Welcome to OpenCairn.</p>
    </div>
  );
}
```

- [ ] **Step 10: Install deps, start dev server, verify**

```bash
cd apps/web && pnpm install && cd ../..
pnpm --filter @opencairn/web dev
```

Open http://localhost:3000 ??should see landing page.
Open http://localhost:3000/app/dashboard ??should see dashboard with sidebar.

- [ ] **Step 11: Commit**

```bash
git add apps/web/
git commit -m "feat(web): add Next.js 16 skeleton with landing and dashboard pages"
```

---

### Task 8.5: Next.js 16 Proxy (API 요청 포워딩)

> **Next.js 16에서 `middleware.ts` deprecated.** 웹앱에서 API를 호출할 때 `/api/*` 경로를 Hono 서버로 포워딩하는 `proxy.ts` (Route Handler) 방식을 사용.
>
> **왜 필요한가:** Better Auth는 쿠키 기반 세션이라 Same-Origin이어야 함. 브라우저가 `localhost:3000`에서 `localhost:4000`으로 직접 요청하면 cross-origin 쿠키 문제가 생김. `proxy.ts`를 통해 `localhost:3000/api/*` → `localhost:4000/api/*` 로 서버사이드 포워딩하면 쿠키가 정상 동작.

**Files:**
- Create: `apps/web/src/app/api/[...path]/route.ts`  ← proxy.ts 역할
- Create: `apps/web/src/lib/api-client.ts`             ← 프론트용 fetch 래퍼

- [ ] **Step 1: Create API proxy route handler**

```typescript
// apps/web/src/app/api/[...path]/route.ts
// Next.js 16 — middleware.ts 대신 catch-all Route Handler로 Hono API 프록시
import { type NextRequest } from "next/server";

const API_BASE = process.env.INTERNAL_API_URL ?? "http://localhost:4000";

async function handler(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const url = `${API_BASE}/api/${path.join("/")}${req.nextUrl.search}`;

  // 요청 헤더를 그대로 포워딩 (쿠키 포함)
  const headers = new Headers(req.headers);
  headers.set("x-forwarded-for", req.ip ?? "127.0.0.1");
  headers.set("x-forwarded-host", req.headers.get("host") ?? "");

  const response = await fetch(url, {
    method:  req.method,
    headers,
    body:    req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
    // @ts-expect-error — Node 18+ duplex 필요
    duplex:  "half",
  });

  // 응답 헤더 포워딩 (Set-Cookie 포함)
  const resHeaders = new Headers(response.headers);
  // 압축 인코딩은 Next.js가 이미 처리
  resHeaders.delete("content-encoding");
  resHeaders.delete("content-length");

  return new Response(response.body, {
    status:  response.status,
    headers: resHeaders,
  });
}

export const GET     = handler;
export const POST    = handler;
export const PUT     = handler;
export const PATCH   = handler;
export const DELETE  = handler;
export const OPTIONS = handler;
```

- [ ] **Step 2: Create API client (TanStack Query에서 사용)**

```typescript
// apps/web/src/lib/api-client.ts
// 모든 API 호출은 /api/* 경로로 — proxy가 Hono로 포워딩
// Server Components에서는 INTERNAL_API_URL 직접 사용 가능

export async function apiClient<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const base = typeof window === "undefined"
    ? (process.env.INTERNAL_API_URL ?? "http://localhost:4000")
    : ""; // 브라우저에서는 same-origin (/api/...)

  const res = await fetch(`${base}/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `API error ${res.status}`);
  }

  return res.json();
}
```

- [ ] **Step 3: Add INTERNAL_API_URL to .env.example**

```
# 웹→API 내부 통신 URL (Docker 환경에서는 컨테이너 이름 사용)
INTERNAL_API_URL=http://localhost:4000
# Docker Compose에서는:
# INTERNAL_API_URL=http://api:4000
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/ \
        apps/web/src/lib/api-client.ts
git commit -m "feat(web): add API proxy route handler (Next.js 16 proxy.ts 패턴)"
```

---

### Task 9: Verify Full Stack

- [ ] **Step 1: Start all services**

```bash
docker-compose up -d
pnpm --filter @opencairn/api dev &
pnpm --filter @opencairn/web dev &
```

- [ ] **Step 2: Verify health endpoint**

```bash
curl http://localhost:4000/api/health
```

Expected: `{"status":"ok","timestamp":"..."}`

- [ ] **Step 3: Verify landing page**

Open http://localhost:3000

Expected: "OpenCairn" heading with "Get Started" button.

- [ ] **Step 4: Verify dashboard**

Open http://localhost:3000/app/dashboard

Expected: Sidebar + "Dashboard" heading.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: verify full stack integration (API + Web + DB + Docker)"
```

---

## Task B1: Backup & Restore Scripts

> **Added 2026-04-14** — 셀프호스트 사용자용 내장 백업 스크립트. 상세 전략: `docs/architecture/backup-strategy.md`

**Files:**
- Create: `scripts/backup.sh`
- Create: `scripts/restore.sh`
- Create: `scripts/backup-verify.sh`
- Modify: `.env.example` (백업 env 추가)
- Modify: `docker-compose.yml` (backups 볼륨)
- Modify: `README.md` (백업 섹션)

### B1.1 backup.sh

- [ ] **Step 1:** `scripts/backup.sh` 작성. 핵심 로직:
  1. `BACKUP_DIR` env (기본 `./backups`) 디렉토리 생성
  2. 타임스탬프 파일명 (`db_YYYYMMDD_HHMMSS.sql.gz`)
  3. `docker compose exec -T postgres pg_dump -U opencairn opencairn | gzip > "$BACKUP_DIR/$FILENAME"`
  4. 옵션 `--to-r2`: `aws s3 cp "$FILENAME" s3://$R2_BACKUP_BUCKET/$(date +%Y/%m)/` (aws cli 또는 rclone)
  5. 옵션 `--to-s3` / `--to-b2`: 각각 AWS S3 / Backblaze B2 업로드
  6. 리텐션 정리: `find "$BACKUP_DIR" -name "db_*.sql.gz" -mtime +${BACKUP_RETENTION_DAYS:-7} -delete`
  7. 완료 메시지 + 파일 크기 출력
  8. 에러 시 비0 exit code (cron 알림용)

### B1.2 restore.sh

- [ ] **Step 2:** `scripts/restore.sh <backup_file>` 작성.
  1. 인자 유효성 검사
  2. 경고 프롬프트 (`확실한가? 기존 DB가 덮어써짐`)
  3. `docker compose stop api worker hocuspocus` — 서비스 정지
  4. `DROP DATABASE opencairn; CREATE DATABASE opencairn;` — DB 초기화
  5. `gunzip -c "$1" | docker compose exec -T postgres psql -U opencairn opencairn` — 복원
  6. `docker compose start api worker hocuspocus` — 재시작
  7. `curl http://localhost:4000/health` — 헬스체크
  8. 결과 보고

### B1.3 backup-verify.sh

- [ ] **Step 3:** `scripts/backup-verify.sh <backup_file>` 작성.
  1. 임시 PostgreSQL 컨테이너 생성 (`docker run --rm -d --name opencairn_verify postgres:16`)
  2. 백업 파일 복원
  3. 핵심 테이블 row 카운트 검증 (`users`, `concepts`, `wiki_pages`, `sources`)
  4. 무결성 제약 검증 (FK, unique)
  5. 임시 컨테이너 정리
  6. Sentry/이메일 알림 (실패 시)

### B1.4 env 및 docker-compose

- [ ] **Step 4:** `.env.example`에 추가:
```bash
# Backup
BACKUP_DIR=./backups
BACKUP_RETENTION_DAYS=7
R2_BACKUP_BUCKET=                      # optional
R2_BACKUP_ENDPOINT=                    # optional (Cloudflare R2)
R2_BACKUP_ACCESS_KEY=                  # optional
R2_BACKUP_SECRET_KEY=                  # optional
```

- [ ] **Step 5:** `docker-compose.yml`에 `backups` named volume 추가, `postgres` 서비스에 mount.

### B1.5 README 섹션

- [ ] **Step 6:** `README.md`에 "Backup & Restore" 섹션 추가. 수동 실행 + cron 예시 (`0 3 * * * /opt/opencairn/scripts/backup.sh --to-r2`) + 복구 절차 + 검증 가이드 포함.

### B1.6 Commit

- [ ] **Step 7:**
```bash
chmod +x scripts/backup.sh scripts/restore.sh scripts/backup-verify.sh
git add scripts/ .env.example docker-compose.yml README.md
git commit -m "feat(infra): add backup/restore/verify scripts with R2 upload support"
```
