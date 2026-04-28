import type { McpServerTestResult } from "@opencairn/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

type AuthHeader = { name: string; value: string } | null;
type RunListTools = (
  serverUrl: string,
  authHeader: AuthHeader,
) => Promise<McpServerTestResult>;

const TEST_TIMEOUT_MS = 10_000;

let runListToolsOverride: RunListTools | null = null;

export function __setRunListToolsForTest(fn: RunListTools | null): void {
  runListToolsOverride = fn;
}

const blockedAddresses = new BlockList();
blockedAddresses.addSubnet("0.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("10.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("100.64.0.0", 10, "ipv4");
blockedAddresses.addSubnet("127.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("169.254.0.0", 16, "ipv4");
blockedAddresses.addSubnet("172.16.0.0", 12, "ipv4");
blockedAddresses.addSubnet("192.0.0.0", 24, "ipv4");
blockedAddresses.addSubnet("192.0.2.0", 24, "ipv4");
blockedAddresses.addSubnet("192.168.0.0", 16, "ipv4");
blockedAddresses.addSubnet("198.18.0.0", 15, "ipv4");
blockedAddresses.addSubnet("198.51.100.0", 24, "ipv4");
blockedAddresses.addSubnet("203.0.113.0", 24, "ipv4");
blockedAddresses.addSubnet("224.0.0.0", 4, "ipv4");
blockedAddresses.addSubnet("240.0.0.0", 4, "ipv4");
blockedAddresses.addAddress("255.255.255.255", "ipv4");
blockedAddresses.addAddress("::", "ipv6");
blockedAddresses.addAddress("::1", "ipv6");
blockedAddresses.addSubnet("fc00::", 7, "ipv6");
blockedAddresses.addSubnet("fe80::", 10, "ipv6");
blockedAddresses.addSubnet("ff00::", 8, "ipv6");

function isBlockedIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockedAddresses.check(address, "ipv4");
  if (family === 6) return blockedAddresses.check(address, "ipv6");
  return true;
}

export async function validateMcpServerUrl(serverUrl: string): Promise<void> {
  const url = new URL(serverUrl);
  if (url.protocol !== "https:") {
    throw new Error("MCP server URL must use HTTPS");
  }
  const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (!hostname) {
    throw new Error("MCP server URL must include a host");
  }

  const allowlist = process.env.MCP_URL_ALLOWLIST;
  const allowlistMatch = allowlist
    ? hostname.match(new RegExp(allowlist))
    : null;
  if (allowlist && allowlistMatch?.[0] !== hostname) {
    throw new Error("MCP server host is not allowed");
  }

  const directIp = isIP(hostname);
  const addresses = directIp
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isBlockedIp(address))
  ) {
    throw new Error("MCP server host resolves to a private address");
  }
}

export async function runListTools(
  serverUrl: string,
  authHeader: AuthHeader,
): Promise<McpServerTestResult> {
  if (runListToolsOverride) return runListToolsOverride(serverUrl, authHeader);

  const started = Date.now();
  try {
    await validateMcpServerUrl(serverUrl);
    const headers = authHeader
      ? { [authHeader.name]: authHeader.value }
      : undefined;
    const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
      requestInit: {
        ...(headers ? { headers } : {}),
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      },
    });
    const client = new Client({
      name: "opencairn-api-mcp-test",
      version: "0.1.0",
    });
    await client.connect(transport);
    try {
      const result = await client.listTools();
      const tools = result.tools ?? [];
      return {
        status: "ok",
        toolCount: tools.length,
        sampleNames: tools.slice(0, 5).map((tool) => tool.name),
        durationMs: Date.now() - started,
      };
    } finally {
      await client.close();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /\b(401|403|unauthori[sz]ed|forbidden)\b/i.test(message)
      ? "auth_failed"
      : "transport_error";
    return {
      status,
      toolCount: 0,
      sampleNames: [],
      durationMs: Date.now() - started,
      ...(status === "transport_error"
        ? { errorMessage: "Unable to reach MCP server." }
        : {}),
    };
  }
}
