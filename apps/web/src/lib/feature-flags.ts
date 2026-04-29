// Server-only feature flags. Don't import from a "use client" component;
// thread the result down via props instead.

export function isDeepResearchEnabled(): boolean {
  return (
    (process.env.FEATURE_DEEP_RESEARCH ?? "true").toLowerCase() === "true"
  );
}

export function isManagedDeepResearchEnabled(): boolean {
  return (
    (process.env.FEATURE_MANAGED_DEEP_RESEARCH ?? "false").toLowerCase() ===
    "true"
  );
}

export function isImportEnabled(): boolean {
  return (process.env.FEATURE_IMPORT_ENABLED ?? "true").toLowerCase() === "true";
}

export function isSynthesisExportEnabled(): boolean {
  return (
    (process.env.FEATURE_SYNTHESIS_EXPORT ?? "false").toLowerCase() === "true"
  );
}

export function isTectonicCompileEnabled(): boolean {
  return (
    (process.env.FEATURE_TECTONIC_COMPILE ?? "false").toLowerCase() === "true"
  );
}
