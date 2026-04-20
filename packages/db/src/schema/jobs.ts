import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./users";
import { projects } from "./projects";
import { jobStatusEnum } from "./enums";

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    type: text("type").notNull(),
    status: jobStatusEnum("status").notNull().default("queued"),
    progress: jsonb("progress"),
    input: jsonb("input"),
    output: jsonb("output"),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    index("jobs_user_id_idx").on(t.userId),
    index("jobs_status_idx").on(t.status),
  ]
);

export const usageRecords = pgTable(
  "usage_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // action: 'ingest' | 'qa' | 'audio' — plan-9 enforcePlanLimit에서 사용
    action: text("action").notNull(),
    // month: 'YYYY-MM' 형식 — plan-9 incrementUsage upsert 키
    month: text("month").notNull(),
    // count: 월별 누적 카운트 (tokensUsed 대신)
    count: integer("count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("usage_records_user_id_idx").on(t.userId),
    // plan-9 incrementUsage onConflictDoUpdate 대상 복합 unique
    uniqueIndex("usage_records_user_action_month_idx").on(t.userId, t.action, t.month),
  ]
);
