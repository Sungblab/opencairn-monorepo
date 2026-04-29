import type { Client } from "@temporalio/client";
import { taskQueue } from "./temporal-client";

const ONE_HOUR_MS = 60 * 60 * 1000;

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
    workflowExecutionTimeout: ONE_HOUR_MS,
  });
}

export async function signalSynthesisExportCancel(
  client: Client,
  runId: string,
) {
  return client.workflow.getHandle(workflowIdFor(runId)).signal("cancel");
}
