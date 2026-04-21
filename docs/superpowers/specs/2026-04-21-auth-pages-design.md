# Auth Pages Design

**Date:** 2026-04-21  
**Status:** Approved (rev 2 — Google OAuth 필수화 + 랜딩 모달)

## Overview

Email+password + Google OAuth 인증 구현.  
랜딩 헤더의 "로그인" / "시작하기" 버튼은 페이지 이동 대신 **모달**을 열어 로그인/회원가입 폼을 표시.  
전용 `/auth/*` 페이지는 직접 URL 접근 및 비밀번호 찾기·이메일 인증 용도로 유지.  
이메일 발송은 콘솔 로그 mock (프로덕션 배포 시 Resend 교체).

---

## Routes

```
/[locale]/auth/login            — 로그인 (전용 페이지)
/[locale]/auth/signup           — 회원가입 (전용 페이지)
/[locale]/auth/forgot-password  — 비밀번호 찾기 요청
/[locale]/auth/verify-email     — 이메일 인증 완료 랜딩 (토큰 쿼리 처리)
```

성공 후 리다이렉트: `/[locale]/app`.

---

## API — Better Auth 설정 변경 (`apps/api/src/lib/auth.ts`)

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
socialProviders: {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  },
},
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

---

## Landing — AuthModal (`apps/web/src/components/auth/AuthModal.tsx`)

랜딩 페이지 전용 모달 컴포넌트. 기존 `Dialog` UI 컴포넌트 사용.

- **탭 2개**: 로그인 / 회원가입
- 외부에서 `defaultTab: "login" | "signup"` prop으로 초기 탭 제어
- Google 버튼 — 항상 표시 (상단 우선순위)
- 구분선 "또는 이메일로 계속"
- 이메일+비밀번호 폼
- 회원가입 탭 → 제출 성공 시 "인증 이메일 발송됨" 상태로 전환 (탭 닫지 않음)
- "비밀번호 찾기" → 모달 닫고 `/auth/forgot-password`로 이동

### Header.tsx 변경

- "로그인" 버튼 → `onClick={() => openModal("login")}` (href 제거)
- "시작하기" 버튼 → `onClick={() => openModal("signup")}`
- `LandingHeader`에 `AuthModal` 포함, `useState`로 open/defaultTab 관리

---

## Web — 레이아웃 (`apps/web/src/app/[locale]/auth/layout.tsx`)

- stone-50 배경, 전체 화면 세로 중앙 정렬
- 상단: OpenCairn 로고 (랜딩 홈 링크)
- 카드: `max-w-sm`, `rounded-xl`, `border border-stone-200`, `bg-white`, `p-8`
- 네비게이션 없음

---

## Web — 공유 폼 컴포넌트 (`apps/web/src/components/auth/`)

모달과 전용 페이지 양쪽에서 재사용.

### `LoginForm.tsx`
- props: `onSuccess?: () => void` (모달에서는 닫기, 페이지에서는 router.push)
- 필드: 이메일, 비밀번호
- 제출: `authClient.signIn.email()` → `onSuccess()` 호출 또는 `/app` 이동

### `SignupForm.tsx`
- props: `onSuccess?: () => void`
- 필드: 이름, 이메일, 비밀번호
- 제출: `authClient.signUp.email()` → "인증 이메일 발송됨" UI 상태

### `ForgotPasswordForm.tsx`
- 필드: 이메일
- 제출: `authClient.forgetPassword()` → "이메일 보냈습니다" UI 상태
- "로그인으로 돌아가기" 링크

### `GoogleButton.tsx`
- `authClient.signIn.social({ provider: "google", callbackURL: "/app" })` 호출
- 항상 렌더링 (조건부 없음)

---

## Web — 전용 페이지

### `auth/login/page.tsx`
- `LoginForm` 렌더링, `onSuccess` → `router.push("/app")`
- "계정이 없으신가요?" → `/auth/signup`

### `auth/signup/page.tsx`
- `SignupForm` 렌더링
- "이미 계정이 있으신가요?" → `/auth/login`

### `auth/forgot-password/page.tsx`
- `ForgotPasswordForm` 렌더링

### `auth/verify-email/page.tsx`
- 서버 컴포넌트, URL `token` 쿼리 파라미터로 인증 처리
- 성공: "인증 완료" + "로그인하기" 버튼
- 실패/만료: 오류 메시지 + "다시 요청하기" 버튼

---

## `session.ts` 수정

```ts
// 기존: redirect("/login")
// 변경:
import { defaultLocale } from "@/i18n";
if (!res.ok) redirect(`/${defaultLocale}/auth/login`);
```

---

## i18n

신규 네임스페이스 `auth`. 파일: `messages/ko/auth.json`, `messages/en/auth.json`.  
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
modal.loginTab, modal.signupTab,
errors.invalidCredentials, errors.emailNotVerified, errors.emailAlreadyExists,
errors.generic
```

---

## 환경변수

| 변수 | 위치 | 필수 | 용도 |
|------|------|------|------|
| `GOOGLE_CLIENT_ID` | API | 필수 | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | API | 필수 | Google OAuth |

이메일/비밀번호만 테스트 시 Google 키 없이도 Better Auth가 기동하지만 Google 버튼 클릭 시 오류 발생.

---

## 파일 목록 (신규 / 수정)

**신규:**
- `apps/web/src/lib/auth-client.ts`
- `apps/web/src/app/[locale]/auth/layout.tsx`
- `apps/web/src/app/[locale]/auth/login/page.tsx`
- `apps/web/src/app/[locale]/auth/signup/page.tsx`
- `apps/web/src/app/[locale]/auth/forgot-password/page.tsx`
- `apps/web/src/app/[locale]/auth/verify-email/page.tsx`
- `apps/web/src/components/auth/AuthModal.tsx`
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
- `apps/web/src/components/landing/chrome/Header.tsx` — 버튼 → 모달 트리거

---

## 테스트

- 헤더 "로그인" 클릭 → 모달 열림, 로그인 탭 활성
- 헤더 "시작하기" 클릭 → 모달 열림, 회원가입 탭 활성
- 이메일 가입 → 콘솔에서 verify URL 복사 → 인증 → 로그인 가능
- 잘못된 비밀번호 → 에러 메시지 표시
- 비밀번호 찾기 → 콘솔에서 reset URL 확인
- Google 버튼 항상 표시
- `/app` 직접 접근 시 `/ko/auth/login`으로 리다이렉트
