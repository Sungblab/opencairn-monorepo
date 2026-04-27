"use client";

// Plan 11A foundation entry point — project-scope chat. URL:
//   /app/w/<wsSlug>/p/<projectId>/chat-scope
//
// Same pattern as the workspace-scope route: standalone ChatPanel rendered
// in the (shell) layout's centre column. useScopeContext picks up the
// projectId from the URL and seeds the auto-attached project chip.

import { ChatPanel } from "@/components/chat-scope/ChatPanel";

export default function ProjectChatScopePage() {
  return (
    <main className="h-full">
      <ChatPanel />
    </main>
  );
}
