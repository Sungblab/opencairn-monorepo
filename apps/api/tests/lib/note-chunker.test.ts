import { describe, expect, it } from "vitest";
import { chunkNoteText } from "../../src/lib/note-chunker.js";

describe("chunkNoteText", () => {
  it("keeps heading path on each chunk", () => {
    const chunks = chunkNoteText({
      contentText: "# Intro\nAlpha text.\n\n## Details\nBeta text.",
      maxChars: 30,
    });

    expect(chunks.map((c) => c.headingPath)).toEqual([
      "Intro",
      "Intro > Details",
    ]);
  });

  it("omits missing parent heading levels from heading paths", () => {
    const chunks = chunkNoteText({
      contentText: "### Deep\nAlpha text.",
      maxChars: 30,
    });

    expect(chunks[0]?.headingPath).toBe("Deep");
  });

  it("splits long paragraphs without producing empty chunks", () => {
    const chunks = chunkNoteText({
      contentText: "A".repeat(90),
      maxChars: 40,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.contentText.length > 0)).toBe(true);
    expect(chunks.every((c) => c.tokenCount > 0)).toBe(true);
  });

  it("preserves source offsets for paragraph-level citations", () => {
    const chunks = chunkNoteText({
      contentText: "# Title\n\nFirst paragraph.\n\nSecond paragraph.",
      maxChars: 32,
    });

    expect(chunks[0]?.sourceOffsets.start).toBeGreaterThanOrEqual(0);
    expect(chunks[0]?.sourceOffsets.end).toBeGreaterThan(
      chunks[0]?.sourceOffsets.start ?? 0,
    );
  });

  it("preserves source offsets when the note uses CRLF line endings", () => {
    const contentText = "# Title\r\n\r\nFirst paragraph.\r\n\r\nSecond paragraph.";
    const chunks = chunkNoteText({
      contentText,
      maxChars: 32,
    });

    for (const chunk of chunks) {
      expect(
        contentText.slice(chunk.sourceOffsets.start, chunk.sourceOffsets.end),
      ).toContain(chunk.contentText);
    }
  });
});
