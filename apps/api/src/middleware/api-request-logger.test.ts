import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { apiRequestLogger } from "./api-request-logger";

const insertedLogs = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("@opencairn/db", () => ({
  apiRequestLogs: {},
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(async (row: Record<string, unknown>) => {
        insertedLogs.push(row);
      }),
    })),
  },
}));

describe("apiRequestLogger", () => {
  beforeEach(() => {
    insertedLogs.length = 0;
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("API_REQUEST_LOGGING_ENABLED", "true");
  });

  it("redacts OAuth and secret-like query values before storing request logs", async () => {
    const app = new Hono();
    app.use("*", apiRequestLogger());
    app.get("/api/integrations/google/callback", (c) => c.text("ok"));

    const response = await app.request(
      "/api/integrations/google/callback?code=oauth-code&state=oauth-state&accessToken=oauth-access&signature=signed-url&workspaceId=00000000-0000-4000-8000-000000000001",
    );

    expect(response.status).toBe(200);
    expect(insertedLogs).toHaveLength(1);
    expect(insertedLogs[0]?.query).toBe(
      "code=REDACTED&state=REDACTED&accessToken=REDACTED&signature=REDACTED&workspaceId=00000000-0000-4000-8000-000000000001",
    );
  });

  it("does not redact non-sensitive suffix matches", async () => {
    const app = new Hono();
    app.use("*", apiRequestLogger());
    app.get("/api/search", (c) => c.text("ok"));

    const response = await app.request("/api/search?csrf_token_hint=public-hint");

    expect(response.status).toBe(200);
    expect(insertedLogs).toHaveLength(1);
    expect(insertedLogs[0]?.query).toBe("csrf_token_hint=public-hint");
  });
});
