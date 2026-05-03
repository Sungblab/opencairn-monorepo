# Import Connectors Gap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the highest-risk import claim gap by adding a generic Markdown export package importer that covers Obsidian/Bear-style exports without creating separate Obsidian or Bear provider importers.

**Architecture:** Keep current Drive file-ID import and Notion ZIP import intact. Add one source-agnostic `markdown_zip` import path that reuses the existing `/api/import`, `ImportWorkflow`, target picker, progress page, ZIP defenses, and parser/Plate conversion infrastructure. Connector foundation and Parser Gateway remain substrate work; this plan does not build provider account UX, live sync, or a Drive/Obsidian/Bear-specific browser.

**Tech Stack:** Hono + Zod, Drizzle migrations, Temporal Python worker, existing Notion ZIP staging/Markdown conversion activities, Plate JSON conversion, Next.js import tabs with next-intl, Vitest/pytest/Playwright.

---

## Current Code Truth

Read before implementing:

- Drive import exists as OAuth-connected file-ID MVP:
  - `apps/web/src/app/[locale]/workspace/[wsSlug]/import/DriveTab.tsx`
  - `apps/api/src/routes/import.ts`
  - `apps/worker/src/worker/activities/drive_activities.py`
- Notion ZIP import exists as presigned ZIP upload:
  - `apps/web/src/app/[locale]/workspace/[wsSlug]/import/NotionTab.tsx`
  - `apps/worker/src/worker/activities/notion_activities.py`
  - `apps/worker/src/worker/workflows/import_workflow.py`
- Connector foundation exists but is not provider UX:
  - `packages/db/src/schema/connectors.ts`
  - `packages/shared/src/connectors.ts`
  - `apps/api/src/routes/connectors.ts`
- Parser Gateway exists as worker-local benchmark substrate, not production ingest dispatch:
  - `apps/worker/src/worker/lib/parser_gateway.py`
  - `apps/worker/src/worker/lib/canonical_document.py`
  - `apps/worker/scripts/parser_benchmark.py`

## Narrowed First Move

Do **not** start with Obsidian or Bear dedicated importers. Start with a generic Markdown export package importer:

- `markdown_zip` source type.
- ZIP contains `.md`/`.markdown` files plus relative attachments.
- Frontmatter is preserved into note metadata where safe.
- `[[wikilinks]]` and relative Markdown links are resolved within the imported package when possible.
- Obsidian and Bear are treated as export shapes on top of Markdown, not provider identities.

Why this first:

- It directly fixes the public claim gap for "Obsidian/Bear major export formats" without inventing provider UX.
- It reuses the Notion ZIP architecture and tests instead of adding a parallel importer.
- It does not depend on connector account/source grants.
- It prepares a later connector bridge by producing clean source metadata and provenance.

Not first:

- Google Picker/folder sync for Drive. Drive already works as file-ID MVP; this is a UX gap, not the biggest false claim.
- Connector v2 migration. Foundation exists; bridging Drive/Notion into `connector_jobs` and `external_object_refs` is a later cross-stack plan.
- Parser Gateway production replacement. Markdown ZIP import should use deterministic Markdown conversion first; Parser Gateway remains benchmark substrate.

## File Structure

Create:

- `apps/worker/src/worker/activities/markdown_import_activities.py`
  Generic ZIP discovery and Markdown package normalization.
- `apps/worker/tests/test_markdown_import_activities.py`
  ZIP traversal, attachment mapping, wikilink, frontmatter, and package manifest tests.
- `apps/web/src/app/[locale]/workspace/[wsSlug]/import/MarkdownTab.tsx`
  One upload tab for Markdown export packages. Copy can mention "Markdown export ZIP" and examples, not first-class Obsidian/Bear connectors.
- `apps/web/tests/e2e/import-markdown.spec.ts`
  Mocked or fixture-backed browser path for upload/start/progress.

Modify:

- `packages/db/src/schema/enums.ts`
  Add `markdown_zip` to `import_source` enum and `markdown` only if current `source_type` cannot represent imported Markdown clearly.
- `packages/shared/src/import-types.ts`
  Add `startMarkdownImportSchema` and source union value.
- `apps/api/src/routes/import.ts`
  Add `/api/import/markdown/upload-url` and `/api/import/markdown`, sharing the same ownership-prefix checks as Notion ZIP.
- `apps/worker/src/worker/workflows/import_workflow.py`
  Add a `markdown_zip` branch that discovers Markdown package nodes and reuses binary child ingest for attachments.
