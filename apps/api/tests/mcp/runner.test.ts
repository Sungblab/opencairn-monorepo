import { beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.hoisted(() => vi.fn());
const transportOptions = vi.hoisted(() => [] as unknown[]);

vi.mock("node:dns/promises", () => ({
  lookup: lookupMock,
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    constructor(_url: URL, options: unknown) {
      transportOptions.push(options);
    }
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    async connect() {}
    async listTools() {
      return { tools: [] };
    }
    async close() {}
  },
}));

import { runListTools, validateMcpServerUrl } from "../../src/lib/mcp-runner";

describe("mcp runner SSRF guard", () => {
  beforeEach(() => {
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    transportOptions.length = 0;
  });

  it("rejects non-https and private hosts before connecting", async () => {
    await expect(validateMcpServerUrl("http://example.com/mcp")).rejects.toThrow(
      /https/i,
    );
    await expect(
      validateMcpServerUrl("https://127.0.0.1/mcp"),
    ).rejects.toThrow(/private/i);
    await expect(validateMcpServerUrl("https://[::1]/mcp")).rejects.toThrow(
      /private/i,
    );
    expect(lookupMock).not.toHaveBeenCalledWith(
      "127.0.0.1",
      expect.anything(),
    );
  });

  it("rejects hostnames resolving to any blocked address", async () => {
    lookupMock.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);

    await expect(
      validateMcpServerUrl("https://mixed.example/mcp"),
    ).rejects.toThrow(/private/i);
  });

  it("passes a timeout abort signal into the streamable HTTP transport", async () => {
    const result = await runListTools("https://public.example/mcp", null);

    expect(result.status).toBe("ok");
    expect(transportOptions).toHaveLength(1);
    expect(transportOptions[0]).toMatchObject({
      requestInit: {
        signal: expect.any(AbortSignal),
      },
    });
  });
});
