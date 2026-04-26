// Minimal SSE frame parser tuned for /api/visualize.
//
// The route emits frames separated by `\n\n`, each frame having `event: <name>`
// + `data: <json>`. We do incremental parsing because the response body
// arrives as a chunked ReadableStream — one fetch read may end mid-frame, so
// the caller keeps appending to a buffer and feeds the buffer back here.
// Anything after the last `\n\n` is returned as `remainder` for the next
// iteration.
//
// We intentionally don't reuse `eventsource-parser` here because the visualize
// stream stays in-process to this hook: we need the full frame in one pass
// (event + data) so we can dispatch by event name, and the parser callback
// model doesn't compose cleanly with React state batching. The parser is also
// small enough that direct testing keeps the SSE contract honest.

export interface SseEvent {
  event: string;
  data: unknown;
}

export function parseSseChunks(buffer: string): {
  events: SseEvent[];
  remainder: string;
} {
  const events: SseEvent[] = [];
  const blocks = buffer.split("\n\n");
  // Last block may be incomplete — keep as remainder for the next read.
  const remainder = blocks.pop() ?? "";
  for (const block of blocks) {
    if (!block.trim()) continue;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
    }
    if (dataLines.length === 0) continue;
    try {
      events.push({ event, data: JSON.parse(dataLines.join("\n")) });
    } catch {
      // Malformed JSON in data — skip the frame rather than corrupt state.
    }
  }
  return { events, remainder };
}
