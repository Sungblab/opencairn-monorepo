# React Email Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline HTML invite email in `apps/api/src/lib/email.ts` with a `packages/emails` workspace package built on react-email + Resend's native React rendering, and scaffold Layout/Button primitives so future templates share the same structure.

**Architecture:** New workspace package `@opencairn/emails` exports React components (`<InviteEmail>`, shared `<Layout>`, `<Button>`). `apps/api` imports the component directly and passes it to `resend.emails.send({ react: <Component .../> })` — Resend converts to HTML internally. A react-email CLI dev server runs on port 3001 for local preview. No runtime LLM calls; Gemini is only used at development time by the engineer to scaffold new templates.

**Tech Stack:** TypeScript, React 19, `@react-email/components` (primitives like `Html`, `Container`, `Button`), `react-email` CLI (preview dev server), Resend SDK (already installed), Vitest (already the monorepo runner), pnpm workspaces.

**Design reference:** `docs/superpowers/specs/2026-04-23-react-email-adoption-design.md`

---

## File Structure

**Create:**
- `packages/emails/package.json` — workspace package manifest, deps, scripts
- `packages/emails/tsconfig.json` — extends root base, adds JSX
- `packages/emails/vitest.config.ts` — Vitest with React JSX support
- `packages/emails/src/components/tokens.ts` — color/font/spacing constants
- `packages/emails/src/components/Button.tsx` — branded CTA wrapping `@react-email/components` Button
- `packages/emails/src/components/Layout.tsx` — Html+Head+Body+Preview+Container+footer shell
- `packages/emails/src/templates/invite.tsx` — `<InviteEmail>` component
- `packages/emails/src/index.ts` — barrel export
- `packages/emails/emails/invite.tsx` — preview wrapper consumed by react-email CLI
- `packages/emails/tests/invite.test.tsx` — `@react-email/render` snapshot + behavior assertions

**Modify:**
- `apps/api/package.json` — add `@opencairn/emails: workspace:*`
- `apps/api/src/lib/email.ts` — replace HTML string with React template + `react:` send
- `.env.example` — change `EMAIL_FROM` default to `hello@opencairn.com`

**Unchanged:**
- `apps/api/src/routes/invites.ts` — `sendInviteEmail` signature stable
- `apps/api/tests/invites.test.ts` — only exercises `GET /api/invites/:token`, doesn't call `sendInviteEmail`

Each file has a single responsibility. Components (`Layout`, `Button`) are independent of templates (`invite`), and templates are independent of the send wiring in `apps/api`.

---

## Task 1: Scaffold `packages/emails` workspace package

**Files:**
- Create: `packages/emails/package.json`
- Create: `packages/emails/tsconfig.json`
- Create: `packages/emails/vitest.config.ts`
- Create: `packages/emails/emails/.gitkeep`
- Create: `packages/emails/src/index.ts` (empty stub for now)

- [ ] **Step 1: Create `packages/emails/package.json`**

```json
{
  "name": "@opencairn/emails",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "dev": "email dev --dir ./emails --port 3001",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@react-email/components": "^0.5.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@react-email/render": "^1.3.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^5.0.0",
    "react-email": "^4.0.0",
    "typescript": "^5.8.0",
    "vitest": "^4.1.4"
  }
}
```

Notes:
- `react`/`react-dom` are runtime deps because Resend SDK calls `@react-email/render` against the component tree at send time.
- `@react-email/render` is a devDep because we only call it from tests; production send goes through Resend SDK which bundles its own render.
- `email dev` (from the `react-email` package) is the preview CLI. `--port 3001` avoids Next.js dev on 3000.
- Version pinning uses caret ranges consistent with `packages/db` and `packages/shared`; pnpm will resolve actual latest on install.

