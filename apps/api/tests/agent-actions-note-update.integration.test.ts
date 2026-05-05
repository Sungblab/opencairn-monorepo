import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import {
  agentActions,
  and,
  db,
  eq,
  noteVersions,
  notes,
  wikiLinks,
  yjsDocuments,
} from "@opencairn/db";
import { createApp } from "../src/app.js";
import { plateValueToText } from "../src/lib/plate-text.js";
import {
  transformYjsStateWithPlateValue,
  yjsStateToPlateValue,
} from "../src/lib/yjs-plate-transform.js";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";
import type { PlateValue } from "../src/lib/yjs-to-plate.js";

const app = createApp();

async function authedFetch(
  path: string,
  init: RequestInit & { userId: string },
): Promise<Response> {
  const { userId, headers, ...rest } = init;
  const cookie = await signSessionCookie(userId);
  return app.request(path, {
    ...rest,
    headers: {
      ...(headers ?? {}),
      cookie,
      "content-type": "application/json",
    },
  });
}

async function seedYjsDocument(noteId: string, content: PlateValue) {
  const empty = new Y.Doc();
  const transformed = transformYjsStateWithPlateValue({
    currentState: Y.encodeStateAsUpdate(empty),
    draft: content,
  });
  await db.insert(yjsDocuments).values({
    name: `page:${noteId}`,
    state: transformed.state,
    stateVector: transformed.stateVector,
    sizeBytes: transformed.state.byteLength,
  });
  await db
    .update(notes)
    .set({
      content: transformed.plateValue,
      contentText: plateValueToText(transformed.plateValue),
    })
    .where(eq(notes.id, noteId));
  return transformed;
}

describe("note.update agent action integration", () => {
  let seed: SeedResult;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "owner" });
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("previews and applies a Yjs-backed draft with version capture, mirrors, and wiki links", async () => {
    const targetNoteId = randomUUID();
    await db.insert(notes).values({
      id: targetNoteId,
      projectId: seed.projectId,
      workspaceId: seed.workspaceId,
      title: "Target note",
      inheritParent: true,
    });

    const current = await seedYjsDocument(seed.noteId, [
      { type: "p", id: "block-1", children: [{ text: "old draft" }] },
    ]);
    const draftContent: PlateValue = [
      {
        type: "p",
        id: "block-1",
        children: [
          { text: "updated draft with " },
          {
            type: "wiki-link",
            targetId: targetNoteId,
            children: [{ text: "Target note" }],
          },
        ],
      },
    ];

    const create = await authedFetch(`/api/projects/${seed.projectId}/agent-actions`, {
      method: "POST",
      userId: seed.userId,
      body: JSON.stringify({
        requestId: randomUUID(),
        kind: "note.update",
        risk: "write",
        input: {
          noteId: seed.noteId,
          draft: { format: "plate_value_v1", content: draftContent },
          reason: "integration test",
        },
      }),
    });

    expect(create.status).toBe(201);
    const created = await create.json() as {
      action: {
        id: string;
        status: string;
        preview: {
          current: { yjsStateVectorBase64: string };
          draft: { contentText: string };
        };
      };
    };
    expect(created.action.status).toBe("draft");
    expect(created.action.preview.current.yjsStateVectorBase64).toBe(
      Buffer.from(current.stateVector).toString("base64"),
    );
    expect(created.action.preview.draft.contentText).toContain("updated draft");

    const apply = await authedFetch(`/api/agent-actions/${created.action.id}/apply`, {
      method: "POST",
      userId: seed.userId,
      body: JSON.stringify({
        yjsStateVectorBase64: created.action.preview.current.yjsStateVectorBase64,
      }),
    });

    expect(apply.status).toBe(200);
    const applied = await apply.json() as {
      action: {
        status: string;
        result: {
          versionCapture: {
            before: { created: boolean; version: number };
            after: { created: boolean; version: number };
          };
        };
      };
    };
    expect(applied.action.status).toBe("completed");
    expect(applied.action.result.versionCapture.before.created).toBe(true);
    expect(applied.action.result.versionCapture.after.created).toBe(true);
    expect(applied.action.result.versionCapture.after.version).toBe(
      applied.action.result.versionCapture.before.version + 1,
    );

    const versions = await db
      .select({
        version: noteVersions.version,
        source: noteVersions.source,
        actorType: noteVersions.actorType,
        contentText: noteVersions.contentText,
      })
      .from(noteVersions)
      .where(eq(noteVersions.noteId, seed.noteId))
      .orderBy(noteVersions.version);
    expect(versions).toMatchObject([
      { version: 1, source: "manual_checkpoint", actorType: "agent", contentText: "old draft" },
      { version: 2, source: "ai_edit", actorType: "agent", contentText: "updated draft with Target note" },
    ]);

    const [storedDoc] = await db
      .select({ state: yjsDocuments.state })
      .from(yjsDocuments)
      .where(eq(yjsDocuments.name, `page:${seed.noteId}`));
    expect(storedDoc).toBeTruthy();
    expect(yjsStateToPlateValue(storedDoc!.state)).toEqual(draftContent);

    const [note] = await db
      .select({ content: notes.content, contentText: notes.contentText })
      .from(notes)
      .where(eq(notes.id, seed.noteId));
    expect(note?.content).toEqual(draftContent);
    expect(note?.contentText).toBe("updated draft with Target note");

    const links = await db
      .select({
        sourceNoteId: wikiLinks.sourceNoteId,
        targetNoteId: wikiLinks.targetNoteId,
        workspaceId: wikiLinks.workspaceId,
      })
      .from(wikiLinks)
      .where(and(eq(wikiLinks.sourceNoteId, seed.noteId), eq(wikiLinks.targetNoteId, targetNoteId)));
    expect(links).toEqual([
      {
        sourceNoteId: seed.noteId,
        targetNoteId,
        workspaceId: seed.workspaceId,
      },
    ]);
  });

  it("returns the stable stale-preview error code from the apply route", async () => {
    await seedYjsDocument(seed.noteId, [
      { type: "p", id: "block-1", children: [{ text: "old draft" }] },
    ]);

    const create = await authedFetch(`/api/projects/${seed.projectId}/agent-actions`, {
      method: "POST",
      userId: seed.userId,
      body: JSON.stringify({
        requestId: randomUUID(),
        kind: "note.update",
        risk: "write",
        input: {
          noteId: seed.noteId,
          draft: {
            format: "plate_value_v1",
            content: [{ type: "p", id: "block-1", children: [{ text: "new draft" }] }],
          },
        },
      }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as { action: { id: string } };

    const stale = await authedFetch(`/api/agent-actions/${created.action.id}/apply`, {
      method: "POST",
      userId: seed.userId,
      body: JSON.stringify({ yjsStateVectorBase64: Buffer.from("stale").toString("base64") }),
    });

    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      error: "note_update_stale_preview",
      message: "note_update_stale_preview",
    });

    const [action] = await db
      .select({ status: agentActions.status, errorCode: agentActions.errorCode })
      .from(agentActions)
      .where(eq(agentActions.id, created.action.id));
    expect(action).toEqual({
      status: "failed",
      errorCode: "note_update_stale_preview",
    });
  });
});
