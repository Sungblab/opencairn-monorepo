"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface GoogleIntegrationStatus {
  connected: boolean;
  accountEmail: string | null;
  scopes: string[] | null;
}

async function fetchStatus(
  workspaceId: string,
): Promise<GoogleIntegrationStatus> {
  const res = await fetch(
    `/api/integrations/google?workspaceId=${encodeURIComponent(workspaceId)}`,
    { credentials: "include" },
  );
  if (!res.ok) {
    // 401 = not signed in. Rather than crashing the import page we report
    // "not connected" — the ProtectedRoute wrapper will have already sent
    // the user to /login in the common case.
    return { connected: false, accountEmail: null, scopes: null };
  }
  return (await res.json()) as GoogleIntegrationStatus;
}

// `workspaceId` is the audit S3-022 isolation gate: a Drive connection in
// workspace A is no longer visible from workspace B even for the same user,
// so the hook needs the current workspace id to ask the right question.
// Callers that don't have one yet (e.g. layout still resolving the slug)
// should pass `null`/`undefined` — the query stays disabled until it lands.
export function useGoogleIntegration(workspaceId: string | null | undefined) {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["google-integration", workspaceId],
    queryFn: () => fetchStatus(workspaceId!),
    enabled: Boolean(workspaceId),
    staleTime: 10_000,
  });
  const disconnect = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error("workspaceId required");
      const res = await fetch(
        `/api/integrations/google?workspaceId=${encodeURIComponent(workspaceId)}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok) throw new Error(`disconnect failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["google-integration", workspaceId] }),
  });
  return {
    status: status.data,
    loading: status.isLoading,
    disconnect: disconnect.mutate,
    connectUrl: (wsId: string) =>
      `/api/integrations/google/connect?workspaceId=${encodeURIComponent(wsId)}`,
  };
}
