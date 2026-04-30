# Note Version History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Notion-grade note version history: automatic snapshots, manual checkpoints, preview, current-vs-version diff, and restore.

**Architecture:** Store durable `note_versions` snapshots beside the existing Yjs canonical document. Hocuspocus captures automatic snapshots when it already derives Plate JSON from Yjs, while API routes handle list/detail/diff/checkpoint/restore with note-scoped permissions. The web UI exposes a note history Sheet from the note chrome and never mutates the live editor until the user confirms restore.

**Tech Stack:** Drizzle ORM + PostgreSQL, Hono routes with Zod validation, Hocuspocus/Yjs persistence, Next.js 16 client components, TanStack Query, lucide-react, next-intl message namespaces, Vitest.

---

## Scope Notes

- Do not update `docs/contributing/plans-status.md` in this implementation branch. That file changes only after the implementation PR is merged.
- Do not manually guess migration numbers. Modify Drizzle schema first, then run `pnpm db:generate`.
- Keep `apps/web` free of DB imports. Web calls API clients/hooks only.
- The first implementation is for Plate/Yjs notes. Canvas notes can appear in version lists later, but this plan does not add canvas restore.
- Public share pages do not expose version history.

## File Map

### Database and Shared Types

- Create: `packages/db/src/schema/note-versions.ts` — `note_versions` table, enums, indexes.
- Modify: `packages/db/src/client.ts` — include schema module in Drizzle schema object.
- Modify: `packages/db/src/index.ts` — export note version schema.
- Create: `packages/db/tests/note-versions.test.ts` — schema shape, indexes, enum presence.
- Create: `packages/shared/src/note-versions.ts` — Zod schemas for API payloads and diff response.
- Modify: `packages/shared/src/index.ts` — export shared note version schemas.
- Create: `packages/shared/tests/note-versions.test.ts` — schema validation tests.
- Generated: `packages/db/drizzle/<generated>_*.sql` and `packages/db/drizzle/meta/<generated>_snapshot.json` via `pnpm db:generate`.

### API and Hocuspocus

- Create: `packages/db/src/lib/note-version-hash.ts` — stable canonical JSON + SHA-256 helper shared by API and Hocuspocus.
- Create: `packages/db/src/lib/note-version-capture.ts` — snapshot creation, throttling, forced snapshots, restore transaction helpers shared by API and Hocuspocus.
- Create: `apps/api/src/lib/note-version-diff.ts` — Plate block/text diff helper.
- Create: `apps/api/src/routes/note-versions.ts` — list/detail/diff/checkpoint/restore endpoints.
- Modify: `apps/api/src/app.ts` — mount note version routes.
- Create: `packages/db/tests/note-version-hash.test.ts`
- Create: `apps/api/tests/note-version-diff.test.ts`
- Create: `apps/api/tests/note-versions.test.ts`
- Modify: `apps/hocuspocus/src/persistence.ts` — call capture helper after Yjs + note mirror write.
- Create: `apps/hocuspocus/tests/version-capture.test.ts`

### Web

- Create: `apps/web/src/lib/api-client-note-versions.ts` — typed fetch client.
- Create: `apps/web/src/hooks/use-note-versions.ts` — list/detail/diff/checkpoint/restore hooks.
- Create: `apps/web/src/components/notes/history/note-history-button.tsx`
- Create: `apps/web/src/components/notes/history/note-history-sheet.tsx`
- Create: `apps/web/src/components/notes/history/version-timeline.tsx`
- Create: `apps/web/src/components/notes/history/version-preview.tsx`
- Create: `apps/web/src/components/notes/history/version-diff-view.tsx`
- Create: `apps/web/src/components/notes/history/restore-version-dialog.tsx`
- Modify: `apps/web/src/components/notes/NoteRouteChrome.tsx` — mount history button.
- Modify: `apps/web/src/i18n.ts` — register `note-history` namespace.
- Create: `apps/web/messages/ko/note-history.json`
- Create: `apps/web/messages/en/note-history.json`
- Create: focused Vitest files beside components/hooks.

## Task 1: Add DB Schema and Shared Contracts

**Files:**
- Create: `packages/db/src/schema/note-versions.ts`
- Modify: `packages/db/src/client.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/tests/note-versions.test.ts`
- Create: `packages/shared/src/note-versions.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/tests/note-versions.test.ts`

- [ ] **Step 1: Write DB schema test**

Create `packages/db/tests/note-versions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
  noteVersions,
  noteVersionActorTypeEnum,
  noteVersionSourceEnum,
} from "../src";

describe("note_versions schema", () => {
  it("declares the note_versions table and required columns", () => {
    expect(getTableName(noteVersions)).toBe("note_versions");
    const cols = getTableColumns(noteVersions);
    expect(Object.keys(cols)).toEqual(
      expect.arrayContaining([
        "id",
        "noteId",
        "workspaceId",
        "projectId",
        "version",
        "title",
        "content",
        "contentText",
        "contentHash",
        "yjsState",
        "yjsStateVector",
        "actorId",
        "actorType",
        "source",
        "reason",
        "createdAt",
      ]),
    );
  });

  it("declares actor and source enums", () => {
    expect(noteVersionActorTypeEnum.enumValues).toEqual(["user", "agent", "system"]);
    expect(noteVersionSourceEnum.enumValues).toEqual([
      "auto_save",
      "title_change",
      "ai_edit",
      "restore",
      "manual_checkpoint",
      "import",
    ]);
  });
});
```

- [ ] **Step 2: Run DB schema test to verify it fails**

Run:

```bash
pnpm --filter @opencairn/db test -- note-versions.test.ts
```

Expected: FAIL because `noteVersions` is not exported.

- [ ] **Step 3: Add DB schema**

Create `packages/db/src/schema/note-versions.ts`:

```ts
import { pgEnum, pgTable, uuid, integer, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { byteaU8 } from "./custom-types";
import { notes } from "./notes";
import { projects } from "./projects";
import { user } from "./users";
import { workspaces } from "./workspaces";

export const noteVersionActorTypeEnum = pgEnum("note_version_actor_type", [
  "user",
  "agent",
  "system",
]);

export const noteVersionSourceEnum = pgEnum("note_version_source", [
  "auto_save",
  "title_change",
  "ai_edit",
  "restore",
  "manual_checkpoint",
  "import",
]);

export const noteVersions = pgTable(
  "note_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    content: jsonb("content").$type<unknown>().notNull(),
    contentText: text("content_text").notNull().default(""),
    contentHash: text("content_hash").notNull(),
    yjsState: byteaU8("yjs_state"),
    yjsStateVector: byteaU8("yjs_state_vector"),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    actorType: noteVersionActorTypeEnum("actor_type").notNull().default("user"),
    source: noteVersionSourceEnum("source").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("note_versions_note_version_idx").on(t.noteId, t.version),
    index("note_versions_note_created_idx").on(t.noteId, t.createdAt.desc()),
    index("note_versions_workspace_created_idx").on(t.workspaceId, t.createdAt.desc()),
    index("note_versions_actor_created_idx").on(t.actorId, t.createdAt.desc()),
  ],
);
```

Modify `packages/db/src/client.ts`:

```ts
import * as noteVersions from "./schema/note-versions";

const schema = {
  // keep existing schema spreads
  ...noteVersions,
};
```

Modify `packages/db/src/index.ts`:

```ts
export * from "./schema/note-versions";
```

- [ ] **Step 4: Add shared schemas and tests**

