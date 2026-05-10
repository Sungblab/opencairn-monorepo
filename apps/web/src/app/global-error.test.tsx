import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import GlobalError from "./global-error";

describe("global error page", () => {
  it("reloads the browser after resetting the root error boundary", () => {
    const reset = vi.fn();
    const reload = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload },
    });

    render(<GlobalError error={new Error("boom")} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: "새로고침 / Reload" }));

    expect(reset).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });
});
