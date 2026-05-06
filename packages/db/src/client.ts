import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as users from "./schema/users";
import * as auth from "./schema/auth";
import * as workspaces from "./schema/workspaces";
import * as workspaceMembers from "./schema/workspace-members";
import * as workspaceInvites from "./schema/workspace-invites";
import * as projects from "./schema/projects";
import * as projectPermissions from "./schema/project-permissions";
import * as pagePermissions from "./schema/page-permissions";
import * as folders from "./schema/folders";
import * as tags from "./schema/tags";
import * as notes from "./schema/notes";
import * as noteChunks from "./schema/note-chunks";
import * as concepts from "./schema/concepts";
import * as evidence from "./schema/evidence";
import * as wikiLogs from "./schema/wiki-logs";
import * as learning from "./schema/learning";
import * as jobs from "./schema/jobs";
import * as userPreferences from "./schema/user-preferences";
import * as agentRuns from "./schema/agent-runs";
import * as agentActions from "./schema/agent-actions";
import * as agenticPlans from "./schema/agentic-plans";
import * as projectSemaphores from "./schema/project-semaphores";
import * as embeddingBatches from "./schema/embedding-batches";
import * as comments from "./schema/comments";
import * as yjsDocuments from "./schema/yjs-documents";
import * as wikiLinks from "./schema/wiki-links";
import * as suggestions from "./schema/suggestions";
import * as staleAlerts from "./schema/stale-alerts";
import * as audioFiles from "./schema/audio-files";
import * as userMcpServers from "./schema/user-mcp-servers";
import * as connectors from "./schema/connectors";
import * as mcpServerTokens from "./schema/mcp-server-tokens";
import * as noteVersions from "./schema/note-versions";
import * as agentFiles from "./schema/agent-files";
import * as codeWorkspaces from "./schema/code-workspaces";

const schema = {
  ...users,
  ...auth,
  ...workspaces,
  ...workspaceMembers,
  ...workspaceInvites,
  ...projects,
  ...projectPermissions,
  ...pagePermissions,
  ...folders,
  ...tags,
  ...notes,
  ...noteChunks,
  ...concepts,
  ...evidence,
  ...wikiLogs,
  ...learning,
  ...jobs,
  ...userPreferences,
  ...agentRuns,
  ...agentActions,
  ...agenticPlans,
  ...projectSemaphores,
  ...embeddingBatches,
  ...comments,
  ...yjsDocuments,
  ...wikiLinks,
  ...suggestions,
  ...staleAlerts,
  ...audioFiles,
  ...userMcpServers,
  ...connectors,
  ...mcpServerTokens,
  ...noteVersions,
  ...agentFiles,
  ...codeWorkspaces,
};

// 명시적 factory — 소비자가 자체 pool을 소유하고 싶을 때 사용.
// 호출자가 pool 수명 책임 (no global cache). hocuspocus 등 별개 서비스용.
export function createDb(url: string) {
  const client = postgres(url, {
    prepare: false,
    max: 10,
    idle_timeout: 20,
    max_lifetime: 60 * 5,
  });
  return drizzle(client, { schema });
}

// 모듈-레벨 singleton — HMR 대비 globalForDb 캐시 유지.
const globalForDb = globalThis as unknown as {
  _pgClient?: ReturnType<typeof postgres>;
};

const sql =
  globalForDb._pgClient ??
  postgres(process.env.DATABASE_URL!, {
    prepare: false,
    max: 10,
    idle_timeout: 20,
    max_lifetime: 60 * 5,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb._pgClient = sql;
}

export const db = drizzle(sql, { schema });
export type DB = typeof db;
// Drizzle transaction handle — the type passed to the callback of db.transaction().
// Use this instead of DB when you accept either db or tx so helpers work in both contexts.
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