Create `packages/shared/tests/note-versions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  noteVersionDiffSchema,
  noteVersionListResponseSchema,
  restoreNoteVersionResponseSchema,
} from "../src/note-versions";

describe("note version shared schemas", () => {
  it("accepts version list payloads", () => {
    expect(() =>
      noteVersionListResponseSchema.parse({
        versions: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            version: 3,
            title: "Draft",
            contentTextPreview: "hello",
            actor: { type: "system", id: null, name: null },
            source: "auto_save",
            reason: null,
            createdAt: "2026-04-30T00:00:00.000Z",
          },
        ],
        nextCursor: null,
      }),
    ).not.toThrow();
  });

  it("accepts structured diff payloads", () => {
    expect(() =>
      noteVersionDiffSchema.parse({
        fromVersion: 1,
        toVersion: "current",
        summary: {
          addedBlocks: 1,
          removedBlocks: 0,
          changedBlocks: 1,
          addedWords: 2,
          removedWords: 1,
        },
        blocks: [
          {
            key: "0",
            status: "changed",
            before: { type: "p", children: [{ text: "old text" }] },
            after: { type: "p", children: [{ text: "new text" }] },
            textDiff: [
              { kind: "delete", text: "old" },
              { kind: "insert", text: "new" },
              { kind: "equal", text: " text" },
            ],
          },
        ],
      }),
    ).not.toThrow();
  });

  it("accepts restore responses", () => {
    expect(() =>
      restoreNoteVersionResponseSchema.parse({
        noteId: "11111111-1111-4111-8111-111111111111",
        restoredFromVersion: 2,
        newVersion: 5,
        updatedAt: "2026-04-30T00:00:00.000Z",
      }),
    ).not.toThrow();
  });
});
```

Create `packages/shared/src/note-versions.ts`:

```ts
import { z } from "zod";

export const noteVersionActorTypeSchema = z.enum(["user", "agent", "system"]);
export const noteVersionSourceSchema = z.enum([
  "auto_save",
  "title_change",
  "ai_edit",
  "restore",
  "manual_checkpoint",
  "import",
]);

export const noteVersionActorSchema = z.object({
  type: noteVersionActorTypeSchema,
  id: z.string().nullable(),
  name: z.string().nullable(),
});

export const noteVersionListItemSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  title: z.string(),
  contentTextPreview: z.string(),
  actor: noteVersionActorSchema,
  source: noteVersionSourceSchema,
  reason: z.string().nullable(),
  createdAt: z.string(),
});

export const noteVersionListResponseSchema = z.object({
  versions: z.array(noteVersionListItemSchema),
  nextCursor: z.string().nullable(),
});

export const noteVersionDetailSchema = noteVersionListItemSchema.extend({
  content: z.unknown(),
  contentText: z.string(),
});

export const textDiffPartSchema = z.object({
  kind: z.enum(["equal", "insert", "delete"]),
  text: z.string(),
});

export const noteVersionDiffSchema = z.object({
  fromVersion: z.union([z.number().int().positive(), z.literal("current")]),
  toVersion: z.union([z.number().int().positive(), z.literal("current")]),
  summary: z.object({
    addedBlocks: z.number().int().min(0),
    removedBlocks: z.number().int().min(0),
    changedBlocks: z.number().int().min(0),
    addedWords: z.number().int().min(0),
    removedWords: z.number().int().min(0),
  }),
  blocks: z.array(
    z.object({
      key: z.string(),
      status: z.enum(["added", "removed", "changed", "unchanged"]),
      before: z.unknown().optional(),
      after: z.unknown().optional(),
      textDiff: z.array(textDiffPartSchema).optional(),
    }),
  ),
});

export const restoreNoteVersionResponseSchema = z.object({
  noteId: z.string().uuid(),
  restoredFromVersion: z.number().int().positive(),
  newVersion: z.number().int().positive(),
  updatedAt: z.string(),
});

export type NoteVersionListResponse = z.infer<typeof noteVersionListResponseSchema>;
export type NoteVersionDetail = z.infer<typeof noteVersionDetailSchema>;
export type NoteVersionDiff = z.infer<typeof noteVersionDiffSchema>;
export type RestoreNoteVersionResponse = z.infer<typeof restoreNoteVersionResponseSchema>;
export type NoteVersionSource = z.infer<typeof noteVersionSourceSchema>;
export type NoteVersionActorType = z.infer<typeof noteVersionActorTypeSchema>;
```

Modify `packages/shared/src/index.ts`:

```ts
export * from "./note-versions";
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @opencairn/db test -- note-versions.test.ts
pnpm --filter @opencairn/shared test -- note-versions.test.ts
```

Expected: PASS.

- [ ] **Step 6: Generate migration**

Run:

```bash
pnpm db:generate
```

Expected: one new SQL migration and one new meta snapshot. Inspect the SQL and confirm it only creates note version enums/table/indexes and does not recreate existing tables.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/note-versions.ts packages/db/src/client.ts packages/db/src/index.ts packages/db/tests/note-versions.test.ts packages/shared/src/note-versions.ts packages/shared/src/index.ts packages/shared/tests/note-versions.test.ts packages/db/drizzle
git commit -m "feat(db): add note version schema"
```

## Task 2: Add Hash and Diff Helpers

**Files:**
- Create: `packages/db/src/lib/note-version-hash.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/tests/note-version-hash.test.ts`
- Create: `apps/api/src/lib/note-version-diff.ts`
- Test: `apps/api/tests/note-version-diff.test.ts`

- [ ] **Step 1: Write hash tests**

Create `packages/db/tests/note-version-hash.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { contentHash, canonicalizeForHash, previewText } from "../src/lib/note-version-hash";

describe("note version hashing", () => {
  it("is stable across object key order", () => {
    const a = [{ type: "p", children: [{ text: "hello", bold: true }] }];
    const b = [{ children: [{ bold: true, text: "hello" }], type: "p" }];
    expect(contentHash({ title: "T", content: a })).toBe(contentHash({ title: "T", content: b }));
  });

  it("includes title in the hash", () => {
    const content = [{ type: "p", children: [{ text: "hello" }] }];
    expect(contentHash({ title: "A", content })).not.toBe(contentHash({ title: "B", content }));
  });

  it("removes volatile keys before hashing", () => {
    expect(
      canonicalizeForHash({
        type: "p",
        id: "stable",
        updatedAt: "2026-04-30",
        selection: { anchor: 1 },
        children: [{ text: "x" }],
      }),
    ).toEqual({
      children: [{ text: "x" }],
      id: "stable",
      type: "p",
    });
  });

  it("creates short previews", () => {
    expect(previewText("a".repeat(160))).toBe(`${"a".repeat(117)}...`);
  });
});
```

- [ ] **Step 2: Add hash helper**

Create `packages/db/src/lib/note-version-hash.ts`:

```ts
import { createHash } from "node:crypto";

const VOLATILE_KEYS = new Set(["updatedAt", "createdAt", "selection", "cursor", "awareness"]);

export function canonicalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeForHash);
  if (!value || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort()) {
    if (VOLATILE_KEYS.has(key)) continue;
    out[key] = canonicalizeForHash(input[key]);
  }
  return out;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalizeForHash(value));
}

export function contentHash(input: { title: string; content: unknown }): string {
  return createHash("sha256")
    .update(stableJson({ title: input.title, content: input.content }))
    .digest("hex");
}

export function previewText(text: string, max = 120): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3))}...`;
}
```

Modify `packages/db/src/index.ts`:

```ts
export * from "./lib/note-version-hash";
```

- [ ] **Step 3: Write diff tests**

