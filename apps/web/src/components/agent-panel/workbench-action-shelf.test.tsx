import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkbenchActionShelf } from "./workbench-action-shelf";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}));

describe("WorkbenchActionShelf", () => {
  it("shows document actions for note-like surfaces", () => {
    render(<WorkbenchActionShelf activeKind="note" onRun={vi.fn()} />);

    expect(screen.getByRole("button", { name: /summarize/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /decompose/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /extract_citations/i }),
    ).toBeInTheDocument();
  });

  it("runs a command when an action is clicked", () => {
    const onRun = vi.fn();
    render(<WorkbenchActionShelf activeKind="project" onRun={onRun} />);

    fireEvent.click(screen.getByRole("button", { name: /research/i }));

    expect(onRun).toHaveBeenCalledWith(
      expect.objectContaining({ id: "research" }),
    );
  });
});
