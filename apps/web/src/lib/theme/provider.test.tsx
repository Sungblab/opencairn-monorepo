import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "./provider";

function mockPrefersDark(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.cookie = "opencairn.theme=; Max-Age=0; Path=/";
    document.documentElement.removeAttribute("data-theme");
    mockPrefersDark(false);
  });

  it("syncs a stored client theme back to the server-readable cookie", async () => {
    window.localStorage.setItem("opencairn.theme", "cairn-dark");

    render(
      <ThemeProvider initialTheme="cairn-light">
        <div />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute(
        "data-theme",
        "cairn-dark",
      );
    });
    expect(document.cookie).toContain("opencairn.theme=cairn-dark");
  });

  it("persists the system dark fallback so reloads do not flash back to light", async () => {
    mockPrefersDark(true);

    render(
      <ThemeProvider initialTheme="cairn-light">
        <div />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(window.localStorage.getItem("opencairn.theme")).toBe("cairn-dark");
    });
    expect(document.cookie).toContain("opencairn.theme=cairn-dark");
  });
});