Create `apps/api/tests/note-version-diff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { diffPlateValues } from "../src/lib/note-version-diff";

describe("note version diff", () => {
  it("marks added and removed blocks", () => {
    const diff = diffPlateValues({
      fromVersion: 1,
      toVersion: "current",
      before: [{ type: "p", children: [{ text: "old" }] }],
      after: [
        { type: "p", children: [{ text: "old" }] },
        { type: "p", children: [{ text: "new" }] },
      ],
    });
    expect(diff.summary.addedBlocks).toBe(1);
    expect(diff.blocks.map((b) => b.status)).toEqual(["unchanged", "added"]);
  });

  it("marks changed text with insert and delete parts", () => {
    const diff = diffPlateValues({
      fromVersion: 2,
      toVersion: "current",
      before: [{ type: "p", children: [{ text: "hello old world" }] }],
      after: [{ type: "p", children: [{ text: "hello new world" }] }],
    });
    expect(diff.summary.changedBlocks).toBe(1);
    expect(diff.blocks[0]?.textDiff).toEqual([
      { kind: "equal", text: "hello " },
      { kind: "delete", text: "old" },
      { kind: "insert", text: "new" },
      { kind: "equal", text: " world" },
    ]);
  });
});
```

- [ ] **Step 4: Add diff helper**

Create `apps/api/src/lib/note-version-diff.ts`:

```ts
import type { NoteVersionDiff } from "@opencairn/shared";

type PlateNode = Record<string, unknown>;

function textOf(node: unknown): string {
  const parts: string[] = [];
  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const obj = value as { text?: unknown; children?: unknown };
    if (typeof obj.text === "string") {
      parts.push(obj.text);
      return;
    }
    if (Array.isArray(obj.children)) obj.children.forEach(walk);
  };
  walk(node);
  return parts.join("");
}

function blockKey(node: unknown, index: number): string {
  if (node && typeof node === "object") {
    const obj = node as { id?: unknown; blockId?: unknown };
    if (typeof obj.id === "string") return obj.id;
    if (typeof obj.blockId === "string") return obj.blockId;
  }
  return String(index);
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

function commonSuffix(a: string, b: string, prefix: number): number {
  let i = 0;
  while (
    i + prefix < a.length &&
    i + prefix < b.length &&
    a[a.length - 1 - i] === b[b.length - 1 - i]
  ) {
    i += 1;
  }
  return i;
}

function textDiff(before: string, after: string): Array<{ kind: "equal" | "insert" | "delete"; text: string }> {
  if (before === after) return [{ kind: "equal", text: before }];
  const prefix = commonPrefix(before, after);
  const suffix = commonSuffix(before, after, prefix);
  const parts: Array<{ kind: "equal" | "insert" | "delete"; text: string }> = [];
  if (prefix > 0) parts.push({ kind: "equal", text: before.slice(0, prefix) });
  const deleted = before.slice(prefix, before.length - suffix);
  const inserted = after.slice(prefix, after.length - suffix);
  if (deleted) parts.push({ kind: "delete", text: deleted });
  if (inserted) parts.push({ kind: "insert", text: inserted });
  if (suffix > 0) parts.push({ kind: "equal", text: before.slice(before.length - suffix) });
  return parts;
}

export function diffPlateValues(input: {
  fromVersion: number | "current";
  toVersion: number | "current";
  before: unknown;
  after: unknown;
}): NoteVersionDiff {
  const before = Array.isArray(input.before) ? input.before : [];
  const after = Array.isArray(input.after) ? input.after : [];
  const max = Math.max(before.length, after.length);
  const blocks: NoteVersionDiff["blocks"] = [];
  let addedBlocks = 0;
  let removedBlocks = 0;
  let changedBlocks = 0;
  let addedWords = 0;
  let removedWords = 0;

  for (let i = 0; i < max; i += 1) {
    const b = before[i] as PlateNode | undefined;
    const a = after[i] as PlateNode | undefined;
    if (!b && a) {
      addedBlocks += 1;
      addedWords += wordCount(textOf(a));
      blocks.push({ key: blockKey(a, i), status: "added", after: a });
      continue;
    }
    if (b && !a) {
      removedBlocks += 1;
      removedWords += wordCount(textOf(b));
      blocks.push({ key: blockKey(b, i), status: "removed", before: b });
      continue;
    }
    if (!b || !a) continue;
    const beforeText = textOf(b);
    const afterText = textOf(a);
    if (JSON.stringify(b) === JSON.stringify(a)) {
      blocks.push({ key: blockKey(a, i), status: "unchanged", before: b, after: a });
      continue;
    }
    changedBlocks += 1;
    const parts = textDiff(beforeText, afterText);
    addedWords += wordCount(parts.filter((p) => p.kind === "insert").map((p) => p.text).join(" "));
    removedWords += wordCount(parts.filter((p) => p.kind === "delete").map((p) => p.text).join(" "));
    blocks.push({ key: blockKey(a, i), status: "changed", before: b, after: a, textDiff: parts });
  }

  return {
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    summary: { addedBlocks, removedBlocks, changedBlocks, addedWords, removedWords },
    blocks,
  };
}
```

- [ ] **Step 5: Run helper tests**

Run:

```bash
pnpm --filter @opencairn/db test -- note-version-hash.test.ts
pnpm --filter @opencairn/api test -- note-version-diff.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/lib/note-version-hash.ts packages/db/src/index.ts packages/db/tests/note-version-hash.test.ts apps/api/src/lib/note-version-diff.ts apps/api/tests/note-version-diff.test.ts
git commit -m "feat(api): add note version hash and diff helpers"
```

## Task 3: Add Capture and Restore Service

**Files:**
- Create: `packages/db/src/lib/note-version-capture.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/tests/note-version-capture.test.ts`

- [ ] **Step 1: Write capture service tests**

Create `packages/db/tests/note-version-capture.test.ts` with DB-backed tests using the existing DB package cleanup pattern.

Core test cases:

