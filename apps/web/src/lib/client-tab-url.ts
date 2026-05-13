"use client";

import { tabToUrl, type TabRoute } from "@/lib/tab-url";
import { parseWorkspacePath } from "@/lib/url-parsers";

export function pushWorkspaceTabUrl(route: TabRoute) {
  if (typeof window === "undefined") return;
  const parsed = parseWorkspacePath(window.location.pathname);
  if (!parsed.wsSlug) return;
  const next = tabToUrl(parsed.wsSlug, route, parsed.locale ?? "ko");
  if (window.location.pathname !== next) {
    window.history.pushState(null, "", next);
  }
}
