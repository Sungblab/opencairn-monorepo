"use client";

import { newTab } from "@/lib/tab-factory";
import { useTabsStore } from "@/stores/tabs-store";

export function openOriginalFileTab(fileId: string, fileName: string | null) {
  const tabs = useTabsStore.getState();
  const existing = tabs.findTabByTarget("agent_file", fileId);
  if (existing) {
    tabs.setActive(existing.id);
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
}
