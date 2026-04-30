import type {
  McpTokenCreate,
  McpTokenCreated,
  McpTokenSummary,
} from "@opencairn/shared";

const BASE = "/api/mcp/tokens";

export type McpWorkspaceOption = {
  id: string;
  slug: string;
  name: string;
  role: string;
};

async function unwrap<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  throw new Error(`mcp server token request failed (${res.status})`);
}

export const mcpServerTokensQueryKey = (workspaceId: string) =>
  ["mcp-server-tokens", workspaceId] as const;

export const mcpTokenWorkspacesQueryKey = () =>
  ["mcp-token-workspaces"] as const;

export async function listMcpTokenWorkspaces(): Promise<McpWorkspaceOption[]> {
  const res = await fetch("/api/workspaces/me", { credentials: "include" });
  const body = await unwrap<{ workspaces: McpWorkspaceOption[] }>(res);
  return body.workspaces;
}

export async function listMcpServerTokens(
  workspaceId: string,
): Promise<{ tokens: McpTokenSummary[] }> {
  const res = await fetch(`${BASE}?workspaceId=${encodeURIComponent(workspaceId)}`, {
    credentials: "include",
  });
  return unwrap<{ tokens: McpTokenSummary[] }>(res);
}

export async function createMcpServerToken(
  input: McpTokenCreate,
): Promise<McpTokenCreated> {
  const res = await fetch(BASE, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap<McpTokenCreated>(res);
}

export async function revokeMcpServerToken(id: string): Promise<void> {
  const res = await fetch(`${BASE}/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await unwrap<{ ok: true }>(res);
}
