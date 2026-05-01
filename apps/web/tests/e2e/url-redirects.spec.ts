import { expect, test } from "@playwright/test";

const cases = [
  ["/ko/app/w/test/p/p1/notes/n1", "/ko/workspace/test/project/p1/note/n1"],
  ["/ko/app/w/test/p/p1/agents", "/ko/workspace/test/project/p1/agents"],
  ["/ko/app/w/test/n/n1", "/ko/workspace/test/note/n1"],
  ["/ko/app/w/test/research", "/ko/workspace/test/research"],
  ["/ko/app/w/test", "/ko/workspace/test"],
  ["/ko/app/dashboard", "/ko/dashboard"],
  ["/ko/app/settings/ai", "/ko/settings/ai"],
  ["/ko/app/settings/mcp", "/ko/settings/mcp"],
  ["/ko/app", "/ko/dashboard"],
  ["/en/app/w/test", "/en/workspace/test"],
] as const;

for (const [from, to] of cases) {
  test(`307: ${from} -> ${to}`, async ({ request }) => {
    const res = await request.get(from, { maxRedirects: 0 });

    expect(res.status()).toBe(307);
    expect(res.headers().location).toBe(to);
  });
}