- `apps/worker/src/worker/activities/import_activities.py`
  Extend target/materialization logic only if current Notion page-tree materialization is too Notion-specific.
- `apps/web/src/app/[locale]/workspace/[wsSlug]/import/ImportTabs.tsx`
  Add a Markdown tab. Do not add Obsidian/Bear provider tabs.
- `apps/web/messages/{ko,en}/import.json`
  Add Markdown tab copy and errors.
- `docs/contributing/feature-registry.md`
  Keep owning-path map updated.

Generated:

- New Drizzle migration from `pnpm db:generate`. Do not guess the migration number.

Do not modify in this plan:

- `apps/api/src/routes/connectors.ts`
- `packages/db/src/schema/connectors.ts`
- provider-specific connector UX
- Drive Picker or Drive folder browser
- Parser Gateway production dispatch

## Task 1: Shared And DB Contract

**Files:**

- Modify: `packages/shared/src/import-types.ts`
- Modify: `packages/db/src/schema/enums.ts`
- Test: `packages/shared/tests/import-types.test.ts` or nearest existing shared import test
- Test: `packages/db/tests/import-jobs.test.ts` or add a focused enum test
- Generated: `packages/db/drizzle/*_markdown_import.sql`

- [ ] **Step 1: Write failing shared schema tests**

Add tests that prove `markdown_zip` is accepted and the upload request is bounded:

```ts
import { describe, expect, it } from "vitest";
import {
  importSourceSchema,
  startMarkdownImportSchema,
  markdownUploadUrlSchema,
} from "../src/import-types";

describe("markdown import schemas", () => {
  it("accepts markdown_zip as an import source", () => {
    expect(importSourceSchema.parse("markdown_zip")).toBe("markdown_zip");
  });

  it("validates markdown import start payload", () => {
    const parsed = startMarkdownImportSchema.parse({
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      zipObjectKey:
        "imports/markdown/550e8400-e29b-41d4-a716-446655440000/user_1/pkg.zip",
      originalName: "vault.zip",
      target: { kind: "new" },
    });
    expect(parsed.originalName).toBe("vault.zip");
  });

  it("caps markdown zip upload size", () => {
    expect(() =>
      markdownUploadUrlSchema.parse({
        workspaceId: "550e8400-e29b-41d4-a716-446655440000",
        size: 11 * 1024 * 1024 * 1024,
        originalName: "too-big.zip",
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run shared test and confirm it fails**

Run:

```bash
pnpm --filter @opencairn/shared test -- import-types.test.ts
```

Expected: fail because schemas do not exist yet.

- [ ] **Step 3: Extend shared schemas**

In `packages/shared/src/import-types.ts`, extend the source union and add Markdown schemas:

```ts
export const importSourceSchema = z.enum([
  "google_drive",
  "notion_zip",
  "markdown_zip",
]);

export const startMarkdownImportSchema = z.object({
  workspaceId: z.string().uuid(),
  zipObjectKey: z.string().min(1),
  originalName: z.string().min(1).max(255),
  target: importTargetSchema,
});

export const markdownUploadUrlSchema = z.object({
  workspaceId: z.string().uuid(),
  size: z.number().int().positive().max(10 * 1024 * 1024 * 1024),
  originalName: z.string().min(1).max(255),
});
```

- [ ] **Step 4: Add DB enum value with generated migration**

Modify `packages/db/src/schema/enums.ts` to include `markdown_zip` in `importSourceEnum`.

Run:

```bash
pnpm db:generate
```

Expected: one generated migration adds the enum value. Do not hand-pick a migration number.

- [ ] **Step 5: Run focused contract tests**

Run:

```bash
pnpm --filter @opencairn/shared test -- import-types.test.ts
pnpm --filter @opencairn/db test -- import-jobs.test.ts
```

Expected: shared tests pass; DB tests pass or the nearest enum/table shape test passes.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/import-types.ts packages/shared/tests packages/db/src/schema/enums.ts packages/db/drizzle packages/db/drizzle/meta
git commit -m "feat(import): add markdown zip import contract"
```

## Task 2: API Markdown ZIP Start Path

**Files:**

- Modify: `apps/api/src/routes/import.ts`
- Test: `apps/api/tests/import-markdown-start.test.ts`
- Test: `apps/api/tests/import-markdown-upload.test.ts`

- [ ] **Step 1: Write upload ownership tests**

Create tests mirroring the Notion ZIP issuer-prefix cases:

