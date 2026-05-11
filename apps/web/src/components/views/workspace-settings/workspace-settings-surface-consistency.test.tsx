import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { IntegrationsTab } from "./integrations-tab";
import { InvitesTab } from "./invites-tab";
import { MembersTab } from "./members-tab";
import { SharedLinksTab } from "./shared-links-tab";
import { TrashTab } from "./trash-tab";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (key: string) => (ns ? `${ns}.${key}` : key),
}));

vi.mock("@/lib/api-client", () => {
  const apiClient = vi.fn(async (path: string) => {
    if (path.startsWith("/notes/trash")) {
      return {
        notes: [
          {
            id: "note-1",
            title: "Deleted note",
            projectName: "Research",
            deletedAt: "2026-05-10T00:00:00Z",
            expiresAt: "2026-06-09T00:00:00Z",
          },
        ],
      };
    }
    return {};
  });

  return {
    apiClient,
    wsSettingsApi: {
      members: vi.fn(async () => [
        {
          userId: "user-1",
          name: "Alice",
          email: "alice@example.com",
          role: "member",
        },
      ]),
      patchMemberRole: vi.fn(async () => undefined),
      removeMember: vi.fn(async () => undefined),
      invites: vi.fn(async () => [
        {
          id: "invite-1",
          email: "new@example.com",
          role: "member",
          acceptedAt: null,
          expiresAt: "2999-01-01T00:00:00Z",
        },
      ]),
      createInvite: vi.fn(async () => undefined),
      cancelInvite: vi.fn(async () => undefined),
      sharedLinks: vi.fn(async () => ({
        links: [
          {
            id: "link-1",
            role: "viewer",
            noteTitle: "Shared note",
            createdAt: "2026-05-10T00:00:00Z",
            createdBy: { id: "user-1", name: "Alice" },
          },
        ],
      })),
    },
    shareApi: {
      revoke: vi.fn(async () => undefined),
    },
    integrationsApi: {
      google: vi.fn(async () => ({
        connected: true,
        accountEmail: "drive@example.com",
      })),
      disconnectGoogle: vi.fn(async () => undefined),
    },
  };
});

function renderWithQueryClient(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function expectAppShellControl(element: HTMLElement) {
  expect(element).toHaveClass("rounded-[var(--radius-control)]");
  expect(element).not.toHaveClass("rounded");
  expect(element.className).not.toContain("hover:bg-accent");
}

describe("workspace settings child surfaces", () => {
  it("renders trash controls with app shell tokens", async () => {
    renderWithQueryClient(<TrashTab wsId="ws-1" />);

    const list = await screen.findByRole("list");
    expect(list).toHaveClass("rounded-[var(--radius-card)]");
    expect(list).not.toHaveClass("rounded");

    expectAppShellControl(
      screen.getByRole("button", {
        name: "workspaceSettings.trash.restore",
      }),
    );
    expectAppShellControl(
      screen.getByRole("button", {
        name: "workspaceSettings.trash.deleteForever",
      }),
    );
  });

  it("renders member role and remove controls with app shell tokens", async () => {
    renderWithQueryClient(<MembersTab wsId="ws-1" />);

    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expectAppShellControl(
      screen.getByRole("combobox", {
        name: "workspaceSettings.members.rolePlaceholder",
      }),
    );
    expectAppShellControl(
      screen.getByRole("button", {
        name: "workspaceSettings.members.remove",
      }),
    );
  });

  it("renders invite form and row controls with app shell tokens", async () => {
    renderWithQueryClient(<InvitesTab wsId="ws-1" />);

    expect(await screen.findByText("new@example.com")).toBeInTheDocument();
    expectAppShellControl(
      screen.getByRole("textbox", {
        name: "workspaceSettings.invites.newEmailLabel",
      }),
    );
    expectAppShellControl(
      screen.getByRole("button", {
        name: "workspaceSettings.invites.send",
      }),
    );
    expectAppShellControl(
      screen.getByRole("button", {
        name: "workspaceSettings.invites.cancel",
      }),
    );
  });

  it("renders shared-link revoke control with app shell tokens", async () => {
    renderWithQueryClient(<SharedLinksTab wsId="ws-1" />);

    expect(await screen.findByText("Shared note")).toBeInTheDocument();
    expectAppShellControl(
      screen.getByRole("button", {
        name: "workspaceSettings.sharedLinks.revoke",
      }),
    );
  });

  it("renders integration card and action with app shell tokens", async () => {
    renderWithQueryClient(<IntegrationsTab wsId="ws-1" />);

    const action = await screen.findByRole("button", {
      name: "workspaceSettings.integrations.google.disconnect",
    });
    expectAppShellControl(action);
    await waitFor(() => {
      expect(screen.getByText("workspaceSettings.integrations.google.name")).toBeInTheDocument();
    });
    expect(action.closest("div")).toHaveClass("rounded-[var(--radius-card)]");
  });
});
