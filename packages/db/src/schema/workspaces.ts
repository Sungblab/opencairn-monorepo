import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, index, pgEnum, check } from "drizzle-orm/pg-core";
import { user } from "./users";

export const workspacePlanEnum = pgEnum("workspace_plan", ["free", "pro", "enterprise"]);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    planType: workspacePlanEnum("plan_type").notNull().default("free"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
  },
  // `workspaces_slug_unique` (the constraint index auto-created by `.unique()`)
  // already covers btree lookups on slug — no separate `workspaces_slug_idx`.
  // CHECK pins slug to lowercase so `Acme` and `acme` cannot both exist as
  // routable slugs (case-sensitive unique would allow both).
  (t) => [
    index("workspaces_owner_id_idx").on(t.ownerId),
    check("workspaces_slug_lower_check", sql`${t.slug} = lower(${t.slug})`),
  ]
);
