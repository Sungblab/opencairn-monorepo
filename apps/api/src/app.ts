import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { errorHandler } from "./middleware/error";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";

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

  app.route("/api/health", healthRoutes);
  app.route("/api/auth", authRoutes);

  app.onError(errorHandler);

  return app;
}
