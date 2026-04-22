import { describe, it, expect } from "vitest";
import { createCommentSchema, mentionSearchQuerySchema, mentionTokenSchema } from "../src/comment-types.js";

describe("createCommentSchema", () => {
  it("accepts block-anchored top-level comment", () => {
    const r = createCommentSchema.safeParse({ body: "hi", anchorBlockId: "blk1" });
    expect(r.success).toBe(true);
  });
  it("rejects empty body", () => {
    const r = createCommentSchema.safeParse({ body: "" });
    expect(r.success).toBe(false);
  });
  it("accepts reply with parentId", () => {
    const r = createCommentSchema.safeParse({ body: "re", parentId: "00000000-0000-4000-8000-000000000001" });
    expect(r.success).toBe(true);
  });
});

describe("mentionTokenSchema", () => {
  it("parses each type", () => {
    expect(mentionTokenSchema.parse({ type: "user", id: "u_1" })).toBeTruthy();
    expect(mentionTokenSchema.parse({ type: "page", id: "n_1" })).toBeTruthy();
    expect(mentionTokenSchema.parse({ type: "concept", id: "c_1" })).toBeTruthy();
    expect(mentionTokenSchema.parse({ type: "date", id: "2026-04-22" })).toBeTruthy();
  });
});

describe("mentionSearchQuerySchema", () => {
  it("requires workspaceId", () => {
    const r = mentionSearchQuerySchema.safeParse({ type: "user", q: "al" });
    expect(r.success).toBe(false);
  });
});
