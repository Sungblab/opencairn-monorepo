import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SidebarFooter } from "./sidebar-footer";

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: (ns?: string) => (key: string, values?: Record<string, unknown>) =>
    ns ? `${ns}.${key}${values?.credits ? `:${values.credits}` : ""}` : key,
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

const themeMock = vi.hoisted(() => ({
  theme: "cairn-light",
  setTheme: vi.fn(),
  themes: ["cairn-light", "cairn-dark", "sepia", "high-contrast"] as const,
}));

let authMeIsSiteAdmin = false;

vi.mock("@/stores/panel-store", () => ({
  usePanelStore: (selector: (s: typeof panelStoreMock) => unknown) =>
    selector(panelStoreMock),
}));

vi.mock("@/lib/theme/provider", () => ({
  useTheme: () => themeMock,
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
    themeMock.theme = "cairn-light";
    themeMock.setTheme.mockClear();
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

  it("shows the current plan and remaining managed credits in the footer", async () => {
    vi.mocked(global.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/api/auth/me")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ isSiteAdmin: false }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          workspaces: [
            { id: "1", slug: "acme", name: "ACME", role: "owner" },
          ],
          invites: [],
          billing: {
            plan: "pro",
            balanceCredits: 1234,
            monthlyGrantCredits: 8000,
            managedLlm: true,
          },
        }),
      } as Response);
    });

    sessionMock.value = {
      data: {
        user: { id: "u1", name: "Ada Lovelace", email: "ada@x" },
      },
      isPending: false,
    };

    render(withQuery(<SidebarFooter />));

    expect(await screen.findByText("ACME")).toBeInTheDocument();
    expect(screen.getByText("sidebar.footer.plan_pro")).toBeInTheDocument();
    expect(
      screen.getByText("sidebar.footer.credits_remaining:1,234"),
    ).toBeInTheDocument();
  });

  it("renders nothing while the session is still loading", () => {
    sessionMock.value = { data: null, isPending: true };
    const { container } = render(withQuery(<SidebarFooter />));
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps a single workspace settings entry inside the bottom profile menu", async () => {
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
        name: "sidebar.footer.settings_aria",
      }),
    ).toHaveAttribute("href", "/ko/workspace/acme/settings/workspace");
    expect(
      screen.queryByRole("menuitem", {
        name: "sidebar.footer.account_settings",
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryByText("sidebar.role.member")).not.toBeInTheDocument();
    expect(screen.queryByText("ada@x")).not.toBeInTheDocument();
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

  it("lets users select a theme from the bottom profile menu", async () => {
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

    expect(screen.getByText("sidebar.footer.theme")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /Cairn Light, account\.appearance\.themes\.cairn-light/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("sidebar.footer.active_theme"),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: /Cairn Dark, account\.appearance\.themes\.cairn-dark/,
      }),
    );

    expect(themeMock.setTheme).toHaveBeenCalledWith("cairn-dark");
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
