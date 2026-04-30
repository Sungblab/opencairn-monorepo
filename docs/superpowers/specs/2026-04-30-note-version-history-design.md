# Note Version History Design Spec

**Status:** Draft (2026-04-30).
**Owner:** Sungbin
**Author:** Sungbin + Codex.
**Plan reference:** New plan candidate after Plan 2E. Do not mark complete in `docs/contributing/plans-status.md` until the implementation PR is merged.
**Related:**

- `apps/hocuspocus/src/persistence.ts` — Yjs canonical state and `notes.content` mirror.
- `packages/db/src/schema/notes.ts` — current note row, no revision table.
- `apps/api/src/routes/notes.ts` — note metadata/move/canvas routes.
- `apps/web/src/components/editor/note-editor-client.tsx` — editor entry point.
- `docs/architecture/collaboration-model.md` § 2.5 — planned activity log vocabulary (`created`, `updated`, `restored`).
- `docs/superpowers/plans/2026-04-09-plan-2-editor.md` § 21-7 — superseded artifact-only version history sketch.

## 1. Goal

Ship a Notion-grade v1 for note history:

- users can open a note's version history from the note chrome;
- the system keeps automatic snapshots of note content, title, actor, and source;
- users can preview any historical version without changing the live editor;
- users can compare a historical version with the current note;
- users can restore a historical version, while preserving the pre-restore current state as another version;
- restore and AI-generated edits are auditable enough to feed a future workspace activity log.

This is not a generic backup system. It is a product-level editing control for day-to-day mistakes, AI over-edits, collaborative edits, and "what changed?" review.

## 2. Non-Goals

- **Per-keystroke playback.** v1 stores durable snapshots, not every Yjs update or cursor movement.
- **Google Docs-style author attribution by character.** v1 records snapshot actor/source metadata and renders text/block diffs. Fine-grained multi-author attribution is v2.
- **Full workspace activity feed.** The schema keeps activity-log-compatible metadata, but this plan does not implement a global `/activity` product surface.
- **Binary/file source versioning.** PDFs, uploaded source files, MinIO objects, and connector external versions are not duplicated here. Only the derived note/editor state is versioned.
- **Canvas code versioning in the same path.** Canvas notes use `content_text` and `PATCH /api/notes/:id/canvas`. v1 may snapshot their text for listing consistency, but restore/diff UX is scoped to Plate notes unless the implementation plan explicitly adds canvas support.
- **Branching history.** Restoring an old version creates a new latest version. It does not fork a branch.

## 3. Current State

Collaborative Plate notes are stored through Hocuspocus:

- `yjs_documents.state` is the canonical collaborative document.
- `notes.content` and `notes.content_text` are derived mirrors used for search, snippets, public share rendering, and migrations.
- `PATCH /api/notes/:id` strips `content`, so normal Plate content writes do not pass through the API note route.

That means version capture cannot be implemented only in `apps/api/src/routes/notes.ts`. The main capture hook must live near `apps/hocuspocus/src/persistence.ts`, where the canonical Yjs state is already converted to Plate JSON and plain text.

The existing docs mention `activity_events`, `restored`, and historical version UI in older plans, but the current DB does not have a note revision table and the web app does not expose a history control.

## 4. Data Model

### 4.1 `note_versions`

New table:

