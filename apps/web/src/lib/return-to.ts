// Whitelist of relative paths safe to redirect to after auth flows.
// Strips locale prefix so callers can pass either /ko/workspace or /workspace.
const ALLOW_PREFIXES = ["/dashboard", "/workspace", "/settings", "/onboarding"];
const LOCALE_PREFIX = /^\/(ko|en)(?=\/|$)/;

export function isSafeReturnTo(path: string | null | undefined): boolean {
  if (!path || typeof path !== "string") return false;
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  const stripped = path.replace(LOCALE_PREFIX, "") || "/";
  return ALLOW_PREFIXES.some(
    (prefix) =>
      stripped === prefix ||
      stripped.startsWith(`${prefix}/`) ||
      stripped.startsWith(`${prefix}?`),
  );
}
