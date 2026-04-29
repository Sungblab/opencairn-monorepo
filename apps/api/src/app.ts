import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { errorHandler } from "./middleware/error";
import {
  csrfOriginGuard,
  securityHeaders,
  trustedOriginsFromEnv,
} from "./lib/security";
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
import { shareRouter } from "./routes/share";
import { integrationsRouter } from "./routes/integrations";
import { importRouter } from "./routes/import";
import { researchRouter } from "./routes/research";
import { codeRoutes } from "./routes/code";
import { canvasRoutes } from "./routes/canvas";
import { threadRoutes } from "./routes/threads";
import { chatRoutes } from "./routes/chat";
import { searchRoutes } from "./routes/search";
import { messageFeedbackRoutes } from "./routes/message-feedback";
import { userRoutes } from "./routes/users";
import { streamRoutes } from "./routes/stream";
import { graphRoutes } from "./routes/graph";
import { learningRoutes } from "./routes/learning";
import { socraticRoutes } from "./routes/socratic";
import { visualizeRouter } from "./routes/visualize";
import { synthesisRoutes } from "./routes/synthesis";
import { synthesisExportRouter } from "./routes/synthesis-export";
import { narratorRoutes } from "./routes/narrator";
import { curatorRoutes } from "./routes/curator";
import { connectorRoutes } from "./routes/connector";
import { stalenessRoutes } from "./routes/staleness";
import { plan8AgentRoutes } from "./routes/plan8-agents";
import { notificationRoutes } from "./routes/notifications";
import { literatureRoutes } from "./routes/literature";
import { docEditorRoutes } from "./routes/doc-editor";
import { mcpRoutes } from "./routes/mcp";
import { connectorRoutes as connectorFoundationRoutes } from "./routes/connectors";

export function createApp() {
  const app = new Hono();

  app.use("*", logger());
  app.use("*", securityHeaders());

  app.use(
    "*",
    cors({
      origin: trustedOriginsFromEnv(),
      credentials: true,
    }),
  );
  app.use("*", csrfOriginGuard());

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
  // Plan 11A — scoped chat with attached chips, RAG mode, pin, cost.
  // Mounted as a specific path (not a wildcard /api router) so it does
  // not race the share/invite/comments wildcard auth middlewares.
  app.route("/api/chat", chatRoutes);
  // Plan 11A — chip combobox search. Specific path so the `/api/*`
  // wildcard sub-apps don't intercept it with their own auth chain.
  app.route("/api/search", searchRoutes);
  // Plan 8 agent entrypoints. Keep this above the wildcard `/api` routers so
  // the overview/audio paths do not get swallowed by their auth middlewares.
  app.route("/api/agents/plan8", plan8AgentRoutes);
  // Mounted alongside /api/threads (specific path) so the wildcard /api routers
  // below don't intercept this with their own requireAuth chains.
  app.route("/api/message-feedback", messageFeedbackRoutes);
  app.route("/api/mcp/servers", mcpRoutes);
  app.route("/api/connectors", connectorFoundationRoutes);
  // Plan 2C share-link routes. Same public-then-auth shape as inviteRoutes.
  // Mounted FIRST among `/api` wildcard sub-apps so its public route
  // (`/api/public/share/:token`) is dispatched before any other sub-app's
  // wildcard auth middleware (e.g. inviteRoutes' or commentsRouter's).
  app.route("/api", shareRouter); // /api/public/share/:token + /api/notes/:id/share + /api/share/:shareId + /api/workspaces/:workspaceId/share
  app.route("/api", inviteRoutes); // /api/workspaces/:id/invites and /api/invites/:token/*
  app.route("/api", projectRoutes);
  app.route("/api/projects", graphRoutes);
  app.route("/api/projects", learningRoutes);
  app.route("/api/projects", socraticRoutes);
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
  app.route("/api/visualize", visualizeRouter);
  app.route("/api/code", codeRoutes);
  app.route("/api/synthesis", synthesisRoutes);
  app.route("/api/synthesis-export", synthesisExportRouter);
  app.route("/api/narrator", narratorRoutes);
  app.route("/api/curator", curatorRoutes);
  app.route("/api/connector", connectorRoutes);
  app.route("/api/agents/temporal", stalenessRoutes);
  app.route("/api/canvas", canvasRoutes);
  app.route("/api/users", userRoutes);
  app.route("/api/notifications", notificationRoutes);
  app.route("/api/stream", streamRoutes); // SSE: project tree (Phase 2) + notifications (Phase 5)
  app.route("/api/literature", literatureRoutes);
  app.route("/api", docEditorRoutes); // /api/notes/:id/doc-editor/commands/:cmd (flag-gated inside the router)
  app.route("/api", commentsRouter); // /api/notes/:noteId/comments (Plan 2B)
  app.route("/api", mentionsRouter); // /api/mentions/search (Plan 2B)

  app.onError(errorHandler);

  return app;
}
