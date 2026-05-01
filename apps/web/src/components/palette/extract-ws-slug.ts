// Pulls the active workspace slug out of the path so the global palette
// (mounted at the locale boundary) can scope its note search and shell
// actions without a prop drill from a server-rendered layout.
//
import { parseWorkspacePath } from "@/lib/url-parsers";

// Routes: `/<locale>/workspace/<wsSlug>/...`. Any other shape
// (`/settings/*`, `/onboarding`, `/s/<token>`)
// returns null and the palette renders the "no workspace" action set.

export function extractWsSlug(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  return parseWorkspacePath(pathname).wsSlug;
}
