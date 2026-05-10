import { HelpView } from "@/components/views/help/help-view";

export default async function WorkspaceHelpPage({
  params,
}: {
  params: Promise<{ wsSlug: string }>;
}) {
  const { wsSlug } = await params;
  return <HelpView wsSlug={wsSlug} />;
}
