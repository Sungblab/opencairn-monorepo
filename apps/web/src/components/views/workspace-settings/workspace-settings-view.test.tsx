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
  it("uses one settings shell with grouped scroll pages", () => {
    render(<WorkspaceSettingsView wsSlug="acme" wsId="ws-1" path={[]} />);

    expect(
      screen.getByRole("link", { name: "workspaceSettings.groups.personal" }),
    ).toHaveAttribute("href", "/ko/workspace/acme/settings/personal");
    expect(
      screen.getByRole("link", { name: "workspaceSettings.groups.aiTools" }),
    ).toHaveAttribute("href", "/ko/workspace/acme/settings/ai");
    expect(
      screen.getByRole("link", { name: "workspaceSettings.groups.workspace" }),
    ).toHaveAttribute("href", "/ko/workspace/acme/settings/workspace");
    expect(
      screen.getByRole("link", { name: "workspaceSettings.groups.billing" }),
    ).toHaveAttribute("href", "/ko/workspace/acme/settings/billing");

    expect(screen.getByText("profile")).toBeInTheDocument();
    expect(screen.getByText("appearance")).toBeInTheDocument();
    expect(screen.getByText("language region")).toBeInTheDocument();
    expect(screen.getByText("notifications")).toBeInTheDocument();
    expect(screen.getByText("security")).toBeInTheDocument();
    expect(
      screen.getByText("workspaceSettings.overview.personal.description"),
    ).toBeInTheDocument();
  });

  it("keeps legacy personal section paths on the personal scroll page", () => {
    const { rerender } = render(
      <WorkspaceSettingsView
        wsSlug="acme"
        wsId="ws-1"
        path={["personal", "appearance"]}
      />,
    );

    expect(screen.getByText("appearance")).toBeInTheDocument();
    expect(screen.getByText("profile")).toBeInTheDocument();

    rerender(
      <WorkspaceSettingsView
        wsSlug="acme"
        wsId="ws-1"
        path={["personal", "language"]}
      />,
    );

    expect(screen.getByText("language region")).toBeInTheDocument();
    expect(screen.getByText("security")).toBeInTheDocument();
  });

  it("renders AI tools together on one scroll page", () => {
    render(
      <WorkspaceSettingsView wsSlug="acme" wsId="ws-1" path={["ai", "mcp"]} />,
    );

    expect(screen.getByText("providers")).toBeInTheDocument();
    expect(screen.getByText("mcp")).toBeInTheDocument();
    expect(
      screen.getByText("workspaceSettings.overview.aiTools.card1Title"),
    ).toBeInTheDocument();
  });

  it("keeps active and hover group links readable", () => {
    render(
      <WorkspaceSettingsView wsSlug="acme" wsId="ws-1" sub="members" />,
    );

    const active = screen.getByRole("link", {
      name: "workspaceSettings.groups.workspace",
    });
    const inactive = screen.getByRole("link", {
      name: "workspaceSettings.groups.personal",
    });

    expect(active.className).toContain("bg-foreground");
    expect(active.className).toContain("text-background");
    expect(inactive.className).toContain("hover:bg-muted");
    expect(inactive.className).not.toContain("hover:bg-accent");
  });
});
