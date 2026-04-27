import { describe, it, expect } from "vitest";
import {
  AttachedChipSchema,
  CreateConversationBodySchema,
  PatchConversationBodySchema,
  SendMessageBodySchema,
  PinBodySchema,
  ChipTypeSchema,
  MemoryFlagsSchema,
  CitationSchema,
} from "../src/chat.js";

const WS = "11111111-1111-1111-1111-111111111111";
const PAGE = "22222222-2222-2222-2222-222222222222";
const NOTE = "33333333-3333-3333-3333-333333333333";

const FULL_FLAGS = {
  l3_global: true,
  l3_workspace: true,
  l4: true,
  l2: false,
};

describe("chat shared schemas", () => {
  describe("ChipType / AttachedChip", () => {
    it("rejects unknown chip type", () => {
      const r = AttachedChipSchema.safeParse({
        type: "garbage",
        id: "x",
        manual: true,
      });
      expect(r.success).toBe(false);
    });

    it("accepts a page chip", () => {
      const r = AttachedChipSchema.safeParse({
        type: "page",
        id: PAGE,
        manual: false,
      });
      expect(r.success).toBe(true);
    });

    it("accepts memory chip variants (Plan 11B compat)", () => {
      for (const t of ["memory:l2", "memory:l3", "memory:l4"]) {
        const r = AttachedChipSchema.safeParse({ type: t, id: "abc", manual: true });
        expect(r.success).toBe(true);
      }
    });

    it("ChipType options match the DB enum literals", () => {
      // Mirror packages/db/src/schema/conversations.ts. Drift here = a
      // request the DB will reject at insert time.
      expect(ChipTypeSchema.options.sort()).toEqual(
        ["page", "project", "workspace", "memory:l3", "memory:l4", "memory:l2"].sort(),
      );
    });
  });

  describe("CreateConversationBody", () => {
    it("requires scopeId", () => {
      const r = CreateConversationBodySchema.safeParse({
        workspaceId: WS,
        scopeType: "page",
        attachedChips: [],
        memoryFlags: FULL_FLAGS,
      });
      expect(r.success).toBe(false);
    });

    it("defaults ragMode to strict", () => {
      const r = CreateConversationBodySchema.parse({
        workspaceId: WS,
        scopeType: "workspace",
        scopeId: WS,
        attachedChips: [],
        memoryFlags: FULL_FLAGS,
      });
      expect(r.ragMode).toBe("strict");
    });

    it("rejects non-uuid workspaceId", () => {
      const r = CreateConversationBodySchema.safeParse({
        workspaceId: "not-a-uuid",
        scopeType: "page",
        scopeId: PAGE,
        attachedChips: [],
        memoryFlags: FULL_FLAGS,
      });
      expect(r.success).toBe(false);
    });
  });

  describe("PatchConversationBody", () => {
    it("accepts a partial update with only ragMode", () => {
      const r = PatchConversationBodySchema.safeParse({ ragMode: "expand" });
      expect(r.success).toBe(true);
    });

    it("rejects unknown ragMode literal", () => {
      const r = PatchConversationBodySchema.safeParse({ ragMode: "loose" });
      expect(r.success).toBe(false);
    });
  });

  describe("SendMessageBody", () => {
    it("rejects empty content", () => {
      const r = SendMessageBodySchema.safeParse({
        conversationId: WS,
        content: "",
      });
      expect(r.success).toBe(false);
    });

    it("rejects content over 32k", () => {
      const r = SendMessageBodySchema.safeParse({
        conversationId: WS,
        content: "x".repeat(32_001),
      });
      expect(r.success).toBe(false);
    });

    it("accepts a normal turn", () => {
      const r = SendMessageBodySchema.parse({
        conversationId: WS,
        content: "hello",
      });
      expect(r.content).toBe("hello");
    });
  });

  describe("PinBody", () => {
    it("requires uuid noteId and non-empty blockId", () => {
      const r = PinBodySchema.safeParse({ noteId: NOTE, blockId: "block-1" });
      expect(r.success).toBe(true);
    });

    it("rejects missing blockId", () => {
      const r = PinBodySchema.safeParse({ noteId: NOTE, blockId: "" });
      expect(r.success).toBe(false);
    });
  });

  describe("Citation locator", () => {
    it("accepts a line_range tuple", () => {
      const r = CitationSchema.safeParse({
        source_type: "note",
        source_id: NOTE,
        snippet: "...",
        locator: { line_range: [10, 25] },
      });
      expect(r.success).toBe(true);
    });

    it("accepts an audio span", () => {
      const r = CitationSchema.safeParse({
        source_type: "external",
        source_id: "https://example.com/audio.mp3",
        snippet: "...",
        locator: { start_ms: 1000, end_ms: 5000 },
      });
      expect(r.success).toBe(true);
    });
  });

  describe("MemoryFlags", () => {
    it("requires every flag", () => {
      const r = MemoryFlagsSchema.safeParse({
        l3_global: true,
        l3_workspace: true,
        l4: true,
      });
      expect(r.success).toBe(false);
    });
  });
});
