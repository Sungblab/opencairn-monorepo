import { describe, expect, it } from "vitest";

import {
  NoteVersionActorTypeSchema,
  NoteVersionDiffSchema,
  NoteVersionListResponseSchema,
  NoteVersionSourceSchema,
  RestoreNoteVersionResponseSchema,
} from "../src/note-versions";

describe("note version shared schemas", () => {
  it("defines actor and source enums", () => {
    expect(NoteVersionActorTypeSchema.options).toEqual([
      "user",
      "agent",
      "system",
    ]);
    expect(NoteVersionSourceSchema.options).toEqual([
      "auto_save",
      "title_change",
      "ai_edit",
      "restore",
      "manual_checkpoint",
      "import",
    ]);
  });

  it("accepts version list payloads", () => {
    expect(() =>
      NoteVersionListResponseSchema.parse({
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
      NoteVersionDiffSchema.parse({
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
      RestoreNoteVersionResponseSchema.parse({
        noteId: "11111111-1111-4111-8111-111111111111",
        restoredFromVersion: 2,
        newVersion: 5,
        updatedAt: "2026-04-30T00:00:00.000Z",
      }),
    ).not.toThrow();
  });
});
