import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GlobalNav } from "./global-nav";

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// LiteratureSearchButton renders its own modal + react-query hooks. This
// suite is scoped to GlobalNav's link layout, so stub the button to a tiny
// marker that the assertions can ignore.
vi.mock("@/components/literature/literature-search-button", () => ({
  LiteratureSearchButton: () => null,
}));

describe("GlobalNav", () => {
  it("renders three locale-prefixed workspace links and a more button", () => {
    render(<GlobalNav wsSlug="acme" deepResearchEnabled={true} />);
    const links = screen.getAllByRole("link");
    const hrefs = links.map((a) => a.getAttribute("href"));
    // Next.js Link strips the trailing slash from "/ko/workspace/acme/" on render.
    expect(hrefs).toEqual([
      "/ko/workspace/acme",
      "/ko/workspace/acme/research",
      "/ko/workspace/acme/import",
    ]);
    expect(
      screen.getByRole("button", { name: "sidebar.nav.more_aria" }),
    ).toBeInTheDocument();
  });

  it("hides the research icon when deepResearchEnabled is false", () => {
    render(<GlobalNav wsSlug="acme" deepResearchEnabled={false} />);
    const links = screen.getAllByRole("link");
    const hrefs = links.map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "/ko/workspace/acme",
      "/ko/workspace/acme/import",
    ]);
    expect(
      screen.queryByLabelText("sidebar.nav.research"),
    ).not.toBeInTheDocument();
  });
});
