export const SIDEBAR_FAVORITES_UPDATED = "opencairn:sidebar-favorites-updated";

export interface SidebarFavorite {
  id: string;
  targetId?: string;
  label: string;
  href: string;
  kind: "note" | "folder" | "source_bundle" | "code_workspace" | "agent_file";
}

const SIDEBAR_FAVORITE_KINDS: SidebarFavorite["kind"][] = [
  "note",
  "folder",
  "source_bundle",
  "code_workspace",
  "agent_file",
];

export function sidebarFavoritesKey(wsSlug: string) {
  return `opencairn:sidebar:favorites:${wsSlug}`;
}

export function readSidebarFavorites(wsSlug: string): SidebarFavorite[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(sidebarFavoritesKey(wsSlug));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSidebarFavorite);
  } catch {
    return [];
  }
}

export function upsertSidebarFavorite(
  wsSlug: string,
  favorite: SidebarFavorite,
) {
  if (typeof window === "undefined") return;
  const next = [
    favorite,
    ...readSidebarFavorites(wsSlug).filter((item) => item.id !== favorite.id),
  ].slice(0, 8);
  window.localStorage.setItem(
    sidebarFavoritesKey(wsSlug),
    JSON.stringify(next),
  );
  window.dispatchEvent(new CustomEvent(SIDEBAR_FAVORITES_UPDATED));
}

export function removeSidebarFavorite(wsSlug: string, id: string) {
  if (typeof window === "undefined") return;
  const next = readSidebarFavorites(wsSlug).filter((item) => item.id !== id);
  window.localStorage.setItem(
    sidebarFavoritesKey(wsSlug),
    JSON.stringify(next),
  );
  window.dispatchEvent(new CustomEvent(SIDEBAR_FAVORITES_UPDATED));
}

function isSidebarFavorite(value: unknown): value is SidebarFavorite {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    (record.targetId === undefined || typeof record.targetId === "string") &&
    typeof record.label === "string" &&
    typeof record.href === "string" &&
    typeof record.kind === "string" &&
    SIDEBAR_FAVORITE_KINDS.includes(record.kind as SidebarFavorite["kind"])
  );
}