```ts
import { describe, expect, it } from "vitest";
import { db, noteVersions, notes, projects, user, workspaces, yjsDocuments, eq } from "../src";
import { captureNoteVersion, restoreNoteVersion } from "../src/lib/note-version-capture";

async function seedNote() {
  const [u] = await db.insert(user).values({
    id: `user-${crypto.randomUUID()}`,
    email: `${crypto.randomUUID()}@example.com`,
    name: "Version Tester",
  }).returning();
  const [ws] = await db.insert(workspaces).values({ name: `ws-${crypto.randomUUID()}`, ownerId: u.id }).returning();
  const [project] = await db.insert(projects).values({ name: "p", workspaceId: ws.id }).returning();
  const [note] = await db.insert(notes).values({
    title: "seed",
    workspaceId: ws.id,
    projectId: project.id,
    content: [{ type: "p", children: [{ text: "seed" }] }],
    contentText: "seed",
  }).returning();
  return { userId: u.id, workspaceId: ws.id, projectId: project.id, noteId: note.id };
}

describe("note version capture", () => {
  it("creates version 1 and skips exact duplicate hashes", async () => {
    const seed = await seedNote();
    const first = await captureNoteVersion({
      noteId: seed.noteId,
      title: "First",
      content: [{ type: "p", children: [{ text: "hello" }] }],
      contentText: "hello",
      yjsState: new Uint8Array([1]),
      yjsStateVector: new Uint8Array([2]),
      source: "manual_checkpoint",
      actorType: "user",
      actorId: seed.userId,
      reason: "test",
      force: true,
    });
    const second = await captureNoteVersion({
      noteId: seed.noteId,
      title: "First",
      content: [{ type: "p", children: [{ text: "hello" }] }],
      contentText: "hello",
      yjsState: new Uint8Array([1]),
      yjsStateVector: new Uint8Array([2]),
      source: "manual_checkpoint",
      actorType: "user",
      actorId: seed.userId,
      reason: "test",
      force: true,
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    const rows = await db.select().from(noteVersions).where(eq(noteVersions.noteId, seed.noteId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.version).toBe(1);
  });

  it("restores a historical version and creates a new latest version", async () => {
    const seed = await seedNote();
    await captureNoteVersion({
      noteId: seed.noteId,
      title: "Old",
      content: [{ type: "p", children: [{ text: "old" }] }],
      contentText: "old",
      yjsState: new Uint8Array([1]),
      yjsStateVector: new Uint8Array([2]),
      source: "manual_checkpoint",
      actorType: "user",
      actorId: seed.userId,
      reason: "old checkpoint",
      force: true,
    });
    await db.update(notes).set({
      title: "Current",
      content: [{ type: "p", children: [{ text: "current" }] }],
      contentText: "current",
    }).where(eq(notes.id, seed.noteId));

    const restored = await restoreNoteVersion({
      noteId: seed.noteId,
      version: 1,
      actorId: seed.userId,
    });

    expect(restored.newVersion).toBe(3);
    const [note] = await db.select().from(notes).where(eq(notes.id, seed.noteId));
    expect(note?.title).toBe("Old");
    const [doc] = await db.select().from(yjsDocuments).where(eq(yjsDocuments.name, `page:${seed.noteId}`));
    expect(doc?.state.byteLength).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Add capture service**

Create `packages/db/src/lib/note-version-capture.ts`:

```ts
import { and, desc, eq, db, notes, noteVersions, yjsDocuments } from "../index";
import { contentHash } from "./note-version-hash";

export type NoteVersionActorType = "user" | "agent" | "system";
export type NoteVersionSource =
  | "auto_save"
  | "title_change"
  | "ai_edit"
  | "restore"
  | "manual_checkpoint"
  | "import";

const AUTO_SNAPSHOT_MS = 5 * 60 * 1000;
const PLATE_JSON_MAX_BYTES = 2 * 1024 * 1024;

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export async function captureNoteVersion(input: {
  noteId: string;
  title: string;
  content: unknown;
  contentText: string;
  yjsState: Uint8Array;
  yjsStateVector: Uint8Array;
  source: NoteVersionSource;
  actorType: NoteVersionActorType;
  actorId: string | null;
  reason: string | null;
  force: boolean;
}): Promise<{ created: boolean; version: number }> {
  if (jsonBytes(input.content) > PLATE_JSON_MAX_BYTES) {
    throw new Error("version_too_large");
  }
  const hash = contentHash({ title: input.title, content: input.content });

  return db.transaction(async (tx) => {
    const [note] = await tx
      .select({ id: notes.id, workspaceId: notes.workspaceId, projectId: notes.projectId })
      .from(notes)
      .where(eq(notes.id, input.noteId))
      .for("update");
    if (!note) throw new Error("note_not_found");

    const [latest] = await tx
      .select()
      .from(noteVersions)
      .where(eq(noteVersions.noteId, input.noteId))
      .orderBy(desc(noteVersions.version))
      .limit(1)
      .for("update");

    if (latest?.contentHash === hash) {
      return { created: false, version: latest.version };
    }

    if (!input.force && latest?.source === "auto_save") {
      const ageMs = Date.now() - latest.createdAt.getTime();
      const textDelta = Math.abs(input.contentText.length - latest.contentText.length);
      if (ageMs < AUTO_SNAPSHOT_MS && textDelta < 200) {
        return { created: false, version: latest.version };
      }
    }

    const version = (latest?.version ?? 0) + 1;
    await tx.insert(noteVersions).values({
      noteId: note.id,
      workspaceId: note.workspaceId,
      projectId: note.projectId,
      version,
      title: input.title,
      content: input.content,
      contentText: input.contentText,
      contentHash: hash,
      yjsState: input.yjsState,
      yjsStateVector: input.yjsStateVector,
      actorId: input.actorId,
      actorType: input.actorType,
      source: input.source,
      reason: input.reason,
    });
    return { created: true, version };
  });
}

export async function restoreNoteVersion(input: {
  noteId: string;
  version: number;
  actorId: string;
}): Promise<{ noteId: string; restoredFromVersion: number; newVersion: number; updatedAt: string }> {
  return db.transaction(async (tx) => {
    const [note] = await tx
      .select()
      .from(notes)
      .where(eq(notes.id, input.noteId))
      .for("update");
    if (!note) throw new Error("note_not_found");

    const [target] = await tx
      .select()
      .from(noteVersions)
      .where(and(eq(noteVersions.noteId, input.noteId), eq(noteVersions.version, input.version)))
      .limit(1)
      .for("update");
    if (!target) throw new Error("version_not_found");
    if (!target.yjsState || !target.yjsStateVector) throw new Error("version_not_restorable");

    const currentHash = contentHash({ title: note.title, content: note.content ?? [] });
    const [latest] = await tx
      .select()
      .from(noteVersions)
      .where(eq(noteVersions.noteId, input.noteId))
      .orderBy(desc(noteVersions.version))
      .limit(1)
      .for("update");

    let nextVersion = (latest?.version ?? 0) + 1;
    if (latest?.contentHash !== currentHash) {
      await tx.insert(noteVersions).values({
        noteId: note.id,
        workspaceId: note.workspaceId,
        projectId: note.projectId,
        version: nextVersion,
        title: note.title,
        content: note.content ?? [],
        contentText: note.contentText ?? "",
        contentHash: currentHash,
        yjsState: null,
        yjsStateVector: null,
        actorId: input.actorId,
        actorType: "user",
        source: "manual_checkpoint",
        reason: "pre-restore checkpoint",
      });
      nextVersion += 1;
    }

    const updatedAt = new Date();
    await tx.update(notes).set({
      title: target.title,
      content: target.content,
      contentText: target.contentText,
      updatedAt,
    }).where(eq(notes.id, input.noteId));

    await tx.insert(yjsDocuments).values({
      name: `page:${input.noteId}`,
      state: target.yjsState,
      stateVector: target.yjsStateVector,
      sizeBytes: target.yjsState.byteLength,
    }).onConflictDoUpdate({
      target: yjsDocuments.name,
      set: {
        state: target.yjsState,
        stateVector: target.yjsStateVector,
        sizeBytes: target.yjsState.byteLength,
        updatedAt,
      },
    });

    await tx.insert(noteVersions).values({
      noteId: note.id,
      workspaceId: note.workspaceId,
      projectId: note.projectId,
      version: nextVersion,
      title: target.title,
      content: target.content,
      contentText: target.contentText,
      contentHash: target.contentHash,
      yjsState: target.yjsState,
      yjsStateVector: target.yjsStateVector,
      actorId: input.actorId,
      actorType: "user",
      source: "restore",
      reason: `restored from v${input.version}`,
    });

    return {
      noteId: input.noteId,
      restoredFromVersion: input.version,
      newVersion: nextVersion,
      updatedAt: updatedAt.toISOString(),
    };
  });
}
```

Modify `packages/db/src/index.ts`:

```ts
export * from "./lib/note-version-capture";
```

- [ ] **Step 3: Run capture tests**

Run:

```bash
pnpm --filter @opencairn/db test -- note-version-capture.test.ts
```

Expected: PASS. If local Postgres is unavailable, record the exact DB error and run typecheck in Task 8; do not hide code failures as environment failures.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/lib/note-version-capture.ts packages/db/src/index.ts packages/db/tests/note-version-capture.test.ts
git commit -m "feat(db): add note version capture service"
```

