import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DisconnectedBanner } from "./DisconnectedBanner";

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
  usePluginOption: () => false,
}));

describe("DisconnectedBanner", () => {
  it("uses a mobile-safe stacked layout and full-size retry button", () => {
    render(<DisconnectedBanner />);

    const alert = screen.getByRole("alert");
    const retry = screen.getByRole("button", {
      name: "collab.collab.restore_connection",
    });

    expect(alert.className).toContain("flex-col");
    expect(alert.className).toContain("sm:flex-row");
    expect(retry.className).toContain("min-h-9");
    expect(retry.className).toContain("shrink-0");
  });
});
