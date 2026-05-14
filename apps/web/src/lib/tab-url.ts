import { parseWorkspacePath } from "@/lib/url-parsers";
import { urls } from "@/lib/urls";
import type { TabKind, TabMode } from "@/stores/tabs-store";

// Single source of truth for the Tab ↔ URL mapping. The shell uses this in
// two directions: tabs-store entries derive their URL via tabToUrl when a
// tab gains focus, and useUrlTabSync (Task 9) parses incoming URL changes
// back into the canonical (kind, targetId) pair via urlToTabTarget. Keep
// these two functions inverses of each other or deep-link sharing breaks.
export interface TabRoute {
  kind: TabKind;
  targetId: string | null;
  mode?: TabMode;
}

const NOTE_URL_MODES = new Set<TabMode>([
  "reading",
  "source",
  "data",
  "canvas",
]);

export function tabToUrl(
  slug: string,
  route: TabRoute,
  locale = "ko",
): string {
  switch (route.kind) {
    case "dashboard":
      return `${urls.workspace.root(locale, slug)}/`;
    case "note":
      if (route.mode && NOTE_URL_MODES.has(route.mode)) {
        return urls.workspace.noteMode(
          locale,
          slug,
          route.targetId ?? "",
          route.mode,
        );
      }
      return urls.workspace.note(locale, slug, route.targetId ?? "");
    case "project":
      if (route.mode === "graph") {
        return urls.workspace.projectGraph(locale, slug, route.targetId ?? "");
      }
      return urls.workspace.project(locale, slug, route.targetId ?? "");
    case "research_hub":
      return urls.workspace.research(locale, slug);
    case "research_run":
      return urls.workspace.researchRun(locale, slug, route.targetId ?? "");
    case "import":
      return urls.workspace.root(locale, slug);
    case "help":
      return urls.workspace.help(locale, slug);
    case "report":
      return urls.workspace.report(locale, slug);
    case "ws_settings":
      return route.targetId
        ? urls.workspace.settingsSection(locale, slug, route.targetId)
        : urls.workspace.settings(locale, slug);
    case "agent_file":
      return urls.workspace.agentFile(locale, slug, route.targetId ?? "");
    case "code_workspace":
      return urls.workspace.codeWorkspace(locale, slug, route.targetId ?? "");
    case "ingest":
    case "lit_search":
    case "agent_panel":
      // Transient in-app tabs without canonical URLs — fall back to the
      // workspace base so URL sync doesn't drop the user on /undefined.
      return urls.workspace.root(locale, slug);
  }
}

export function urlToTabTarget(
  path: string,
): { slug: string; route: TabRoute } | null {
  const parsed = parseWorkspacePath(path);
  if (!parsed.wsSlug) return null;
  const slug = parsed.wsSlug;
  const clean = path.split(/[?#]/, 1)[0]!.replace(/\/+$/, "");
  const rawParts = clean.split("/").filter(Boolean);
  const parts = rawParts.slice(parsed.locale ? 3 : 2);

  if (parts.length === 0) {
    return { slug, route: { kind: "dashboard", targetId: null } };
  }
  if (parts[0] === "note" && parts[1]) {
    const mode = NOTE_URL_MODES.has(parts[2] as TabMode)
      ? (parts[2] as TabMode)
      : undefined;
    return {
      slug,
      route: {
        kind: "note",
        targetId: parts[1],
        ...(mode ? { mode } : {}),
      },
    };
  }
  if (parts[0] === "file" && parts[1]) {
    return {
      slug,
      route: {
        kind: "agent_file",
        targetId: parts[1],
        mode: "agent-file",
      },
    };
  }
  if (parts[0] === "code-workspace" && parts[1]) {
    return {
      slug,
      route: {
        kind: "code_workspace",
        targetId: parts[1],
        mode: "code-workspace",
      },
    };
  }
  if (parts[0] === "project" && parts[1] && parts[2] === "note" && parts[3]) {
    return { slug, route: { kind: "note", targetId: parts[3] } };
  }
  if (parts[0] === "project" && parts[1]) {
    return {
      slug,
      route: {
        kind: "project",
        targetId: parts[1],
        ...(parts[2] === "graph" ? { mode: "graph" as const } : {}),
      },
    };
  }
  if (parts[0] === "research" && parts.length === 1) {
    return { slug, route: { kind: "research_hub", targetId: null } };
  }
  if (parts[0] === "research" && parts[1]) {
    return { slug, route: { kind: "research_run", targetId: parts[1] } };
  }
  if (parts[0] === "import" && parts.length === 1) {
    return { slug, route: { kind: "dashboard", targetId: null } };
  }
  if (parts[0] === "help" && parts.length === 1) {
    return { slug, route: { kind: "help", targetId: null } };
  }
  if (parts[0] === "report" && parts.length === 1) {
    return { slug, route: { kind: "report", targetId: null } };
  }
  if (parts[0] === "settings") {
    return {
      slug,
      route: { kind: "ws_settings", targetId: parts[1] ?? null },
    };
  }

  return null;
}
