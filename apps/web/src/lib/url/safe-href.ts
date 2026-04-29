// Allowlist for `<a href>` URLs that can come from untrusted producers
// (LLM output, RAG hits over imported documents, federated literature
// metadata, research-agent scrapes, comment text, etc.). React 19 does not
// block `javascript:` URLs in href — it logs a console warning and lets the
// click execute the URI in the page origin. So every site that renders an
// untrusted URL must run it through this allowlist.
//
// Allowed: `http:`, `https:`, `mailto:`, plus relative URLs (`/`, `#`, `?`,
// schemeless paths) which the browser resolves against the current page.
// Anything else (including `javascript:`, `data:`, `vbscript:`, `file:`)
// collapses to `"#"`.
//
// Originally lived inline in `components/share/plate-static-renderer.tsx`;
// promoted here so the editor block, agent-panel citation chips, literature
// search viewer, and any other consumer share one defanging implementation.

export function safeHref(raw: unknown): string {
  if (typeof raw !== "string") return "#";
  const trimmed = raw.trim();
  if (trimmed === "") return "#";
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("?")
  ) {
    return trimmed;
  }
  try {
    const u = new URL(trimmed, "https://share.local/");
    if (
      u.protocol === "http:" ||
      u.protocol === "https:" ||
      u.protocol === "mailto:"
    ) {
      return trimmed;
    }
    return "#";
  } catch {
    return "#";
  }
}
