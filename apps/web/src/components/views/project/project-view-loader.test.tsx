import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./project-view", () => ({
  ProjectView: () => <div>project view</div>,
}));

vi.mock("next/dynamic", () => ({
  default: (_loader: unknown, options: { loading?: () => React.ReactNode }) =>
    function DynamicFallback() {
      return options.loading?.() ?? null;
    },
}));

import { ProjectViewLoader } from "./project-view-loader";

describe("ProjectViewLoader", () => {
  it("uses the same shell-safe width constraints as the project view", () => {
    render(<ProjectViewLoader wsSlug="acme" projectId="p1" />);

    const skeleton = screen.getByTestId("route-project-skeleton");
    expect(skeleton).toHaveClass("w-full", "min-w-0", "overflow-x-hidden");
    expect(skeleton.querySelector(".grid")?.className).toContain("auto-fit");
  });
});
