import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceSettingsView } from "./workspace-settings-view";

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}));

vi.mock("./members-tab", () => ({ MembersTab: () => <div>members</div> }));
vi.mock("./invites-tab", () => ({ InvitesTab: () => <div>invites</div> }));
vi.mock("./integrations-tab", () => ({
  IntegrationsTab: () => <div>integrations</div>,
}));
vi.mock("./shared-links-tab", () => ({
  SharedLinksTab: () => <div>shared links</div>,
}));
vi.mock("./trash-tab", () => ({ TrashTab: () => <div>trash</div> }));
vi.mock("../account/profile-view", () => ({ ProfileView: () => <div>profile</div> }));
vi.mock("../account/security-view", () => ({ SecurityView: () => <div>security</div> }));
vi.mock("../account/providers-view", () => ({ ProvidersView: () => <div>providers</div> }));
vi.mock("../account/notifications-view", () => ({
  NotificationsView: () => <div>notifications</div>,
}));
vi.mock("../account/billing-view", () => ({ BillingView: () => <div>billing</div> }));
vi.mock("../account/appearance-view", () => ({
  AppearanceView: () => <div>appearance</div>,
}));
vi.mock("../account/language-region-view", () => ({
  LanguageRegionView: () => <div>language region</div>,
}));
vi.mock("@/components/settings/mcp/McpSettingsClientLoader", () => ({
  McpSettingsClientLoader: () => <div>mcp</div>,
}));

describe("WorkspaceSettingsView", () => {
  it("uses one settings shell for personal, AI, workspace, and billing sections", () => {
    render(<WorkspaceSettingsView wsSlug="acme" wsId="ws-1" path={[]} />);

    expect(screen.getByText("workspaceSettings.groups.personal")).toBeInTheDocument();
    expect(screen.getByText("workspaceSettings.groups.aiTools")).toBeInTheDocument();
    expect(screen.getByText("workspaceSettings.groups.workspace")).toBeInTheDocument();
    expect(screen.getByText("workspaceSettings.groups.billing")).toBeInTheDocument();
    expect(screen.getByText("profile")).toBeInTheDocument();

    expect(
      screen.getByRole("link", { name: "account.tabs.profile" }),
    ).toHaveAttribute("href", "/ko/workspace/acme/settings/personal/profile");
    expect(
      screen.getByRole("link", { name: "account.tabs.notifications" }),
    ).toHaveAttribute("href", "/ko/workspace/acme/settings/personal/notifications");
    expect(
      screen.getByRole("link", { name: "workspaceSettings.tabs.members" }),
    ).toHaveAttribute("href", "/ko/workspace/acme/settings/workspace/members");
  });

  it("renders appearance and language as first-class personal settings", () => {
    const { rerender } = render(
      <WorkspaceSettingsView
        wsSlug="acme"
        wsId="ws-1"
        path={["personal", "appearance"]}
      />,
    );

    expect(screen.getByText("appearance")).toBeInTheDocument();

    rerender(
      <WorkspaceSettingsView
        wsSlug="acme"
        wsId="ws-1"
        path={["personal", "language"]}
      />,
    );

    expect(screen.getByText("language region")).toBeInTheDocument();
  });

  it("keeps active and hover tabs readable", () => {
    render(
      <WorkspaceSettingsView wsSlug="acme" wsId="ws-1" sub="members" />,
    );

    const active = screen.getByRole("link", {
      name: "workspaceSettings.tabs.members",
    });
    const inactive = screen.getByRole("link", {
      name: "workspaceSettings.tabs.invites",
    });

    expect(active.className).toContain("bg-muted");
    expect(active.className).toContain("text-foreground");
    expect(inactive.className).toContain("hover:bg-muted");
    expect(inactive.className).not.toContain("hover:bg-accent");
  });
});
