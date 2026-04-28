# Session 2 — Iteration 4 Findings (최종)

**Date**: 2026-04-28  
**Areas covered**: 영역 7 (BYOK UI) + 영역 8 (Onboarding) + i18n parity 확인 + Notifications API idempotency  
**Files audited**:
- `apps/web/src/app/[locale]/app/settings/ai/page.tsx`
- `apps/web/src/components/settings/ByokKeyCard.tsx`
- `apps/web/src/app/[locale]/onboarding/page.tsx`
- `apps/web/src/app/[locale]/onboarding/OnboardingShell.tsx`
- `apps/web/src/components/notifications/use-notifications.ts`
- `apps/api/src/routes/notifications.ts`
- `apps/web/messages/{ko,en}/` (파일 목록 확인)

---

## HIGH

없음. (Iteration 4 High 0건)

---

## MEDIUM

없음.

---

## LOW

### S2-032 — OnboardingShell 배너에 `kr` 클래스 하드코딩
**파일**: `apps/web/src/app/[locale]/onboarding/OnboardingShell.tsx:75`  
**심각도**: Low  
**축**: i18n

```tsx
<p role="status" aria-live="polite" className="auth-alert auth-alert-info kr">
```

`kr` 클래스가 로케일 무관하게 항상 붙는다. 한국어 특화 폰트/자간 CSS가 있다면 `locale === 'ko'` 조건으로 적용해야 함. 현재는 영어 유저도 `kr` 클래스를 받는다.

---

## 긍정적 발견 (Good)

### BYOK UI — 보안 & UX 올바름
- `ByokKeyCard.tsx:109` — `type="password"` 입력. 키가 화면에 노출되지 않음. ✅
- `data.lastFour` 만 서버에서 반환 (전체 키 미노출). ✅  
- Provider 셀렉트 UI 없음 (env-only 룰 준수). ✅
- 삭제 확인 Radix `Dialog` 사용 (S2-021 window.confirm과 대조). ✅
- 모든 UI 문자열 i18n 키 (`t("saved")`, `t("error.save_failed")` 등). ✅
- `autoComplete="off"`, `spellCheck={false}` 로 브라우저 저장 방지. ✅

### Onboarding — guard 체인 + BYOK cost philosophy 준수
- 세션 → email verified → workspace existence 순서대로 guard. ✅
- BYOK/관리형 구분으로 기능 차단하지 않음. ✅
- invite 토큰 처리: not_found / expired / already_accepted 각 케이스 번역 키로 처리. ✅
- `inviteResult.status === 'ok'` 일 때만 AcceptInviteCard 표시. ✅

### Notifications API — COALESCE idempotency 올바름
`notifications.ts:130-138`:
```ts
readAt: sql`COALESCE(${notifications.readAt}, NOW())`
```
feedback memory `feedback_idempotent_patch_pattern.md`에서 요구한 COALESCE 패턴 올바르게 적용. 이미 읽은 알림 재마킹 시 원래 `read_at` 유지 + 200 반환. ✅

### i18n 파일 쌍 parity (파일 레벨)
`apps/web/messages/{ko,en}/` 하위 전 파일이 ko/en 양쪽 모두 존재 확인:
app, common, collab, import, onboarding, auth, research, app-shell, note, account, dashboard, palette, settings, canvas, graph, learn, notifications, public-share, share-dialog, workspace-settings, agent-panel, editor, chat-scope, ingest, literature, chat, doc-editor, landing, agents, project, sidebar (29 네임스페이스 × 2). ✅

키-레벨 parity는 `pnpm --filter @opencairn/web i18n:parity` 스크립트가 CI에서 검증. 이번 audit에서 소스 수동 검토 스코프 밖이나, 파일 존재 자체는 확인.

---

## 종료 조건

- **Iteration 3: High 0건**
- **Iteration 4: High 0건**
- **연속 2 iteration High/Critical 0건 → 종료 조건 충족**

Session 2 ralph audit 완료.
