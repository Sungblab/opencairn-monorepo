export { db, type DB } from "./client";

export * from "./schema/enums";
export * from "./schema/users";
export * from "./schema/auth";
export * from "./schema/workspaces";
export * from "./schema/workspace-members";
export * from "./schema/workspace-invites";
export * from "./schema/projects";
export * from "./schema/project-permissions";
export * from "./schema/page-permissions";
export * from "./schema/folders";
export * from "./schema/tags";
export * from "./schema/notes";
export * from "./schema/concepts";
export * from "./schema/wiki-logs";
export * from "./schema/learning";
export * from "./schema/jobs";
export * from "./schema/conversations";
export * from "./schema/user-preferences";
export * from "./schema/agent-runs";
export * from "./schema/project-semaphores";
export * from "./schema/embedding-batches";
export * from "./schema/comments";
export * from "./schema/yjs-documents";

export { eq, and, or, desc, asc, sql, inArray, isNull, ilike, lt, gt, lte, gte, count } from "drizzle-orm";
