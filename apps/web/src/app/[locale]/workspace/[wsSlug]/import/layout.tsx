import { ShellProviders } from "@/components/shell/shell-providers";
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
