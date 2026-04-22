// Plan 2B Task 19 — @mention token round-trip helpers.
//
// The on-wire token shape is `@[type:id]` (literally, as plain text inside
// a comment body). Server-side `parseMentions`
// (apps/api/src/lib/mention-parser.ts) extracts these via regex on POST
// /notes/:id/comments and writes `comment_mentions` rows. Keep the regex
// below in sync with the server-side one.
//
// `date` ids are expected to be YYYY-MM-DD; `user` / `page` / `concept` ids
// are uuids or project-scoped uuids. We deliberately do NOT validate id
// shape here — the source of truth is the server, and the client's only
// job is to emit a string that round-trips through the parser.

export type MentionType = "user" | "page" | "concept" | "date";

export interface MentionToken {
  type: MentionType;
  id: string;
}

export function serialize(t: MentionToken): string {
  return `@[${t.type}:${t.id}]`;
}

export function parseOne(token: string): MentionToken | null {
  const m = /^@\[(user|page|concept|date):([^\]\s]+)\]$/.exec(token);
  return m ? { type: m[1] as MentionType, id: m[2]! } : null;
}