## Task 4: Add Note Version API Routes

**Files:**
- Create: `apps/api/src/routes/note-versions.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/tests/note-versions.test.ts`

- [ ] **Step 1: Write route tests**

Create `apps/api/tests/note-versions.test.ts` with tests for:

```ts
describe("note version routes", () => {
  it("lists versions for readers");
  it("returns 403 for users without note read access");
  it("returns a version detail");
  it("returns a diff against current");
  it("creates a manual checkpoint for writers");
  it("rejects checkpoint for read-only users");
  it("restores a version for writers");
  it("rejects restore for read-only users");
});
```

Use the same request helper style as existing `apps/api/tests/notes.test.ts`. Seed two users so read/write permission behavior is explicit.

- [ ] **Step 2: Add route implementation**

Create `apps/api/src/routes/note-versions.ts`:

```ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, db, notes, noteVersions, captureNoteVersion, restoreNoteVersion, contentHash, previewText } from "@opencairn/db";
import { noteVersionDiffSchema, noteVersionListResponseSchema, restoreNoteVersionResponseSchema } from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { canRead, canWrite } from "../lib/permissions";
import { isUuid } from "../lib/validators";
import { diffPlateValues } from "../lib/note-version-diff";
import type { AppEnv } from "../lib/types";

const checkpointSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const noteVersionRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/:id/versions", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canRead(user.id, { type: "note", id }))) return c.json({ error: "Forbidden" }, 403);
    const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 100);
    const rows = await db
      .select()
      .from(noteVersions)
      .where(eq(noteVersions.noteId, id))
      .orderBy(desc(noteVersions.version))
      .limit(limit);
    const payload = {
      versions: rows.map((row) => ({
        id: row.id,
        version: row.version,
        title: row.title,
        contentTextPreview: previewText(row.contentText),
        actor: { type: row.actorType, id: row.actorId, name: null },
        source: row.source,
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: null,
    };
    return c.json(noteVersionListResponseSchema.parse(payload));
  })
  .get("/:id/versions/:version", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const version = Number(c.req.param("version"));
    if (!isUuid(id) || !Number.isInteger(version) || version < 1) return c.json({ error: "Bad Request" }, 400);
    if (!(await canRead(user.id, { type: "note", id }))) return c.json({ error: "Forbidden" }, 403);
    const [row] = await db
      .select()
      .from(noteVersions)
      .where(and(eq(noteVersions.noteId, id), eq(noteVersions.version, version)))
      .limit(1);
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json({
      id: row.id,
      version: row.version,
      title: row.title,
      contentTextPreview: previewText(row.contentText),
      content: row.content,
      contentText: row.contentText,
      actor: { type: row.actorType, id: row.actorId, name: null },
      source: row.source,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    });
  })
  .get("/:id/versions/:version/diff", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const version = Number(c.req.param("version"));
    if (!isUuid(id) || !Number.isInteger(version) || version < 1) return c.json({ error: "Bad Request" }, 400);
    if (!(await canRead(user.id, { type: "note", id }))) return c.json({ error: "Forbidden" }, 403);
    const [target] = await db.select().from(noteVersions).where(and(eq(noteVersions.noteId, id), eq(noteVersions.version, version))).limit(1);
    if (!target) return c.json({ error: "Not found" }, 404);
    const [note] = await db.select().from(notes).where(eq(notes.id, id)).limit(1);
    if (!note) return c.json({ error: "Not found" }, 404);
    const diff = diffPlateValues({
      fromVersion: version,
      toVersion: "current",
      before: target.content,
      after: note.content ?? [],
    });
    return c.json(noteVersionDiffSchema.parse(diff));
  })
  .post("/:id/versions/checkpoint", zValidator("json", checkpointSchema), async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canWrite(user.id, { type: "note", id }))) return c.json({ error: "Forbidden" }, 403);
    const [note] = await db.select().from(notes).where(eq(notes.id, id)).limit(1);
    if (!note) return c.json({ error: "Not found" }, 404);
    const hash = contentHash({ title: note.title, content: note.content ?? [] });
    const result = await captureNoteVersion({
      noteId: id,
      title: note.title,
      content: note.content ?? [],
      contentText: note.contentText ?? "",
      yjsState: new Uint8Array(),
      yjsStateVector: new Uint8Array(),
      source: "manual_checkpoint",
      actorType: "user",
      actorId: user.id,
      reason: c.req.valid("json").reason ?? `manual checkpoint ${hash.slice(0, 8)}`,
      force: true,
    });
    return c.json({ created: result.created, version: result.version }, result.created ? 201 : 200);
  })
  .post("/:id/versions/:version/restore", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const version = Number(c.req.param("version"));
    if (!isUuid(id) || !Number.isInteger(version) || version < 1) return c.json({ error: "Bad Request" }, 400);
    if (!(await canWrite(user.id, { type: "note", id }))) return c.json({ error: "Forbidden" }, 403);
    const result = await restoreNoteVersion({ noteId: id, version, actorId: user.id });
    return c.json(restoreNoteVersionResponseSchema.parse(result));
  });
```

Note: the checkpoint path above uses empty Yjs bytes until Task 5 wires Hocuspocus capture. In Task 5, replace this with a helper that reads `yjs_documents` for `page:<id>` and rejects checkpoint if missing for Plate notes.

- [ ] **Step 3: Mount routes**

Modify `apps/api/src/app.ts`:

```ts
import { noteVersionRoutes } from "./routes/note-versions";

// mount before generic noteRoutes if the app uses overlapping /api/notes paths
app.route("/api/notes", noteVersionRoutes);
```

- [ ] **Step 4: Run route tests**

Run:

```bash
pnpm --filter @opencairn/api test -- note-versions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/note-versions.ts apps/api/src/app.ts apps/api/tests/note-versions.test.ts
git commit -m "feat(api): expose note version routes"
```

## Task 5: Wire Hocuspocus Automatic Capture

**Files:**
- Modify: `apps/hocuspocus/src/persistence.ts`
- Create: `apps/hocuspocus/tests/version-capture.test.ts`
- Modify: `packages/db/src/lib/note-version-capture.ts` — expose one shared capture API used by both API routes and Hocuspocus.

- [ ] **Step 1: Write Hocuspocus capture tests**

Create `apps/hocuspocus/tests/version-capture.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { db, noteVersions, eq } from "@opencairn/db";
import { makePersistence } from "../src/persistence";
import { seedCollabNote } from "./helpers/seed";

describe("persistence note version capture", () => {
  it("creates an automatic version when storing a changed Plate note", async () => {
    const seed = await seedCollabNote();
    const persistence = makePersistence({ db });
    const doc = new Y.Doc();
    const xml = doc.get("content", Y.XmlText) as Y.XmlText;
    xml.insert(0, "hello version history");
    const state = Y.encodeStateAsUpdate(doc);

    await persistence.store({ documentName: `page:${seed.noteId}`, state });

    const rows = await db.select().from(noteVersions).where(eq(noteVersions.noteId, seed.noteId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source).toBe("auto_save");
    expect(rows[0]?.actorType).toBe("system");
  });

  it("does not create duplicate versions for identical state", async () => {
    const seed = await seedCollabNote();
    const persistence = makePersistence({ db });
    const doc = new Y.Doc();
    const xml = doc.get("content", Y.XmlText) as Y.XmlText;
    xml.insert(0, "same");
    const state = Y.encodeStateAsUpdate(doc);

    await persistence.store({ documentName: `page:${seed.noteId}`, state });
    await persistence.store({ documentName: `page:${seed.noteId}`, state });

    const rows = await db.select().from(noteVersions).where(eq(noteVersions.noteId, seed.noteId));
    expect(rows).toHaveLength(1);
  });
});
```

