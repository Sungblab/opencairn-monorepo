"use client";

import dynamic from "next/dynamic";

type JobProgressLoaderProps = {
  wsSlug: string;
  jobId: string;
};

const LazyJobProgress = dynamic<JobProgressLoaderProps>(
  () => import("./JobProgress").then((mod) => mod.JobProgress),
  {
    ssr: false,
    loading: () => <JobProgressSkeleton />,
  },
);

export function JobProgressLoader(props: JobProgressLoaderProps) {
  return <LazyJobProgress {...props} />;
}

function JobProgressSkeleton() {
  return (
    <div aria-hidden className="mt-6 space-y-4">
      <div className="h-2 w-full animate-pulse rounded bg-muted" />
      <div className="h-4 w-40 animate-pulse rounded-[var(--radius-control)] bg-muted/70" />
      <div className="h-9 w-20 animate-pulse rounded-[var(--radius-control)] bg-muted/60" />
    </div>
  );
}
