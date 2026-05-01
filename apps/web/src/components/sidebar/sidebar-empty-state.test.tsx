import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SidebarEmptyState } from "./sidebar-empty-state";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ wsSlug: "acme" }),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

describe("SidebarEmptyState", () => {
  it("renders a create-project CTA that navigates to /new-project", () => {
    render(<SidebarEmptyState />);
    expect(screen.getByText("sidebar.project.empty")).toBeInTheDocument();
    const cta = screen.getByRole("button", {
      name: "sidebar.project.create_cta",
    });
    fireEvent.click(cta);
    expect(push).toHaveBeenCalledWith("/ko/workspace/acme/new-project");
  });
});
