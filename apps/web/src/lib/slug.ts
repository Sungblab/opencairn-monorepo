// Keep this list in sync with apps/api/src/routes/workspaces.ts RESERVED_SLUGS.
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "app", "api", "admin", "auth", "www", "assets", "static", "public",
  "health", "onboarding", "settings", "billing", "share",
  "invite", "invites", "help", "docs", "blog",
  // 2026-04-30 URL restructure: new top-level + workspace path segments.
  "workspace", "dashboard", "project", "note",
]);

const MIN_LEN = 3;
const MAX_LEN = 40;
const VALID_SLUG = /^[a-z0-9-]+$/;

export function deriveSlug(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^\x00-\x7f]+/g, "") // strip non-ASCII
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LEN);

  if (ascii.length < MIN_LEN) return "";
  if (RESERVED_SLUGS.has(ascii)) return "";
  return ascii;
}

export function isValidSlug(slug: string): boolean {
  if (slug.length < MIN_LEN || slug.length > MAX_LEN) return false;
  if (!VALID_SLUG.test(slug)) return false;
  if (RESERVED_SLUGS.has(slug)) return false;
  return true;
}
