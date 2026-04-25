import { apiClient } from "./api-client";
import type {
  CreateResearchRunInput,
  ResearchRunDetail,
  ResearchRunSummary,
  ResearchApproveResponse,
  ResearchCancelResponse,
} from "@opencairn/shared";

export const researchApi = {
  createRun: (body: CreateResearchRunInput) =>
    apiClient<{ runId: string }>(`/research/runs`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listRuns: (workspaceId: string, limit = 50) =>
    apiClient<{ runs: ResearchRunSummary[] }>(
      `/research/runs?workspaceId=${encodeURIComponent(workspaceId)}&limit=${limit}`,
    ),
  getRun: (id: string) =>
    apiClient<ResearchRunDetail>(`/research/runs/${id}`),
  addTurn: (id: string, feedback: string) =>
    apiClient<{ turnId: string }>(`/research/runs/${id}/turns`, {
      method: "POST",
      body: JSON.stringify({ feedback }),
    }),
  updatePlan: (id: string, editedText: string) =>
    apiClient<{ turnId: string }>(`/research/runs/${id}/plan`, {
      method: "PATCH",
      body: JSON.stringify({ editedText }),
    }),
  approve: (id: string, finalPlanText?: string) =>
    apiClient<ResearchApproveResponse>(`/research/runs/${id}/approve`, {
      method: "POST",
      body: JSON.stringify(finalPlanText ? { finalPlanText } : {}),
    }),
  cancel: (id: string) =>
    apiClient<ResearchCancelResponse>(`/research/runs/${id}/cancel`, {
      method: "POST",
    }),
};

export const researchKeys = {
  all: ["research"] as const,
  list: (workspaceId: string) => ["research", "list", workspaceId] as const,
  detail: (runId: string) => ["research", "detail", runId] as const,
};
