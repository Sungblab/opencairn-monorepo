# Auth Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 랜딩 모달(로그인/회원가입) + 전용 `/auth/*` 페이지 + 이메일 인증 + Google OAuth 구현

**Architecture:** Better Auth API 설정에 emailVerification + Google OAuth 추가. 웹에 `better-auth/react` 클라이언트 추가. 폼 컴포넌트를 모달과 전용 페이지 양쪽에서 재사용. 이메일 발송은 콘솔 로그 mock.

**Tech Stack:** better-auth ^1.2.0, next-intl, @base-ui/react Dialog, Tailwind CSS (stone 팔레트), Next.js 16 App Router

---

## File Map

**신규:**
- `apps/web/src/lib/auth-client.ts` — Better Auth 브라우저 클라이언트
- `apps/web/src/app/[locale]/auth/layout.tsx` — 미니멀 auth 레이아웃
- `apps/web/src/app/[locale]/auth/login/page.tsx`
- `apps/web/src/app/[locale]/auth/signup/page.tsx`
- `apps/web/src/app/[locale]/auth/forgot-password/page.tsx`
- `apps/web/src/app/[locale]/auth/verify-email/page.tsx`
- `apps/web/src/components/auth/GoogleButton.tsx`
- `apps/web/src/components/auth/LoginForm.tsx`
- `apps/web/src/components/auth/SignupForm.tsx`
- `apps/web/src/components/auth/ForgotPasswordForm.tsx`
- `apps/web/src/components/auth/AuthModal.tsx`
- `apps/web/messages/ko/auth.json`
- `apps/web/messages/en/auth.json`

**수정:**
- `apps/api/src/lib/auth.ts` — emailVerification + sendResetPassword + Google OAuth
- `apps/web/src/lib/session.ts` — redirect 경로 `/ko/auth/login`으로 수정
- `apps/web/src/i18n.ts` — auth namespace import 추가
- `apps/web/src/components/landing/chrome/Header.tsx` — 버튼을 모달 트리거로 교체

---

### Task 1: better-auth 웹 패키지 추가 + auth-client 생성

**Files:**
- Create: `apps/web/src/lib/auth-client.ts`

- [ ] **Step 1: better-auth 설치**

```bash
pnpm add better-auth --filter @opencairn/web
```

Expected: `apps/web/package.json`의 dependencies에 `"better-auth": "^1.2.x"` 추가됨.

- [ ] **Step 2: auth-client 파일 생성**

`apps/web/src/lib/auth-client.ts`:
```ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined"
      ? window.location.origin
      : (process.env.INTERNAL_API_URL ?? "http://localhost:4000"),
});
```

`baseURL`은 Better Auth가 `/api/auth/*` 요청을 날릴 기준 origin. 브라우저에서는 same-origin(Next.js 프록시 경유), 서버에서는 직접 API 호출.

- [ ] **Step 3: 타입 체크**

```bash
pnpm --filter @opencairn/web tsc --noEmit
```

Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add apps/web/package.json apps/web/src/lib/auth-client.ts pnpm-lock.yaml
git commit -m "feat(web): add better-auth client"
```

---

### Task 2: API Better Auth 설정 업데이트

**Files:**
- Modify: `apps/api/src/lib/auth.ts`

현재 파일:
```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@opencairn/db";

const trustedOrigins = ...;

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: { enabled: true },
  session: { expiresIn: 60 * 60 * 24 * 7 },
  trustedOrigins,
});
```

- [ ] **Step 1: auth.ts 전체 교체**

`apps/api/src/lib/auth.ts`:
```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@opencairn/db";

const trustedOrigins =
  process.env.CORS_ORIGIN?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? ["http://localhost:3000"];

