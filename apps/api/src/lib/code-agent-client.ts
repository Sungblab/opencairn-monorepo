import type { Client } from "@temporalio/client";
import { taskQueue } from "./temporal-client";

const ONE_HOUR_MS = 60 * 60 * 1000;

export const workflowIdFor = (runId: string) => `code-agent-${runId}`;

export type StartParams = {
  runId: string;
  noteId: string;
  workspaceId: string;
  userId: string;
  prompt: string;
  language: "python" | "javascript" | "html" | "react";
  byokKeyHandle: string | null;
};

export async function startCodeRun(client: Client, p: StartParams) {
  return client.workflow.start("CodeAgentWorkflow", {
    workflowId: workflowIdFor(p.runId),
    taskQueue: taskQueue(),
    args: [p],
    workflowExecutionTimeout: ONE_HOUR_MS, // 1 h absolute deadline (spec §3.5)
  });
}

export type CodeFeedbackPayload = {
  kind: "ok" | "error";
  error?: string;
  stdout?: string;
};

export async function signalCodeFeedback(
  client: Client,
  runId: string,
  feedback: CodeFeedbackPayload,
) {
  return client.workflow
    .getHandle(workflowIdFor(runId))
    .signal("client_feedback", feedback);
}

export async function cancelCodeRun(client: Client, runId: string) {
  return client.workflow.getHandle(workflowIdFor(runId)).signal("cancel");
}
