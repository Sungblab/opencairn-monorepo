import type { Page, Route } from "@playwright/test";

export const SAVE_SUGGESTION_FIXTURE = {
  title: "Fixture note from chat",
  body_markdown:
    "# Fixture saved note\n\nBody inserted from deterministic E2E fixture.",
} as const;

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function fulfillAgentSaveSuggestionStream(
  route: Route,
): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: [
      sseFrame("user_persisted", { id: "fixture-user-msg" }),
      sseFrame("agent_placeholder", { id: "fixture-agent-msg" }),
      sseFrame("status", { phrase: "fixture" }),
      sseFrame("text", { delta: "Deterministic fixture reply." }),
      sseFrame("save_suggestion", SAVE_SUGGESTION_FIXTURE),
      sseFrame("done", { id: "fixture-agent-msg", status: "complete" }),
    ].join(""),
  });
}

export async function fulfillPersistedSaveSuggestionMessages(
  route: Route,
  sent: boolean,
): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      messages: sent
        ? [
            {
              id: "fixture-user-msg",
              role: "user",
              status: "complete",
              content: { body: "/fixture-save" },
              mode: "auto",
              provider: null,
              created_at: new Date("2026-04-29T00:00:00.000Z").toISOString(),
            },
            {
              id: "fixture-agent-msg",
              role: "agent",
              status: "complete",
              content: {
                body: "Deterministic fixture reply.",
                save_suggestion: SAVE_SUGGESTION_FIXTURE,
              },
              mode: "auto",
              provider: "fixture",
              created_at: new Date("2026-04-29T00:00:01.000Z").toISOString(),
            },
          ]
        : [],
    }),
  });
}

export async function installMockEventSource(
  page: Page,
  opts: {
    workflowId: string;
    fileName: string;
    mime: string;
    events: Array<{ delayMs: number; event: unknown }>;
  },
): Promise<void> {
  await page.addInitScript(({ workflowId, fileName, mime, events }) => {
    const startedAt = Date.now();
    localStorage.setItem(
      "ingest-store",
      JSON.stringify({
        state: {
          runs: {
            [workflowId]: {
              workflowId,
              fileName,
              mime,
              status: "running",
              startedAt,
              lastSeq: 0,
              units: { current: 0, total: null },
              stage: null,
              figures: [],
              outline: [],
              error: null,
              noteId: null,
            },
          },
          spotlightWfid: workflowId,
        },
        version: 0,
      }),
    );

    const NativeEventSource = window.EventSource;

    class MockIngestEventSource {
      url: string;
      withCredentials: boolean;
      readyState = 0;
      onopen: ((ev: Event) => void) | null = null;
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;
      private timers: number[] = [];
      private listeners = new Map<
        string,
        Set<EventListenerOrEventListenerObject>
      >();

      constructor(url: string | URL, init?: EventSourceInit) {
        this.url = String(url);
        this.withCredentials = Boolean(init?.withCredentials);
        this.timers.push(
          window.setTimeout(() => {
            if (this.readyState === NativeEventSource.CLOSED) return;
            this.readyState = NativeEventSource.OPEN;
            this.emit("open", new Event("open"));
          }, 0),
        );
        this.timers.push(
          ...events.map(({ delayMs, event }) =>
            window.setTimeout(() => {
              if (this.readyState === NativeEventSource.CLOSED) return;
              this.readyState = NativeEventSource.OPEN;
              this.emit(
                "message",
                new MessageEvent("message", { data: JSON.stringify(event) }),
              );
            }, delayMs),
          ),
        );
      }

      close() {
        this.readyState = NativeEventSource.CLOSED;
        for (const timer of this.timers) window.clearTimeout(timer);
      }

      addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
      ) {
        const existing = this.listeners.get(type) ?? new Set();
        existing.add(listener);
        this.listeners.set(type, existing);
      }

      removeEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
      ) {
        this.listeners.get(type)?.delete(listener);
      }

      dispatchEvent(event: Event) {
        this.emit(event.type, event);
        return !event.defaultPrevented;
      }

      private emit(type: string, event: Event) {
        if (type === "open") this.onopen?.(event);
        if (type === "message" && event instanceof MessageEvent) {
          this.onmessage?.(event);
        }
        if (type === "error") this.onerror?.(event);
        for (const listener of this.listeners.get(type) ?? []) {
          if (typeof listener === "function") {
            listener.call(this, event);
          } else {
            listener.handleEvent(event);
          }
        }
      }
    }

    const EventSourceShim = function (
      this: EventSource,
      url: string | URL,
      init?: EventSourceInit,
    ) {
      const href = String(url);
      if (!href.endsWith(`/api/ingest/stream/${workflowId}`)) {
        return new NativeEventSource(url, init);
      }
      return new MockIngestEventSource(href, init) as unknown as EventSource;
    } as unknown as typeof EventSource;

    window.EventSource = EventSourceShim;
  }, opts);
}