```ts
describe("POST /api/import/markdown — zipObjectKey ownership", () => {
  it("accepts a key under imports/markdown/<workspace>/<user>/", async () => {
    // seed user/workspace with writer access
    // POST /api/import/markdown with matching key
    // expect 201 and returned jobId
  });

  it("rejects another user's key", async () => {
    // same workspace, different user segment
    // expect 403 zip_object_key_not_owned
  });

  it("rejects traversal-like keys", async () => {
    // key contains '..', '//', or '\\'
    // expect 403 zip_object_key_not_owned
  });
});
```

Use the existing import route test helpers and mock Temporal start the same way Notion tests do.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
pnpm --filter @opencairn/api test -- import-markdown-start.test.ts import-markdown-upload.test.ts
```

Expected: fail because routes are not implemented.

- [ ] **Step 3: Add Markdown upload URL route**

In `apps/api/src/routes/import.ts`, add a route parallel to `/notion/upload-url`:

```ts
importRouter.post(
  "/markdown/upload-url",
  requireAuth,
  zValidator("json", markdownUploadUrlSchema),
  async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");
    if (!(await canWrite(userId, { type: "workspace", id: body.workspaceId }))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const objectKey = `imports/markdown/${body.workspaceId}/${userId}/${Date.now()}-${randomUUID()}.zip`;
    const uploadUrl = await getPresignedPutUrl(objectKey, {
      expiresSeconds: 30 * 60,
      contentType: "application/zip",
      maxSize: body.size,
    });
    return c.json({ objectKey, uploadUrl });
  },
);
```

- [ ] **Step 4: Add Markdown import start route**

Add `/markdown` start route that inserts an `import_jobs` row with `source: "markdown_zip"` and starts `ImportWorkflow` with:

```ts
const sourceMetadata = {
  zip_object_key: body.zipObjectKey,
  original_name: body.originalName,
};
```

Apply the exact same prefix checks as Notion, but with:

```ts
const expectedPrefix = `imports/markdown/${body.workspaceId}/${userId}/`;
```

- [ ] **Step 5: Run API tests**

Run:

```bash
pnpm --filter @opencairn/api test -- import-markdown-start.test.ts import-markdown-upload.test.ts import-notion-start.test.ts import-notion-upload.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/import.ts apps/api/tests/import-markdown-start.test.ts apps/api/tests/import-markdown-upload.test.ts
git commit -m "feat(api): add markdown zip import start routes"
```

## Task 3: Worker Markdown Package Discovery

**Files:**

- Create: `apps/worker/src/worker/activities/markdown_import_activities.py`
- Modify: `apps/worker/src/worker/activities/__init__.py` or worker registration path if needed
- Test: `apps/worker/tests/test_markdown_import_activities.py`

- [ ] **Step 1: Write failing activity tests**

Tests must cover:

- zip slip rejected
- file count cap rejected
- `.md` files become `kind="page"`
- attachments become `kind="binary"`
- `[[wikilink]]` map resolves by normalized title
- YAML frontmatter is captured as metadata but not required

Use temporary ZIP fixtures created inside the test.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
cd apps/worker
uv run pytest tests/test_markdown_import_activities.py -v
```

Expected: fail because the activity module does not exist.

- [ ] **Step 3: Implement `unzip_markdown_export`**

Implement an activity with this signature:

```python
@activity.defn(name="unzip_markdown_export")
async def unzip_markdown_export(inp: dict[str, Any]) -> dict[str, Any]:
    ...
```

Return a `TreeManifest` compatible with `ImportWorkflow`:

```python
{
    "job_id": job_id,
    "root_display_name": original_name,
    "nodes": [
        {
            "idx": 0,
            "parent_idx": None,
            "kind": "page",
            "path": "Folder/Note.md",
            "display_name": "Note",
            "meta": {
                "md_path": "Folder/Note.md",
                "frontmatter": {"tags": ["research"]},
                "source_format": "markdown",
            },
        }
    ],
    "uuid_link_map": {},
    "link_title_map": {"note": 0},
}
```

Use the existing Notion ZIP activity as the local pattern for staging, bounds, and zip-slip defense.

- [ ] **Step 4: Add link resolver helper**

Implement a pure helper:

```python
def normalize_markdown_link_target(value: str) -> str:
    return value.strip().removesuffix(".md").removesuffix(".markdown").replace("\\", "/").lower()
```

