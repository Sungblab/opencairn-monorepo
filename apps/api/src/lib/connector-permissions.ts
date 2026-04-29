import {
  and,
  connectorAccounts,
  connectorSources,
  db,
  eq,
  type ConnectorAccount,
  type ConnectorSource,
} from "@opencairn/db";

export class ConnectorNotFoundError extends Error {
  constructor(
    message: "connector_account_not_found" | "connector_source_not_found",
  ) {
    super(message);
    this.name = "ConnectorNotFoundError";
  }
}

export async function assertConnectorAccountOwner(
  userId: string,
  accountId: string,
): Promise<ConnectorAccount> {
  const [row] = await db
    .select()
    .from(connectorAccounts)
    .where(
      and(
        eq(connectorAccounts.id, accountId),
        eq(connectorAccounts.userId, userId),
      ),
    )
    .limit(1);
  if (!row) throw new ConnectorNotFoundError("connector_account_not_found");
  return row;
}

export async function assertConnectorSourceWorkspace(
  sourceId: string,
  workspaceId: string,
): Promise<ConnectorSource> {
  const [row] = await db
    .select()
    .from(connectorSources)
    .where(
      and(
        eq(connectorSources.id, sourceId),
        eq(connectorSources.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!row) throw new ConnectorNotFoundError("connector_source_not_found");
  return row;
}
