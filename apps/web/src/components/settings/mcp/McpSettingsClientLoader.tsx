"use client";

import dynamic from "next/dynamic";

type McpSettingsClientLoaderProps = {
  mcpClientEnabled?: boolean;
  mcpServerEnabled?: boolean;
  withProviders?: boolean;
};

const LazyMcpSettingsClient = dynamic<McpSettingsClientLoaderProps>(
  () => import("./McpSettingsClient").then((mod) => mod.McpSettingsClient),
  {
    ssr: false,
    loading: () => <McpSettingsSkeleton />,
  },
);

const LazyMcpSettingsClientRuntime = dynamic<McpSettingsClientLoaderProps>(
  () =>
    import("./McpSettingsClientRuntime").then(
      (mod) => mod.McpSettingsClientRuntime,
    ),
  {
    ssr: false,
    loading: () => <McpSettingsSkeleton />,
  },
);

export function McpSettingsClientLoader(
  { withProviders = false, ...props }: McpSettingsClientLoaderProps,
) {
  return withProviders ? (
    <LazyMcpSettingsClientRuntime {...props} />
  ) : (
    <LazyMcpSettingsClient {...props} />
  );
}

function McpSettingsSkeleton() {
  return (
    <section aria-hidden className="space-y-6">
      <div className="space-y-4 rounded-[var(--radius-card)] border border-border p-5">
        <div className="h-9 w-36 animate-pulse rounded-[var(--radius-control)] bg-muted" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="h-12 animate-pulse rounded-[var(--radius-control)] bg-muted/60"
            />
          ))}
        </div>
      </div>
      <div className="space-y-3 rounded-[var(--radius-card)] border border-border p-5">
        <div className="h-5 w-44 animate-pulse rounded-[var(--radius-control)] bg-muted" />
        <div className="h-10 max-w-sm animate-pulse rounded-[var(--radius-control)] bg-muted/70" />
        <div className="h-28 animate-pulse rounded-[var(--radius-control)] bg-muted/50" />
      </div>
    </section>
  );
}
