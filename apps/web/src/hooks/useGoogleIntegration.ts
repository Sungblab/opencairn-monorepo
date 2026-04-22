"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface GoogleIntegrationStatus {
  connected: boolean;
  accountEmail: string | null;
  scopes: string[] | null;
}

async function fetchStatus(): Promise<GoogleIntegrationStatus> {
  const res = await fetch("/api/integrations/google", {
    credentials: "include",
  });
  if (!res.ok) {
    // 401 = not signed in. Rather than crashing the import page we report
    // "not connected" — the ProtectedRoute wrapper will have already sent
    // the user to /login in the common case.
    return { connected: false, accountEmail: null, scopes: null };
  }
  return (await res.json()) as GoogleIntegrationStatus;
}

export function useGoogleIntegration() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["google-integration"],
    queryFn: fetchStatus,
    // Reasonable while the user is actively on the Import page — stale cache
    // makes the "just finished OAuth" redirect feel laggy otherwise.
    staleTime: 10_000,
  });
  const disconnect = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/integrations/google", {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`disconnect failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["google-integration"] }),
  });
  return {
    status: status.data,
    loading: status.isLoading,
    disconnect: disconnect.mutate,
    connectUrl: (workspaceId: string) =>
      `/api/integrations/google/connect?workspaceId=${encodeURIComponent(workspaceId)}`,
  };
}
