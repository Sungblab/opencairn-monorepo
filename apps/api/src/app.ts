import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { errorHandler } from "./middleware/error";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";
import { workspaceRoutes } from "./routes/workspaces";
import { inviteRoutes } from "./routes/invites";
import { projectRoutes } from "./routes/projects";
import { folderRoutes } from "./routes/folders";
import { tagRoutes } from "./routes/tags";
import { noteRoutes } from "./routes/notes";
import { noteAssetRoutes } from "./routes/note-assets";
import { ingestRoutes } from "./routes/ingest";
import { internalRoutes } from "./routes/internal";
import { commentsRouter } from "./routes/comments";
import { mentionsRouter } from "./routes/mentions";
import { integrationsRouter } from "./routes/integrations";
import { importRouter } from "./routes/import";
import { researchRouter } from "./routes/research";
import { threadRoutes } from "./routes/threads";
import { messageFeedbackRoutes } from "./routes/message-feedback";
import { userRoutes } from "./routes/users";
import { streamRoutes } from "./routes/stream";
import { graphRoutes } from "./routes/graph";
import { notificationRoutes } from "./routes/notifications";

export function createApp() {
  const app = new Hono();

  app.use("*", logger());

  app.use(
    "*",
    cors({
      origin: process.env.CORS_ORIGIN?.split(",") ?? ["http://localhost:3000"],
      credentials: true,
    })
  );

  // /api/internal must be mounted BEFORE the generic /api routes
  // (inviteRoutes, projectRoutes) — those sub-apps use requireAuth as a
  // wildcard middleware and would otherwise intercept /api/internal/* with
  // a 401 session check, masking the shared-secret gate inside internal.
  app.route("/api/internal", internalRoutes);
  app.route("/api/health", healthRoutes);
  app.route("/api/auth", authRoutes);
  app.route("/api/workspaces", workspaceRoutes);
  // /api/integrations has a public callback route (/google/callback) that
  // must not be gated by auth. Any router mounted at the generic "/api"
  // prefix with .use("*", requireAuth) intercepts /api/* wildcard, so we
  // mount integrations BEFORE the invite/project/comments/mentions routers.
  // Same precedent as /api/internal.
  app.route("/api/integrations", integrationsRouter);
  // /api/import sits above the wildcard /api routers for the same reason —
  // inviteRoutes' .use("*", requireAuth) would otherwise race the importRouter's
  // own per-route requireAuth and surface a 401 before zValidator can run.
  app.route("/api/import", importRouter);
  app.route("/api/threads", threadRoutes);
  // Mounted alongside /api/threads (specific path) so the wildcard /api routers
  // below don't intercept this with their own requireAuth chains.
  app.route("/api/message-feedback", messageFeedbackRoutes);
  app.route("/api", inviteRoutes);  // /api/workspaces/:id/invites and /api/invites/:token/*
  app.route("/api", projectRoutes);
  app.route("/api/projects", graphRoutes);
  app.route("/api/folders", folderRoutes);
  app.route("/api/tags", tagRoutes);
  // Phase 3-B viewer endpoints (/:id/file, /:id/data). Must be mounted BEFORE
  // noteRoutes — noteRoutes declares a catch-all GET /:id that would
  // otherwise swallow the file/data suffixes. Hono's matcher walks
  // registrations in order, so the first sub-app that returns a non-404
  // wins; noteAssetRoutes 404s fall through to noteRoutes naturally.
  app.route("/api/notes", noteAssetRoutes);
  app.route("/api/notes", noteRoutes);
  app.route("/api/ingest", ingestRoutes);
  app.route("/api/research", researchRouter);
  app.route("/api/users", userRoutes);
  app.route("/api/notifications", notificationRoutes);
  app.route("/api/stream", streamRoutes);  // SSE: project tree (Phase 2) + notifications (Phase 5)
  app.route("/api", commentsRouter);  // /api/notes/:noteId/comments (Plan 2B)
  app.route("/api", mentionsRouter);  // /api/mentions/search (Plan 2B)

  app.onError(errorHandler);

  return app;
}
