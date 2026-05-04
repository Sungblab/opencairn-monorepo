import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Sidebar } from "./Sidebar";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}));

vi.mock("@/hooks/use-legacy-project-tree", () => ({
  useLegacyProjectTree: () => ({
    isLoading: false,
    notes: [],
    folders: [],
  }),
}));

vi.mock("./NewNoteButton", () => ({
  NewNoteButton: () => <button type="button">new note</button>,
}));

vi.mock("./NewCanvasButton", () => ({
  NewCanvasButton: () => <button type="button">new canvas</button>,
}));

describe("Sidebar", () => {
  it("does not reserve a fixed project rail on mobile", () => {
    render(
      <Sidebar
        workspaceSlug="acme"
        projectId="project-1"
        projectName="Project"
      />,
    );

    const sidebar = screen.getByTestId("sidebar");
    expect(sidebar.className).toContain("w-full");
    expect(sidebar.className).toContain("lg:w-64");
  });
});