const webUrl = process.env.WEB_URL ?? "http://localhost:3000";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      console.log(`[DEV] Reset password for ${user.email}: ${url}`);
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      console.log(`[DEV] Verify email for ${user.email}: ${url}`);
    },
    callbackURL: `${webUrl}/ko/auth/verify-email`,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
  },
  trustedOrigins,
});
```

`GOOGLE_CLIENT_ID`가 빈 문자열이면 Better Auth가 Google 라우트를 등록하지 않음. env 미설정 시 Google 버튼 클릭 시 API에서 오류 반환 (허용 가능 — 버튼은 항상 표시).

- [ ] **Step 2: 타입 체크**

```bash
pnpm --filter @opencairn/api tsc --noEmit
```

Expected: 에러 없음.

- [ ] **Step 3: API 재기동 확인**

```bash
pnpm --filter @opencairn/api dev
```

Expected: `Started server on port 4000` 출력, 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add apps/api/src/lib/auth.ts
git commit -m "feat(api): emailVerification + sendResetPassword + Google OAuth config"
```

---

### Task 3: i18n auth 네임스페이스 추가

**Files:**
- Create: `apps/web/messages/ko/auth.json`
- Create: `apps/web/messages/en/auth.json`
- Modify: `apps/web/src/i18n.ts`

- [ ] **Step 1: ko/auth.json 생성**

`apps/web/messages/ko/auth.json`:
```json
{
  "login": {
    "title": "로그인",
    "email": "이메일",
    "password": "비밀번호",
    "submit": "로그인",
    "forgotPassword": "비밀번호 찾기",
    "noAccount": "계정이 없으신가요?",
    "signUp": "회원가입",
    "orContinueWith": "또는"
  },
  "signup": {
    "title": "회원가입",
    "name": "이름",
    "email": "이메일",
    "password": "비밀번호",
    "submit": "가입하기",
    "hasAccount": "이미 계정이 있으신가요?",
    "signIn": "로그인",
    "orContinueWith": "또는",
    "emailSent": "이메일을 확인해주세요",
    "emailSentDesc": "인증 링크를 보냈어요. 이메일에서 링크를 클릭해 계정을 활성화하세요."
  },
  "forgot": {
    "title": "비밀번호 찾기",
    "desc": "가입한 이메일을 입력하면 재설정 링크를 보내드려요.",
    "email": "이메일",
    "submit": "링크 보내기",
    "sent": "이메일을 보냈어요",
    "sentDesc": "비밀번호 재설정 링크를 이메일로 보냈어요. 잠시 후 확인해주세요.",
    "backToLogin": "로그인으로 돌아가기"
  },
  "verify": {
    "success": "이메일 인증 완료",
    "successDesc": "이메일이 인증됐어요. 이제 로그인할 수 있어요.",
    "goLogin": "로그인하기",
    "error": "인증에 실패했어요",
    "errorDesc": "링크가 만료됐거나 유효하지 않아요. 다시 가입해 인증 이메일을 받아보세요.",
    "retry": "다시 가입하기"
  },
  "modal": {
    "loginTab": "로그인",
    "signupTab": "회원가입"
  },
  "google": {
    "button": "Google로 계속하기"
  },
  "errors": {
    "invalidCredentials": "이메일 또는 비밀번호가 올바르지 않아요.",
    "emailNotVerified": "이메일 인증이 필요해요. 받은 메일함을 확인해주세요.",
    "emailAlreadyExists": "이미 사용 중인 이메일이에요.",
    "generic": "문제가 발생했어요. 잠시 후 다시 시도해주세요."
  }
}
```

- [ ] **Step 2: en/auth.json 생성**

