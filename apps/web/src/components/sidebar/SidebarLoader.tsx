"use client";

import dynamic from "next/dynamic";

type SidebarLoaderProps = {
  workspaceSlug: string;
  projectId: string;
  projectName: string;
};

const LazySidebar = dynamic<SidebarLoaderProps>(
  () => import("./Sidebar").then((mod) => mod.Sidebar),
  {
    ssr: false,
    loading: () => <SidebarSkeleton />,
  },
);

export function SidebarLoader(props: SidebarLoaderProps) {
  return <LazySidebar {...props} />;
}

function SidebarSkeleton() {
  return (
    <aside
      aria-hidden
      className="flex max-h-[42vh] w-full shrink-0 flex-col border-b border-border bg-card lg:max-h-none lg:w-64 lg:border-b-0 lg:border-r"
    >
      <header className="border-b border-border p-4">
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-4 w-36 animate-pulse rounded bg-muted/70" />
      </header>
      <div className="space-y-1 p-2">
        <div className="h-8 animate-pulse rounded-[var(--radius-control)] bg-muted/70" />
        <div className="h-8 animate-pulse rounded-[var(--radius-control)] bg-muted/60" />
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {Array.from({ length: 7 }).map((_, index) => (
          <div
            key={index}
            className="h-7 animate-pulse rounded-[var(--radius-control)] bg-muted/50"
          />
        ))}
      </div>
    </aside>
  );
}
