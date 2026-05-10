export function defaultScopeIds(activeKind: string | undefined): string[] {
  switch (activeKind) {
    case "note":
      return ["page", "project"];
    case "project":
      return ["project"];
    case "research_run":
      return ["research"];
    default:
      return ["workspace"];
  }
}
