import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SidebarFooter } from "./sidebar-footer";

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ wsSlug: "acme" }),
  useRouter: () => ({ push: vi.fn() }),
}));

// Hoisted mock holder so individual tests can override the session state
// returned by authClient.useSession without re-declaring the vi.mock call.
const sessionMock = vi.hoisted(() => ({
  value: {
    data: {
      user: {
        id: "u1",
        name: "Ada Lovelace",
        email: "ada@example.com",
        image: "https://example.com/avatar.png",
      },
    },
    isPending: false,
  } as unknown,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => sessionMock.value,
  },
}));

// BYOK status drives the plan label. Default to "no key" so the existing
// assertions don't have to reason about the registered branch.
vi.mock("@/lib/api-client-byok-key", () => ({
  byokKeyQueryKey: () => ["byok-key"],
  getByokKey: vi.fn().mockResolvedValue({ registered: false }),
}));

const panelStoreMock = vi.hoisted(() => ({
  openAgentPanelTab: vi.fn(),
}));

let authMeIsSiteAdmin = false;

vi.mock("@/stores/panel-store", () => ({
  usePanelStore: (selector: (s: typeof panelStoreMock) => unknown) =>
    selector(panelStoreMock),
}));

function withQuery(node: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

describe("SidebarFooter", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        isSiteAdmin: authMeIsSiteAdmin,
      }),
    }) as unknown as typeof fetch;
    vi.mocked(global.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/api/auth/me")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ isSiteAdmin: authMeIsSiteAdmin }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          workspaces: [
            { id: "1", slug: "acme", name: "ACME", role: "owner" },
            { id: "2", slug: "beta", name: "Beta", role: "member" },
          ],
          invites: [],
        }),
      } as Response);
    });
    authMeIsSiteAdmin = false;
  });

  it("renders the current workspace instead of the user's name", async () => {
    sessionMock.value = {
      data: {
        user: {
          id: "u1",
          name: "Ada Lovelace",
          email: "ada@x",
          image: "https://example.com/avatar.png",
        },
      },
      isPending: false,
    };
    render(withQuery(<SidebarFooter />));
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
    expect(screen.getByAltText("")).toHaveAttribute(
      "src",
      "https://example.com/avatar.png",
    );
    expect(
      await screen.findByText("ACME"),
    ).toBeInTheDocument();
    expect(screen.getByText("sidebar.footer.plan_free")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "sidebar.footer.settings_aria" }),
    ).not.toBeInTheDocument();
  });

  it("renders nothing while the session is still loading", () => {
    sessionMock.value = { data: null, isPending: true };
    const { container } = render(withQuery(<SidebarFooter />));
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps workspace and account settings inside the bottom profile menu", async () => {
    sessionMock.value = {
      data: { user: { id: "u1", name: "Ada Lovelace", email: "ada@x" } },
      isPending: false,
    };
    const user = userEvent.setup();

    render(withQuery(<SidebarFooter />));

    const profileMenu = screen.getByRole("button", {
      name: "sidebar.footer.profile_menu_aria",
    });
    profileMenu.focus();
    await user.keyboard("{Enter}");

    expect(
      screen.getByRole("menuitem", {
        name: "sidebar.footer.workspace_settings",
      }),
    ).toHaveAttribute("href", "/ko/workspace/acme/settings");
    expect(
      screen.getByRole("menuitem", {
        name: "sidebar.footer.account_settings",
      }),
    ).toHaveAttribute("href", "/ko/settings/profile");
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("sidebar.role.member")).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "sidebar.footer.profile" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "sidebar.footer.settings_aria" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", {
        name: "sidebar.footer.admin_console",
      }),
    ).not.toBeInTheDocument();
  });

  it("links site admins to the admin console from the bottom profile menu", async () => {
    sessionMock.value = {
      data: {
        user: {
          id: "u1",
          name: "Ada Lovelace",
          email: "ada@x",
        },
      },
      isPending: false,
    };
    authMeIsSiteAdmin = true;
    const user = userEvent.setup();

    render(withQuery(<SidebarFooter />));

    const profileMenu = screen.getByRole("button", {
      name: "sidebar.footer.profile_menu_aria",
    });
    profileMenu.focus();
    await user.keyboard("{Enter}");

    expect(
      screen.getByRole("menuitem", {
        name: "sidebar.footer.admin_console",
      }),
    ).toHaveAttribute("href", "/ko/admin");
  });

  it("opens the agent panel notifications tab from the bell", async () => {
    sessionMock.value = {
      data: { user: { id: "u1", name: "Ada Lovelace", email: "ada@x" } },
      isPending: false,
    };
    const user = userEvent.setup();
    panelStoreMock.openAgentPanelTab.mockClear();

    render(withQuery(<SidebarFooter />));

    await user.click(
      screen.getByRole("button", { name: "sidebar.footer.notifications_aria" }),
    );

    expect(panelStoreMock.openAgentPanelTab).toHaveBeenCalledWith(
      "notifications",
    );
  });
});