`apps/web/messages/en/auth.json`:
```json
{
  "login": {
    "title": "Sign in",
    "email": "Email",
    "password": "Password",
    "submit": "Sign in",
    "forgotPassword": "Forgot password?",
    "noAccount": "Don't have an account?",
    "signUp": "Sign up",
    "orContinueWith": "or"
  },
  "signup": {
    "title": "Create account",
    "name": "Name",
    "email": "Email",
    "password": "Password",
    "submit": "Create account",
    "hasAccount": "Already have an account?",
    "signIn": "Sign in",
    "orContinueWith": "or",
    "emailSent": "Check your email",
    "emailSentDesc": "We sent you a verification link. Click it to activate your account."
  },
  "forgot": {
    "title": "Forgot password",
    "desc": "Enter your email and we'll send you a reset link.",
    "email": "Email",
    "submit": "Send reset link",
    "sent": "Email sent",
    "sentDesc": "We sent a password reset link to your email. Check your inbox.",
    "backToLogin": "Back to sign in"
  },
  "verify": {
    "success": "Email verified",
    "successDesc": "Your email has been verified. You can now sign in.",
    "goLogin": "Sign in",
    "error": "Verification failed",
    "errorDesc": "The link has expired or is invalid. Please sign up again to get a new verification email.",
    "retry": "Sign up again"
  },
  "modal": {
    "loginTab": "Sign in",
    "signupTab": "Sign up"
  },
  "google": {
    "button": "Continue with Google"
  },
  "errors": {
    "invalidCredentials": "Invalid email or password.",
    "emailNotVerified": "Please verify your email. Check your inbox.",
    "emailAlreadyExists": "This email is already in use.",
    "generic": "Something went wrong. Please try again."
  }
}
```

- [ ] **Step 3: i18n.ts에 auth namespace 추가**

`apps/web/src/i18n.ts` 현재:
```ts
const [common, landing, dashboard, sidebar, app, editor] = await Promise.all([
  import(`../messages/${locale}/common.json`).then((m) => m.default),
  import(`../messages/${locale}/landing.json`).then((m) => m.default),
  import(`../messages/${locale}/dashboard.json`).then((m) => m.default),
  import(`../messages/${locale}/sidebar.json`).then((m) => m.default),
  import(`../messages/${locale}/app.json`).then((m) => m.default),
  import(`../messages/${locale}/editor.json`).then((m) => m.default),
]);

return {
  locale,
  messages: { common, landing, dashboard, sidebar, app, editor },
};
```

교체 후:
```ts
const [common, landing, dashboard, sidebar, app, editor, auth] = await Promise.all([
  import(`../messages/${locale}/common.json`).then((m) => m.default),
  import(`../messages/${locale}/landing.json`).then((m) => m.default),
  import(`../messages/${locale}/dashboard.json`).then((m) => m.default),
  import(`../messages/${locale}/sidebar.json`).then((m) => m.default),
  import(`../messages/${locale}/app.json`).then((m) => m.default),
  import(`../messages/${locale}/editor.json`).then((m) => m.default),
  import(`../messages/${locale}/auth.json`).then((m) => m.default),
]);

return {
  locale,
  messages: { common, landing, dashboard, sidebar, app, editor, auth },
};
```

- [ ] **Step 4: parity 확인**

```bash
pnpm --filter @opencairn/web i18n:parity
```

Expected: 에러 없음 (ko/en auth.json 키가 동일).

- [ ] **Step 5: 커밋**

```bash
git add apps/web/messages/ko/auth.json apps/web/messages/en/auth.json apps/web/src/i18n.ts
git commit -m "feat(web): auth i18n namespace (ko+en)"
```

---

### Task 4: session.ts redirect 수정 + auth layout 생성

**Files:**
- Modify: `apps/web/src/lib/session.ts`
- Create: `apps/web/src/app/[locale]/auth/layout.tsx`

- [ ] **Step 1: session.ts redirect 경로 수정**

`apps/web/src/lib/session.ts` 에서:
```ts
if (!res.ok) redirect("/login");
```
→ 교체:
```ts
if (!res.ok) redirect("/ko/auth/login");
```

middleware.ts 없는 현재 구조에서 bare `/login`은 404. default locale(`ko`)을 하드코드해 locale-aware 경로로 이동. (미래에 middleware 추가 시 이 경로 제거 예정)

- [ ] **Step 2: auth layout 생성**

