import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSwitcher } from "./workspace-switcher";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ wsSlug: "acme" }),
}));

// Identity-ish i18n mock — matches the pattern used by use-url-tab-sync.test.
vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: () => (key: string) => key,
}));

function renderSwitcher() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <WorkspaceSwitcher />
    </QueryClientProvider>,
  );
}

describe("WorkspaceSwitcher", () => {
  beforeEach(() => {
    push.mockClear();
  });

  it("renders the current workspace name in the trigger", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        workspaces: [
          { id: "1", slug: "acme", name: "ACME", role: "owner" },
          { id: "2", slug: "beta", name: "Beta", role: "member" },
        ],
        invites: [],
      }),
    }) as unknown as typeof fetch;

    renderSwitcher();
    const trigger = await screen.findByRole("button", {
      name: /switcher.trigger_aria/,
    });
    await waitFor(() => {
      expect(trigger).toHaveTextContent("ACME");
    });
  });

  it("opens the menu and lists workspaces with role badges", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        workspaces: [
          { id: "1", slug: "acme", name: "ACME", role: "owner" },
          { id: "2", slug: "beta", name: "Beta", role: "member" },
        ],
        invites: [],
      }),
    }) as unknown as typeof fetch;

    renderSwitcher();
    const trigger = await screen.findByRole("button", {
      name: /switcher.trigger_aria/,
    });
    fireEvent.click(trigger);

    const menu = await screen.findByRole("menu");
    await waitFor(() => {
      expect(within(menu).getByText("ACME")).toBeInTheDocument();
      expect(within(menu).getByText("Beta")).toBeInTheDocument();
    });
    expect(within(menu).getByText("role.owner")).toBeInTheDocument();
    expect(within(menu).getByText("role.member")).toBeInTheDocument();
  });

  it("pushes a locale-prefixed path when a workspace is chosen", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        workspaces: [
          { id: "1", slug: "acme", name: "ACME", role: "owner" },
          { id: "2", slug: "beta", name: "Beta", role: "member" },
        ],
        invites: [],
      }),
    }) as unknown as typeof fetch;

    renderSwitcher();
    fireEvent.click(
      await screen.findByRole("button", { name: /switcher.trigger_aria/ }),
    );
    const betaItem = await screen.findByText("Beta");
    fireEvent.click(betaItem);
    expect(push).toHaveBeenCalledWith("/ko/app/w/beta");
  });

  it("renders pending invites under a dedicated label", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        workspaces: [{ id: "1", slug: "acme", name: "ACME", role: "owner" }],
        invites: [
          {
            id: "i1",
            workspaceId: "w2",
            workspaceName: "Invited Team",
            workspaceSlug: "invited",
            role: "member",
            expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          },
        ],
      }),
    }) as unknown as typeof fetch;

    renderSwitcher();
    fireEvent.click(
      await screen.findByRole("button", { name: /switcher.trigger_aria/ }),
    );
    expect(await screen.findByText("Invited Team")).toBeInTheDocument();
    expect(screen.getByText("switcher.invites_label")).toBeInTheDocument();
  });

  it("always offers a create-new-workspace entry", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ workspaces: [], invites: [] }),
    }) as unknown as typeof fetch;

    renderSwitcher();
    fireEvent.click(
      await screen.findByRole("button", { name: /switcher.trigger_aria/ }),
    );
    const newItem = await screen.findByText("switcher.new_workspace");
    fireEvent.click(newItem);
    expect(push).toHaveBeenCalledWith("/ko/onboarding");
  });
});
