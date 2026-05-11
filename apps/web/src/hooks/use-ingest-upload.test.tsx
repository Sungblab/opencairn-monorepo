import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIngestUpload } from "./use-ingest-upload";
import { useIngestStore } from "@/stores/ingest-store";

// Reset the zustand store between tests — runs survive otherwise
// because the persist middleware re-hydrates from in-memory localStorage.
function resetStore() {
  useIngestStore.setState({ runs: {} });
}

describe("useIngestUpload", () => {
  beforeEach(() => {
    resetStore();
    vi.restoreAllMocks();
  });

  it("posts FormData to /api/ingest/upload and primes background ingest state", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          workflowId: "ingest-wf-123",
          objectKey: "uploads/u/abc.pdf",
          sourceBundleNodeId: "00000000-0000-0000-0000-000000000010",
          originalFileId: "00000000-0000-0000-0000-000000000011",
        }),
        { status: 202, headers: { "content-type": "application/json" } },
      ),
    );

    const { result } = renderHook(() => useIngestUpload());

    const file = new File(["pdf bytes"], "report.pdf", {
      type: "application/pdf",
    });
    let returned: {
      workflowId: string;
      objectKey: string;
      sourceBundleNodeId: string | null;
      originalFileId: string | null;
    } | null = null;
    await act(async () => {
      returned = await result.current.upload(file, "00000000-0000-0000-0000-000000000001");
    });

    // Inspect the request — multipart fields are what /api/ingest/upload reads.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/ingest/upload");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    const fd = init?.body as FormData;
    expect(fd).toBeInstanceOf(FormData);
    expect(fd.get("projectId")).toBe(
      "00000000-0000-0000-0000-000000000001",
    );
    expect(fd.get("file")).toBeInstanceOf(File);
    expect((fd.get("file") as File).name).toBe("report.pdf");

    // Hook return value matches API response shape.
    expect(returned).toEqual({
      workflowId: "ingest-wf-123",
      objectKey: "uploads/u/abc.pdf",
      sourceBundleNodeId: "00000000-0000-0000-0000-000000000010",
      originalFileId: "00000000-0000-0000-0000-000000000011",
    });

    // Store now reflects a running ingest that a background subscriber can
    // observe.
    const state = useIngestStore.getState();
    expect(state.runs["ingest-wf-123"]).toMatchObject({
      workflowId: "ingest-wf-123",
      fileName: "report.pdf",
      mime: "application/pdf",
      status: "running",
      bundleNodeId: "00000000-0000-0000-0000-000000000010",
      bundleStatus: "running",
    });
    expect(result.current.error).toBeNull();
  });

  it("surfaces server errors without dispatching startRun", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );

    const { result } = renderHook(() => useIngestUpload());
    const file = new File(["x"], "x.pdf", { type: "application/pdf" });

    let thrown: unknown = null;
    await act(async () => {
      try {
        await result.current.upload(file, "wsid");
      } catch (e) {
        thrown = e;
      }
    });

    expect(thrown).toMatchObject({ status: 403, message: "Forbidden" });
    expect(result.current.error).toEqual({
      status: 403,
      message: "Forbidden",
    });
    // Critically, no run was dispatched — the store stays empty so no
    // dangling SSE listener attaches to a non-existent workflow.
    expect(useIngestStore.getState().runs).toEqual({});
  });

  it("forwards optional noteId in the multipart body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ workflowId: "wf-2", objectKey: "k" }),
        { status: 202 },
      ),
    );

    const { result } = renderHook(() => useIngestUpload());
    const file = new File(["x"], "y.pdf", { type: "application/pdf" });

    await act(async () => {
      await result.current.upload(file, "proj-1", { noteId: "note-9" });
    });

    const fd = fetchSpy.mock.calls[0]![1]?.body as FormData;
    expect(fd.get("noteId")).toBe("note-9");
  });

  it("falls back to application/octet-stream when File.type is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ workflowId: "wf-3", objectKey: "k" }),
        { status: 202 },
      ),
    );

    const { result } = renderHook(() => useIngestUpload());
    // Some browsers leave .type empty on drag-drop from a quirky source.
    const file = new File(["x"], "noext", { type: "" });

    await act(async () => {
      await result.current.upload(file, "proj-1");
    });

    expect(useIngestStore.getState().runs["wf-3"].mime).toBe(
      "application/octet-stream",
    );
  });
});
