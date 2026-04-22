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
import { ingestRoutes } from "./routes/ingest";
import { internalRoutes } from "./routes/internal";
import { commentsRouter } from "./routes/comments";
import { mentionsRouter } from "./routes/mentions";
import { integrationsRouter } from "./routes/integrations";

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
  app.route("/api", inviteRoutes);  // /api/workspaces/:id/invites and /api/invites/:token/*
  app.route("/api", projectRoutes);
  app.route("/api/folders", folderRoutes);
  app.route("/api/tags", tagRoutes);
  app.route("/api/notes", noteRoutes);
  app.route("/api/ingest", ingestRoutes);
  app.route("/api", commentsRouter);  // /api/notes/:noteId/comments (Plan 2B)
  app.route("/api", mentionsRouter);  // /api/mentions/search (Plan 2B)

  app.onError(errorHandler);

  return app;
}
