import type { Client } from "@temporalio/client";
import { taskQueue } from "./temporal-client";

const FORTY_FIVE_SECONDS_MS = 45_000;

export const workflowIdFor = (runId: string) => `doc-editor-${runId}`;

export type DocEditorWorkflowInput = {
  command: "improve" | "translate" | "summarize" | "expand";
  note_id: string;
  workspace_id: string;
  user_id: string;
  selection_block_id: string;
  selection_start: number;
  selection_end: number;
  selection_text: string;
  document_context_snippet: string;
  language: string | null;
};

export type DocEditorWorkflowOutput = {
  command: string;
  output_mode: "diff";
  payload: {
    hunks: Array<{
      blockId: string;
      originalRange: { start: number; end: number };
      originalText: string;
      replacementText: string;
    }>;
    summary: string;
  };
  tokens_in: number;
  tokens_out: number;
};

export async function startDocEditorWorkflow(
  client: Client,
  runId: string,
  input: DocEditorWorkflowInput,
) {
  return client.workflow.start("DocEditorWorkflow", {
    workflowId: workflowIdFor(runId),
    taskQueue: taskQueue(),
    args: [input],
    workflowExecutionTimeout: FORTY_FIVE_SECONDS_MS,
  });
}
