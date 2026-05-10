import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ImportTabs } from "./ImportTabs";

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: () => (key: string) =>
    ({
      file: "File",
      link: "Link",
      text: "Text",
      more: "More",
      title: "Existing import paths",
      description: "Prepared import paths",
      "tabs.drive": "Google Drive",
      "tabs.markdown": "Markdown ZIP",
      "tabs.notion": "Notion ZIP",
    })[key] ?? key,
}));

vi.mock("./FirstSourceIntakeLoader", () => ({
  FirstSourceIntakeLoader: ({
    initialMode,
    showModeTabs,
  }: {
    initialMode: string;
    showModeTabs?: boolean;
  }) => (
    <div>
      {initialMode} first-source panel{" "}
      {showModeTabs === false ? "single-mode" : "multi-mode"}
    </div>
  ),
}));

vi.mock("./DriveTabLoader", () => ({
  DriveTabLoader: () => <div>Drive panel</div>,
}));

vi.mock("./MarkdownTabLoader", () => ({
  MarkdownTabLoader: () => <div>Markdown panel</div>,
}));

vi.mock("./NotionTabLoader", () => ({
  NotionTabLoader: () => <div>Legacy ZIP panel</div>,
}));

describe("ImportTabs", () => {
  it("puts file, link, and text intake first while keeping legacy imports behind More", async () => {
    const user = userEvent.setup();
    render(<ImportTabs wsSlug="home-1234abcd" />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "File",
      "Link",
      "Text",
      "More",
    ]);
    expect(
      screen.getByText("file first-source panel single-mode"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Link" }));
    expect(
      screen.getByText("link first-source panel single-mode"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Text" }));
    expect(
      screen.getByText("text first-source panel single-mode"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "More" }));
    expect(screen.getByText("Drive panel")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Notion ZIP" }));
    expect(screen.getByText("Legacy ZIP panel")).toBeInTheDocument();
  });
});
