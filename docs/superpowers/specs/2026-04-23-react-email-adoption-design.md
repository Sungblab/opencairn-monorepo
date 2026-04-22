# React Email 도입 Design Spec

**Status:** Draft (2026-04-23)
**Owner:** Sungbin
**Related:**
- `apps/api/src/lib/email.ts` — 교체 대상 (현재 인라인 HTML 문자열)
- `apps/api/src/routes/invites.ts:86` — 유일한 호출처
- [onboarding-and-first-run-design.md](./2026-04-22-onboarding-and-first-run-design.md) — invite 링크 규격 레퍼런스
- 외부: [react.email](https://react.email/docs) · [Resend React integration](https://react.email/docs/integrations/resend)

## 1. Problem

현재 OpenCairn의 이메일 발송 경로는 `apps/api/src/lib/email.ts` 한 파일, invite 메일 하나뿐이다:

- HTML을 **문자열 리터럴로 직접 작성** — 태그 수동, XSS 방지 위해 `escapeHtml` 수동 호출
- 디자인 없음 — 브랜드 로고/폰트/색상 미적용, `<p>` 두 줄
- 프리뷰 불가 — 렌더 확인하려면 실제 발송 or resend 대시보드 찔러보기
- 재사용 자산 없음 — 다음 템플릿 (이메일 검증 / @mention / 결제 영수증) 추가 시 처음부터 또 문자열 작성

Plan 2C (notifications + share), 9b (billing receipts), Better Auth (email verification, password reset) 전부 이메일 발송을 추가로 필요로 한다. **지금 작고, 나중에 많아진다** — 인프라를 한 번 깔아두면 새 템플릿 추가가 "React 컴포넌트 1개 + 호출 한 줄"로 줄어든다.

## 2. Goals & Non-Goals

**Goals**
- `packages/emails` 워크스페이스 패키지로 이메일 템플릿 분리 (`db`·`llm`·`shared` 패턴 일치)
- 공용 레이아웃 컴포넌트 (Layout / Button / Footer) — 앞으로 모든 템플릿이 extends
- 기존 `sendInviteEmail`을 react-email + Resend native React 렌더링으로 교체
- `pnpm --filter @opencairn/emails dev` 프리뷰 서버 — 브라우저에서 라이브 수정 확인
- `.env.example`의 `EMAIL_FROM` 기본값을 verified 도메인(`opencairn.com`)으로 교체
- 새 템플릿 추가 워크플로우 확립 — Gemini에 "invite.tsx 구조 따라서 X 만들어줘" 붙여넣기 편하도록 컴포넌트 스타일 컨벤션 명확화

**Non-goals (v0.1)**
- 런타임 LLM 카피 생성 — 템플릿 작성 시 Gemini 활용은 개발자 워크플로우이지 런타임 기능이 아님
- 여러 템플릿 미리 만들기 — invite 하나만 포팅. 다음 템플릿은 실제 수요 발생 시 추가
- 바이링구얼 분기 구현 — 현재 invite는 ko 고정. `locale` prop 자리만 Layout에 뚫어두되 분기 로직은 다음 템플릿에서 도입
- Unsubscribe / 수신거부 관리 — 트랜잭셔널 메일만 다루는 v0.1 범위 밖
- 이메일 큐잉 / 재시도 — Resend의 내장 재시도 + 호출처 측 error 로깅으로 충분
- 이메일 분석 (open/click tracking) — Plan 9b 이후

## 3. Architecture

```
packages/emails/                   # 새 패키지 @opencairn/emails
├── package.json
├── tsconfig.json
├── src/
│   ├── components/                # 재사용 컴포넌트
│   │   ├── Layout.tsx             # <Html><Head><Body> + 로고 헤더 + 브랜드 푸터
│   │   ├── Button.tsx             # 브랜드 컬러 CTA 버튼
│   │   └── tokens.ts              # 색상/폰트/간격 상수 (CLAUDE.md neutral 팔레트 준수)
│   ├── templates/
│   │   └── invite.tsx             # InviteEmail — props: { inviter, signupUrl }
│   └── index.ts                   # 배럴 export
└── emails/                        # react-email CLI 프리뷰 전용 디렉터리
    └── invite.tsx                 # <InviteEmail inviter="Alex" signupUrl="http://..." />
```

**패키지 이름:** `@opencairn/emails`
**Workspace export:** `src/index.ts` → `{ InviteEmail }` (앞으로 템플릿 추가 시 여기 append)

**의존성:**
- `react` / `react-dom` — peer, react-email이 요구
- `@react-email/components` — `Html`, `Head`, `Body`, `Container`, `Button`, `Text`, `Section`, `Hr`, `Img`
- `react-email` (devDependency) — CLI, 프리뷰 서버

**데이터 흐름:**
```
apps/api/src/routes/invites.ts
  └─> apps/api/src/lib/email.ts
       └─> @opencairn/emails (InviteEmail)
            └─> resend.emails.send({ react: <InviteEmail .../> })
                 └─> Resend API → SMTP
```

Resend SDK는 `react` 프로퍼티를 받으면 내부에서 `@react-email/render`로 HTML 변환 후 발송. 별도 render 단계 불필요.

## 4. Layout 컴포넌트 스펙

`components/Layout.tsx`는 모든 템플릿이 children으로 감싸는 껍데기.

**구조:**
```tsx
<Layout preview="이메일 미리보기 텍스트">
  {/* 본문 컴포넌트들 */}
</Layout>
```

**포함 요소 (고정):**
- `<Html lang="ko">` — 기본 ko, 템플릿이 `lang` prop으로 override 가능 (en 분기 대비)
- `<Head>` — font preconnect (Pretendard), 반응형 viewport
- `<Preview>` — preview text는 prop으로 주입 (Gmail/Apple Mail 목록 미리보기)
- 헤더 섹션 — OpenCairn 로고 (텍스트 워드마크, CLAUDE.md 규칙상 serif만 로고에 허용)
- `<Container>` — children 삽입
- 푸터 섹션 — copyright, 문의 이메일(`hello@opencairn.com`), "이 메일을 받은 이유" 슬롯 (children prop `footerNote`)

**스타일 토큰 (`tokens.ts`):**
- 팔레트: neutral 모노 (CLAUDE.md feedback memory `feedback_opencairn_design.md` 규칙 — warm/ember/cream 금지)
- 폰트: body는 system-ui 스택, 로고만 serif
- 이메일 호환성을 위해 CSS-in-JS는 `style={{...}}` 인라인만 사용 (Tailwind `className`은 react-email이 내부 변환하지만 인라인이 더 단순)

**핵심 규칙 (컨벤션):**
- 모든 색상은 `tokens.ts`에서 import — 템플릿 안에서 하드코딩 금지
- 외부 이미지 URL 금지 (Outlook 블록됨) — 로고는 순수 텍스트 or data URI
- 버튼은 `components/Button.tsx` 써야지 raw `<a>` 스타일 커스텀 금지
- 가로폭 600px 고정 (이메일 업계 표준)

## 5. Button 컴포넌트 스펙

`components/Button.tsx` — 모든 CTA가 이걸 사용.

**Props:**
```tsx
interface Props {
  href: string;        // 필수, 코드 주입
  children: ReactNode; // 라벨
  variant?: 'primary' | 'secondary';  // v0.1은 primary 하나, variant 자리만 마련
}
```

**이유:**
- CTA 라벨은 LLM이 생성할 수도 있음(개발 시 Gemini 활용) — 그래도 `href`는 절대 LLM이 만지지 않도록 강제
- Outlook VML 대응을 `@react-email/components`의 `<Button>`이 이미 처리 — 이걸 감싸서 브랜드 스타일만 추가

## 6. Invite 템플릿 — 기존 로직 마이그레이션

**기존 (`apps/api/src/lib/email.ts`):**
```ts
const html = `<p>${safeName} invited you to collaborate.</p>
<p><a href="${signupUrl}">Accept invite</a></p>`;
await resend.emails.send({ from, to, subject, html });
```

**이후:**
```ts
// packages/emails/src/templates/invite.tsx
export function InviteEmail({ inviter, signupUrl }: {
  inviter: string;
  signupUrl: string;
}) {
  return (
    <Layout preview={`${inviter}님이 OpenCairn 워크스페이스에 초대했습니다`}>
      <Text>{inviter}님이 함께 작업하자고 초대하셨습니다.</Text>
      <Button href={signupUrl}>초대 수락하기</Button>
      <Text style={small}>
        링크가 동작하지 않으면 아래 주소를 브라우저에 붙여넣어 주세요:<br/>
        {signupUrl}
      </Text>
    </Layout>
  );
}
```

```ts
// apps/api/src/lib/email.ts
import { InviteEmail } from "@opencairn/emails";

export async function sendInviteEmail(to, { token, workspaceId, invitedByName }) {
  const signupUrl = `${webBase}/${DEFAULT_LOCALE}/auth/signup?invite=${encodeURIComponent(token)}`;

  if (!resend) {
    console.log("[email:dev]", { to, signupUrl, inviter: invitedByName });
    return;
  }

  await resend.emails.send({
    from,
    to,
    subject: `${invitedByName}님이 OpenCairn 워크스페이스에 초대했습니다`,
    react: InviteEmail({ inviter: invitedByName, signupUrl }),
  });
}
```

**변경점 요약:**
- HTML 문자열 + `escapeHtml` 제거 — React가 텍스트 자동 이스케이프
- 제목/본문 한국어로 통일 (기존은 영어 "invited you..." 혼재) — CLAUDE.md 존댓말 규칙 준수
- 링크는 여전히 코드에서 생성, `signupUrl`로 props 주입 — 절대 템플릿이 만지지 않음
- `workspaceId`는 호출처에서 쓰지 않으므로 template props에서 제외 (YAGNI)

**호환성:**
- `sendInviteEmail` 시그니처 불변 — `apps/api/src/routes/invites.ts:86` 호출처 수정 없음
- `RESEND_API_KEY` 미설정 시 console 로그 분기 유지

## 7. Dev workflow — 프리뷰 서버 & 새 템플릿 추가

**프리뷰 서버:**
```bash
pnpm --filter @opencairn/emails dev
# → http://localhost:3001
```
- react-email CLI 기본 포트는 3000이지만 Next.js dev 서버와 충돌하므로 `package.json`의 dev script를 `email dev --port 3001`로 고정
- `packages/emails/emails/*.tsx` 파일을 자동 스캔
- 핫 리로드 — 템플릿 파일 수정 시 브라우저 즉시 갱신
- 각 `emails/<name>.tsx`는 프리뷰 전용 랩퍼로, `templates/<name>.tsx`를 실제 props 예시와 함께 렌더

**예시 (`packages/emails/emails/invite.tsx`):**
```tsx
import { InviteEmail } from "../src/templates/invite";

export default function Preview() {
  return <InviteEmail inviter="김개발" signupUrl="https://opencairn.com/ko/auth/signup?invite=abc123" />;
}
```

**새 템플릿 추가 워크플로우 (개발자 관점):**
1. `packages/emails/src/templates/<name>.tsx` 생성 — Gemini에 "`invite.tsx` 구조와 `Layout` / `Button` 컴포넌트를 써서 `<X>` 메일 템플릿을 만들어줘. props는 `{...}` 형태로" 프롬프트
2. `packages/emails/emails/<name>.tsx`에 프리뷰 랩퍼 작성
3. `pnpm --filter @opencairn/emails dev`로 확인
4. `src/index.ts`에서 export 추가
5. `apps/api`에서 `sendXEmail` 함수 작성 (`sendInviteEmail` 패턴 복사)

**여기서 Gemini가 하는 것 / 하지 않는 것:**
- ✅ 템플릿 컴포넌트 코드 작성, 카피 문구 초안, 디자인 레이아웃
- ❌ 런타임 호출 — 템플릿 파일은 정적 코드로 커밋. 배포 후 LLM 호출 없음

## 8. Error handling

**API 키 미설정 (`RESEND_API_KEY` unset):**
기존 console 로그 분기 유지. 로그에 렌더된 preview text + signupUrl만 찍음 (full HTML dump 하지 않음 — 개발 시 터미널 오염 방지).

**Resend API 실패:**
- 호출처 `invites.ts`가 이미 try/catch 후 5xx 반환 — 변경 없음
- Resend SDK 자체 retry (429, 5xx 지수 백오프) 그대로 사용
- 배달 실패는 email audit 로그로만 기록, 사용자에게 실패 노출 안 함 (초대자가 재발송 UI로 처리 — Plan 2C 범위)

**템플릿 렌더 에러:**
react-email은 synchronous render. 컴포넌트에 런타임 에러가 있으면 `resend.emails.send`가 예외 throw — 호출처가 catch. Props 타입은 TypeScript로 강제, 런타임 방어는 없음 (internal API 경계 신뢰).

## 9. Testing

**Unit test:**
- `packages/emails/src/__tests__/invite.test.tsx` — `@react-email/render`로 HTML 스트링 생성 후 assertion:
  - `signupUrl`이 `<a href>`에 정확히 포함되는지
  - `inviter` 이름이 DOM에 나타나는지
  - XSS 시도 (`<script>`가 들어와도 텍스트로 이스케이프되는지)
- Vitest 기반 (`apps/api`와 동일 런너)

**Integration test (apps/api):**
- 기존 `invites.test.ts`는 `sendInviteEmail`을 mock — 이 mock을 `@opencairn/emails`의 `InviteEmail` mock으로 업데이트. 실제 Resend는 호출 안 함.

**Visual regression:**
- v0.1은 스킵. 템플릿 추가가 다수로 늘면 `email-snapshot` 같은 도구 검토 (향후).

## 10. Environment

**`.env.example` 변경:**
```diff
- EMAIL_FROM=OpenCairn <onboarding@resend.dev>
+ EMAIL_FROM=OpenCairn <hello@opencairn.com>
```
`opencairn.com`은 Resend에 verified 되어있음 (user confirmed 2026-04-23). `hello@`는 관례 — 필요 시 `noreply@`, `invites@` 등으로 조정 가능.

**운영 주의:**
- 본 spec 착수 전 Resend API 키 로테이션 필요 — 채팅에 1회 노출됨 (2026-04-23). 새 키는 `.env`에만 저장.

## 11. Migration plan (high level)

(상세 task는 `writing-plans` 단계에서 전개)

1. `packages/emails` 스캐폴드 + 의존성 추가
2. `tokens.ts`, `Layout`, `Button` 컴포넌트
3. `templates/invite.tsx` + 프리뷰 랩퍼
4. `src/index.ts` 배럴 export
5. `@opencairn/emails`를 `apps/api` workspace dep으로 추가
6. `apps/api/src/lib/email.ts` → React 버전으로 교체
7. `.env.example` 업데이트
8. Unit test + 기존 `invites` integration test 갱신
9. `pnpm --filter @opencairn/api build` + test 통과 확인
10. `pnpm --filter @opencairn/emails dev`로 시각 검증

## 12. Open questions (spec 확정 후 plan에서 다뤄도 됨)

- Preview text 국제화 — 현재 ko 고정. 다음 템플릿(예: Better Auth 영문 verification) 추가 시 `lang` prop + 간단한 if/else로 처리 예정
- `hello@` vs `noreply@` — `hello@`는 답장 받을 수 있음이 장점, `noreply@`는 고객 오해 방지. 운영 정책 미정 — 일단 `hello@`로 출발하고 받은 답장 모니터링

## 13. Success criteria

- `pnpm --filter @opencairn/emails dev` 실행 시 브라우저에서 invite 템플릿 렌더됨
- `pnpm --filter @opencairn/api build` 통과, `invites.test.ts` 통과
- 실 Resend 계정으로 dev 환경에서 초대 메일 1건 발송해 수신 확인 (본문 한국어, 버튼 CTA 동작, 링크 유효)
- 향후 템플릿 추가 시 "invite.tsx 구조 참고" 한 줄로 Gemini 프롬프트 작성 가능
