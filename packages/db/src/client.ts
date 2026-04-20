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
import * as conversations from "./schema/conversations";

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
  ...conversations,
};

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
