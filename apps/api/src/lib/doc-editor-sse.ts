import type { DocEditorSseEvent } from "@opencairn/shared";

// SSE wire format mirrors chat.ts encoder. `event:` line is the
// discriminator; `data:` is the body sans the `type` field for compactness
// — clients reconstruct the event object via the event name.
export function encodeSseEvent(event: DocEditorSseEvent): string {
  const { type, ...rest } = event as { type: string; [k: string]: unknown };
  return `event: ${type}\ndata: ${JSON.stringify(rest)}\n\n`;
}
