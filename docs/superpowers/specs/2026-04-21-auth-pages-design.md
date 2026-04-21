# Auth Pages Design

**Date:** 2026-04-21  
**Status:** Approved

## Overview

Email+password 인증 페이지 구현 (로그인 / 회원가입 / 비밀번호 찾기 / 이메일 인증).  
Google OAuth 코드는 포함하되 `GOOGLE_CLIENT_ID` 환경변수 존재 시에만 활성화.  
이메일 발송은 콘솔 로그 mock (프로덕션 배포 시 Resend 교체).

---

## Routes

```
/[locale]/auth/login            — 로그인
/[locale]/auth/signup           — 회원가입
/[locale]/auth/forgot-password  — 비밀번호 찾기 요청
/[locale]/auth/verify-email     — 이메일 인증 완료 랜딩 (토큰 쿼리 처리)
```

성공 후 리다이렉트: `/[locale]/app` (기존 앱 대시보드).

---

## API — Better Auth 설정 변경 (`apps/api/src/lib/auth.ts`)

### 추가 플러그인

```ts
emailVerification: {
  sendVerificationEmail: async ({ user, url }) => {
    console.log(`[DEV] Verify email for ${user.email}: ${url}`);
  },
},
emailAndPassword: {
  enabled: true,
  requireEmailVerification: true,
  sendResetPassword: async ({ user, url }) => {
    console.log(`[DEV] Reset password for ${user.email}: ${url}`);
  },
},
socialProviders: process.env.GOOGLE_CLIENT_ID
  ? {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
    }
  : {},
```

`requireEmailVerification: true` — 인증 전에는 로그인 불가.

---

## Web — Better Auth 클라이언트 (`apps/web/src/lib/auth-client.ts`)

```ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: "/api/auth",
});
```

브라우저에서 Better Auth API를 직접 호출하는 얇은 래퍼.

---

## Web — 레이아웃 (`apps/web/src/app/[locale]/auth/layout.tsx`)

- stone-50 배경, 전체 화면 세로 중앙 정렬
- 상단: OpenCairn 로고 (랜딩 홈 링크)
- 하단: 카드 (`max-w-sm`, `rounded-xl`, `border border-stone-200`, `bg-white`, `p-8`)
- 네비게이션 없음

---

## Web — 컴포넌트 (`apps/web/src/components/auth/`)

### `LoginForm.tsx`
- 필드: 이메일, 비밀번호
- "비밀번호 찾기" 링크 → `/auth/forgot-password`
- "계정이 없으신가요?" 링크 → `/auth/signup`
- Google 버튼: `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` 일 때만 렌더링
- 제출: `authClient.signIn.email()` → 성공 시 `/app`으로 `router.push`

### `SignupForm.tsx`
- 필드: 이름, 이메일, 비밀번호
- "이미 계정이 있으신가요?" 링크 → `/auth/login`
- Google 버튼: 조건부 렌더링
- 제출: `authClient.signUp.email()` → 성공 시 "인증 이메일을 보냈습니다" 상태로 전환

### `ForgotPasswordForm.tsx`
- 필드: 이메일
- 제출: `authClient.forgetPassword()` → 성공 시 "이메일을 보냈습니다" 상태로 전환
- "로그인으로 돌아가기" 링크

### `GoogleButton.tsx`
- `authClient.signIn.social({ provider: "google" })` 호출
- `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED !== "true"` 이면 null 반환

---

## Web — 페이지

### `auth/verify-email/page.tsx`
- URL 쿼리에서 `token` 파라미터 추출
- 서버 컴포넌트: `authClient.verifyEmail({ query: { token } })` (서버에서 호출)
- 성공: "이메일 인증이 완료됐습니다" + "로그인하기" 버튼
- 실패/만료: 오류 메시지 + "다시 요청하기" 버튼

---

## `session.ts` 수정

```ts
// 기존: redirect("/login")
// 변경:
import { defaultLocale } from "@/i18n";
if (!res.ok) redirect(`/${defaultLocale}/auth/login`);
```

middleware.ts 없는 현재 구조에서 bare `/login` 경로는 404이므로 locale 포함 경로로 수정.

---

## Header 수정 (`apps/web/src/components/landing/chrome/Header.tsx`)

```tsx
// Sign In
href={`/${locale}/auth/login`}

// Sign Up
href={`/${locale}/auth/signup`}
```

---

## i18n

신규 네임스페이스 `auth` 추가. 파일: `messages/ko/auth.json`, `messages/en/auth.json`.

`apps/web/src/i18n.ts` 에 `auth` import 추가.

키 목록:
```
login.title, login.email, login.password, login.submit, login.forgotPassword,
login.noAccount, login.orContinueWith, login.googleButton,
signup.title, signup.name, signup.email, signup.password, signup.submit,
signup.hasAccount, signup.emailSent, signup.emailSentDesc,
forgot.title, forgot.desc, forgot.email, forgot.submit, forgot.sent, forgot.sentDesc,
forgot.backToLogin,
verify.success, verify.successDesc, verify.goLogin,
verify.error, verify.errorDesc, verify.retry,
errors.invalidCredentials, errors.emailNotVerified, errors.emailAlreadyExists,
errors.generic
```

---

## 환경변수

| 변수 | 위치 | 용도 |
|------|------|------|
| `GOOGLE_CLIENT_ID` | API | Google OAuth 활성화 조건 |
| `GOOGLE_CLIENT_SECRET` | API | Google OAuth 시크릿 |
| `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` | Web | Google 버튼 렌더링 조건 |

세 변수 모두 없어도 이메일/비밀번호 플로우 정상 동작.

---

## 파일 목록 (신규 / 수정)

**신규:**
- `apps/web/src/lib/auth-client.ts`
- `apps/web/src/app/[locale]/auth/layout.tsx`
- `apps/web/src/app/[locale]/auth/login/page.tsx`
- `apps/web/src/app/[locale]/auth/signup/page.tsx`
- `apps/web/src/app/[locale]/auth/forgot-password/page.tsx`
- `apps/web/src/app/[locale]/auth/verify-email/page.tsx`
- `apps/web/src/components/auth/LoginForm.tsx`
- `apps/web/src/components/auth/SignupForm.tsx`
- `apps/web/src/components/auth/ForgotPasswordForm.tsx`
- `apps/web/src/components/auth/GoogleButton.tsx`
- `apps/web/messages/ko/auth.json`
- `apps/web/messages/en/auth.json`

**수정:**
- `apps/api/src/lib/auth.ts` — emailVerification + Google OAuth 추가
- `apps/web/src/lib/session.ts` — redirect 경로 수정
- `apps/web/src/i18n.ts` — auth namespace 추가
- `apps/web/src/components/landing/chrome/Header.tsx` — href 업데이트

---

## 테스트

- 이메일 가입 → 콘솔에서 verify URL 복사 → 인증 → 로그인 가능 확인
- 잘못된 비밀번호 → 에러 메시지 표시 확인
- 비밀번호 찾기 → 콘솔에서 reset URL 확인
- `GOOGLE_CLIENT_ID` 미설정 시 Google 버튼 미표시 확인
- `/app` 직접 접근 시 로그인 페이지로 리다이렉트 확인
