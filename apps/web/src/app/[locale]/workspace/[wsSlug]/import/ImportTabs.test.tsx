import { render, screen } from "@testing-library/react";
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
  it("opens directly on the file upload intake without mode tabs", () => {
    render(<ImportTabs wsSlug="home-1234abcd" />);

    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(
      screen.getByText("file first-source panel single-mode"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Drive panel")).not.toBeInTheDocument();
    expect(screen.queryByText("Legacy ZIP panel")).not.toBeInTheDocument();
  });
});
