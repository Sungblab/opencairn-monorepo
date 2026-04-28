import type {
  McpServerCreate,
  McpServerSummary,
  McpServerTestResult,
  McpServerUpdate,
} from "@opencairn/shared";

const BASE = "/api/mcp/servers";

async function unwrap<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  throw new Error(`mcp request failed (${res.status})`);
}

export const mcpServersQueryKey = () => ["mcp-servers"] as const;

export async function listServers(): Promise<McpServerSummary[]> {
  const res = await fetch(BASE, { credentials: "include" });
  const body = await unwrap<{ servers: McpServerSummary[] }>(res);
  return body.servers;
}

export async function createServer(
  body: McpServerCreate,
): Promise<McpServerSummary> {
  const res = await fetch(BASE, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return unwrap<McpServerSummary>(res);
}

export async function updateServer(
  id: string,
  body: McpServerUpdate,
): Promise<McpServerSummary> {
  const res = await fetch(`${BASE}/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return unwrap<McpServerSummary>(res);
}

export async function deleteServer(id: string): Promise<void> {
  const res = await fetch(`${BASE}/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await unwrap<{ ok: true }>(res);
}

export async function testServer(id: string): Promise<McpServerTestResult> {
  const res = await fetch(`${BASE}/${id}/test`, {
    method: "POST",
    credentials: "include",
  });
  return unwrap<McpServerTestResult>(res);
}
