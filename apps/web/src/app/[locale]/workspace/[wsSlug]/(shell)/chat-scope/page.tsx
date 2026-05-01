"use client";

// Plan 11A foundation entry point — workspace-scope chat. URL:
//   /workspace/<wsSlug>/chat-scope
//
// Lives under the (shell) group so the standard 3-panel layout still
// renders. This page only owns the centre column; the agent panel on the
// right keeps its existing Phase 4 chat (separate system, separate
// table). Plan 11B will collapse the two surfaces.

import { ChatPanel } from "@/components/chat-scope/ChatPanel";

export default function WorkspaceChatScopePage() {
  return (
    <main className="h-full">
      <ChatPanel />
    </main>
  );
}
