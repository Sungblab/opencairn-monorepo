import { Hono } from "hono";
import { z } from "zod";

import { notificationKindEnum } from "@opencairn/db";
import {
  NotificationKindSchema,
  NotificationPreferenceUpsertSchema,
  NotificationProfileUpdateSchema,
  type NotificationKind,
} from "@opencairn/shared";

import { requireAuth } from "../middleware/auth";
import {
  getEffectivePreferences,
  getProfile,
  updateProfile,
  upsertPreference,
} from "../lib/notification-preferences";
import type { AppEnv } from "../lib/types";

// Plan 2 Task 14 — settings page backend.
//
// Mounted under `/api/notification-preferences`. All routes require auth
// and operate on the caller's own preferences. There is no admin path
// here; admins use direct DB updates if they need to override.

export const notificationPreferenceRoutes = new Hono<AppEnv>().use(
  "*",
  requireAuth,
);

// GET / — return all 5 effective rows (DEFAULT_PREFERENCES merged over
// stored). Always returns exactly 5 rows so the client never has to
// reason about missing kinds.
notificationPreferenceRoutes.get("/", async (c) => {
  const me = c.get("user");
  const prefs = await getEffectivePreferences(me.id);
  return c.json({ preferences: prefs });
});

// GET /profile — locale + timezone for the email templates and digest_daily
// scheduling. Separate from /me so the settings page only re-fetches what
// it touches.
notificationPreferenceRoutes.get("/profile", async (c) => {
  const me = c.get("user");
  const profile = await getProfile(me.id);
  return c.json(profile);
});

// PUT /profile — partial update for locale and/or timezone. Body shape
// is enforced by NotificationProfileUpdateSchema (.strict() rejects
// extra keys). REGISTERED BEFORE `/:kind` because Hono walks
// registrations in order — `/:kind` would match `/profile` otherwise
// and fail the enum check.
notificationPreferenceRoutes.put("/profile", async (c) => {
  const me = c.get("user");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = NotificationProfileUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  }

  const profile = await updateProfile({ userId: me.id, body: parsed.data });
  return c.json(profile);
});

// PUT /:kind — upsert one preference row. The client always sends both
// fields so we don't need partial-update semantics here.
notificationPreferenceRoutes.put("/:kind", async (c) => {
  const me = c.get("user");
  const kindParam = c.req.param("kind");

  const kindResult = NotificationKindSchema.safeParse(kindParam);
  if (!kindResult.success) {
    return c.json({ error: "unknown notification kind" }, 400);
  }
  const kind: NotificationKind = kindResult.data;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = NotificationPreferenceUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  }

  const row = await upsertPreference({
    userId: me.id,
    kind,
    body: parsed.data,
  });
  return c.json(row);
});

// Sanity export — keeps notificationKindEnum import live so the lint/tsc
// catch a future kind addition that doesn't roll through the shared schema.
void notificationKindEnum;
void z;
