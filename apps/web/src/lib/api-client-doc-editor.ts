// Plan 11B Phase A — DocEditor SSE client.
//
// The /api/notes/:noteId/doc-editor/commands/:commandName route POSTs JSON
// and streams `text/event-stream` back, so EventSource (GET-only) is not
// usable. We hold the connection open with fetch + ReadableStream and
// surface typed events validated against the shared zod union.
//
// Mirrors the SSE pattern in `apps/web/src/hooks/use-chat-send.ts` for
// streaming chat replies, but kept tiny + dep-free so the parser can be
// unit-tested as a pure function (the API output is well-controlled —
// no comment heartbeats or multi-line `data:` continuations).

import {
  docEditorSseEventSchema,
  type DocEditorSseEvent,
  type DocEditorRequest,
  type DocEditorCommand,
} from "@opencairn/shared";

export function parseSseChunk(chunk: string): DocEditorSseEvent[] {
  const out: DocEditorSseEvent[] = [];
  for (const block of chunk.split("\n\n")) {
    const lines = block.split("\n");
    let event = "";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data = line.slice(5).trim();
    }
    if (!event || !data) continue;
    try {
      const parsed = docEditorSseEventSchema.safeParse({
        type: event,
        ...JSON.parse(data),
      });
      if (parsed.success) out.push(parsed.data);
    } catch {
      // Bad JSON — skip silently. The UI keeps the last good event so a
      // single malformed frame doesn't tear the surface down.
    }
  }
  return out;
}

export async function* runDocEditorCommand(
  noteId: string,
  command: DocEditorCommand,
  body: DocEditorRequest,
  signal?: AbortSignal,
): AsyncGenerator<DocEditorSseEvent> {
  let res: Response;
  try {
    res = await fetch(
      `/api/notes/${encodeURIComponent(noteId)}/doc-editor/commands/${encodeURIComponent(command)}`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        body: JSON.stringify(body),
        signal,
      },
    );
  } catch (err) {
    // AbortError (caller cancelled) is silent — caller already knows.
    if ((err as Error).name === "AbortError") return;
    yield {
      type: "error",
      code: "internal",
      message: err instanceof Error ? err.message : "fetch_failed",
    };
    yield { type: "done" };
    return;
  }
  if (!res.ok || !res.body) {
    yield {
      type: "error",
      // 403 today comes from canWrite failing between selection capture and
      // command execution — same code the worker uses for selection drift.
      code: res.status === 403 ? "selection_race" : "internal",
      message: `HTTP ${res.status}`,
    };
    yield { type: "done" };
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Drain only complete frames (terminated by a blank line); leave any
      // partial trailing frame in the buffer for the next read.
      const splitAt = buffer.lastIndexOf("\n\n");
      if (splitAt === -1) continue;
      const ready = buffer.slice(0, splitAt + 2);
      buffer = buffer.slice(splitAt + 2);
      for (const ev of parseSseChunk(ready)) yield ev;
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    throw err;
  }
  if (buffer) for (const ev of parseSseChunk(buffer)) yield ev;
}
