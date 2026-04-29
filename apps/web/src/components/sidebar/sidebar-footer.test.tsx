import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SidebarFooter } from "./sidebar-footer";

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ wsSlug: "acme" }),
}));

// Hoisted mock holder so individual tests can override the session state
// returned by authClient.useSession without re-declaring the vi.mock call.
const sessionMock = vi.hoisted(() => ({
  value: {
    data: {
      user: { id: "u1", name: "Ada Lovelace", email: "ada@example.com" },
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

function withQuery(node: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

describe("SidebarFooter", () => {
  it("renders the session user's name and links to workspace settings", () => {
    sessionMock.value = {
      data: { user: { id: "u1", name: "Ada Lovelace", email: "ada@x" } },
      isPending: false,
    };
    render(withQuery(<SidebarFooter />));
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "sidebar.footer.settings_aria" }),
    ).toHaveAttribute("href", "/ko/app/w/acme/settings");
  });

  it("renders nothing while the session is still loading", () => {
    sessionMock.value = { data: null, isPending: true };
    const { container } = render(withQuery(<SidebarFooter />));
    expect(container).toBeEmptyDOMElement();
  });
});
