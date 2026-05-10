import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ErrorPage from "./error";

const mocks = vi.hoisted(() => ({
  reloadPage: vi.fn(),
}));

vi.mock("@/lib/reload-page", () => ({
  reloadPage: mocks.reloadPage,
}));

describe("route error page", () => {
  it("reloads the page after resetting the error boundary", () => {
    const reset = vi.fn();

    render(<ErrorPage error={new Error("boom")} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: /다시 시도/ }));

    expect(reset).toHaveBeenCalledOnce();
    expect(mocks.reloadPage).toHaveBeenCalledOnce();
  });
});
