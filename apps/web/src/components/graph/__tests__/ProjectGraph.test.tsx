import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ProjectGraph } from "../ProjectGraph";
import koGraph from "@/../messages/ko/graph.json";
import { useRouter, useSearchParams } from "next/navigation";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

vi.mock("../ViewSwitcher", () => ({
  ViewSwitcher: ({ onAiClick }: { onAiClick: () => void }) => (
    <button data-testid="switcher-ai" onClick={onAiClick}>
      ai
    </button>
  ),
}));
vi.mock("../ViewRenderer", () => ({
  ViewRenderer: ({ projectId }: { projectId: string }) => (
    <div data-testid="renderer">{projectId}</div>
  ),
}));
vi.mock("../ai/VisualizeDialog", () => ({
  VisualizeDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="dialog" /> : null,
}));

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="ko" messages={{ graph: koGraph }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ProjectGraph (assembled)", () => {
  beforeEach(() => {
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      replace: vi.fn(),
    });
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams(),
    );
  });

  it("mounts ViewSwitcher + ViewRenderer with projectId", () => {
    wrap(<ProjectGraph projectId="p-1" />);
    expect(screen.getByTestId("renderer").textContent).toBe("p-1");
    expect(screen.getByTestId("switcher-ai")).toBeInTheDocument();
  });

  it("AI button opens VisualizeDialog", () => {
    wrap(<ProjectGraph projectId="p-1" />);
    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("switcher-ai"));
    expect(screen.getByTestId("dialog")).toBeInTheDocument();
  });
});
