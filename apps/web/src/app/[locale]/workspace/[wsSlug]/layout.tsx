import { requireSession } from "@/lib/session";

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSession();
  return <div className="flex min-h-screen min-w-0 flex-col lg:flex-row">{children}</div>;
}
