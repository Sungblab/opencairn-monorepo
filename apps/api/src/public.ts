// Public surface for cross-package reuse. Imported by apps/hocuspocus to get
// permission helpers + mention parsing without duplicating the logic. Keep
// this file small — it is effectively the API package's "SDK" seam.

export { resolveRole, canRead, canWrite, canComment } from "./lib/permissions.js";
export type { ResolvedRole, ResourceType } from "./lib/permissions.js";
export { parseMentions, stripMentions } from "./lib/mention-parser.js";