`apps/web/src/app/[locale]/auth/layout.tsx`:
```tsx
import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n";

export default async function AuthLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div
      data-brand="auth"
      data-theme="cairn-light"
      className="min-h-screen bg-stone-50 flex flex-col items-center justify-center px-4"
    >
      <a
        href={`/${locale}`}
        className="mb-10 font-serif text-2xl text-stone-900 hover:text-stone-700 transition-colors"
      >
        OpenCairn
      </a>
      <div className="w-full max-w-sm bg-white rounded-xl border border-stone-200 p-8 shadow-sm">
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 타입 체크**

```bash
pnpm --filter @opencairn/web tsc --noEmit
```

Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add apps/web/src/lib/session.ts apps/web/src/app/[locale]/auth/layout.tsx
git commit -m "feat(web): auth layout + fix session redirect to /ko/auth/login"
```

---

### Task 5: GoogleButton 컴포넌트

**Files:**
- Create: `apps/web/src/components/auth/GoogleButton.tsx`

- [ ] **Step 1: GoogleButton 생성**

`apps/web/src/components/auth/GoogleButton.tsx`:
```tsx
"use client";
import { useTranslations, useLocale } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function GoogleButton() {
  const t = useTranslations("auth");
  const locale = useLocale();

  const handleClick = async () => {
    await authClient.signIn.social({
      provider: "google",
      callbackURL: `/${locale}/app`,
    });
  };

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full gap-2"
      onClick={handleClick}
    >
      <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
        <path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          fill="#4285F4"
        />
        <path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <path
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          fill="#EA4335"
        />
      </svg>
      {t("google.button")}
    </Button>
  );
}
```

- [ ] **Step 2: 타입 체크**

```bash
pnpm --filter @opencairn/web tsc --noEmit
```

Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add apps/web/src/components/auth/GoogleButton.tsx
git commit -m "feat(web): GoogleButton component"
```

---

### Task 6: LoginForm 컴포넌트

**Files:**
- Create: `apps/web/src/components/auth/LoginForm.tsx`

- [ ] **Step 1: LoginForm 생성**

`apps/web/src/components/auth/LoginForm.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GoogleButton } from "./GoogleButton";

interface LoginFormProps {
  onSuccess?: () => void;
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const t = useTranslations("auth");
  const router = useRouter();
  const locale = useLocale();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: authError } = await authClient.signIn.email({ email, password });

    setLoading(false);

    if (authError) {
      if (authError.status === 401) {
        setError(t("errors.invalidCredentials"));
      } else if (authError.message?.toLowerCase().includes("verified")) {
        setError(t("errors.emailNotVerified"));
      } else {
        setError(t("errors.generic"));
      }
      return;
    }

    if (onSuccess) {
      onSuccess();
    } else {
      router.push(`/${locale}/app`);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h2 className="font-serif text-xl text-stone-900">{t("login.title")}</h2>

      <GoogleButton />

      <div className="flex items-center gap-3 text-xs text-stone-400">
        <hr className="flex-1 border-stone-200" />
        <span>{t("login.orContinueWith")}</span>
        <hr className="flex-1 border-stone-200" />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-stone-700">{t("login.email")}</label>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-stone-700">{t("login.password")}</label>
          <a
            href={`/${locale}/auth/forgot-password`}
            className="text-xs text-stone-500 hover:text-stone-900 transition-colors"
          >
            {t("login.forgotPassword")}
          </a>
        </div>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "..." : t("login.submit")}
      </Button>

      <p className="text-center text-sm text-stone-500">
        {t("login.noAccount")}{" "}
        <a
          href={`/${locale}/auth/signup`}
          className="font-medium text-stone-900 hover:underline"
        >
          {t("login.signUp")}
        </a>
      </p>
    </form>
  );
}
```

- [ ] **Step 2: 타입 체크**

```bash
pnpm --filter @opencairn/web tsc --noEmit
```

Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add apps/web/src/components/auth/LoginForm.tsx
git commit -m "feat(web): LoginForm component"
```

