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

describe("WorkspaceSettingsView", () => {
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

    expect(active.className).toContain("bg-foreground");
    expect(active.className).toContain("text-background");
    expect(inactive.className).toContain("hover:bg-muted");
    expect(inactive.className).not.toContain("hover:bg-accent");
  });
});
