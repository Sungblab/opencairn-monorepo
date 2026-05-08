"use client";
import { useTabsStore, type Tab } from "@/stores/tabs-store";

export function openIngestTab(wfid: string, fileName: string | null) {
  const tab: Tab = {
    id: `ingest-${wfid}`,
    kind: "ingest",
    targetId: wfid,
    mode: "ingest",
    title: fileName ?? "...",
    titleKey: "ingest.tab.title",
    titleParams: { fileName: fileName ?? "?" },
    pinned: false,
    preview: false,
    dirty: false,
    splitWith: null,
    splitSide: null,
    scrollY: 0,
  };
  const store = useTabsStore.getState();
  if (!store.tabs.some((t) => t.id === tab.id)) store.addTab(tab);
  store.setActive(tab.id);
}
