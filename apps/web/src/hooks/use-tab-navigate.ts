"use client";
import { useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { tabToUrl, type TabRoute } from "@/lib/tab-url";

// Narrow companion to useUrlTabSync: returns ONLY the navigator and skips
// the URL ↔ store reconciliation effect. Used inside TabBar children where
// a second reconciliation would re-parse the current URL and inject an
// unrelated tab (e.g., a dashboard tab while a user is on a note URL).
// useUrlTabSync stays mounted once at ShellProviders level.
export function useTabNavigate() {
  const router = useRouter();
  const locale = useLocale();
  const params = useParams<{ wsSlug?: string }>();
  const slug = params?.wsSlug ?? "";

  return useCallback(
    (
      route: TabRoute,
      opts: { mode: "push" | "replace" } = { mode: "push" },
    ) => {
      if (!slug) return;
      const url = tabToUrl(slug, route, locale);
      if (opts.mode === "replace") router.replace(url);
      else router.push(url);
    },
    [router, slug, locale],
  );
}
