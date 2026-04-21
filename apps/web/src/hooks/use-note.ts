"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export function useNote(id: string) {
  return useQuery({
    queryKey: ["note", id],
    queryFn: () => api.getNote(id),
    enabled: Boolean(id),
  });
}
