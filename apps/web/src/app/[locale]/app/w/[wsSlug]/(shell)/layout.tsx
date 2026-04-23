import { ShellProviders } from "@/components/shell/shell-providers";

// (shell) route group: any page rendered through this layout gets the
// 3-panel AppShell. Existing routes outside the group (p/[projectId]/*,
// import/*) keep their bespoke layouts so Phase 1 doesn't accidentally
// double-render sidebars on routes Phase 2 will properly migrate later.
//
// Session + React Query setup happens in the outer [locale]/app/layout.tsx;
// this layer only wires the shell providers.
export default async function ShellLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ wsSlug: string }>;
}) {
  const { wsSlug } = await params;
  return <ShellProviders wsSlug={wsSlug}>{children}</ShellProviders>;
}
