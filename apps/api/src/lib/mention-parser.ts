import type { MentionToken } from "@opencairn/shared";

// Bounded quantifier (`{1,128}`) keeps matchAll/replace linear on hostile
// input — e.g. `@[user:` followed by 100k chars with no closing `]`. An
// unbounded `+` triggers polynomial backtracking on every `@[user:` prefix.
const TOKEN_RE = /@\[(user|page|concept|date):([^\]\s]{1,128})\]/g;

export function parseMentions(body: string): MentionToken[] {
  const seen = new Set<string>();
  const out: MentionToken[] = [];
  for (const m of body.matchAll(TOKEN_RE)) {
    const type = m[1] as MentionToken["type"];
    const id = m[2];
    if (!id) continue;
    const k = `${type}:${id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ type, id });
  }
  return out;
}

export function stripMentions(body: string): string {
  return body.replace(TOKEN_RE, "").replace(/\s{2,}/g, " ").trim();
}