---

### Task 7: SignupForm 컴포넌트

**Files:**
- Create: `apps/web/src/components/auth/SignupForm.tsx`

- [ ] **Step 1: SignupForm 생성**

`apps/web/src/components/auth/SignupForm.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GoogleButton } from "./GoogleButton";

interface SignupFormProps {
  onSuccess?: () => void;
}

export function SignupForm({ onSuccess }: SignupFormProps) {
  const t = useTranslations("auth");
  const locale = useLocale();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: authError } = await authClient.signUp.email({
      name,
      email,
      password,
      callbackURL: `/${locale}/auth/verify-email`,
    });

    setLoading(false);

    if (authError) {
      if (authError.status === 422 || authError.message?.toLowerCase().includes("already")) {
        setError(t("errors.emailAlreadyExists"));
      } else {
        setError(t("errors.generic"));
      }
      return;
    }

    setEmailSent(true);
    onSuccess?.();
  };

  if (emailSent) {
    return (
      <div className="flex flex-col gap-3 text-center py-4">
        <p className="font-serif text-xl text-stone-900">{t("signup.emailSent")}</p>
        <p className="text-sm text-stone-500">{t("signup.emailSentDesc")}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h2 className="font-serif text-xl text-stone-900">{t("signup.title")}</h2>

      <GoogleButton />

      <div className="flex items-center gap-3 text-xs text-stone-400">
        <hr className="flex-1 border-stone-200" />
        <span>{t("signup.orContinueWith")}</span>
        <hr className="flex-1 border-stone-200" />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-stone-700">{t("signup.name")}</label>
        <Input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-stone-700">{t("signup.email")}</label>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-stone-700">{t("signup.password")}</label>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "..." : t("signup.submit")}
      </Button>

      <p className="text-center text-sm text-stone-500">
        {t("signup.hasAccount")}{" "}
        <a
          href={`/${locale}/auth/login`}
          className="font-medium text-stone-900 hover:underline"
        >
          {t("signup.signIn")}
        </a>
      </p>
    </form>
  );
}
```

- [ ] **Step 2: 타입 체크**

```bash
pnpm --filter @opencairn/web tsc --noEmit
```

Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add apps/web/src/components/auth/SignupForm.tsx
git commit -m "feat(web): SignupForm component"
```

---

### Task 8: ForgotPasswordForm 컴포넌트

**Files:**
- Create: `apps/web/src/components/auth/ForgotPasswordForm.tsx`

- [ ] **Step 1: ForgotPasswordForm 생성**

`apps/web/src/components/auth/ForgotPasswordForm.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ForgotPasswordForm() {
  const t = useTranslations("auth");
  const locale = useLocale();

  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: authError } = await authClient.forgetPassword({
      email,
      redirectTo: `/${locale}/auth/reset-password`,
    });

    setLoading(false);

    if (authError) {
      setError(t("errors.generic"));
      return;
    }

    setSent(true);
  };

  if (sent) {
    return (
      <div className="flex flex-col gap-3 text-center py-4">
        <p className="font-serif text-xl text-stone-900">{t("forgot.sent")}</p>
        <p className="text-sm text-stone-500">{t("forgot.sentDesc")}</p>
        <a
          href={`/${locale}/auth/login`}
          className="mt-2 text-sm font-medium text-stone-900 hover:underline"
        >
          {t("forgot.backToLogin")}
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-serif text-xl text-stone-900">{t("forgot.title")}</h2>
        <p className="text-sm text-stone-500">{t("forgot.desc")}</p>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-stone-700">{t("forgot.email")}</label>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </div>

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "..." : t("forgot.submit")}
      </Button>

      <a
        href={`/${locale}/auth/login`}
        className="text-center text-sm text-stone-500 hover:text-stone-900 transition-colors"
      >
        {t("forgot.backToLogin")}
      </a>
    </form>
  );
}
```

- [ ] **Step 2: 타입 체크**

```bash
pnpm --filter @opencairn/web tsc --noEmit
```

Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add apps/web/src/components/auth/ForgotPasswordForm.tsx
git commit -m "feat(web): ForgotPasswordForm component"
```

