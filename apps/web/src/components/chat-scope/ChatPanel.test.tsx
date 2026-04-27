import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock useScopeContext at the source path so all consumers see the same
// shape; the @-alias resolution otherwise uses the real hook + its
// useParams call which would 500 in jsdom.
vi.mock("@/hooks/useScopeContext", () => ({
  useScopeContext: () => ({
    scopeType: "page",
    scopeId: "n1",
    workspaceId: "ws1",
    workspaceSlug: "acme",
    initialChips: [{ type: "page", id: "n1", label: "Test page", manual: false }],
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (k: string, vars?: Record<string, unknown>) =>
    vars
      ? `${ns ? `${ns}.` : ""}${k}(${JSON.stringify(vars)})`
      : ns
        ? `${ns}.${k}`
        : k,
}));

import { ChatPanel } from "./ChatPanel";

const fetchMock = vi.fn();
beforeEach(() => {
  (globalThis as { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  fetchMock.mockReset();
});

describe("<ChatPanel>", () => {
  it("creates a conversation on first send and renders the assistant reply with cost badge", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/api/chat/conversations")) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: "c1",
            attachedChips: [
              { type: "page", id: "n1", label: "Test page", manual: false },
            ],
            ragMode: "strict",
          }),
        };
      }
      if (url.endsWith("/api/chat/message")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            [
              'event: delta\ndata: {"delta":"H"}\n\n',
              'event: delta\ndata: {"delta":"i"}\n\n',
              'event: cost\ndata: {"messageId":"m1","tokensIn":0,"tokensOut":2,"costKrw":0.0001}\n\n',
              'event: done\ndata: {}\n\n',
            ].join(""),
        };
      }
      return { ok: false, status: 404 };
    });

    render(<ChatPanel />);

    fireEvent.change(screen.getByPlaceholderText(/chatScope\.input\.placeholder/), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: /chatScope\.input\.send/ }));

    await waitFor(() => expect(screen.getByText("Hi")).toBeInTheDocument());
    // Cost badge prints the KRW string with a "원" suffix; look for the
    // formatted value that the placeholder rate produces.
    expect(screen.getByText(/원/)).toBeInTheDocument();
  });
});
