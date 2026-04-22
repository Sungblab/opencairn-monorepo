"use client";

// Plan 2B Task 18 — TanStack Query hooks for the /notes/:id/comments tree.
// All five REST operations (list/create/update/delete/resolve) share the same
// queryKey namespace so mutations invalidate the same cached list the panel
// renders. Polling is a pragmatic stopgap until Hocuspocus awareness pushes
// comment deltas in a later task — 30s matches the activity window for
// in-progress review without being noisy when idle.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  commentsApi,
  type CreateCommentInput,
  type UpdateCommentInput,
} from "@/lib/api-client";

export function useComments(noteId: string) {
  return useQuery({
    queryKey: ["comments", noteId],
    queryFn: () => commentsApi.list(noteId),
    refetchInterval: 30_000,
    enabled: Boolean(noteId),
  });
}

export function useCreateComment(noteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCommentInput) =>
      commentsApi.create(noteId, input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["comments", noteId] }),
  });
}

export function useUpdateComment(noteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCommentInput }) =>
      commentsApi.update(id, body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["comments", noteId] }),
  });
}

export function useDeleteComment(noteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => commentsApi.remove(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["comments", noteId] }),
  });
}

export function useResolveComment(noteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => commentsApi.resolve(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["comments", noteId] }),
  });
}
