import { afterEach, describe, expect, it } from "vitest";
import { db, eq, user } from "@opencairn/db";
import { createApp } from "../src/app.js";
import {
  estimateStudioToolPreflight,
  studioToolProfileSchema,
} from "../src/lib/studio-tool-preflight.js";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const app = createApp();

describe("Studio tool preflight estimates", () => {
  let seed: SeedResult | undefined;

  afterEach(async () => {
    await seed?.cleanup();
    seed = undefined;
  });

  it("keeps quick current-note work lightweight", () => {
    const estimate = estimateStudioToolPreflight({
      tool: "explain",
      plan: "free",
      provider: "gemini",
      model: "gemini-3-flash-preview",
      sourceTokenEstimate: 900,
    });

    expect(estimate.requiresConfirmation).toBe(false);
    expect(estimate.billingPath).toBe("managed");
    expect(estimate.cost.billableCredits).toBeGreaterThan(0);
    expect(estimate.profile.tokensOut).toBeLessThan(3000);
  });

  it("requires confirmation for costly durable study tools", () => {
    const estimate = estimateStudioToolPreflight({
      tool: "mock_exam",
      plan: "pro",
      provider: "gemini",
      model: "gemini-3.1-pro-preview",
      sourceTokenEstimate: 24_000,
    });

    expect(estimate.requiresConfirmation).toBe(true);
    expect(estimate.profile.executionClass).toBe("durable_run");
    expect(estimate.cost.featureMultiplier).toBeGreaterThan(1);
  });

  it("uses BYOK billing path without managed credit debit", () => {
    const estimate = estimateStudioToolPreflight({
      tool: "deep_research",
      plan: "byok",
      provider: "gemini",
      model: "gemini-3.1-pro-preview",
      sourceTokenEstimate: 48_000,
    });

    expect(estimate.billingPath).toBe("byok");
    expect(estimate.chargeRequired).toBe(false);
    expect(estimate.cost.billableCredits).toBeGreaterThan(0);
  });

  it("exposes the first-pass tool profile ids", () => {
    expect(studioToolProfileSchema.options).toContain("quiz");
    expect(studioToolProfileSchema.options).toContain("slides");
    expect(studioToolProfileSchema.options).toContain("deep_research");
  });

  it("exposes a project-scoped preflight route with insufficient-credit blocking", async () => {
    seed = await seedWorkspace({ role: "owner" });
    const cookie = await signSessionCookie(seed.userId);

    const response = await app.request(
      `/api/projects/${seed.projectId}/studio-tools/preflight`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          tool: "mock_exam",
          sourceTokenEstimate: 24_000,
          provider: "gemini",
          model: "gemini-3.1-pro-preview",
        }),
      },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      preflight: {
        billingPath: string;
        canStart: boolean;
        blockedReason: string | null;
        balance: { plan: string; availableCredits: number };
      };
    };
    expect(body.preflight.billingPath).toBe("managed");
    expect(body.preflight.canStart).toBe(false);
    expect(body.preflight.blockedReason).toBe("credits_insufficient");
    expect(body.preflight.balance).toMatchObject({
      plan: "free",
      availableCredits: 0,
    });
  });

  it("keeps BYOK Studio preflight startable without managed credits", async () => {
    seed = await seedWorkspace({ role: "owner" });
    await db.update(user).set({ plan: "byok" }).where(eq(user.id, seed.userId));
    const cookie = await signSessionCookie(seed.userId);

    const response = await app.request(
      `/api/projects/${seed.projectId}/studio-tools/preflight`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          tool: "deep_research",
          sourceTokenEstimate: 48_000,
          provider: "gemini",
          model: "gemini-3.1-pro-preview",
        }),
      },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      preflight: {
        billingPath: string;
        chargeRequired: boolean;
        canStart: boolean;
        blockedReason: string | null;
        balance: { plan: string; availableCredits: number };
      };
    };
    expect(body.preflight.billingPath).toBe("byok");
    expect(body.preflight.chargeRequired).toBe(false);
    expect(body.preflight.canStart).toBe(true);
    expect(body.preflight.blockedReason).toBeNull();
    expect(body.preflight.balance.plan).toBe("byok");
  });
});
