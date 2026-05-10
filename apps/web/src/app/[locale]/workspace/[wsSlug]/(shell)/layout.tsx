import { ShellProviders } from "@/components/shell/shell-providers";
import { getShellLabels } from "@/components/shell/get-shell-labels";
import {
  isDeepResearchEnabled,
  isSynthesisExportEnabled,
} from "@/lib/feature-flags";

// (shell) route group: any page rendered through this layout gets the
// 3-panel AppShell. Existing routes outside the group (p/[projectId]/*,
// import/*) keep their bespoke layouts so Phase 1 doesn't accidentally
// double-render sidebars on routes Phase 2 will properly migrate later.
//
// Session guard and app-only client providers live in the outer
// [locale]/workspace/[wsSlug]/layout.tsx;
// this layer only wires the shell providers. Server-resolved feature flags
// (Deep Research, Synthesis Export) are read here and threaded down so
// client components stay `process.env`-free.
export default async function ShellLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ wsSlug: string }>;
}) {
  const { wsSlug } = await params;
  const shellLabels = await getShellLabels();
  return (
    <ShellProviders
      wsSlug={wsSlug}
      shellLabels={shellLabels}
      deepResearchEnabled={isDeepResearchEnabled()}
      synthesisExportEnabled={isSynthesisExportEnabled()}
    >
      {children}
    </ShellProviders>
  );
}