Tests should assert that `[[My Note]]`, `My Note.md`, and `folder/My Note.md` can resolve to the intended manifest node when unambiguous.

- [ ] **Step 5: Run activity tests**

Run:

```bash
cd apps/worker
uv run pytest tests/test_markdown_import_activities.py -v
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/worker/activities/markdown_import_activities.py apps/worker/tests/test_markdown_import_activities.py
git commit -m "feat(worker): add markdown export discovery activity"
```

## Task 4: Worker Workflow Branch And Markdown Conversion

**Files:**

- Modify: `apps/worker/src/worker/workflows/import_workflow.py`
- Modify: `apps/worker/src/worker/activities/notion_activities.py` or extract shared converter only if needed
- Test: `apps/worker/tests/test_import_workflow.py`
- Test: `apps/worker/tests/test_markdown_import_activities.py`

- [ ] **Step 1: Write failing workflow test**

Add a test that starts `ImportWorkflow` with `source="markdown_zip"` and asserts:

- `unzip_markdown_export` is called
- page nodes run the Markdown-to-Plate conversion path
- binary nodes spawn child `IngestWorkflow` with `workspace_id`
- `finalize_import_job` receives correct counters

- [ ] **Step 2: Run workflow test and confirm failure**

Run:

```bash
cd apps/worker
uv run pytest tests/test_import_workflow.py -k markdown -v
```

Expected: fail because the branch is missing.

- [ ] **Step 3: Add `markdown_zip` branch**

In `ImportWorkflow.run`, add:

```python
elif inp.source == "markdown_zip":
    manifest = await workflow.execute_activity(
        "unzip_markdown_export",
        {
            "job_id": inp.job_id,
            "zip_object_key": inp.source_metadata["zip_object_key"],
            "original_name": inp.source_metadata.get("original_name", "Markdown export"),
            "max_files": inp.source_metadata.get("max_files", 10_000),
            "max_uncompressed": inp.source_metadata.get(
                "max_uncompressed",
                10 * 1024 * 1024 * 1024,
            ),
        },
        schedule_to_close_timeout=_LONG,
        retry_policy=_RETRY,
    )
```

Keep the Drive branch explicit; do not let unknown sources fall into Drive.

- [ ] **Step 4: Reuse Markdown conversion safely**

If `convert_notion_md_to_plate` is Notion-specific only in name, pass Markdown package data through it with `source_format="markdown"`. If it rewrites Notion UUID links in a way that breaks generic Markdown, extract a shared `convert_markdown_md_to_plate` helper and keep `convert_notion_md_to_plate` as a thin wrapper.

The worker result must preserve:

- headings, lists, quotes, code, tables if current converter supports them
- relative links as links when no local target exists
- `[[wikilinks]]` as wiki links when a local target exists
- attachments as binary source notes through child ingest, not inline base64

- [ ] **Step 5: Run worker tests**

Run:

```bash
cd apps/worker
uv run pytest tests/test_import_workflow.py tests/test_markdown_import_activities.py tests/test_notion_md_converter.py -v
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/worker/workflows/import_workflow.py apps/worker/src/worker/activities apps/worker/tests
git commit -m "feat(worker): route markdown zip imports through import workflow"
```

## Task 5: Web Markdown Tab

**Files:**

- Create: `apps/web/src/app/[locale]/workspace/[wsSlug]/import/MarkdownTab.tsx`
- Modify: `apps/web/src/app/[locale]/workspace/[wsSlug]/import/ImportTabs.tsx`
- Modify: `apps/web/messages/ko/import.json`
- Modify: `apps/web/messages/en/import.json`
- Test: existing import component tests or add focused render test if local pattern exists

- [ ] **Step 1: Add copy keys**

Add keys under `markdown`:

```json
{
  "markdown": {
    "tab": "Markdown ZIP",
    "instructions": "Markdown 내보내기 ZIP을 업로드하세요. 폴더 구조, .md 파일, 상대 경로 첨부파일을 가져옵니다.",
    "dropZone": "Markdown ZIP 선택",
    "uploading": "업로드 중 {progress}%",
    "uploaded": "{name} 업로드 완료 ({size})"
  }
}
```

English copy must match keys and describe "Markdown export ZIP" without promising Obsidian/Bear dedicated sync.

- [ ] **Step 2: Implement `MarkdownTab.tsx`**

Copy the `NotionTab.tsx` interaction pattern, but call:

- `POST /api/import/markdown/upload-url`
- `POST /api/import/markdown`

Use the same `TargetPicker` and `urls.workspace.importJob(...)`.

