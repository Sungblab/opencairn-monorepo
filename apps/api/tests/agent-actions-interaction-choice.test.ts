import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const app = createApp();

async function authedFetch(
  path: string,
  init: RequestInit & { userId: string },
): Promise<Response> {
  const { userId, headers, ...rest } = init;
  const cookie = await signSessionCookie(userId);
  return app.request(path, {
    ...rest,
    headers: {
      ...(headers ?? {}),
      cookie,
      "content-type": "application/json",
    },
  });
}

describe("interaction.choice agent actions", () => {
  let seed: SeedResult;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "owner" });
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("creates a draft choice action idempotently and completes one response", async () => {
    const requestId = randomUUID();
    const body = choiceBody(requestId, true);

    const first = await postAction(seed, body);
    const second = await postAction(seed, body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    const firstBody = await first.json() as {
      action: { id: string; status: string };
      idempotent: boolean;
    };
    const secondBody = await second.json() as {
      action: { id: string; status: string };
      idempotent: boolean;
    };
    expect(firstBody).toMatchObject({
      idempotent: false,
      action: { status: "draft" },
    });
    expect(secondBody).toMatchObject({
      idempotent: true,
      action: { id: firstBody.action.id, status: "draft" },
    });

    const response = await authedFetch(
      `/api/agent-actions/${firstBody.action.id}/respond`,
      {
        method: "POST",
        userId: seed.userId,
        body: JSON.stringify({
          optionId: "summary",
          value: "forged value",
          label: "forged label",
        }),
      },
    );
    expect(response.status).toBe(200);
    const responseBody = await response.json() as {
      action: {
        status: string;
        result: {
          optionId: string;
          value: string;
          label: string;
          respondedAt: string;
        };
      };
    };
    expect(responseBody.action.status).toBe("completed");
    expect(responseBody.action.result).toMatchObject({
      optionId: "summary",
      value: "요약 노트로 만들어줘",
      label: "요약 노트",
    });
    expect(new Date(responseBody.action.result.respondedAt).toString()).not.toBe(
      "Invalid Date",
    );

    const duplicate = await authedFetch(
      `/api/agent-actions/${firstBody.action.id}/respond`,
      {
        method: "POST",
        userId: seed.userId,
        body: JSON.stringify({
          optionId: "summary",
          value: "요약 노트로 만들어줘",
          label: "요약 노트",
        }),
      },
    );
    expect(duplicate.status).toBe(409);
  });

  it("rejects invalid option ids and custom responses when custom input is disabled", async () => {
    const created = await postAction(seed, choiceBody(randomUUID(), false));
    const { action } = await created.json() as { action: { id: string } };

    const invalidOption = await authedFetch(
      `/api/agent-actions/${action.id}/respond`,
      {
        method: "POST",
        userId: seed.userId,
        body: JSON.stringify({
          optionId: "table",
          value: "표로 만들어줘",
          label: "표",
        }),
      },
    );
    expect(invalidOption.status).toBe(400);

    const custom = await authedFetch(
      `/api/agent-actions/${action.id}/respond`,
      {
        method: "POST",
        userId: seed.userId,
        body: JSON.stringify({
          value: "내 방식대로 정리해줘",
          label: "내 방식대로 정리해줘",
        }),
      },
    );
    expect(custom.status).toBe(400);
  });
});

function choiceBody(requestId: string, allowCustom: boolean) {
  return {
    requestId,
    kind: "interaction.choice",
    risk: "low",
    approvalMode: "auto_safe",
    input: {
      cardId: "format",
      prompt: "어떤 형태로 만들까요?",
      options: [
        {
          id: "summary",
          label: "요약 노트",
          value: "요약 노트로 만들어줘",
        },
      ],
      allowCustom,
      source: {},
    },
  };
}

async function postAction(seed: SeedResult, body: Record<string, unknown>) {
  return authedFetch(`/api/projects/${seed.projectId}/agent-actions`, {
    method: "POST",
    userId: seed.userId,
    body: JSON.stringify(body),
  });
}
