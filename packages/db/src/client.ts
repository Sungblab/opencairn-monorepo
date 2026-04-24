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
import * as concepts from "./schema/concepts";
import * as wikiLogs from "./schema/wiki-logs";
import * as learning from "./schema/learning";
import * as jobs from "./schema/jobs";
import * as userPreferences from "./schema/user-preferences";
import * as agentRuns from "./schema/agent-runs";
import * as projectSemaphores from "./schema/project-semaphores";
import * as embeddingBatches from "./schema/embedding-batches";
import * as comments from "./schema/comments";
import * as yjsDocuments from "./schema/yjs-documents";

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
  ...concepts,
  ...wikiLogs,
  ...learning,
  ...jobs,
  ...userPreferences,
  ...agentRuns,
  ...projectSemaphores,
  ...embeddingBatches,
  ...comments,
  ...yjsDocuments,
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
