import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { user } from "./users";
import { projects } from "./projects";
import { suggestionTypeEnum, suggestionStatusEnum } from "./enums";

export const suggestions = pgTable(
  "suggestions",
  {
    id:         uuid("id").defaultRandom().primaryKey(),
    userId:     text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    projectId:  uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    type:       suggestionTypeEnum("type").notNull(),
    payload:    jsonb("payload").notNull().$type<Record<string, unknown>>(),
    status:     suggestionStatusEnum("status").notNull().default("pending"),
    createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("suggestions_user_status_idx").on(t.userId, t.status),
    index("suggestions_project_type_idx").on(t.projectId, t.type),
  ]
);
