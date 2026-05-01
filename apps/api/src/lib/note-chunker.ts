import { createHash } from "node:crypto";

export type ChunkNoteTextInput = {
  contentText: string;
  maxChars?: number;
};

export type NoteTextChunk = {
  chunkIndex: number;
  headingPath: string;
  contentText: string;
  tokenCount: number;
  contentHash: string;
  sourceOffsets: { start: number; end: number };
};

const HEADING_RE = /^(#{1,6})\s+(.+)$/;

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function chunkNoteText(input: ChunkNoteTextInput): NoteTextChunk[] {
  const maxChars = input.maxChars ?? 2400;
  const lines = input.contentText.split(/\r?\n/);
  const headingStack: string[] = [];
  const chunks: Omit<NoteTextChunk, "chunkIndex">[] = [];
  let buffer = "";
  let bufferStart = 0;
  let cursor = 0;

  function flush(end: number) {
    const text = buffer.trim();
    if (!text) {
      buffer = "";
      bufferStart = cursor;
      return;
    }
    chunks.push({
      headingPath: headingStack.filter(Boolean).join(" > "),
      contentText: text,
      tokenCount: Math.max(1, Math.ceil(text.length / 4)),
      contentHash: hashText(text),
      sourceOffsets: { start: bufferStart, end },
    });
    buffer = "";
    bufferStart = cursor;
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const heading = HEADING_RE.exec(line);
    if (heading) {
      flush(cursor);
      const level = heading[1]!.length;
      headingStack.splice(level - 1);
      headingStack[level - 1] = heading[2]!.trim();
    } else if (line.length > maxChars) {
      flush(cursor);
      for (let i = 0; i < line.length; i += maxChars) {
        const part = line.slice(i, i + maxChars);
        bufferStart = cursor + i;
        buffer = part;
        flush(cursor + i + part.length);
      }
    } else {
      if (!buffer) bufferStart = cursor;
      const next = buffer ? `${buffer}\n${line}` : line;
      if (next.length > maxChars) {
        flush(cursor);
        bufferStart = cursor;
        buffer = line;
      } else {
        buffer = next;
      }
    }
    const nextNewline = input.contentText.indexOf(
      "\n",
      cursor + rawLine.length,
    );
    cursor = nextNewline === -1 ? input.contentText.length : nextNewline + 1;
  }
  flush(input.contentText.length);

  return chunks.map((chunk, chunkIndex) => ({ ...chunk, chunkIndex }));
}
