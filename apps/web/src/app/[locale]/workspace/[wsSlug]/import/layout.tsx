import { ShellProviders } from "@/components/shell/shell-providers";
import { getShellLabels } from "@/components/shell/get-shell-labels";
import {
  isDeepResearchEnabled,
  isSynthesisExportEnabled,
} from "@/lib/feature-flags";

export default async function ImportLayout({
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
