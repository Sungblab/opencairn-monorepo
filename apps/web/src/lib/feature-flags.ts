// Mirrors apps/api/src/routes/research.ts:37-46 — case-insensitive 'true'
// only. These are read on the SERVER (route page or layout). Don't import
// from a "use client" component; thread the result down via props instead.

export function isDeepResearchEnabled(): boolean {
  return (
    (process.env.FEATURE_DEEP_RESEARCH ?? "false").toLowerCase() === "true"
  );
}

export function isManagedDeepResearchEnabled(): boolean {
  return (
    (process.env.FEATURE_MANAGED_DEEP_RESEARCH ?? "false").toLowerCase() ===
    "true"
  );
}
