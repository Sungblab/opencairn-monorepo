import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DisconnectedBanner } from "./DisconnectedBanner";

const yjsState = vi.hoisted(() => ({
  isConnected: false,
}));

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}));

vi.mock("@platejs/yjs/react", () => ({
  YjsPlugin: {},
}));

vi.mock("platejs/react", () => ({
  useEditorRef: () => ({
    getOption: () => [{ connect: vi.fn() }],
  }),
  usePluginOption: () => yjsState.isConnected,
}));

describe("DisconnectedBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    yjsState.isConnected = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not flash during the initial connection grace period", () => {
    render(<DisconnectedBanner />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("uses a compact mobile-safe status layout and retry button after grace period", () => {
    render(<DisconnectedBanner />);
    act(() => {
      vi.advanceTimersByTime(1200);
    });

    const status = screen.getByRole("status");
    const retry = screen.getByRole("button", {
      name: "collab.collab.restore_connection",
    });

    expect(status.className).toContain("max-w-[720px]");
    expect(status.className).toContain("sm:flex-row");
    expect(retry.className).toContain("min-h-8");
    expect(retry.className).toContain("shrink-0");
  });

  it("stays hidden when the provider is connected", () => {
    yjsState.isConnected = true;

    render(<DisconnectedBanner />);
    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
