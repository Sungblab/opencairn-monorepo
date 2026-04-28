const SLUG_PATTERN = /^[a-z0-9_]{1,32}$/;

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

export function generateSlug(
  displayName: string,
  takenSlugs: ReadonlySet<string>,
): string {
  const base =
    displayName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32)
      .replace(/_+$/g, "") || "mcp";

  if (!takenSlugs.has(base)) return base;

  for (let i = 2; i < 10_000; i += 1) {
    const suffix = `_${i}`;
    const candidate = `${base.slice(0, 32 - suffix.length)}${suffix}`;
    if (!takenSlugs.has(candidate)) return candidate;
  }

  throw new Error("Unable to allocate MCP server slug");
}