---

### Task 9: auth 전용 페이지 3개 (login / signup / forgot-password)

**Files:**
- Create: `apps/web/src/app/[locale]/auth/login/page.tsx`
- Create: `apps/web/src/app/[locale]/auth/signup/page.tsx`
- Create: `apps/web/src/app/[locale]/auth/forgot-password/page.tsx`

- [ ] **Step 1: login page 생성**

`apps/web/src/app/[locale]/auth/login/page.tsx`:
```tsx
import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n";
import { LoginForm } from "@/components/auth/LoginForm";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LoginForm />;
}
```

- [ ] **Step 2: signup page 생성**

`apps/web/src/app/[locale]/auth/signup/page.tsx`:
```tsx
import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n";
import { SignupForm } from "@/components/auth/SignupForm";

export default async function SignupPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <SignupForm />;
}
```

- [ ] **Step 3: forgot-password page 생성**

`apps/web/src/app/[locale]/auth/forgot-password/page.tsx`:
```tsx
import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ForgotPasswordForm />;
}
```

- [ ] **Step 4: 타입 체크**

```bash
pnpm --filter @opencairn/web tsc --noEmit
```

Expected: 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/app/[locale]/auth/login/page.tsx apps/web/src/app/[locale]/auth/signup/page.tsx apps/web/src/app/[locale]/auth/forgot-password/page.tsx
git commit -m "feat(web): auth pages — login, signup, forgot-password"
```

---

### Task 10: verify-email 페이지

**Files:**
- Create: `apps/web/src/app/[locale]/auth/verify-email/page.tsx`

이 페이지는 Better Auth의 이메일 인증 후 `callbackURL`로 리다이렉트된 사용자를 받는 랜딩 페이지.  
인증 성공 시: `?error` 파라미터 없음 → 성공 UI.  
인증 실패 시: `?error=...` 파라미터 있음 → 에러 UI.

- [ ] **Step 1: verify-email page 생성**

`apps/web/src/app/[locale]/auth/verify-email/page.tsx`:
```tsx
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n";

