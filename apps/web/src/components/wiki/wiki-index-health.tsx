import type {
  ProjectWikiIndex,
  ProjectWikiIndexHealthIssueKind,
  ProjectWikiIndexHealthStatus,
} from "@/lib/api-client";

const LIBRARIAN_REPAIR_ISSUES = new Set<ProjectWikiIndexHealthIssueKind>([
  "duplicate_titles",
  "unresolved_missing",
  "unresolved_ambiguous",
  "orphan_pages",
]);

export function hasLibrarianRepairIssue(
  index: ProjectWikiIndex | undefined,
): boolean {
  return Boolean(
    index?.health.issues.some((issue) =>
      LIBRARIAN_REPAIR_ISSUES.has(issue.kind),
    ),
  );
}

export function formatWikiHealthIssueSummary(
  index: ProjectWikiIndex | undefined,
  format: (kind: ProjectWikiIndexHealthIssueKind, count: number) => string,
): string | null {
  if (!index || index.health.issues.length === 0) return null;
  return index.health.issues
    .slice(0, 2)
    .map((issue) => format(issue.kind, issue.count))
    .join(" · ");
}

export function formatRecentWikiActivitySummary(
  index: ProjectWikiIndex | undefined,
  label: string,
): string | null {
  const log = index?.recentLogs[0];
  if (!log) return null;
  const reason = log.reason?.trim();
  return reason
    ? `${label}: ${log.noteTitle} - ${reason}`
    : `${label}: ${log.noteTitle} ${log.action}`;
}

export function getWikiHealthClassName(
  status: ProjectWikiIndexHealthStatus | null,
): string {
  switch (status) {
    case "blocked":
      return "border-destructive/30 bg-destructive/5 text-destructive";
    case "needs_attention":
      return "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200";
    case "updating":
      return "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-700/60 dark:bg-sky-950/30 dark:text-sky-200";
    case "healthy":
      return "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700/60 dark:bg-emerald-950/30 dark:text-emerald-200";
    default:
      return "border-border bg-background text-muted-foreground";
  }
}

export function WikiIndexHealthBadge({
  testId,
  className,
  label,
  status,
  issueSummary,
  tone,
  refreshLabel,
  refreshingLabel,
  showRefresh,
  refreshPending,
  onRefresh,
  runLibrarianLabel,
  runningLibrarianLabel,
  showRunLibrarian,
  runLibrarianPending,
  onRunLibrarian,
}: {
  testId?: string;
  className: string;
  label: string;
  status: string;
  issueSummary: string | null;
  tone: ProjectWikiIndexHealthStatus | null;
  refreshLabel: string;
  refreshingLabel: string;
  showRefresh: boolean;
  refreshPending: boolean;
  onRefresh: () => void;
  runLibrarianLabel: string;
  runningLibrarianLabel: string;
  showRunLibrarian: boolean;
  runLibrarianPending: boolean;
  onRunLibrarian: () => void;
}) {
  return (
    <div
      data-testid={testId}
      className={`${className} ${getWikiHealthClassName(tone)}`}
    >
      <span className="shrink-0">
        {label} {status}
      </span>
      {issueSummary ? (
        <span className="min-w-0 flex-1 truncate text-current/80">
          {issueSummary}
        </span>
      ) : (
        <span className="flex-1" />
      )}
      {showRefresh ? (
        <button
          type="button"
          disabled={refreshPending}
          onClick={onRefresh}
          className="inline-flex min-h-7 items-center rounded-[var(--radius-control)] border border-current/25 bg-background/70 px-2 py-1 text-[11px] font-medium text-current hover:bg-background disabled:opacity-60"
        >
          {refreshPending ? refreshingLabel : refreshLabel}
        </button>
      ) : null}
      {showRunLibrarian ? (
        <button
          type="button"
          disabled={runLibrarianPending}
          onClick={onRunLibrarian}
          className="inline-flex min-h-7 items-center rounded-[var(--radius-control)] border border-current/25 bg-background/70 px-2 py-1 text-[11px] font-medium text-current hover:bg-background disabled:opacity-60"
        >
          {runLibrarianPending ? runningLibrarianLabel : runLibrarianLabel}
        </button>
      ) : null}
    </div>
  );
}
