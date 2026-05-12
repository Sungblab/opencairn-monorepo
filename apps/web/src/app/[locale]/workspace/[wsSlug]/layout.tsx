import { requireSession } from "@/lib/session";
import { LocaleAppProviders } from "@/components/providers/locale-app-providers";
import { IntlClientProvider } from "@/components/providers/intl-client-provider";

const WORKSPACE_CLIENT_MESSAGE_NAMESPACES = [
  "common",
  "dashboard",
  "sidebar",
  "app",
  "editor",
  "collab",
  "import",
  "appShell",
  "agentPanel",
  "research",
  "graph",
  "learn",
  "literature",
  "canvas",
  "note",
  "project",
  "projectTemplates",
  "workspaceSettings",
  "account",
  "palette",
  "notifications",
  "chat",
  "chatScope",
  "shareDialog",
  "ingest",
  "docEditor",
  "agents",
  "synthesisExport",
  "accountNotifications",
  "noteHistory",
  "agentFiles",
  "codeWorkspaces",
  "admin",
  "help",
] as const;

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSession();
  return (
    <IntlClientProvider namespaces={WORKSPACE_CLIENT_MESSAGE_NAMESPACES}>
      <LocaleAppProviders>
        <div className="flex min-h-screen min-w-0 flex-col lg:flex-row">
          {children}
        </div>
      </LocaleAppProviders>
    </IntlClientProvider>
  );
}
