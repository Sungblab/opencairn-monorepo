import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./users";

export const siteAdminReports = pgTable(
  "site_admin_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reporterUserId: text("reporter_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    type: text("type").notNull().default("bug"),
    priority: text("priority").notNull().default("normal"),
    status: text("status").notNull().default("open"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    pageUrl: text("page_url"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    resolvedByUserId: text("resolved_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("site_admin_reports_status_created_idx").on(t.status, t.createdAt),
    index("site_admin_reports_reporter_idx").on(t.reporterUserId, t.createdAt),
  ],
);

export type SiteAdminReport = typeof siteAdminReports.$inferSelect;
export type SiteAdminReportInsert = typeof siteAdminReports.$inferInsert;
