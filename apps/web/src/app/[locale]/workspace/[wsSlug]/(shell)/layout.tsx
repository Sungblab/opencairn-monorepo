import { ShellProviders } from "@/components/shell/shell-providers";
import {
  isDeepResearchEnabled,
  isSynthesisExportEnabled,
} from "@/lib/feature-flags";

// (shell) route group: any page rendered through this layout gets the
// 3-panel AppShell. Existing routes outside the group (p/[projectId]/*,
// import/*) keep their bespoke layouts so Phase 1 doesn't accidentally
// double-render sidebars on routes Phase 2 will properly migrate later.
//
// Session guard lives in the outer [locale]/workspace/[wsSlug]/layout.tsx.
// React Query setup happens in [locale]/layout.tsx;
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
  return (
    <ShellProviders
      wsSlug={wsSlug}
      deepResearchEnabled={isDeepResearchEnabled()}
      synthesisExportEnabled={isSynthesisExportEnabled()}
    >
      {children}
    </ShellProviders>
  );
}
