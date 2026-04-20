import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { conversationScopeEnum, messageRoleEnum } from "./enums";

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").default(""),
    scope: conversationScopeEnum("scope").notNull().default("project"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("conversations_project_id_idx").on(t.projectId)]
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    sources: jsonb("sources"),
    canvasData: jsonb("canvas_data"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_id_idx").on(t.conversationId)]
);
