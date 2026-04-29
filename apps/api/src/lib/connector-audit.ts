import { connectorAuditEvents, db } from "@opencairn/db";
import type { ConnectorAuditEvent } from "@opencairn/shared";

const SECRET_KEY_RE =
  /(token|secret|authorization|password|api[_-]?key|refresh)/i;

export function redactConnectorMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactConnectorMetadata);
  if (!value || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = SECRET_KEY_RE.test(key)
      ? "[redacted]"
      : redactConnectorMetadata(child);
  }
  return out;
}

export async function recordConnectorAuditEvent(
  event: ConnectorAuditEvent,
): Promise<void> {
  await db.insert(connectorAuditEvents).values({
    workspaceId: event.workspaceId,
    userId: event.userId,
    accountId: event.accountId ?? null,
    sourceId: event.sourceId ?? null,
    connectorJobId: event.connectorJobId ?? null,
    action: event.action,
    riskLevel: event.riskLevel,
    provider: event.provider,
    metadata: redactConnectorMetadata(event.metadata) as Record<
      string,
      unknown
    >,
  });
}
