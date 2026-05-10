"use client";

import dynamic from "next/dynamic";

const LazyReportIssueView = dynamic(
  () => import("./report-issue-view").then((mod) => mod.ReportIssueView),
  {
    ssr: false,
    loading: () => <ReportIssueViewSkeleton />,
  },
);

export function ReportIssueViewLoader() {
  return <LazyReportIssueView />;
}

function ReportIssueViewSkeleton() {
  return (
    <div
      aria-hidden
      className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-7 lg:px-8"
    >
      <header className="border-b border-border pb-5">
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-8 w-56 animate-pulse rounded-[var(--radius-control)] bg-muted/70" />
        <div className="mt-3 h-4 w-full max-w-md animate-pulse rounded-[var(--radius-control)] bg-muted/50" />
      </header>
      <section className="rounded-[var(--radius-card)] border border-border bg-background">
        <div className="border-b border-border bg-muted/40 px-4 py-3">
          <div className="h-5 w-40 animate-pulse rounded-[var(--radius-control)] bg-muted" />
        </div>
        <div className="grid gap-4 p-4">
          <div className="h-10 animate-pulse rounded-[var(--radius-control)] bg-muted/60" />
          <div className="h-32 animate-pulse rounded-[var(--radius-control)] bg-muted/50" />
        </div>
      </section>
    </div>
  );
}
