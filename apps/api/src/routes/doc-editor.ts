import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { randomUUID } from "node:crypto";
import {
  db,
  notes,
  docEditorCalls,
  eq,
} from "@opencairn/db";
import {
  docEditorCommandSchema,
  docEditorRequestSchema,
} from "@opencairn/shared";
import type { DocEditorSseEvent } from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { canWrite } from "../lib/permissions";
import { getTemporalClient } from "../lib/temporal-client";
import {
  startDocEditorWorkflow,
  type DocEditorWorkflowOutput,
} from "../lib/doc-editor-client";
import type { AppEnv } from "../lib/types";

export const docEditorRoutes = new Hono<AppEnv>();

// Whole-router feature gate. Off by default — flag flip happens manually
// after staging verification. Mirrors research route's pattern.
docEditorRoutes.use("*", async (c, next) => {
  const enabled =
    (process.env.FEATURE_DOC_EDITOR_SLASH ?? "false").toLowerCase() === "true";
  if (!enabled) return c.json({ error: "not_found" }, 404);
  await next();
});

docEditorRoutes.post(
  "/notes/:noteId/doc-editor/commands/:commandName",
  requireAuth,
  async (c) => {
    const userId = c.get("userId");
    const noteId = c.req.param("noteId");
    const commandName = c.req.param("commandName");
    if (!noteId || !commandName) {
      // Hono typing returns string | undefined even when the pattern
      // declares the param; the router would never reach here without a
      // path match, but the explicit narrow keeps strict TS happy.
      return c.json({ error: "not_found" }, 404);
    }

    // Command first — fast 400 on a typo, no DB lookup needed.
    const cmdParsed = docEditorCommandSchema.safeParse(commandName);
    if (!cmdParsed.success) {
      return c.json({ error: "command_unknown" }, 400);
    }

    const [note] = await db
      .select({ id: notes.id, workspaceId: notes.workspaceId })
      .from(notes)
      .where(eq(notes.id, noteId));
    // 404 hides existence when the caller has no access — same convention
    // as code.ts / research.ts. canWrite check below also collapses to 404
    // if the row exists but the caller can't write (cross-workspace, etc.).
    if (!note) return c.json({ error: "not_found" }, 404);
    if (!(await canWrite(userId, { type: "note", id: noteId }))) {
      return c.json({ error: "forbidden" }, 403);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const bodyParsed = docEditorRequestSchema.safeParse(body);
    if (!bodyParsed.success) {
      return c.json(
        { error: "invalid_body", details: bodyParsed.error.flatten() },
        400,
      );
    }

    const { selection, language, documentContextSnippet } = bodyParsed.data;
    const runId = randomUUID();

    const startedAt = Date.now();
    // Plan 11B Phase A T15 — structured terminal-event log for the
    // doc-editor surface. Mirrors the audit row in `doc_editor_calls`
    // but lands in stdout where Promtail / Loki can collect without a
    // DB read. Single line per request (start vs end is recoverable from
    // `duration_ms` + the request-id Hono assigns upstream).
    const logEvent = (
      status: "ok" | "failed",
      extras: { tokens_in?: number; tokens_out?: number; error_code?: string },
    ) =>
      console.info(
        JSON.stringify({
          event: "doc_editor.invoked",
          note_id: noteId,
          workspace_id: note.workspaceId,
          user_id: userId,
          command: cmdParsed.data,
          status,
          duration_ms: Date.now() - startedAt,
          tokens_in: extras.tokens_in ?? 0,
          tokens_out: extras.tokens_out ?? 0,
          ...(extras.error_code ? { error_code: extras.error_code } : {}),
        }),
      );

    return streamSSE(c, async (stream) => {
      const writeEvent = (ev: DocEditorSseEvent) => {
        const { type, ...rest } = ev;
        return stream.writeSSE({
          event: type,
          data: JSON.stringify(rest),
        });
      };

      let aborted = false;
      let temporalClient;
      try {
        temporalClient = await getTemporalClient();
      } catch (err) {
        await writeEvent({
          type: "error",
          code: "internal",
          message: err instanceof Error ? err.message : "temporal_unreachable",
        });
        await writeEvent({ type: "done" });
        await db.insert(docEditorCalls).values({
          noteId,
          workspaceId: note.workspaceId,
          userId,
          command: cmdParsed.data,
          tokensIn: 0,
          tokensOut: 0,
          costKrw: "0",
          status: "failed",
          errorCode: "temporal_unreachable",
        });
        logEvent("failed", { error_code: "temporal_unreachable" });
        return;
      }

      const handle = await startDocEditorWorkflow(temporalClient, runId, {
        command: cmdParsed.data,
        note_id: noteId,
        workspace_id: note.workspaceId,
        user_id: userId,
        selection_block_id: selection.blockId,
        selection_start: selection.start,
        selection_end: selection.end,
        selection_text: selection.text,
        document_context_snippet: documentContextSnippet,
        language: language ?? null,
      });

      stream.onAbort(async () => {
        aborted = true;
        try {
          await handle.cancel();
        } catch {
          // already terminal — fine.
        }
      });

      try {
        const result =
          (await handle.result()) as unknown as DocEditorWorkflowOutput;
        if (aborted) return;

        await writeEvent({
          type: "doc_editor_result",
          output_mode: "diff",
          payload: result.payload,
        });
        await writeEvent({
          type: "cost",
          tokens_in: result.tokens_in,
          tokens_out: result.tokens_out,
          // Plan 13 follow-up — provider-specific KRW pricing. Audit row
          // reuses zero until the upgrade lands.
          cost_krw: 0,
        });
        await writeEvent({ type: "done" });

        await db.insert(docEditorCalls).values({
          noteId,
          workspaceId: note.workspaceId,
          userId,
          command: cmdParsed.data,
          tokensIn: result.tokens_in,
          tokensOut: result.tokens_out,
          costKrw: "0",
          status: "ok",
        });
        logEvent("ok", {
          tokens_in: result.tokens_in,
          tokens_out: result.tokens_out,
        });
      } catch (err) {
        const errName = err instanceof Error ? err.name : String(err);
        const isCancel =
          aborted || /CancelledFailure|TerminatedFailure/.test(errName);
        if (!aborted) {
          await writeEvent({
            type: "error",
            code: isCancel ? "selection_race" : "llm_failed",
            message: err instanceof Error ? err.message : "unknown",
          });
          await writeEvent({ type: "done" });
        }
        await db.insert(docEditorCalls).values({
          noteId,
          workspaceId: note.workspaceId,
          userId,
          command: cmdParsed.data,
          tokensIn: 0,
          tokensOut: 0,
          costKrw: "0",
          status: "failed",
          errorCode: isCancel ? "cancelled" : errName,
        });
        logEvent("failed", { error_code: isCancel ? "cancelled" : errName });
      }
    });
  },
);
