import { requireSession } from "@/lib/session";
import { IntlClientProvider } from "@/components/providers/intl-client-provider";

export default async function CanvasLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side gate: any /canvas/* route requires a Better Auth session.
  // Plan 7 Phase 1's only canvas route is /canvas/demo (debug playground).
  // Future Phase 2+ canvas routes (e.g., /canvas/templates) inherit the gate.
  await requireSession();
  return (
    <IntlClientProvider namespaces={["canvas"]}>{children}</IntlClientProvider>
  );
}
