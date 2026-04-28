function enabledByDefault(name: string): boolean {
  return (process.env[name] ?? "true").toLowerCase() === "true";
}

function disabledByDefault(name: string): boolean {
  return (process.env[name] ?? "false").toLowerCase() === "true";
}

export function isDeepResearchEnabled(): boolean {
  return enabledByDefault("FEATURE_DEEP_RESEARCH");
}

export function isManagedDeepResearchEnabled(): boolean {
  return disabledByDefault("FEATURE_MANAGED_DEEP_RESEARCH");
}
