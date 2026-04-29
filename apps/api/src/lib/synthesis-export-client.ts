import type { Client } from "@temporalio/client";
import { taskQueue } from "./temporal-client";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

function workflowExecutionTimeoutMs(): number {
  const raw = process.env.SYNTHESIS_EXPORT_TIMEOUT_MS;
  if (!raw) return TWO_HOURS_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : TWO_HOURS_MS;
}

export const workflowIdFor = (runId: string) => `synthesis-export-${runId}`;

export interface StartSynthesisExportParams {
  runId: string;
  workspaceId: string;
  projectId: string | null;
  userId: string;
  format: "latex" | "docx" | "pdf" | "md";
  template: "ieee" | "acm" | "apa" | "korean_thesis" | "report";
  userPrompt: string;
  explicitSourceIds: string[];
  noteIds: string[];
  autoSearch: boolean;
  byokKeyHandle: string | null;
}

export async function startSynthesisExportRun(
  client: Client,
  p: StartSynthesisExportParams,
) {
  // Snake-case payload keys mirror the Python @dataclass field names so
  // Temporal's default JSON converter round-trips cleanly without a custom
  // Pydantic adapter on the worker side.
  // Keep in sync with the Python @dataclass:
  // apps/worker/src/worker/activities/synthesis_export/types.py SynthesisRunParams
  return client.workflow.start("SynthesisExportWorkflow", {
    workflowId: workflowIdFor(p.runId),
    taskQueue: taskQueue(),
    args: [
      {
        run_id: p.runId,
        workspace_id: p.workspaceId,
        project_id: p.projectId,
        user_id: p.userId,
        format: p.format,
        template: p.template,
        user_prompt: p.userPrompt,
        explicit_source_ids: p.explicitSourceIds,
        note_ids: p.noteIds,
        auto_search: p.autoSearch,
        byok_key_handle: p.byokKeyHandle,
      },
    ],
    workflowExecutionTimeout: workflowExecutionTimeoutMs(),
  });
}

export async function signalSynthesisExportCancel(
  client: Client,
  runId: string,
) {
  return client.workflow.getHandle(workflowIdFor(runId)).signal("cancel");
}
