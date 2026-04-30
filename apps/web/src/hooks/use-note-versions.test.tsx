import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  useCreateNoteCheckpoint,
  useNoteVersionDetail,
  useNoteVersionDiff,
  useNoteVersions,
  useRestoreNoteVersion,
} from "./use-note-versions";
import {
  createNoteCheckpoint,
  getNoteVersion,
  getNoteVersionDiff,
  listNoteVersions,
  restoreNoteVersion,
} from "@/lib/api-client-note-versions";

vi.mock("@/lib/api-client-note-versions", () => ({
  listNoteVersions: vi.fn(),
  getNoteVersion: vi.fn(),
  getNoteVersionDiff: vi.fn(),
  createNoteCheckpoint: vi.fn(),
  restoreNoteVersion: vi.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("use note versions hooks", () => {
  it("loads the note version list only when enabled", async () => {
    vi.mocked(listNoteVersions).mockResolvedValue({
      versions: [],
      nextCursor: null,
    });

    const { rerender } = renderHook(
      ({ enabled }) => useNoteVersions("note-1", enabled),
      { wrapper, initialProps: { enabled: false } },
    );

    expect(listNoteVersions).not.toHaveBeenCalled();
    rerender({ enabled: true });

    await waitFor(() =>
      expect(listNoteVersions).toHaveBeenCalledWith("note-1"),
    );
  });

  it("loads detail and diff for the selected version", async () => {
    vi.mocked(getNoteVersion).mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      version: 2,
      title: "Draft",
      contentTextPreview: "Draft",
      actor: { type: "system", id: null, name: null },
      source: "auto_save",
      reason: null,
      createdAt: "2026-04-30T00:00:00.000Z",
      content: [{ type: "p", children: [{ text: "Draft" }] }],
      contentText: "Draft",
    });
    vi.mocked(getNoteVersionDiff).mockResolvedValue({
      fromVersion: 2,
      toVersion: "current",
      summary: {
        addedBlocks: 0,
        removedBlocks: 0,
        changedBlocks: 1,
        addedWords: 1,
        removedWords: 1,
      },
      blocks: [],
    });

    renderHook(() => useNoteVersionDetail("note-1", 2), { wrapper });
    renderHook(() => useNoteVersionDiff("note-1", 2, true), { wrapper });

    await waitFor(() =>
      expect(getNoteVersion).toHaveBeenCalledWith("note-1", 2),
    );
    await waitFor(() =>
      expect(getNoteVersionDiff).toHaveBeenCalledWith("note-1", 2, "current"),
    );
  });

  it("invalidates history after checkpoint and restore mutations", async () => {
    vi.mocked(createNoteCheckpoint).mockResolvedValue({
      created: true,
      version: 3,
    });
    vi.mocked(restoreNoteVersion).mockResolvedValue({
      noteId: "11111111-1111-4111-8111-111111111111",
      restoredFromVersion: 2,
      newVersion: 4,
      updatedAt: "2026-04-30T00:00:00.000Z",
    });

    const checkpoint = renderHook(() => useCreateNoteCheckpoint("note-1"), {
      wrapper,
    });
    const restore = renderHook(() => useRestoreNoteVersion("note-1"), {
      wrapper,
    });

    checkpoint.result.current.mutate("before restore");
    restore.result.current.mutate(2);

    await waitFor(() =>
      expect(createNoteCheckpoint).toHaveBeenCalledWith(
        "note-1",
        "before restore",
      ),
    );
    await waitFor(() =>
      expect(restoreNoteVersion).toHaveBeenCalledWith("note-1", 2),
    );
  });
});
