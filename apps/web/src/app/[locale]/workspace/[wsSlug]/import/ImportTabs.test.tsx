import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ImportTabs } from "./ImportTabs";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    ({
      drive: "Google Drive",
      markdown: "Markdown ZIP",
      more: "More",
    })[key] ?? key,
}));

vi.mock("./DriveTab", () => ({
  DriveTab: () => <div>Drive panel</div>,
}));

vi.mock("./MarkdownTab", () => ({
  MarkdownTab: () => <div>Markdown panel</div>,
}));

vi.mock("./NotionTab", () => ({
  NotionTab: () => <div>Legacy ZIP panel</div>,
}));

describe("ImportTabs", () => {
  it("keeps provider-specific ZIP imports behind More", async () => {
    const user = userEvent.setup();
    render(<ImportTabs wsSlug="home-1234abcd" />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Google Drive",
      "Markdown ZIP",
      "More",
    ]);
    expect(screen.getByText("Drive panel")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Markdown ZIP" }));
    expect(screen.getByText("Markdown panel")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "More" }));
    expect(screen.getByText("Legacy ZIP panel")).toBeInTheDocument();
  });
});
