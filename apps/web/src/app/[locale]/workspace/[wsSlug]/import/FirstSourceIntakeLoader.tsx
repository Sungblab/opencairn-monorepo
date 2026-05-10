"use client";

import dynamic from "next/dynamic";

type FirstSourceMode = "file" | "link" | "text";

type FirstSourceIntakeLoaderProps = {
  wsSlug: string;
  initialMode?: FirstSourceMode;
  showModeTabs?: boolean;
};

const LazyFirstSourceIntake = dynamic<FirstSourceIntakeLoaderProps>(
  () =>
    import("@/components/import/first-source-intake").then(
      (mod) => mod.FirstSourceIntake,
    ),
  {
    ssr: false,
    loading: () => <ImportPanelSkeleton />,
  },
);

export function FirstSourceIntakeLoader(props: FirstSourceIntakeLoaderProps) {
  return <LazyFirstSourceIntake {...props} />;
}

function ImportPanelSkeleton() {
  return (
    <div
      aria-hidden
      className="space-y-4 rounded-[var(--radius-card)] border border-border p-5"
    >
      <div className="h-5 w-44 animate-pulse rounded-[var(--radius-control)] bg-muted" />
      <div className="h-10 animate-pulse rounded-[var(--radius-control)] bg-muted/70" />
      <div className="h-28 animate-pulse rounded-[var(--radius-control)] bg-muted/50" />
    </div>
  );
}
