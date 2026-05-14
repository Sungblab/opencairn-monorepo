import { ShellLabelsProvider, type ShellLabels } from "./shell-labels";

export const testShellLabels: ShellLabels = {
  placeholders: {
    sidebar: "sidebar",
    agentPanel: "agent panel",
    openSidebar: "open sidebar",
    openAgentPanel: "open agent panel",
  },
  tabs: {
    bar: {
      newTab: "new tab",
      newTabTitle: "newTabTitle",
      overflowTrigger: "overflow trigger",
    },
    item: {
      close: "close",
      pinned: "pinned",
      unsaved: "unsaved",
      splitPrimary: "splitPrimary",
      splitSecondary: "splitSecondary",
    },
    titles: {
      dashboard: "대시보드",
      graph: "그래프",
      note: "노트",
      project: "프로젝트",
      research_hub: "Deep Research",
      research_run: "Research {id}",
      import: "가져오기",
      help: "도움말",
      report: "문제 신고",
      ws_settings: "설정",
      agent_panel: "에이전트 패널",
    },
  },
};

export function TestShellLabelsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ShellLabelsProvider labels={testShellLabels}>
      {children}
    </ShellLabelsProvider>
  );
}
