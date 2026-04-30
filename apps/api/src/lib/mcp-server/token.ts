import { createHash, randomBytes } from "node:crypto";

import {
  and,
  db as defaultDb,
  eq,
  gt,
  isNull,
  mcpServerTokens,
  or,
  type DB,
} from "@opencairn/db";

export const MCP_SERVER_TOKEN_PREFIX = "ocmcp_";
const TOKEN_BYTES = 32;

export type VerifiedMcpServerToken = {
  id: string;
  workspaceId: string;
  scopes: string[];
  expiresAt: Date | null;
};

export function generateMcpServerToken(): string {
  return `${MCP_SERVER_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
}

export function hashMcpServerToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function tokenPrefix(token: string): string {
  return token.slice(0, MCP_SERVER_TOKEN_PREFIX.length + 4);
}

export function looksLikeMcpServerToken(token: string): boolean {
  return /^ocmcp_[A-Za-z0-9_-]{43}$/.test(token);
}

export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export async function verifyMcpServerToken(
  token: string,
  opts?: { db?: DB; now?: Date },
): Promise<VerifiedMcpServerToken | null> {
  if (!looksLikeMcpServerToken(token)) return null;
  const conn = opts?.db ?? defaultDb;
  const now = opts?.now ?? new Date();
  const [row] = await conn
    .select({
      id: mcpServerTokens.id,
      workspaceId: mcpServerTokens.workspaceId,
      scopes: mcpServerTokens.scopes,
      expiresAt: mcpServerTokens.expiresAt,
    })
    .from(mcpServerTokens)
    .where(
      and(
        eq(mcpServerTokens.tokenHash, hashMcpServerToken(token)),
        isNull(mcpServerTokens.revokedAt),
        or(isNull(mcpServerTokens.expiresAt), gt(mcpServerTokens.expiresAt, now)),
      ),
    )
    .limit(1);

  if (!row) return null;
  await conn
    .update(mcpServerTokens)
    .set({ lastUsedAt: now })
    .where(eq(mcpServerTokens.id, row.id));
  return row;
}
