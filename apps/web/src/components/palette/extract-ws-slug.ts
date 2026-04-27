// Pulls the active workspace slug out of the path so the global palette
// (mounted at the locale boundary) can scope its note search and shell
// actions without a prop drill from a server-rendered layout.
//
// Routes: `/<locale>/app/w/<wsSlug>/...` — wsSlug sits at index 4 (after the
// leading "/"). Any other shape (`/settings/*`, `/onboarding`, `/s/<token>`)
// returns null and the palette renders the "no workspace" action set.

const WS_SEGMENT_RE = /^\/[^/]+\/app\/w\/([^/]+)(?:\/|$)/;

export function extractWsSlug(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const match = pathname.match(WS_SEGMENT_RE);
  return match?.[1] ?? null;
}
