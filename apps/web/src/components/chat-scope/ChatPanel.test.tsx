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

function mkConversationResponse() {
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

function mkSseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function mkControlledSseBody() {
  const encoder = new TextEncoder();
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
  });
  return {
    body,
    push(chunk: string) {
      streamController?.enqueue(encoder.encode(chunk));
    },
    close() {
      streamController?.close();
    },
  };
}

async function submitMessage(text = "hello") {
  fireEvent.change(screen.getByPlaceholderText(/chatScope\.input\.placeholder/), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: /chatScope\.input\.send/ }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith("/api/chat/message", expect.anything()),
  );
}

describe("<ChatPanel>", () => {
  it("streams assistant deltas before the SSE response completes", async () => {
    const stream = mkControlledSseBody();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/api/chat/conversations")) {
        return mkConversationResponse();
      }
      if (url.endsWith("/api/chat/message")) {
        return {
          ok: true,
          status: 200,
          body: stream.body,
        };
      }
      return { ok: false, status: 404 };
    });

    render(<ChatPanel />);
    await submitMessage();

    stream.push('event: delta\ndata: {"delta":"Hel"}\n\n');
    await waitFor(() => expect(screen.getByText("Hel")).toBeInTheDocument());

    stream.push('event: delta\ndata: {"delta":"lo"}\n\n');
    stream.push('event: done\ndata: {}\n\n');
    stream.close();

    await waitFor(() => expect(screen.getByText("Hello")).toBeInTheDocument());
  });

  it("surfaces an SSE error event on the assistant message", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/api/chat/conversations")) return mkConversationResponse();
      if (url.endsWith("/api/chat/message")) {
        return {
          ok: true,
          status: 200,
          body: mkSseBody([
            'event: error\ndata: {"code":"llm_failed","message":"provider failed"}\n\n',
            'event: done\ndata: {}\n\n',
          ]),
        };
      }
      return { ok: false, status: 404 };
    });

    render(<ChatPanel />);
    await submitMessage("fail");

    await waitFor(() =>
      expect(screen.getByText("chat.errors.streamFailed")).toBeInTheDocument(),
    );
  });

  it("maps timeout SSE errors to the dedicated chat error string", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/api/chat/conversations")) return mkConversationResponse();
      if (url.endsWith("/api/chat/message")) {
        return {
          ok: true,
          status: 200,
          body: mkSseBody([
            'event: error\ndata: {"code":"TIMEOUT","message":"deadline exceeded"}\n\n',
            'event: done\ndata: {}\n\n',
          ]),
        };
      }
      return { ok: false, status: 404 };
    });

    render(<ChatPanel />);
    await submitMessage("slow");

    await waitFor(() =>
      expect(
        screen.getByText("chat.errors.executionTimeout"),
      ).toBeInTheDocument(),
    );
  });

  it("applies the SSE cost event to the streamed assistant message", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/api/chat/conversations")) return mkConversationResponse();
      if (url.endsWith("/api/chat/message")) {
        return {
          ok: true,
          status: 200,
          body: mkSseBody([
            'event: delta\ndata: {"delta":"Hi"}\n\n',
            'event: cost\ndata: {"messageId":"m1","tokensIn":0,"tokensOut":2,"costKrw":0.0001}\n\n',
            'event: done\ndata: {}\n\n',
          ]),
        };
      }
      return { ok: false, status: 404 };
    });

    render(<ChatPanel />);
    await submitMessage();

    await waitFor(() => expect(screen.getByText("Hi")).toBeInTheDocument());
    // Cost badge prints the KRW string with a "원" suffix; look for the
    // formatted value that the placeholder rate produces.
    expect(screen.getByText(/원/)).toBeInTheDocument();
  });

  it("renders a save_suggestion SSE event on the assistant message", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/api/chat/conversations")) return mkConversationResponse();
      if (url.endsWith("/api/chat/message")) {
        return {
          ok: true,
          status: 200,
          body: mkSseBody([
            'event: delta\ndata: {"delta":"Saved."}\n\n',
            'event: save_suggestion\ndata: {"title":"Draft note","body_markdown":"# Draft"}\n\n',
            'event: done\ndata: {}\n\n',
          ]),
        };
      }
      return { ok: false, status: 404 };
    });

    render(<ChatPanel />);
    await submitMessage("save this");

    await waitFor(() => expect(screen.getByText("Saved.")).toBeInTheDocument());
    expect(screen.getByText(/Draft note/)).toBeInTheDocument();
  });
});