If the existing hocuspocus test seed helper has a different name, create this helper in the test file by following `apps/hocuspocus/tests/persistence.test.ts`.

- [ ] **Step 2: Add capture call**

Modify `apps/hocuspocus/src/persistence.ts` inside `storeImpl`, after the transaction that upserts `yjs_documents` and updates `notes`:

```ts
import { captureNoteVersion } from "@opencairn/db";

// after the transaction completes and only when workspaceId exists
try {
  await captureNoteVersion({
    noteId,
    title: noteTitle,
    content: plateValue as unknown,
    contentText,
    yjsState: state,
    yjsStateVector: stateVector,
    source: "auto_save",
    actorType: "system",
    actorId: null,
    reason: null,
    force: false,
  });
} catch (error) {
  logger.warn({ noteId, error }, "persistence.store: note version capture failed");
}
```

Also adjust the existing transaction to return `noteTitle` from the updated note or prefetch it before update:

```ts
const noteRow = await db.query.notes.findFirst({ where: eq(notes.id, noteId) });
const noteTitle = noteRow?.title ?? "Untitled";
```

- [ ] **Step 3: Run Hocuspocus tests**

Run:

```bash
pnpm --filter @opencairn/hocuspocus test -- version-capture.test.ts persistence.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/hocuspocus/src/persistence.ts apps/hocuspocus/tests/version-capture.test.ts packages/db/src/lib/note-version-capture.ts
git commit -m "feat(hocuspocus): capture note versions on store"
```

## Task 6: Add Web API Client and Hooks

**Files:**
- Create: `apps/web/src/lib/api-client-note-versions.ts`
- Create: `apps/web/src/hooks/use-note-versions.ts`
- Test: `apps/web/src/hooks/use-note-versions.test.tsx`

- [ ] **Step 1: Add client**

Create `apps/web/src/lib/api-client-note-versions.ts`:

```ts
import {
  noteVersionDiffSchema,
  noteVersionDetailSchema,
  noteVersionListResponseSchema,
  restoreNoteVersionResponseSchema,
  type NoteVersionDiff,
  type NoteVersionDetail,
  type NoteVersionListResponse,
  type RestoreNoteVersionResponse,
} from "@opencairn/shared";
import { apiFetch } from "@/lib/api-client";

export async function listNoteVersions(noteId: string): Promise<NoteVersionListResponse> {
  const json = await apiFetch(`/api/notes/${noteId}/versions`);
  return noteVersionListResponseSchema.parse(json);
}

export async function getNoteVersion(noteId: string, version: number): Promise<NoteVersionDetail> {
  const json = await apiFetch(`/api/notes/${noteId}/versions/${version}`);
  return noteVersionDetailSchema.parse(json);
}

export async function getNoteVersionDiff(noteId: string, version: number): Promise<NoteVersionDiff> {
  const json = await apiFetch(`/api/notes/${noteId}/versions/${version}/diff`);
  return noteVersionDiffSchema.parse(json);
}

export async function createNoteCheckpoint(noteId: string, reason?: string): Promise<{ created: boolean; version: number }> {
  return apiFetch(`/api/notes/${noteId}/versions/checkpoint`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  }) as Promise<{ created: boolean; version: number }>;
}

export async function restoreNoteVersion(noteId: string, version: number): Promise<RestoreNoteVersionResponse> {
  const json = await apiFetch(`/api/notes/${noteId}/versions/${version}/restore`, { method: "POST" });
  return restoreNoteVersionResponseSchema.parse(json);
}
```

If `apiFetch` has a different signature in this repo, adapt to the existing `apps/web/src/lib/api-client*.ts` pattern and keep the exported function names unchanged.

- [ ] **Step 2: Add hooks**

Create `apps/web/src/hooks/use-note-versions.ts`:

```ts
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createNoteCheckpoint,
  getNoteVersion,
  getNoteVersionDiff,
  listNoteVersions,
  restoreNoteVersion,
} from "@/lib/api-client-note-versions";

export function useNoteVersions(noteId: string, enabled = true) {
  return useQuery({
    queryKey: ["note-versions", noteId],
    queryFn: () => listNoteVersions(noteId),
    enabled: enabled && Boolean(noteId),
  });
}

export function useNoteVersionDetail(noteId: string, version: number | null) {
  return useQuery({
    queryKey: ["note-version", noteId, version],
    queryFn: () => getNoteVersion(noteId, version as number),
    enabled: Boolean(noteId && version),
  });
}

export function useNoteVersionDiff(noteId: string, version: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ["note-version-diff", noteId, version],
    queryFn: () => getNoteVersionDiff(noteId, version as number),
    enabled: enabled && Boolean(noteId && version),
  });
}

export function useCreateNoteCheckpoint(noteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason?: string) => createNoteCheckpoint(noteId, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["note-versions", noteId] });
    },
  });
}

export function useRestoreNoteVersion(noteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (version: number) => restoreNoteVersion(noteId, version),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["note", noteId] });
      void qc.invalidateQueries({ queryKey: ["note-versions", noteId] });
    },
  });
}
```

- [ ] **Step 3: Run web typecheck for client/hooks**

Run:

```bash
pnpm --filter @opencairn/web typecheck
```

Expected: PASS or unrelated pre-existing failures documented with exact file/line.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api-client-note-versions.ts apps/web/src/hooks/use-note-versions.ts
git commit -m "feat(web): add note version client hooks"
```

## Task 7: Add History Sheet UI

**Files:**
- Create: `apps/web/src/components/notes/history/note-history-button.tsx`
- Create: `apps/web/src/components/notes/history/note-history-sheet.tsx`
- Create: `apps/web/src/components/notes/history/version-timeline.tsx`
- Create: `apps/web/src/components/notes/history/version-preview.tsx`
- Create: `apps/web/src/components/notes/history/version-diff-view.tsx`
- Create: `apps/web/src/components/notes/history/restore-version-dialog.tsx`
- Modify: `apps/web/src/components/notes/NoteRouteChrome.tsx`
- Create/modify tests beside components.

- [ ] **Step 1: Add timeline component**

Create `apps/web/src/components/notes/history/version-timeline.tsx`:

```tsx
"use client";

import { cn } from "@/lib/utils";
import type { NoteVersionListResponse } from "@opencairn/shared";

