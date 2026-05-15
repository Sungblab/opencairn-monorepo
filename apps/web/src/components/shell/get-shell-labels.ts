import { getTranslations } from "next-intl/server";
import type { ShellLabels } from "./shell-labels";

export async function getShellLabels(): Promise<ShellLabels> {
  const placeholders = await getTranslations("appShell.placeholders");
  const tabBar = await getTranslations("appShell.tabs.bar");
  const tabItem = await getTranslations("appShell.tabs.item");
  const tabTitles = await getTranslations("appShell.tabTitles");

  return {
    placeholders: {
      sidebar: placeholders("sidebar"),
      agentPanel: placeholders("agent_panel"),
      openSidebar: placeholders("open_sidebar"),
      openAgentPanel: placeholders("open_agent_panel"),
    },
    tabs: {
      bar: {
        newTab: tabBar("newTab"),
        newTabTitle: tabBar("newTabTitle"),
        overflowTrigger: tabBar("overflowTrigger"),
      },
      item: {
        close: tabItem("close"),
        pinned: tabItem("pinned"),
        unsaved: tabItem("unsaved"),
        splitPrimary: tabItem("splitPrimary"),
        splitSecondary: tabItem("splitSecondary"),
      },
      titles: {
        dashboard: tabTitles("dashboard"),
        atlas: tabTitles("atlas"),
        graph: tabTitles("graph"),
        note: tabTitles("note"),
        project: tabTitles("project"),
        research_hub: tabTitles("research_hub"),
        research_run: tabTitles("research_run", { id: "{id}" }),
        import: tabTitles("import"),
        help: tabTitles("help"),
        report: tabTitles("report"),
        ws_settings: tabTitles("ws_settings"),
        agent_panel: tabTitles("agent_panel"),
      },
    },
  };
}
