import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("auth route bundle boundaries", () => {
  it("keeps auth pages behind dynamic form loaders", () => {
    const pages = [
      ["src/app/[locale]/auth/login/page.tsx", "LoginFormLoader", "LoginForm"],
      ["src/app/[locale]/auth/signup/page.tsx", "SignupFormLoader", "SignupForm"],
      [
        "src/app/[locale]/auth/forgot-password/page.tsx",
        "ForgotPasswordFormLoader",
        "ForgotPasswordForm",
      ],
    ] as const;

    for (const [path, loader, directForm] of pages) {
      const source = read(path);
      expect(source).toContain(loader);
      expect(source).not.toMatch(
        new RegExp(`from\\s+["']@/components/auth/${directForm}["']`),
      );
    }
  });

  it("keeps Google One Tap behind its route loader", () => {
    for (const path of [
      "src/app/[locale]/auth/login/page.tsx",
      "src/app/[locale]/auth/signup/page.tsx",
    ]) {
      const source = read(path);
      expect(source).toContain("GoogleOneTapLoader");
      expect(source).not.toMatch(
        /from\s+["']@\/components\/auth\/GoogleOneTap["']/,
      );
    }
  });

  it("loads auth route clients dynamically", () => {
    const loaders = [
      ["src/components/auth/LoginFormLoader.tsx", 'import("./LoginForm")'],
      ["src/components/auth/SignupFormLoader.tsx", 'import("./SignupForm")'],
      [
        "src/components/auth/ForgotPasswordFormLoader.tsx",
        'import("./ForgotPasswordForm")',
      ],
      ["src/components/auth/GoogleOneTapLoader.tsx", 'import("./GoogleOneTap")'],
    ] as const;

    for (const [path, importString] of loaders) {
      expect(existsSync(join(root, path))).toBe(true);
      const source = read(path);
      expect(source).toContain("next/dynamic");
      expect(source).toContain(importString);
    }
  });

  it("keeps lightweight auth chrome off the tailwind-merge runtime", () => {
    for (const path of [
      "src/components/auth/AuthCard.tsx",
      "src/components/auth/AuthEyebrow.tsx",
      "src/components/auth/GoogleButton.tsx",
    ]) {
      const source = read(path);
      expect(source).not.toContain("@/lib/utils");
      expect(source).not.toContain("tailwind-merge");
    }
  });
});
