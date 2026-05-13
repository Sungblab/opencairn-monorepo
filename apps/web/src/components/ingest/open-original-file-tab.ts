"use client";

import { pushWorkspaceTabUrl } from "@/lib/client-tab-url";
import { newTab } from "@/lib/tab-factory";
import { useTabsStore } from "@/stores/tabs-store";

function syncAgentFileUrl(fileId: string) {
  pushWorkspaceTabUrl({
    kind: "agent_file",
    targetId: fileId,
    mode: "agent-file",
  });
}

export function openOriginalFileTab(fileId: string, fileName: string | null) {
  const tabs = useTabsStore.getState();
  const existing = tabs.findTabByTarget("agent_file", fileId);
  if (existing) {
    tabs.setActive(existing.id);
    syncAgentFileUrl(fileId);
    return;
  }

  tabs.addTab(
    newTab({
      kind: "agent_file",
      targetId: fileId,
      title: fileName ?? "Uploaded file",
      mode: "agent-file",
      preview: false,
    }),
  );
  syncAgentFileUrl(fileId);
}
