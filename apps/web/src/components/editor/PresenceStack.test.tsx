import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PresenceStack } from "./PresenceStack";

const awareness = {
  clientID: 1,
  getStates: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
};
const editor = {
  getOption: () => awareness,
};

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: { count?: number }) =>
    key === "viewing_count" ? `${params?.count ?? 0} viewing` : key,
}));

vi.mock("@platejs/yjs/react", () => ({
  YjsPlugin: {},
}));

vi.mock("platejs/react", () => ({
  useEditorRef: () => editor,
}));

describe("PresenceStack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides all awareness states for the current user, not only the local client id", () => {
    awareness.getStates.mockReturnValue(
      new Map([
        [1, { data: { id: "u-me", name: "성빈", color: "#22c55e" } }],
        [2, { data: { id: "u-me", name: "성빈", color: "#22c55e" } }],
      ]),
    );

    const { container } = render(<PresenceStack currentUserId="u-me" />);

    expect(container.firstChild).toBeNull();
  });

  it("deduplicates multiple awareness connections for the same remote user", () => {
    awareness.getStates.mockReturnValue(
      new Map([
        [1, { data: { id: "u-me", name: "성빈", color: "#22c55e" } }],
        [2, { data: { id: "u-other", name: "다른", color: "#0ea5e9" } }],
        [3, { data: { id: "u-other", name: "다른", color: "#0ea5e9" } }],
      ]),
    );

    render(<PresenceStack currentUserId="u-me" />);

    expect(screen.getByLabelText("1 viewing")).toBeInTheDocument();
    expect(screen.getAllByTitle("다른")).toHaveLength(1);
  });
});
