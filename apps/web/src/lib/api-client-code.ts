// Plan 7 Canvas Phase 2 — typed wrappers for /api/code/* and /api/canvas/*.
// Mirrors the shape of `api-client-research.ts`: pure typed wrappers around
// the shared `apiClient` helper. SSE consumption lives in
// `use-code-agent-stream.ts`; this module only covers POST endpoints.

import { apiClient } from "./api-client";
import type {
  CodeAgentRunRequest,
  CodeAgentFeedback,
} from "@opencairn/shared";

export const codeApi = {
  startRun: (body: CodeAgentRunRequest) =>
    apiClient<{ runId: string }>(`/code/run`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  sendFeedback: (body: CodeAgentFeedback) =>
    apiClient<{ ok: true }>(`/code/feedback`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

export const codeKeys = {
  all: ["code"] as const,
  detail: (runId: string) => ["code", "detail", runId] as const,
};
