import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  byokKeyQueryKey,
  getByokKey,
  setByokKey,
  deleteByokKey,
} from "./api-client-byok-key";

describe("api-client-byok-key", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("byokKeyQueryKey is a stable tuple", () => {
    expect(byokKeyQueryKey()).toEqual(["byok-key"]);
  });

  it("getByokKey returns parsed body on 200", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          registered: true,
          lastFour: "abcd",
          updatedAt: "2026-04-26T10:00:00.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const result = await getByokKey();
    expect(result).toEqual({
      registered: true,
      lastFour: "abcd",
      updatedAt: "2026-04-26T10:00:00.000Z",
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/users/me/byok-key",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("getByokKey throws on non-200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 500 }),
    );
    await expect(getByokKey()).rejects.toThrow(
      /byok-key request failed \(500 unknown\)/,
    );
  });

  it("setByokKey posts body and returns parsed response", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          registered: true,
          lastFour: "wxyz",
          updatedAt: "2026-04-26T10:00:00.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const result = await setByokKey("AIzaSyTestPhaseEClientWxyz");
    expect(result).toMatchObject({ registered: true, lastFour: "wxyz" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/users/me/byok-key",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ apiKey: "AIzaSyTestPhaseEClientWxyz" }),
      }),
    );
  });

  it("setByokKey forwards 400 error code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: "invalid_input", code: "wrong_prefix" }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(setByokKey("not_a_key")).rejects.toMatchObject({
      code: "wrong_prefix",
    });
  });

  it("deleteByokKey returns parsed response", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ registered: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await deleteByokKey();
    expect(result).toEqual({ registered: false });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/users/me/byok-key",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