- [ ] **Step 2: Create `packages/emails/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "jsx": "react-jsx",
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

Notes:
- `jsx: "react-jsx"` — React 17+ automatic JSX runtime, no need to import React in every file.
- `rootDir: ./src` excludes the `emails/` preview directory from `tsc` build output (CLI handles it separately).

- [ ] **Step 3: Create `packages/emails/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
```

Notes:
- `@vitejs/plugin-react` is required because tests render TSX components via `@react-email/render`.
- `environment: "node"` — no DOM needed; `render()` returns a string.

- [ ] **Step 4: Create empty placeholders**

`packages/emails/emails/.gitkeep` (empty file — just needs to exist so git tracks the preview directory).

`packages/emails/src/index.ts`:
```ts
// Barrel export — templates added in later tasks.
export {};
```

- [ ] **Step 5: Install dependencies**

Run: `pnpm install`
Expected: Installs `packages/emails` deps and adds it to the workspace graph. No errors.

- [ ] **Step 6: Verify workspace registration**

Run: `pnpm --filter @opencairn/emails exec echo ok`
Expected: Prints `ok`. Confirms pnpm sees the package.

- [ ] **Step 7: Commit**

```bash
git add packages/emails/ pnpm-lock.yaml
git commit -m "feat(emails): scaffold @opencairn/emails workspace package"
```

---

## Task 2: Add design tokens

**Files:**
- Create: `packages/emails/src/components/tokens.ts`

- [ ] **Step 1: Create `tokens.ts`**

```ts
// OpenCairn brand tokens for email templates.
// Palette: neutral monochrome only (CLAUDE.md brand rules forbid warm/ember/cream in emails).
// All colors inline-safe for email client rendering (no CSS variables — Outlook doesn't resolve them).

export const colors = {
  text: "#111111",
  textMuted: "#6b7280",
  background: "#ffffff",
  surface: "#f5f5f5",
  border: "#e5e5e5",
  primary: "#111111",       // CTA fill
  primaryText: "#ffffff",   // CTA label
  link: "#111111",
} as const;

export const fonts = {
  body: '-apple-system, BlinkMacSystemFont, "Segoe UI", Pretendard, sans-serif',
  logo: 'ui-serif, Georgia, serif', // serif reserved for the wordmark only
} as const;

export const spacing = {
  xs: "4px",
  sm: "8px",
  md: "16px",
  lg: "24px",
  xl: "32px",
} as const;

export const layout = {
  containerMaxWidth: "600px",
} as const;
```

- [ ] **Step 2: Commit**

```bash
git add packages/emails/src/components/tokens.ts
git commit -m "feat(emails): add neutral monochrome design tokens"
```

---

## Task 3: Build the Button component (TDD)

**Files:**
- Create: `packages/emails/tests/button.test.tsx`
- Create: `packages/emails/src/components/Button.tsx`

- [ ] **Step 1: Write the failing test**

`packages/emails/tests/button.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { Button } from "../src/components/Button";