```ts
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

Enums:

- `actor_type`: `user`, `agent`, `system`
- `source`: `auto_save`, `title_change`, `ai_edit`, `restore`, `manual_checkpoint`, `import`

`content` is required because preview and diff should not depend on reconstructing Yjs. For Plate notes, `yjsState` and `yjsStateVector` are required at write time even though the columns are nullable for future non-Plate surfaces. Restore seeds the collaborative document from those bytes. If a Plate snapshot cannot produce Yjs bytes, the snapshot write fails instead of creating a version that cannot be faithfully restored.

### 4.2 Retention

Default retention for v1:

- keep all manual checkpoints, AI edit snapshots, imports, and restores;
- keep automatic snapshots for 90 days;
- cap automatic snapshots per note to 500 rows before pruning oldest automatic rows;
- never prune the first version for a note.

Retention is enforced by a small maintenance helper or worker task, not by request-time deletes.

### 4.3 Hashing

`contentHash` is a stable SHA-256 over a canonical JSON representation of:

```json
{
  "title": "...",
  "content": [...]
}
```

Do not hash `updatedAt`, user ids, transient Yjs metadata, or local editor selection state. Hash stability lets the capture path skip duplicate saves produced by Hocuspocus store retries.

## 5. Capture Policy

### 5.1 Automatic snapshots

Hocuspocus persistence creates an automatic snapshot when all of these are true:

- the document name matches `page:<noteId>`;
- the Plate JSON conversion succeeded;
- content hash differs from the latest `note_versions.content_hash`;
- either no previous snapshot exists, or the latest automatic snapshot is at least 5 minutes old, or the plain-text delta exceeds a meaningful threshold.

Meaningful delta threshold:

- `abs(currentText.length - previousText.length) >= 200`, or
- normalized word-level diff changes at least 30 words, or
- block count changes by at least 3.

The threshold prevents one version per small collaborative keystroke burst while still capturing substantial editing sessions.

### 5.2 Forced snapshots

Forced snapshot events bypass the 5-minute throttle but still skip exact duplicate hashes:

- note creation/import: `source='import'` or `manual_checkpoint` depending on entry path;
- title rename: `source='title_change'`;
- DocEditorAgent accepted diff: `source='ai_edit'`;
- restore: pre-restore current state snapshot, then restored state as the new latest version with `source='restore'`;
- explicit user action: "Create checkpoint" button, `source='manual_checkpoint'`.

### 5.3 Actor/source resolution

Hocuspocus store callbacks may not reliably include the authenticated user who caused the latest edit. v1 handles this with a best-effort model:

- explicit API paths (`restore`, `manual_checkpoint`, `title_change`, `ai_edit`) pass actor directly;
- automatic Hocuspocus snapshots use `actorType='system'` and `actorId=null` unless the Hocuspocus context contains a trustworthy user id;
- the UI labels system automatic snapshots as "자동 저장" rather than pretending a specific collaborator authored the whole snapshot.

This is honest and avoids false attribution. Fine-grained collaborative attribution is a v2 problem.

## 6. API

All endpoints require `requireAuth` and existing note-scoped permission helpers.

| Method | Route | Permission | Response |
| ------ | ----- | ---------- | -------- |
| `GET` | `/api/notes/:id/versions?limit=50&cursor=` | `canRead(note)` | paginated version metadata |
| `GET` | `/api/notes/:id/versions/:version` | `canRead(note)` | read-only snapshot (`title`, `content`, `contentText`, metadata) |
| `GET` | `/api/notes/:id/versions/:version/diff?against=current\|previous` | `canRead(note)` | structured block/text diff |
| `POST` | `/api/notes/:id/versions/checkpoint` | `canWrite(note)` | creates forced manual checkpoint |
| `POST` | `/api/notes/:id/versions/:version/restore` | `canWrite(note)` | restores selected version as latest |

### 6.1 Version list shape

```ts
{
  versions: Array<{
    id: string;
    version: number;
    title: string;
    contentTextPreview: string;
    actor: { type: "user" | "agent" | "system"; id: string | null; name: string | null };
    source: "auto_save" | "title_change" | "ai_edit" | "restore" | "manual_checkpoint" | "import";
    reason: string | null;
    createdAt: string;
  }>;
  nextCursor: string | null;
}
```

### 6.2 Restore transaction

Restore must be atomic:

1. check `canWrite(note)`;
2. lock the note row and the target version row with `FOR UPDATE`;
3. create a forced pre-restore snapshot of the current state if current hash differs from latest version;
4. write target content into `notes.content` / `notes.content_text`;
5. write target Yjs state into `yjs_documents` if stored, otherwise regenerate with `plateToYDoc`;
6. create a new latest version with `source='restore'` and `reason='restored from vN'`;
7. emit tree/activity-compatible event if the final title differs or if a future activity feed is present.

The API returns the new latest version number and updated note metadata.

### 6.3 Error handling

- Missing or unreadable note: existing convention (`403` for canRead failure where route already exposes note existence; `404` where hide-existence is required).
- Version not found: `404`.
- Restore target is latest and hash matches current: `409 version_already_current`.
- Snapshot too large: `413 version_too_large`, with a product copy that says history could not be saved for this edit.
- Yjs regeneration failure: `500 restore_failed`, no partial writes because restore is transactional.

## 7. Diff Model

### 7.1 Server diff

The API computes a structured diff from two Plate JSON values:

```ts
type NoteVersionDiff = {
  fromVersion: number | "current";
  toVersion: number | "current";
  summary: {
    addedBlocks: number;
    removedBlocks: number;
    changedBlocks: number;
    addedWords: number;
    removedWords: number;
  };
  blocks: Array<{
    key: string;
    status: "added" | "removed" | "changed" | "unchanged";
    before?: PlateNode;
    after?: PlateNode;
    textDiff?: Array<{ kind: "equal" | "insert" | "delete"; text: string }>;
  }>;
};
```

The diff algorithm should be deterministic and conservative:

- use stable block ids if present;
- fall back to index plus normalized text similarity for older blocks with no stable id;
- treat unsupported/void blocks as block-level changed, not as text corruption;
- cap diff payload size and return `diff_too_large` with preview-only fallback when necessary.

### 7.2 Client rendering

The UI renders:

- a compact summary row;
- removed blocks with muted red background;
- added blocks with muted green background;
- changed text with inline insert/delete highlights;
- unchanged context collapsed by default, expandable.

This is a review surface, not an editor. It must never write to Plate until the user presses restore.

## 8. Web UX

### 8.1 Entry point

Add a `History` icon button to `NoteRouteChrome` or the current note header action cluster.

- Icon: `History` from lucide-react.
- Tooltip: `editor.history.open`.
- Hidden/disabled only when the user cannot read the note.
- Restore and checkpoint controls require write permission; read-only users can still inspect history.

### 8.2 History sheet

Use a right-side Sheet, because it lets the current note remain visible and matches existing share/diff sheet patterns.

Sections:

- header: note title, current version number, "Create checkpoint" button if writable;
- left timeline: versions grouped by day, source badge, actor label, relative time;
- right preview: selected version read-only render;
- diff toggle: "Preview" / "Compare with current";
- footer: "Restore this version" destructive-secondary action with confirmation dialog.

On mobile, the Sheet becomes full-screen and the timeline/preview stack vertically.

### 8.3 i18n

New namespace: `note-history.json`.

Required keys include:

- `open`, `title`, `currentVersion`, `createCheckpoint`, `checkpointCreated`
- `source.auto_save`, `source.title_change`, `source.ai_edit`, `source.restore`, `source.manual_checkpoint`, `source.import`
- `preview`, `compareWithCurrent`, `restore`, `restoreConfirmTitle`, `restoreConfirmBody`, `restoreSuccess`, `restoreFailed`
- `empty`, `loadFailed`, `diffTooLarge`, `readOnlyRestoreHint`

Run `pnpm --filter @opencairn/web i18n:parity` when implementing.

### 8.4 Product copy

Korean copy should avoid implying perfect per-character attribution in v1. Use terms like "자동 저장 시점", "AI 편집", "복원됨", and "체크포인트". Do not say "모든 변경의 작성자를 정확히 표시" until v2 attribution exists.

## 9. Security And Permissions

- Version list/detail/diff follows `canRead(note)`.
- Checkpoint and restore follow `canWrite(note)`.
- Every query scopes through `noteId` and denormalized `workspaceId`; never fetch versions by id alone without checking the parent note.
- Public share pages do not expose version history.
- Version snapshots may contain sensitive content. They inherit the same retention and deletion expectations as notes.
- Soft-deleted notes should not expose version APIs unless a future trash/restore plan explicitly adds admin recovery.
- On note hard-delete/workspace delete, cascade deletes version rows.

## 10. Storage And Performance

Snapshots can grow quickly. v1 mitigations:

- automatic snapshot throttling and duplicate hash skip;
- 90-day/500-auto-snapshot retention policy;
- `contentTextPreview` generated server-side instead of sending full content in list response;
- full `content` loaded only for selected version;
- diff computed on demand and capped by payload size.

Large note policy:

- If canonical Plate JSON exceeds 2 MB or encoded Yjs state exceeds the existing 4 MB `YJS_DOCUMENT_MAX_BYTES` cap, reject the snapshot with a structured log and visible non-blocking warning in the editor. Metadata-only history rows are not allowed because restore would be impossible.

## 11. Testing

### 11.1 DB/shared

- schema test declares table columns, enums, indexes, and unique `(note_id, version)`;
- hash helper is stable across key order and ignores timestamps;
- retention helper never prunes first/manual/restore/ai versions.

### 11.2 API

- list requires read permission and paginates;
- detail hides versions from users without note access;
- diff returns added/removed/changed summaries;
- restore requires write permission;
- restore creates pre-restore snapshot and restored latest version in one transaction;
- restore updates `notes.content`, `notes.content_text`, and `yjs_documents`;
- duplicate automatic snapshots are skipped by hash;
- title-change forced snapshot bypasses time throttle.

### 11.3 Hocuspocus

- store path creates first version for a newly seeded note;
- repeated store with same hash does not create duplicates;
- meaningful delta creates a new automatic snapshot;
- unsupported document names do not touch version tables;
- oversize states fail safely without corrupting `notes`.

### 11.4 Web

- history button opens Sheet;
- read-only user can preview/diff but cannot checkpoint/restore;
- writable user can create checkpoint;
- selecting a version loads preview;
- compare tab renders additions/removals;
- restore confirmation calls API and refreshes note/editor state;
- i18n parity passes.

### 11.5 E2E smoke

Manual or Playwright smoke:

1. create note;
2. edit enough content to trigger an automatic snapshot;
3. create manual checkpoint;
4. apply an AI edit if feature flags are available, otherwise simulate via API test fixture;
5. open history, compare old version to current;
6. restore old version;
7. reload note and confirm restored content persists.

## 12. Implementation Phasing

This should be one focused plan but internally ordered as:

1. DB/schema + hash/diff pure helpers.
2. API list/detail/diff/checkpoint/restore.
3. Hocuspocus automatic snapshot capture.
4. Web history Sheet and i18n.
5. Integration tests and manual smoke.

Do not start by building the UI. Without the DB/API restore transaction and Hocuspocus capture hook, the UI would only be a mock.

## 13. Follow-Ups

- Character-level author attribution from Yjs awareness/update metadata.
- Workspace activity feed backed by a real `activity_events` table.
- Trash restore endpoint emitting `tree.note_restored`.
- Canvas/source-code version history.
- Admin retention controls for hosted/commercial plans.
- Export version history as Markdown/JSON for data portability.

## 14. Resolved Decisions

| Question | Decision |
| -------- | -------- |
| Is v1 snapshot-based or Yjs-update-log-based? | Snapshot-based, with optional stored Yjs state for faithful restore. |
| Does v1 include diff? | Yes. Block/text diff against current or previous version. |
| Does v1 expose history on public share pages? | No. Authenticated note readers only. |
| Does restore overwrite history? | No. Restore creates a new latest version and preserves pre-restore current state. |
| Is actor attribution exact for collaborative auto-save? | No. Automatic snapshots can be system-attributed unless a trusted user id is available. |
| Should plans-status be updated now? | No. Update it only after implementation PR merge. |
