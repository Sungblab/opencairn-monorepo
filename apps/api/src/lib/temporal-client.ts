import { Client, Connection } from "@temporalio/client";

// Lazy singleton. The Temporal server is optional in dev (Task 2 adds the
// docker service); this module must not crash API startup when unreachable.
let _client: Client | null = null;

export async function getTemporalClient(): Promise<Client> {
  if (_client) return _client;
  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  });
  _client = new Client({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  });
  return _client;
}