export function VersionTimeline({
  versions,
  selected,
  onSelect,
  sourceLabel,
}: {
  versions: NoteVersionListResponse["versions"];
  selected: number | null;
  onSelect: (version: number) => void;
  sourceLabel: (source: NoteVersionListResponse["versions"][number]["source"]) => string;
}) {
  if (versions.length === 0) return <div className="p-4 text-sm text-muted-foreground">No versions yet</div>;
  return (
    <div className="space-y-1">
      {versions.map((v) => (
        <button
          key={v.id}
          type="button"
          onClick={() => onSelect(v.version)}
          className={cn(
            "w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted",
            selected === v.version && "bg-muted",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">v{v.version}</span>
            <span className="text-xs text-muted-foreground">{sourceLabel(v.source)}</span>
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">{v.contentTextPreview || v.title}</div>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add preview component**

Create `apps/web/src/components/notes/history/version-preview.tsx`:

```tsx
"use client";

import { PlateStaticRenderer } from "@/components/share/plate-static-renderer";
import type { NoteVersionDetail } from "@opencairn/shared";

export function VersionPreview({ version }: { version: NoteVersionDetail | undefined }) {
  if (!version) return <div className="p-6 text-sm text-muted-foreground">Select a version</div>;
  return (
    <div className="min-h-0 overflow-auto p-6">
      <h2 className="mb-4 text-lg font-semibold">{version.title}</h2>
      <PlateStaticRenderer value={Array.isArray(version.content) ? version.content : []} />
    </div>
  );
}
```

If `PlateStaticRenderer` is not exported from its current module, move the reusable renderer into `apps/web/src/components/share/plate-static-renderer.tsx` export shape without changing public share behavior.

- [ ] **Step 3: Add diff component**

Create `apps/web/src/components/notes/history/version-diff-view.tsx`:

```tsx
"use client";

import type { NoteVersionDiff } from "@opencairn/shared";

export function VersionDiffView({ diff }: { diff: NoteVersionDiff | undefined }) {
  if (!diff) return <div className="p-6 text-sm text-muted-foreground">Select a version to compare</div>;
  return (
    <div className="min-h-0 overflow-auto p-6">
      <div className="mb-4 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded border p-2">Added blocks: {diff.summary.addedBlocks}</div>
        <div className="rounded border p-2">Removed blocks: {diff.summary.removedBlocks}</div>
        <div className="rounded border p-2">Changed blocks: {diff.summary.changedBlocks}</div>
      </div>
      <div className="space-y-2">
        {diff.blocks.filter((b) => b.status !== "unchanged").map((block) => (
          <div key={block.key} className="rounded-md border p-3 text-sm">
            <div className="mb-2 text-xs uppercase text-muted-foreground">{block.status}</div>
            {block.textDiff ? (
              <p>
                {block.textDiff.map((part, idx) => (
                  <span
                    key={`${block.key}-${idx}`}
                    className={
                      part.kind === "insert"
                        ? "bg-emerald-500/20"
                        : part.kind === "delete"
                          ? "bg-destructive/20 line-through"
                          : undefined
                    }
                  >
                    {part.text}
                  </span>
                ))}
              </p>
            ) : (
              <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(block.after ?? block.before, null, 2)}</pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add restore dialog**

Create `apps/web/src/components/notes/history/restore-version-dialog.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function RestoreVersionDialog({
  open,
  version,
  pending,
  onOpenChange,
  onConfirm,
  labels,
}: {
  open: boolean;
  version: number | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  labels: { title: string; body: string; cancel: string; restore: string };
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.title}</AlertDialogTitle>
          <AlertDialogDescription>{labels.body.replace("{version}", String(version ?? ""))}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button variant="destructive" disabled={pending} onClick={onConfirm}>
              {labels.restore}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 5: Add sheet**

Create `apps/web/src/components/notes/history/note-history-sheet.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { History, RotateCcw, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  useCreateNoteCheckpoint,
  useNoteVersionDetail,
  useNoteVersionDiff,
  useNoteVersions,
  useRestoreNoteVersion,
} from "@/hooks/use-note-versions";
import { VersionTimeline } from "./version-timeline";
import { VersionPreview } from "./version-preview";
import { VersionDiffView } from "./version-diff-view";
import { RestoreVersionDialog } from "./restore-version-dialog";

export function NoteHistorySheet({
  noteId,
  open,
  canWrite,
  onOpenChange,
}: {
  noteId: string;
  open: boolean;
  canWrite: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("noteHistory");
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<"preview" | "diff">("preview");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const versions = useNoteVersions(noteId, open);
  const detail = useNoteVersionDetail(noteId, selected);
  const diff = useNoteVersionDiff(noteId, selected, mode === "diff");
  const checkpoint = useCreateNoteCheckpoint(noteId);
  const restore = useRestoreNoteVersion(noteId);

  useEffect(() => {
    if (!selected && versions.data?.versions[0]) setSelected(versions.data.versions[0].version);
  }, [selected, versions.data]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-5xl">
        <SheetHeader className="border-b px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <SheetTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" />
              {t("title")}
            </SheetTitle>
            {canWrite && (
              <Button size="sm" variant="outline" onClick={() => checkpoint.mutate(undefined)} disabled={checkpoint.isPending}>
                <Save className="mr-2 h-4 w-4" />
                {t("createCheckpoint")}
              </Button>
            )}
          </div>
        </SheetHeader>
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[280px_1fr]">
          <aside className="min-h-0 overflow-auto border-r p-3">
            <VersionTimeline
              versions={versions.data?.versions ?? []}
              selected={selected}
              onSelect={setSelected}
              sourceLabel={(source) => t(`source.${source}`)}
            />
          </aside>
          <main className="flex min-h-0 flex-col">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <div className="flex gap-1">
                <Button size="sm" variant={mode === "preview" ? "secondary" : "ghost"} onClick={() => setMode("preview")}>
                  {t("preview")}
                </Button>
                <Button size="sm" variant={mode === "diff" ? "secondary" : "ghost"} onClick={() => setMode("diff")}>
                  {t("compareWithCurrent")}
                </Button>
              </div>
              {canWrite && (
                <Button size="sm" variant="destructive" disabled={!selected} onClick={() => setConfirmOpen(true)}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  {t("restore")}
                </Button>
              )}
            </div>
            {mode === "preview" ? <VersionPreview version={detail.data} /> : <VersionDiffView diff={diff.data} />}
          </main>
        </div>
        <RestoreVersionDialog
          open={confirmOpen}
          version={selected}
          pending={restore.isPending}
          onOpenChange={setConfirmOpen}
          onConfirm={() => {
            if (selected) restore.mutate(selected, { onSuccess: () => setConfirmOpen(false) });
          }}
          labels={{
            title: t("restoreConfirmTitle"),
            body: t("restoreConfirmBody"),
            cancel: t("cancel"),
            restore: t("restore"),
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 6: Add button and mount**

Create `apps/web/src/components/notes/history/note-history-button.tsx`:

```tsx
"use client";

import { useState } from "react";
import { History } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { NoteHistorySheet } from "./note-history-sheet";

export function NoteHistoryButton({ noteId, canWrite }: { noteId: string; canWrite: boolean }) {
  const t = useTranslations("noteHistory");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="ghost" size="icon" aria-label={t("open")} title={t("open")} onClick={() => setOpen(true)}>
        <History className="h-4 w-4" />
      </Button>
      <NoteHistorySheet noteId={noteId} canWrite={canWrite} open={open} onOpenChange={setOpen} />
    </>
  );
}
```

Modify `apps/web/src/components/notes/NoteRouteChrome.tsx` by adding the button to the note action cluster:

```tsx
import { NoteHistoryButton } from "@/components/notes/history/note-history-button";

<NoteHistoryButton noteId={noteId} canWrite={!readOnly} />
```

Use the actual prop names already present in `NoteRouteChrome.tsx`.

- [ ] **Step 7: Run component tests/typecheck**

Run:

```bash
pnpm --filter @opencairn/web typecheck
pnpm --filter @opencairn/web test -- note-history
```

Expected: typecheck PASS and focused tests PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/notes/history apps/web/src/components/notes/NoteRouteChrome.tsx
git commit -m "feat(web): add note history sheet"
```

## Task 8: Add i18n Namespace

**Files:**
- Create: `apps/web/messages/ko/note-history.json`
- Create: `apps/web/messages/en/note-history.json`
- Modify: `apps/web/src/i18n.ts`

- [ ] **Step 1: Add Korean messages**

Create `apps/web/messages/ko/note-history.json`:

```json
{
  "open": "기록 열기",
  "title": "버전 기록",
  "currentVersion": "현재 버전",
  "createCheckpoint": "체크포인트 만들기",
  "checkpointCreated": "체크포인트를 만들었어요.",
  "source": {
    "auto_save": "자동 저장",
    "title_change": "제목 변경",
    "ai_edit": "AI 편집",
    "restore": "복원됨",
    "manual_checkpoint": "체크포인트",
    "import": "가져오기"
  },
  "preview": "미리보기",
  "compareWithCurrent": "현재와 비교",
  "restore": "이 버전으로 복원",
  "restoreConfirmTitle": "이 버전으로 복원할까요?",
  "restoreConfirmBody": "현재 내용은 새 버전으로 보존한 뒤 v{version}의 내용으로 복원합니다.",
  "restoreSuccess": "선택한 버전으로 복원했어요.",
  "restoreFailed": "복원하지 못했어요. 다시 시도해주세요.",
  "cancel": "취소",
  "empty": "아직 저장된 버전이 없어요.",
  "loadFailed": "버전 기록을 불러오지 못했어요.",
  "diffTooLarge": "비교할 변경량이 너무 커서 미리보기만 표시합니다.",
  "readOnlyRestoreHint": "읽기 권한만 있어 복원할 수 없어요."
}
```

- [ ] **Step 2: Add English messages**

Create `apps/web/messages/en/note-history.json`:

```json
{
  "open": "Open history",
  "title": "Version history",
  "currentVersion": "Current version",
  "createCheckpoint": "Create checkpoint",
  "checkpointCreated": "Checkpoint created.",
  "source": {
    "auto_save": "Auto-save",
    "title_change": "Title change",
    "ai_edit": "AI edit",
    "restore": "Restored",
    "manual_checkpoint": "Checkpoint",
    "import": "Import"
  },
  "preview": "Preview",
  "compareWithCurrent": "Compare with current",
  "restore": "Restore this version",
  "restoreConfirmTitle": "Restore this version?",
  "restoreConfirmBody": "The current content will be preserved as a new version before restoring v{version}.",
  "restoreSuccess": "Restored the selected version.",
  "restoreFailed": "Could not restore this version. Try again.",
  "cancel": "Cancel",
  "empty": "No saved versions yet.",
  "loadFailed": "Could not load version history.",
  "diffTooLarge": "This change is too large to compare, so only the preview is shown.",
  "readOnlyRestoreHint": "You have read-only access and cannot restore versions."
}
```

- [ ] **Step 3: Register namespace**

Modify `apps/web/src/i18n.ts` following existing namespace registration:

```ts
noteHistory: (await import("../messages/${locale}/note-history.json")).default,
```

Use the existing import style in the file.

- [ ] **Step 4: Run i18n parity**

Run:

```bash
pnpm --filter @opencairn/web i18n:parity
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/messages/ko/note-history.json apps/web/messages/en/note-history.json apps/web/src/i18n.ts
git commit -m "feat(web): add note history messages"
```

## Task 9: Full Verification and Hardening

**Files:**
- Review all touched files.
- Update spec only if implementation materially differs.

- [ ] **Step 1: Run focused package checks**

Run:

```bash
pnpm --filter @opencairn/shared test -- note-versions.test.ts
pnpm --filter @opencairn/db test -- note-versions.test.ts note-version-hash.test.ts note-version-capture.test.ts
pnpm --filter @opencairn/api test -- note-version-diff.test.ts note-versions.test.ts
pnpm --filter @opencairn/hocuspocus test -- version-capture.test.ts persistence.test.ts
pnpm --filter @opencairn/web i18n:parity
pnpm --filter @opencairn/web typecheck
pnpm --filter @opencairn/api typecheck
```

Expected: all PASS. If DB-bound tests fail because local Postgres is unavailable, capture the exact connection error and still run both typechecks.

- [ ] **Step 2: Run lint/build as applicable**

Run:

```bash
pnpm --filter @opencairn/web lint --max-warnings 0
pnpm --filter @opencairn/api lint --max-warnings 0
```

Expected: PASS or pre-existing unrelated failures with exact file references.

- [ ] **Step 3: Inspect generated migration**

Run:

```bash
git diff -- packages/db/drizzle
```

Expected: only note version enums/table/indexes and Drizzle metadata changes. No unrelated table recreation, no hand-edited migration number assumptions.

- [ ] **Step 4: Final self-review**

Check:

```bash
rg -n "note_versions|noteHistory|versions/:version|captureNoteVersion|restoreNoteVersion" packages apps docs/superpowers/specs/2026-04-30-note-version-history-design.md
git diff --check
git status --short
```

Expected: search shows only intentional implementation/spec references, diff check is clean, status shows only intended files.

- [ ] **Step 5: Commit verification fixes**

If Step 1-4 required fixes:

```bash
git add <fixed-files>
git commit -m "fix(api): harden note version history"
```

Use the actual scope (`api`, `web`, `db`, `hocuspocus`, or `docs`) that matches the fixes.

## Task 10: Publish Branch

**Files:**
- PR body file may be created under a temporary path and not committed.

- [ ] **Step 1: Confirm branch status**

Run:

```bash
git status --short --branch
git log --oneline --decorate -8
```

Expected: clean working tree on the implementation branch.

- [ ] **Step 2: Push**

Run:

```bash
git push -u origin HEAD
```

If WSL credential helper fails, use the Windows GitHub CLI fallback from `AGENTS.md`.

- [ ] **Step 3: Open draft PR**

Use GitHub connector or `gh` fallback. PR title:

```text
feat: add note version history
```

PR body:

```md
## Summary
- add note_versions schema and snapshot capture
- expose version list/detail/diff/checkpoint/restore APIs
- capture automatic snapshots from Hocuspocus persistence
- add authenticated note history UI with preview, diff, and restore

## Verification
- pnpm --filter @opencairn/shared test -- note-versions.test.ts
- pnpm --filter @opencairn/db test -- note-versions.test.ts note-version-hash.test.ts note-version-capture.test.ts
- pnpm --filter @opencairn/api test -- note-version-diff.test.ts note-versions.test.ts
- pnpm --filter @opencairn/hocuspocus test -- version-capture.test.ts persistence.test.ts
- pnpm --filter @opencairn/web i18n:parity
- pnpm --filter @opencairn/web typecheck
- pnpm --filter @opencairn/api typecheck

## Risks
- Automatic snapshot actor attribution is system-level unless explicit API paths provide a user.
- Canvas/source-code version history is deferred.
- Local DB-dependent tests may require Postgres availability.
```

Expected: draft PR created, merge left to the user.

## Plan Self-Review

- Spec §1 goal maps to Tasks 1-8.
- Spec §4 data model maps to Task 1.
- Spec §5 capture policy maps to Tasks 3 and 5.
- Spec §6 API maps to Task 4.
- Spec §7 diff model maps to Task 2 and Task 7.
- Spec §8 web UX and i18n maps to Tasks 6-8.
- Spec §9 permissions maps to Task 4 route tests.
- Spec §10 storage/performance maps to Task 3 size guard and Task 9 migration review.
- Spec §11 testing maps to Tasks 1-9.
- No `docs/contributing/plans-status.md` update is included before merge.
