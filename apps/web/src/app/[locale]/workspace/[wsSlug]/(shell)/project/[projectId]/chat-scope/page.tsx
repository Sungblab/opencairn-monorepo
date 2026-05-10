// Plan 11A foundation entry point — project-scope chat. URL:
//   /workspace/<wsSlug>/project/<projectId>/chat-scope
//
// Same pattern as the workspace-scope route: standalone ChatPanel rendered
// in the (shell) layout's centre column. useScopeContext picks up the
// projectId from the URL and seeds the auto-attached project chip.

import { ChatPanelLoader } from "@/components/chat-scope/ChatPanelLoader";

export default function ProjectChatScopePage() {
  return (
    <main className="h-full">
      <ChatPanelLoader />
    </main>
  );
}
