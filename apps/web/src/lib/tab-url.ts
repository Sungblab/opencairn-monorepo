import type { TabKind } from "@/stores/tabs-store";

// Single source of truth for the Tab ↔ URL mapping. The shell uses this in
// two directions: tabs-store entries derive their URL via tabToUrl when a
// tab gains focus, and useUrlTabSync (Task 9) parses incoming URL changes
// back into the canonical (kind, targetId) pair via urlToTabTarget. Keep
// these two functions inverses of each other or deep-link sharing breaks.
export interface TabRoute {
  kind: TabKind;
  targetId: string | null;
}

export function tabToUrl(slug: string, route: TabRoute): string {
  const base = `/w/${slug}`;
  switch (route.kind) {
    case "dashboard":
      return `${base}/`;
    case "note":
      return `${base}/n/${route.targetId}`;
    case "project":
      return `${base}/p/${route.targetId}`;
    case "research_hub":
      return `${base}/research`;
    case "research_run":
      return `${base}/research/${route.targetId}`;
    case "import":
      return `${base}/import`;
    case "ws_settings":
      return route.targetId
        ? `${base}/settings/${route.targetId}`
        : `${base}/settings`;
  }
}

export function urlToTabTarget(
  path: string,
): { slug: string; route: TabRoute } | null {
  const m = path.match(/^\/w\/([^/]+)(?:\/(.*))?$/);
  if (!m) return null;
  const slug = m[1];
  const rest = m[2] ?? "";
  const parts = rest.split("/").filter(Boolean);

  if (parts.length === 0) {
    return { slug, route: { kind: "dashboard", targetId: null } };
  }
  if (parts[0] === "n" && parts[1]) {
    return { slug, route: { kind: "note", targetId: parts[1] } };
  }
  if (parts[0] === "p" && parts[1]) {
    return { slug, route: { kind: "project", targetId: parts[1] } };
  }
  if (parts[0] === "research" && parts.length === 1) {
    return { slug, route: { kind: "research_hub", targetId: null } };
  }
  if (parts[0] === "research" && parts[1]) {
    return { slug, route: { kind: "research_run", targetId: parts[1] } };
  }
  if (parts[0] === "import" && parts.length === 1) {
    return { slug, route: { kind: "import", targetId: null } };
  }
  if (parts[0] === "settings") {
    return {
      slug,
      route: { kind: "ws_settings", targetId: parts[1] ?? null },
    };
  }

  return null;
}