export default async function VerifyEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  const { error } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "auth" });
  const hasError = !!error;

  return (
    <div className="flex flex-col gap-4 text-center py-2">
      {hasError ? (
        <>
          <p className="font-serif text-xl text-stone-900">{t("verify.error")}</p>
          <p className="text-sm text-stone-500">{t("verify.errorDesc")}</p>
          <a
            href={`/${locale}/auth/signup`}
            className="mt-2 inline-block bg-stone-900 text-stone-50 text-sm font-medium px-4 py-2 rounded-md hover:bg-stone-800 transition-colors"
          >
            {t("verify.retry")}
          </a>
        </>
      ) : (
        <>
          <p className="font-serif text-xl text-stone-900">{t("verify.success")}</p>
          <p className="text-sm text-stone-500">{t("verify.successDesc")}</p>
          <a
            href={`/${locale}/auth/login`}
            className="mt-2 inline-block bg-stone-900 text-stone-50 text-sm font-medium px-4 py-2 rounded-md hover:bg-stone-800 transition-colors"
          >
            {t("verify.goLogin")}
          </a>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 타입 체크**

```bash
pnpm --filter @opencairn/web tsc --noEmit
```

Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add apps/web/src/app/[locale]/auth/verify-email/page.tsx
git commit -m "feat(web): verify-email landing page"
```

---

### Task 11: AuthModal 컴포넌트

**Files:**
- Create: `apps/web/src/components/auth/AuthModal.tsx`

- [ ] **Step 1: AuthModal 생성**

`apps/web/src/components/auth/AuthModal.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { LoginForm } from "./LoginForm";
import { SignupForm } from "./SignupForm";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: "login" | "signup";
}

export function AuthModal({ open, onOpenChange, defaultTab = "login" }: AuthModalProps) {
  const t = useTranslations("auth");
  const [tab, setTab] = useState<"login" | "signup">(defaultTab);

  // 모달이 열릴 때마다 defaultTab으로 리셋
  useEffect(() => {
    if (open) setTab(defaultTab);
  }, [open, defaultTab]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton className="max-w-sm p-0 overflow-hidden gap-0">
        {/* 탭 헤더 */}
        <div className="flex border-b border-stone-200">
          <button
            type="button"
            onClick={() => setTab("login")}
            className={`flex-1 py-3.5 text-sm font-medium transition-colors ${
              tab === "login"
                ? "text-stone-900 border-b-2 border-stone-900 -mb-px"
                : "text-stone-500 hover:text-stone-700"
            }`}
          >
            {t("modal.loginTab")}
          </button>
          <button
            type="button"
            onClick={() => setTab("signup")}
            className={`flex-1 py-3.5 text-sm font-medium transition-colors ${
              tab === "signup"
                ? "text-stone-900 border-b-2 border-stone-900 -mb-px"
                : "text-stone-500 hover:text-stone-700"
            }`}
          >
            {t("modal.signupTab")}
          </button>
        </div>

        {/* 폼 영역 */}
        <div className="p-6">
          {tab === "login" ? (
            <LoginForm onSuccess={() => onOpenChange(false)} />
          ) : (
            <SignupForm />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

`LoginForm`의 `onSuccess`는 로그인 성공 시 모달 닫기. `SignupForm`에는 `onSuccess` 전달 안 함 — 가입 성공 후 `emailSent` UI가 모달 안에서 보여야 하므로. `SignupForm`은 `setEmailSent(true)` 후 상태를 내부에서 관리하며 "이메일 확인" 메시지를 표시.

- [ ] **Step 2: 타입 체크**

```bash
pnpm --filter @opencairn/web tsc --noEmit
```

Expected: 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/components/auth/AuthModal.tsx
git commit -m "feat(web): AuthModal with login/signup tabs"
```

---

### Task 12: Header 업데이트 — 버튼을 모달 트리거로 교체

**Files:**
- Modify: `apps/web/src/components/landing/chrome/Header.tsx`

- [ ] **Step 1: Header 전체 교체**

`apps/web/src/components/landing/chrome/Header.tsx`:
```tsx
"use client";
import { useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { AuthModal } from "@/components/auth/AuthModal";

export function LandingHeader() {
  const t = useTranslations("landing.nav");
  const locale = useLocale();
  const otherLocale = locale === "ko" ? "en" : "ko";
  const nameRef = useRef<HTMLSpanElement>(null);
  const [clicks, setClicks] = useState(0);

  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"login" | "signup">("login");

  const openAuth = (tab: "login" | "signup") => {
    setAuthTab(tab);
    setAuthOpen(true);
  };

  const onLogoClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const next = clicks + 1;
    setClicks(next);
    if (next === 3) {
      const span = nameRef.current;
      if (span) {
        const prev = span.textContent ?? "";
        span.textContent = t("easter");
        setTimeout(() => {
          span.textContent = prev;
        }, 1600);
      }
    }
  };

  return (
    <>
      <nav className="sticky top-0 z-40 bg-stone-50/85 backdrop-blur-md border-b border-stone-900">
        <div className="max-w-[1280px] mx-auto px-6 lg:px-10 py-4 flex items-center justify-between">
          <a
            href="#"
            onClick={onLogoClick}
            className="flex items-baseline"
            title={t("logoTitle")}
          >
            <span ref={nameRef} className="font-serif text-2xl text-stone-900">
              OpenCairn
            </span>
          </a>
          <div className="hidden md:flex items-center gap-7 font-mono text-[12px] tracking-wider text-stone-600">
            <a href="#how" className="hover:text-stone-900 transition-colors">{t("pipeline")}</a>
            <a href="#agents" className="hover:text-stone-900 transition-colors">{t("agents")}</a>
            <a href="#workspace" className="hover:text-stone-900 transition-colors">{t("workspace")}</a>
            <a href="#vs" className="hover:text-stone-900 transition-colors">{t("why")}</a>
            <a href="#pricing" className="hover:text-stone-900 transition-colors">{t("pricing")}</a>
            <a href="#docs" className="hover:text-stone-900 transition-colors">{t("docs")}</a>
          </div>
          <div className="flex items-center gap-4">
            <a
              href={`/${otherLocale}`}
              aria-label={t("switchToLabel")}
              className="font-mono text-[11px] tracking-widest text-stone-500 hover:text-stone-900 transition-colors"
            >
              {t("switchTo")}
            </a>
            <button
              onClick={() => openAuth("login")}
              className="hidden sm:inline-block text-sm text-stone-700 hover:text-stone-900 font-medium kr transition-colors"
            >
              {t("signIn")}
            </button>
            <button
              onClick={() => openAuth("signup")}
              className="bg-stone-900 hover:bg-stone-800 text-stone-50 text-sm font-medium px-4 py-2 rounded-md transition-colors kr"
            >
              {t("signUp")}
            </button>
          </div>
        </div>
      </nav>
      <AuthModal
        open={authOpen}
        onOpenChange={setAuthOpen}
        defaultTab={authTab}
      />
    </>
  );
}
```

- [ ] **Step 2: 타입 체크**

```bash
pnpm --filter @opencairn/web tsc --noEmit
```

Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add apps/web/src/components/landing/chrome/Header.tsx
git commit -m "feat(web): landing header — sign in/up buttons open AuthModal"
```

---

### Task 13: 스모크 테스트

- [ ] **Step 1: dev 서버 기동**

터미널 1:
```bash
pnpm --filter @opencairn/api dev
```

터미널 2:
```bash
pnpm --filter @opencairn/web dev
```

- [ ] **Step 2: 전용 페이지 접근 확인**

브라우저에서:
- `http://localhost:3000/ko/auth/login` → 로그인 폼 + Google 버튼 표시
- `http://localhost:3000/ko/auth/signup` → 회원가입 폼 표시
- `http://localhost:3000/ko/auth/forgot-password` → 비밀번호 찾기 폼 표시
- `http://localhost:3000/ko/auth/verify-email` → 인증 완료 성공 UI (error 없음)
- `http://localhost:3000/ko/auth/verify-email?error=invalid` → 인증 실패 UI

- [ ] **Step 3: 모달 동작 확인**

`http://localhost:3000/ko` 랜딩페이지에서:
- "로그인" 클릭 → 모달 열림, 로그인 탭 활성
- "시작하기" 클릭 → 모달 열림, 회원가입 탭 활성
- 탭 전환 동작 확인
- ESC / 오버레이 클릭으로 닫기 확인

- [ ] **Step 4: 회원가입 → 이메일 인증 플로우 확인**

1. 회원가입 폼에 이름/이메일/비밀번호 입력 후 제출
2. API 콘솔에서 `[DEV] Verify email for ...` 로그 확인
3. 로그에서 URL 복사 (`http://localhost:3000/api/auth/verify-email?token=...`)
4. 브라우저에서 URL 접근 → `/ko/auth/verify-email`로 리다이렉트됨 확인
5. 로그인 폼에 방금 가입한 계정으로 로그인 시도 → `/ko/app`으로 이동 확인

- [ ] **Step 5: 미인증 앱 접근 리다이렉트 확인**

- 로그아웃 상태에서 `http://localhost:3000/ko/app` 접근 → `/ko/auth/login`으로 리다이렉트 확인

- [ ] **Step 6: 최종 커밋 (변경사항 있을 경우)**

```bash
git add -A
git commit -m "fix(web): auth smoke test fixes"
```
