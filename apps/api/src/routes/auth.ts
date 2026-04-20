import { Hono } from "hono";
import { auth } from "../lib/auth";

export const authRoutes = new Hono().all("/*", (c) => {
  return auth.handler(c.req.raw);
});
