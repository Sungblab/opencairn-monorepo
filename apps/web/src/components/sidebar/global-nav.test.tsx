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

vi.mock("@/components/literature/literature-search-button", () => ({
  LiteratureSearchButton: () => (
    <button type="button">sidebar.nav.literature</button>
  ),
}));

describe("GlobalNav", () => {
  it("renders visible workspace links", () => {
    render(<GlobalNav wsSlug="acme" deepResearchEnabled={true} />);
    const links = screen.getAllByRole("link");
    const hrefs = links.map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/ko/workspace/acme");
    expect(hrefs).toContain("/ko/workspace/acme/research");
    expect(hrefs).not.toContain("/ko/workspace/acme/import");
    expect(hrefs).not.toContain("/ko/workspace/acme/settings");
    expect(screen.getByText("sidebar.nav.literature")).toBeInTheDocument();
  });

  it("hides the research icon when deepResearchEnabled is false", () => {
    render(<GlobalNav wsSlug="acme" deepResearchEnabled={false} />);
    const links = screen.getAllByRole("link");
    const hrefs = links.map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/ko/workspace/acme");
    expect(hrefs).not.toContain("/ko/workspace/acme/import");
    expect(hrefs).not.toContain("/ko/workspace/acme/research");
    expect(
      screen.queryByText("sidebar.nav.research"),
    ).not.toBeInTheDocument();
  });
});