- [ ] **Step 3: Add tab**

In `ImportTabs.tsx`, add a third tab labelled by `t("markdown.tab")`. Do not label it "Obsidian" or "Bear".

- [ ] **Step 4: Run web checks**

Run:

```bash
pnpm --filter @opencairn/web i18n:parity
pnpm --filter @opencairn/web exec tsc --noEmit
```

Expected: i18n parity passes; typecheck passes or records only known unrelated local blockers.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/[locale]/workspace/[wsSlug]/import/MarkdownTab.tsx apps/web/src/app/[locale]/workspace/[wsSlug]/import/ImportTabs.tsx apps/web/messages/ko/import.json apps/web/messages/en/import.json
git commit -m "feat(web): add markdown zip import tab"
```

## Task 6: Markdown Import E2E And Docs

**Files:**

- Create: `apps/web/tests/e2e/import-markdown.spec.ts`
- Modify: `docs/contributing/feature-registry.md`
- Modify: `docs/contributing/plans-status.md` after merge or when branch is ready for review
- Modify: `docs/review/2026-05-03-claim-reality-master-audit.md` only if public copy claims are changed in the same branch

- [ ] **Step 1: Add fixture-backed E2E**

Use a small ZIP fixture with:

- `Index.md`
- `Folder/Linked.md`
- `assets/image.png`
- a wikilink from `Index.md` to `Linked`

The test should upload the ZIP, start import, and assert the progress page URL. If live worker stack is not available, keep this as a mocked route smoke matching existing E2E conventions and document the limitation in the test comment.

- [ ] **Step 2: Update registry**

Add or update the feature registry row:

```md
| markdown-export-import | planned | `apps/api/src/routes/import.ts`, `apps/worker/src/worker/workflows/import_workflow.py`, `apps/worker/src/worker/activities/markdown_import_activities.py`, `apps/web/src/app/[locale]/workspace/[wsSlug]/import/` | `docs/superpowers/plans/2026-05-03-import-connectors-gap.md` | Obsidian/Bear-style exports enter through generic Markdown ZIP import; do not add separate provider tabs or dedicated importers until this path is proven. |
```

- [ ] **Step 3: Run final focused verification**

Run:

```bash
rg -n "DriveTab|NotionTab|MarkdownTab|markdown_zip|Obsidian|Bear|connector_accounts|ParserGateway|CanonicalDocument" apps packages docs
pnpm --filter @opencairn/shared test -- import-types.test.ts
pnpm --filter @opencairn/api test -- import-markdown-start.test.ts import-markdown-upload.test.ts
cd apps/worker && uv run pytest tests/test_markdown_import_activities.py tests/test_import_workflow.py -k "markdown or ImportWorkflow" -v
pnpm --filter @opencairn/web i18n:parity
git diff --check
```

Expected: focused tests pass. If full-stack E2E cannot run locally, record that the E2E is mocked or deferred to live-stack smoke.

- [ ] **Step 4: Commit docs and tests**

```bash
git add apps/web/tests/e2e/import-markdown.spec.ts docs/contributing/feature-registry.md docs/contributing/plans-status.md docs/review
git commit -m "docs(import): record markdown export import coverage"
```

## Follow-Up Plans After This

1. **Drive Connector UX v2:** Google Picker, folder selection, and Drive `external_object_refs`. Do this after Markdown ZIP because Drive already has a truthful file-ID MVP.
2. **Connector Job Bridge:** write `connector_jobs` and `external_object_refs` compatibility rows for Drive/Notion/Markdown imports without replacing `import_jobs` immediately.
3. **Parser Gateway Production Gate:** route selected PDF/Office parsing through `ParserGateway` only after benchmark scoring exists.
4. **Provider-Specific Obsidian/Bear Polish:** only after generic Markdown ZIP import is live and tested. At that point, Obsidian can add canvas/frontmatter polish and Bear can add TextBundle-specific attachment handling as format adapters, not separate connector providers.

## Self-Review Checklist

- [x] This plan does not build Obsidian/Bear dedicated importers first.
- [x] Drive is kept as current file-ID MVP; Picker/folder UX is separated.
- [x] Notion ZIP remains untouched except shared reuse patterns.
- [x] Connector foundation is acknowledged but not expanded into provider UX.
- [x] Parser Gateway is acknowledged as benchmark substrate, not production dispatch.
- [x] The first implementation is small enough to test end-to-end: one generic Markdown ZIP source.