describe("Button", () => {
  it("renders an anchor with the provided href and label", async () => {
    const html = await render(<Button href="https://opencairn.com/accept">초대 수락하기</Button>);
    expect(html).toContain('href="https://opencairn.com/accept"');
    expect(html).toContain("초대 수락하기");
  });

  it("applies the primary fill color from tokens", async () => {
    const html = await render(<Button href="https://x">go</Button>);
    // Primary token — keep in sync with tokens.ts
    expect(html).toContain("#111111");
    expect(html).toContain("#ffffff");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @opencairn/emails test`
Expected: FAIL — `Cannot find module '../src/components/Button'`.

- [ ] **Step 3: Implement Button**

`packages/emails/src/components/Button.tsx`:
```tsx
import { Button as RButton } from "@react-email/components";
import { colors, spacing } from "./tokens";
import type { ReactNode } from "react";

// `variant` is reserved for future template-specific styles (e.g., secondary
// outline button). v0.1 only implements `primary`, but the prop is declared so
// call sites don't have to be rewritten when we add the second variant.
interface Props {
  href: string;
  children: ReactNode;
  variant?: "primary";
}

export function Button({ href, children }: Props) {
  return (
    <RButton
      href={href}
      style={{
        backgroundColor: colors.primary,
        color: colors.primaryText,
        padding: `${spacing.md} ${spacing.lg}`,
        borderRadius: "6px",
        fontSize: "14px",
        fontWeight: 500,
        textDecoration: "none",
        display: "inline-block",
      }}
    >
      {children}
    </RButton>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @opencairn/emails test`
Expected: PASS — both Button tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/emails/src/components/Button.tsx packages/emails/tests/button.test.tsx
git commit -m "feat(emails): add branded Button primitive"
```

---

## Task 4: Build the Layout shell (TDD)

**Files:**
- Create: `packages/emails/tests/layout.test.tsx`
- Create: `packages/emails/src/components/Layout.tsx`

- [ ] **Step 1: Write the failing test**

`packages/emails/tests/layout.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { Layout } from "../src/components/Layout";

describe("Layout", () => {
  it("renders preview text for inbox preview snippets", async () => {
    const html = await render(
      <Layout preview="프리뷰 텍스트">
        <p>hello</p>
      </Layout>,
    );
    expect(html).toContain("프리뷰 텍스트");
  });

  it("wraps children inside a container", async () => {
    const html = await render(
      <Layout preview="p">
        <p data-testid="child">안녕하세요</p>
      </Layout>,
    );
    expect(html).toContain("안녕하세요");
  });

  it("includes the OpenCairn wordmark in the header", async () => {
    const html = await render(
      <Layout preview="p">
        <p>x</p>
      </Layout>,
    );
    expect(html).toContain("OpenCairn");
  });

  it("includes a footer contact line", async () => {
    const html = await render(
      <Layout preview="p">
        <p>x</p>
      </Layout>,
    );
    expect(html).toContain("hello@opencairn.com");
  });

  it("applies the declared lang attribute", async () => {
    const html = await render(
      <Layout preview="p" lang="en">
        <p>x</p>
      </Layout>,
    );
    expect(html).toContain('lang="en"');
  });

  it("defaults lang to ko", async () => {
    const html = await render(
      <Layout preview="p">
        <p>x</p>
      </Layout>,
    );
    expect(html).toContain('lang="ko"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @opencairn/emails test`
Expected: FAIL — `Cannot find module '../src/components/Layout'`.

- [ ] **Step 3: Implement Layout**

`packages/emails/src/components/Layout.tsx`:
```tsx
import {
  Html,
  Head,
  Body,
  Container,
  Preview,
  Section,
  Text,
  Hr,
} from "@react-email/components";
import type { ReactNode } from "react";
import { colors, fonts, spacing, layout } from "./tokens";

interface Props {
  preview: string;
  lang?: "ko" | "en";
  children: ReactNode;
}

export function Layout({ preview, lang = "ko", children }: Props) {
  return (
    <Html lang={lang}>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: colors.surface, fontFamily: fonts.body, margin: 0, padding: spacing.lg }}>
        <Container style={{ backgroundColor: colors.background, maxWidth: layout.containerMaxWidth, margin: "0 auto", padding: spacing.xl, border: `1px solid ${colors.border}`, borderRadius: "8px" }}>
          <Section>
            <Text style={{ fontFamily: fonts.logo, fontSize: "20px", fontWeight: 600, color: colors.text, margin: 0 }}>
              OpenCairn
            </Text>
          </Section>
          <Hr style={{ borderColor: colors.border, margin: `${spacing.lg} 0` }} />
          <Section>{children}</Section>
          <Hr style={{ borderColor: colors.border, margin: `${spacing.lg} 0` }} />
          <Section>
            <Text style={{ fontSize: "12px", color: colors.textMuted, margin: 0 }}>
              문의는 <a href="mailto:hello@opencairn.com" style={{ color: colors.link }}>hello@opencairn.com</a> 으로 보내주세요.
            </Text>
            <Text style={{ fontSize: "12px", color: colors.textMuted, margin: `${spacing.xs} 0 0 0` }}>
              © OpenCairn
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @opencairn/emails test`
Expected: PASS — all 6 Layout tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/emails/src/components/Layout.tsx packages/emails/tests/layout.test.tsx
git commit -m "feat(emails): add Layout shell with header + footer"
```

---

## Task 5: Build the InviteEmail template (TDD)

**Files:**
- Create: `packages/emails/tests/invite.test.tsx`
- Create: `packages/emails/src/templates/invite.tsx`

- [ ] **Step 1: Write the failing test**

`packages/emails/tests/invite.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { InviteEmail } from "../src/templates/invite";

describe("InviteEmail", () => {
  const baseProps = {
    inviter: "김개발",
    signupUrl: "https://opencairn.com/ko/auth/signup?invite=abc123",
  };

  it("renders the inviter's name in the body", async () => {
    const html = await render(<InviteEmail {...baseProps} />);
    expect(html).toContain("김개발");
  });

  it("puts the signupUrl on the CTA href", async () => {
    const html = await render(<InviteEmail {...baseProps} />);
    expect(html).toContain('href="https://opencairn.com/ko/auth/signup?invite=abc123"');
  });

  it("repeats the signupUrl as plain text for link fallback", async () => {
    // If the button link doesn't render (e.g., text-only clients),
    // the raw URL must still be copy-pasteable from the body.
    const html = await render(<InviteEmail {...baseProps} />);
    const url = "https://opencairn.com/ko/auth/signup?invite=abc123";
    const count = (html.match(new RegExp(url.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "g")) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("escapes HTML in the inviter name (XSS defense)", async () => {
    const html = await render(
      <InviteEmail inviter={'<script>alert(1)</script>'} signupUrl="https://x" />,
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("uses Korean honorific copy", async () => {
    const html = await render(<InviteEmail {...baseProps} />);
    expect(html).toContain("초대");
    // 존댓말 — "초대하셨습니다" or "초대했습니다" etc.
    expect(html).toMatch(/하(셨|였|했)습니다/);
  });

  it("includes preview text mentioning the inviter", async () => {
    const html = await render(<InviteEmail {...baseProps} />);
    // Preview text lives in a hidden <div> at the top of the body.
    expect(html).toContain("김개발");
    expect(html).toContain("워크스페이스");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @opencairn/emails test`
Expected: FAIL — `Cannot find module '../src/templates/invite'`.

- [ ] **Step 3: Implement InviteEmail**

`packages/emails/src/templates/invite.tsx`:
```tsx
import { Text } from "@react-email/components";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { colors, spacing } from "../components/tokens";

interface Props {
  inviter: string;
  signupUrl: string;
}

export function InviteEmail({ inviter, signupUrl }: Props) {
  return (
    <Layout preview={`${inviter}님이 OpenCairn 워크스페이스에 초대하셨습니다`}>
      <Text style={{ fontSize: "16px", color: colors.text, margin: `0 0 ${spacing.md} 0` }}>
        안녕하세요,
      </Text>
      <Text style={{ fontSize: "16px", color: colors.text, margin: `0 0 ${spacing.lg} 0` }}>
        <strong>{inviter}</strong>님이 OpenCairn 워크스페이스에 함께 작업하자고 초대하셨습니다.
      </Text>
      <Button href={signupUrl}>초대 수락하기</Button>
      <Text style={{ fontSize: "13px", color: colors.textMuted, margin: `${spacing.xl} 0 0 0` }}>
        버튼이 동작하지 않으면 아래 주소를 브라우저에 붙여넣어 주세요:
      </Text>
      <Text style={{ fontSize: "12px", color: colors.textMuted, margin: `${spacing.xs} 0 0 0`, wordBreak: "break-all" }}>
        {signupUrl}
      </Text>
    </Layout>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @opencairn/emails test`
Expected: PASS — all 6 InviteEmail tests green (plus earlier Button + Layout tests).

- [ ] **Step 5: Commit**

```bash
git add packages/emails/src/templates/invite.tsx packages/emails/tests/invite.test.tsx
git commit -m "feat(emails): add InviteEmail template with Korean copy"
```

---

## Task 6: Wire barrel export

**Files:**
- Modify: `packages/emails/src/index.ts`

- [ ] **Step 1: Replace the empty stub with exports**

`packages/emails/src/index.ts`:
```ts
export { Layout } from "./components/Layout";
export { Button } from "./components/Button";
export { InviteEmail } from "./templates/invite";
```

- [ ] **Step 2: Verify TypeScript build still works**

Run: `pnpm --filter @opencairn/emails build`
Expected: Produces `packages/emails/dist/` with `.d.ts` files. No TS errors.

- [ ] **Step 3: Commit**

```bash
git add packages/emails/src/index.ts
git commit -m "feat(emails): export Layout, Button, InviteEmail"
```

---

## Task 7: Add the preview wrapper

**Files:**
- Create: `packages/emails/emails/invite.tsx`
- Delete: `packages/emails/emails/.gitkeep`

- [ ] **Step 1: Create preview wrapper**

`packages/emails/emails/invite.tsx`:
```tsx
import { InviteEmail } from "../src/templates/invite";

// react-email CLI renders this default export in the preview server.
// Props here are hard-coded fixtures — production data is injected by apps/api at send time.
export default function Preview() {
  return (
    <InviteEmail
      inviter="김개발"
      signupUrl="https://opencairn.com/ko/auth/signup?invite=example-token"
    />
  );
}

Preview.PreviewProps = {
  inviter: "김개발",
  signupUrl: "https://opencairn.com/ko/auth/signup?invite=example-token",
};
```

- [ ] **Step 2: Remove the placeholder**

Run: `git rm packages/emails/emails/.gitkeep`
Expected: File removed from git.

- [ ] **Step 3: Manually verify the preview server starts**

Run: `pnpm --filter @opencairn/emails dev`
Open http://localhost:3001 in a browser.
Expected: `invite` template appears in the sidebar; clicking renders the invite email with the fixture props. Stop the server with Ctrl+C when verified.

Note: the CLI may require one-time initialization on first run; wait for "Ready in..." or similar log before assuming failure.

- [ ] **Step 4: Commit**

```bash
git add packages/emails/emails/invite.tsx
git commit -m "feat(emails): add invite preview wrapper for dev server"
```

---

## Task 8: Wire apps/api dependency

**Files:**
- Modify: `apps/api/package.json`

- [ ] **Step 1: Add workspace dependency**

In `apps/api/package.json`, find the `dependencies` block and add the `@opencairn/emails` line (keep alphabetical order after `@opencairn/db`):

Before:
```json
  "dependencies": {
    "@hono/node-server": "^1.14.0",
    "@hono/zod-validator": "^0.7.6",
    "@opencairn/db": "workspace:*",
    "@opencairn/shared": "workspace:*",
```

After:
```json
  "dependencies": {
    "@hono/node-server": "^1.14.0",
    "@hono/zod-validator": "^0.7.6",
    "@opencairn/db": "workspace:*",
    "@opencairn/emails": "workspace:*",
    "@opencairn/shared": "workspace:*",
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: pnpm links `@opencairn/emails` into `apps/api/node_modules`.

- [ ] **Step 3: Verify link resolves**

Run: `pnpm --filter @opencairn/api exec node -e "import('@opencairn/emails').then(m => console.log(Object.keys(m)))"`
Expected: Prints `[ 'Layout', 'Button', 'InviteEmail' ]`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): depend on @opencairn/emails workspace package"
```

---

## Task 9: Rewrite apps/api/src/lib/email.ts

**Files:**
- Modify: `apps/api/src/lib/email.ts`

- [ ] **Step 1: Replace the file contents**

`apps/api/src/lib/email.ts`:
```ts
import { Resend } from "resend";
import { InviteEmail } from "@opencairn/emails";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const from = process.env.EMAIL_FROM ?? "OpenCairn <hello@opencairn.com>";
const webBase = process.env.WEB_BASE_URL ?? "http://localhost:3000";
const DEFAULT_LOCALE = "ko"; // Plan 9a default; recipient-locale 추론은 후속.

export async function sendInviteEmail(
  to: string,
  params: { token: string; workspaceId: string; invitedByName: string },
): Promise<void> {
  // Invite link routes through signup — recipient gets a session first,
  // then the onboarding page resolves the token into an accept card.
  const signupUrl = `${webBase}/${DEFAULT_LOCALE}/auth/signup?invite=${encodeURIComponent(params.token)}`;
  const subject = `${params.invitedByName}님이 OpenCairn 워크스페이스에 초대하셨습니다`;

  if (!resend) {
    console.log("[email:dev]", { to, subject, signupUrl, inviter: params.invitedByName });
    return;
  }

  await resend.emails.send({
    from,
    to,
    subject,
    react: InviteEmail({ inviter: params.invitedByName, signupUrl }),
  });
}
```

Notes on what changed:
- `escapeHtml` helper deleted — React escapes text children automatically.
- HTML string literal replaced with `react:` prop; Resend runs `@react-email/render` internally.
- Subject switched from English (`"X invited you to..."`) to ko honorific — CLAUDE.md copy rules.
- Default `from` updated to `hello@opencairn.com` (verified domain); `EMAIL_FROM` env var still overrides.
- Signature `(to, { token, workspaceId, invitedByName })` unchanged — `workspaceId` is still accepted but not used in the rendered template (reserved for future extensions like workspace name / logo per workspace).

- [ ] **Step 2: Build apps/api to check for type errors**

Run: `pnpm --filter @opencairn/api build`
Expected: `tsc` passes with no errors. `apps/api/dist/lib/email.js` is regenerated.

- [ ] **Step 3: Run the existing invites test to confirm no regressions**

Run: `pnpm --filter @opencairn/api test -- tests/invites.test.ts`
Expected: All 5 existing tests pass. (They don't exercise `sendInviteEmail` directly, so the rewrite shouldn't break them — this step confirms that assumption.)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/lib/email.ts
git commit -m "feat(api): render invite email with react-email InviteEmail"
```

---

## Task 10: Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Update EMAIL_FROM default**

Find the `# Email (Resend)` block near line 99 and change:

Before:
```
EMAIL_FROM=OpenCairn <onboarding@resend.dev>
```

After:
```
EMAIL_FROM=OpenCairn <hello@opencairn.com>
```

Keep the comment `# Email (Resend) — leave unset to log to console in dev` and `RESEND_API_KEY=` line unchanged.

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore(env): default EMAIL_FROM to hello@opencairn.com"
```

---

## Task 11: End-to-end dev smoke test

This task is manual verification — no code changes.

- [ ] **Step 1: Confirm the package builds and tests pass in isolation**

Run: `pnpm --filter @opencairn/emails test && pnpm --filter @opencairn/emails build`
Expected: All tests pass; `dist/` regenerates without errors.

- [ ] **Step 2: Confirm apps/api builds and tests pass**

Run: `pnpm --filter @opencairn/api build && pnpm --filter @opencairn/api test`
Expected: `tsc` clean; all existing API tests pass.

- [ ] **Step 3: Launch preview server and visually verify**

Run: `pnpm --filter @opencairn/emails dev`
Open http://localhost:3001
Expected:
- Sidebar lists `invite`
- Rendering shows:
  - OpenCairn wordmark at top
  - "김개발님이 OpenCairn 워크스페이스에 함께 작업하자고 초대하셨습니다."
  - Dark CTA button labeled "초대 수락하기"
  - Plain-text fallback URL below
  - Footer with `hello@opencairn.com`
- Click the button in preview; it navigates to the fixture URL

Stop the server with Ctrl+C.

- [ ] **Step 4: (Optional) Live send test**

Only run this if a Resend API key is available and willing to spend a real send credit.

1. Ensure `.env` (not `.env.example`) has a valid `RESEND_API_KEY` and `EMAIL_FROM=OpenCairn <hello@opencairn.com>`.
2. In a scratch Node REPL or one-off script:
   ```ts
   import { sendInviteEmail } from "./apps/api/src/lib/email.ts";
   await sendInviteEmail("your-own@email.com", {
     token: "test-" + Date.now(),
     workspaceId: "00000000-0000-0000-0000-000000000000",
     invitedByName: "테스터",
   });
   ```
3. Check inbox: Korean subject, dark CTA button, working fallback URL.

- [ ] **Step 5: Final commit (if any follow-up tweaks)**

If steps 3-4 surfaced visual bugs that required changes, commit them as `fix(emails): ...`. Otherwise no commit needed here.

---

## Self-review checklist (for the engineer after Task 11)

Before marking this plan complete:

1. `pnpm --filter @opencairn/emails test` — all green
2. `pnpm --filter @opencairn/api build` — tsc clean
3. `pnpm --filter @opencairn/api test` — all green
4. Preview server renders invite template correctly at http://localhost:3001
5. `sendInviteEmail` signature unchanged — grep for callers confirms `apps/api/src/routes/invites.ts:86` still compiles
6. `.env.example` updated; user notified to rotate the Resend API key shared in chat
7. No `TODO`/`FIXME`/`placeholder` strings introduced
