import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("useUrlTabSync bundle boundary", () => {
  it("stays sync-only and keeps imperative navigation in useTabNavigate", () => {
    const syncHook = read("src/hooks/use-url-tab-sync.ts");

    expect(syncHook).not.toMatch(/useRouter/);
    expect(syncHook).not.toMatch(/useLocale/);
    expect(syncHook).not.toMatch(/next-intl/);
    expect(syncHook).not.toMatch(/useTranslations/);
    expect(syncHook).not.toMatch(/tabToUrl/);
    expect(syncHook).not.toMatch(/navigateToTab/);
    expect(syncHook).toMatch(/useShellLabels/);

    const navigateHook = read("src/hooks/use-tab-navigate.ts");
    expect(navigateHook).toMatch(/useRouter/);
    expect(navigateHook).not.toMatch(/next-intl/);
    expect(navigateHook).not.toMatch(/useLocale/);
    expect(navigateHook).toMatch(/tabToUrl/);
  });
});
