import { beforeEach, describe, expect, it } from "vitest";
import { useThreadsStore } from "./threads-store";

describe("threads-store", () => {
  beforeEach(() => {
    localStorage.clear();
    useThreadsStore.setState(useThreadsStore.getInitialState(), true);
  });

  it("activeThreadId null by default", () => {
    useThreadsStore.getState().setWorkspace("ws-a");
    expect(useThreadsStore.getState().activeThreadId).toBeNull();
  });

  it("setActiveThread persists under oc:active_thread:<wsId>:project:<projectId>", () => {
    useThreadsStore.getState().setWorkspace("ws-a", "project-a");
    useThreadsStore.getState().setActiveThread("thread-42");
    expect(localStorage.getItem("oc:active_thread:ws-a:project:project-a")).toBe(
      JSON.stringify("thread-42"),
    );
  });

  it("setWorkspace loads persisted value for the active project only", () => {
    localStorage.setItem(
      "oc:active_thread:ws-b:project:project-a",
      JSON.stringify("thread-99"),
    );
    localStorage.setItem(
      "oc:active_thread:ws-b:project:project-b",
      JSON.stringify("thread-100"),
    );
    useThreadsStore.getState().setWorkspace("ws-b", "project-b");
    expect(useThreadsStore.getState().activeThreadId).toBe("thread-100");
  });

  it("keeps workspace-level active thread separate from project threads", () => {
    localStorage.setItem(
      "oc:active_thread:ws-b:workspace",
      JSON.stringify("thread-ws"),
    );
    localStorage.setItem(
      "oc:active_thread:ws-b:project:project-a",
      JSON.stringify("thread-project"),
    );

    useThreadsStore.getState().setWorkspace("ws-b", null);

    expect(useThreadsStore.getState().activeThreadId).toBe("thread-ws");
  });

  it("falls back to legacy workspace key for old workspace-level threads", () => {
    localStorage.setItem("oc:active_thread:ws-b", JSON.stringify("thread-99"));
    useThreadsStore.getState().setWorkspace("ws-b", null);
    expect(useThreadsStore.getState().activeThreadId).toBe("thread-99");
  });
});
