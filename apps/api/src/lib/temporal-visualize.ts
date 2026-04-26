// Plan 5 KG Phase 2 · Task 10 · Vis Agent SSE wrapper
//
// Wraps a Temporal workflow/activity handle as a ReadableStream<Uint8Array>
// of SSE-formatted bytes. Two concurrent loops:
//
//  1. result()  → resolves to the validated ViewSpec dict (success), or
//                 throws (failure). Drives the terminal `view_spec | error`
//                 event and the trailing `done` terminator.
//  2. describe() poller → every POLL_INTERVAL_MS, scans pendingActivities
//                 for new heartbeatDetails entries (HeartbeatLoopHooks emits
//                 `{event: "tool_use" | "tool_result", payload}`), and
//                 forwards each unique entry as an SSE event.
//
// Deep Research Phase C (apps/api/src/routes/research.ts) uses a DB-projection
// SSE — every 2s, it polls research_runs/turns/artifacts. That model doesn't
// fit build_view because there's no persisted run row; the agent's progress
// is intrinsic to the activity heartbeat. Hence this dedicated wrapper.
//
// Cancel semantics: ReadableStream.cancel() (browser disconnect, fetch abort)
// flips `cancelled`, breaks the poller loop on its next iteration, and best-
// -effort calls handle.cancel() so the worker stops paying for tool calls.

import type { WorkflowHandle } from "@temporalio/client";

type HeartbeatEvent = { event: string; payload: unknown };

const POLL_INTERVAL_MS = 250;

// SSE event tokens emitted by this wrapper (CI guard greps for these
// literals — see Task 30 in 2026-04-26-plan-5-kg-phase-2.md):
//   event: tool_use     — heartbeat from HeartbeatLoopHooks.on_tool_start
//   event: tool_result  — heartbeat from HeartbeatLoopHooks.on_tool_end
//   event: view_spec    — terminal success, payload {viewSpec: ViewSpec}
//   event: error        — terminal failure, payload {error, messageKey}
//   event: done         — unconditional terminator (always last frame)
function sseChunk(event: string, data: unknown): Uint8Array {
  const json = JSON.stringify(data);
  return new TextEncoder().encode(`event: ${event}\ndata: ${json}\n\n`);
}

// Loose structural type — a real WorkflowHandle satisfies it, and the test
// fakes do too. We never call any other handle method here.
type VisualizeHandle =
  | WorkflowHandle
  | {
      describe: () => Promise<unknown>;
      result: () => Promise<unknown>;
      cancel: () => Promise<void>;
    };

/**
 * Wrap a Temporal handle as an SSE-friendly ReadableStream.
 *
 * Heartbeat metadata `{event, payload}` from the worker is forwarded as
 * SSE events of the same name. The terminal result (a ViewSpec dict) is
 * emitted as `view_spec`. Errors become `error` with a stable `messageKey`
 * for i18n. A trailing `done` event always closes the stream — clients can
 * use it as the unconditional sentinel even after `error`.
 *
 * The handle MUST expose `.describe()`, `.result()`, `.cancel()`. For
 * activities started via the Temporal client an equivalent polling shape
 * is used (the worker activity runs inside a 1-step workflow per Plan
 * Task 11, so WorkflowHandle is the production-time type).
 */
export function streamBuildView(
  handle: VisualizeHandle,
): ReadableStream<Uint8Array> {
  let cancelled = false;
  const seen = new Set<string>();

  // Drain all unseen heartbeats from one describe() snapshot. Returns true
  // if any new heartbeats were emitted (used by the final-flush loop to
  // know when to stop). Swallows enqueue errors so the poller doesn't crash
  // after the controller closes. Note: doesn't gate on `cancelled` — the
  // post-result drain runs *after* we flip the flag specifically to stop
  // the background poller, but we still want to flush queued heartbeats.
  // The enqueue try/catch handles the post-close case.
  const drainHeartbeats = async (
    controller: ReadableStreamDefaultController<Uint8Array>,
    closed: { value: boolean },
  ): Promise<boolean> => {
    let emitted = false;
    try {
      const desc = (await (
        handle as { describe: () => Promise<unknown> }
      ).describe()) as {
        pendingActivities?: Array<{ heartbeatDetails?: HeartbeatEvent[] }>;
      };
      const acts = desc.pendingActivities ?? [];
      for (const a of acts) {
        for (const hb of a.heartbeatDetails ?? []) {
          const key = JSON.stringify(hb);
          if (seen.has(key)) continue;
          seen.add(key);
          if (hb.event && hb.payload !== undefined && !closed.value) {
            try {
              controller.enqueue(sseChunk(hb.event, hb.payload));
              emitted = true;
            } catch {
              closed.value = true;
              return emitted;
            }
          }
        }
      }
    } catch {
      // describe() failures are non-fatal — result() drives termination.
    }
    return emitted;
  };

  // Single shared "controller closed" flag — flipped when we close the
  // controller or when an enqueue throws (cancel() raced). drainHeartbeats
  // checks it; the background poller checks it too. Distinct from
  // `cancelled` (consumer-initiated abort) so the post-result drain can
  // still flush in-flight heartbeats.
  const closed = { value: false };

  // Background poller: runs while result() is in flight, forwarding new
  // heartbeats every POLL_INTERVAL_MS. Fire-and-forget — exits when
  // `cancelled` flips (set by result branch's finally OR stream cancel).
  const startPoller = (
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): void => {
    void (async () => {
      while (!cancelled && !closed.value) {
        await drainHeartbeats(controller, closed);
        if (cancelled || closed.value) break;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    })();
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      startPoller(controller);

      let resultValue: unknown;
      let resultError: Error | null = null;
      try {
        resultValue = await (
          handle as { result: () => Promise<unknown> }
        ).result();
      } catch (e) {
        resultError = e instanceof Error ? e : new Error(String(e));
      }

      // Stop the background poller now that result() settled. The
      // post-result drain still flushes any heartbeats the worker emitted
      // before completing — `closed` (not `cancelled`) gates emission, so
      // events still land in the stream in the worker's emission order
      // before the terminal `view_spec | error`.
      cancelled = true;
      // Cap drain iterations so a misbehaving fake/handle can't hang the
      // stream. 64 is well over the realistic ceiling of tool turns per run.
      for (let i = 0; i < 64; i++) {
        if (closed.value) break;
        const emitted = await drainHeartbeats(controller, closed);
        if (!emitted) break;
      }

      try {
        if (resultError) {
          controller.enqueue(
            sseChunk("error", {
              error: resultError.message,
              messageKey: "graph.errors.visualizeFailed",
            }),
          );
        } else {
          controller.enqueue(
            sseChunk("view_spec", { viewSpec: resultValue }),
          );
        }
      } catch {
        closed.value = true;
        // Already closed (e.g. cancel() raced). Ignore.
      }
      try {
        controller.enqueue(sseChunk("done", {}));
      } catch {
        closed.value = true;
        // Already closed. Ignore.
      }
      try {
        controller.close();
      } catch {
        // Already closed. Ignore.
      }
      closed.value = true;
    },
    async cancel() {
      cancelled = true;
      try {
        await (handle as { cancel: () => Promise<void> }).cancel();
      } catch {
        // best-effort — handle may already be terminal
      }
    },
  });
}
