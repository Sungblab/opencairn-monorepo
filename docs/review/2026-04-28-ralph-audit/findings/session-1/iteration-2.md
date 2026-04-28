# Session 1 — Iteration 2 Findings

> **범위**: Area 3 (Hocuspocus 서버 심층) + Area 4 (코멘트 시스템 + @mention + 알림)
> **감사일**: 2026-04-28
> **읽은 파일**: hocuspocus/src/{block-orphan-reaper · wiki-link-sync} · apps/api/src/routes/{comments · mentions · share} · apps/api/src/lib/mention-parser · apps/web/src/components/comments/{CommentThread · CommentComposer}

---

## ✅ 검증 통과 (Area 3 + Area 4 클리어)

| 항목 | 결과 |
|---|---|
| `block-orphan-reaper`: onChange만 사용, 에러 catch | ✅ edit pipeline 절대 abort 안 함 |
| `wiki-link-sync`: cross-workspace 타겟 삭제 | ✅ `eq(notes.workspaceId, workspaceId)` 필터 |
| `wiki-link-sync`: 자기 참조 + soft-deleted 타겟 드랍 | ✅ |
| `wiki-link-sync`: DELETE→INSERT 원자성 | ✅ persistence.storeImpl transaction 내부 실행 |
| `GET /notes/:noteId/comments` — `canRead` 게이트 | ✅ |
| `POST /notes/:noteId/comments` — 블록 앵커: `canWrite`, 페이지: `canComment` 게이트 | ✅ |
| `PATCH /comments/:id` — 본인만 수정 | ✅ |
| `DELETE /comments/:id` — 본인 OR `canWrite` | ✅ |
| `POST /comments/:id/resolve` — 본인 OR `canWrite` | ✅ |
| `GET /public/share/:token` — `revokedAt IS NULL` 검증 | ✅ |
| `GET /public/share/:token` — per-IP rate limit (30/min) | ✅ |
| 페이지 퍼미션 grant: workspace member 확인 | ✅ |
| 페이지 퍼미션 revoke: `canWrite` 게이트 | ✅ |
| mentions.ts — 이메일 누출 제거 (Tier 0 C-1 fix) | ✅ `user.email` SELECT 없음, label은 name only |
| `mention-parser.ts` — `TOKEN_RE` 중복 dedup | ✅ `seen` Set 사용 |

---

## Medium

### S1-011 — @mention token: 크로스-워크스페이스 알림 injection

**파일**: `apps/api/src/lib/mention-parser.ts:1-18` + `apps/api/src/routes/comments.ts:104,143-163`

**현상**: `parseMentions(body)` 는 `@[type:id]` 형식의 토큰을 정규식으로만 추출하며 `id`가 현재 워크스페이스 소속인지 검증하지 않는다. POST /notes/:noteId/comments 핸들러는 추출된 `mentionedId`에 대해 직접 `persistAndPublish({ userId: mentionedId, ... })` 를 호출한다.

**공격 시나리오**:
1. 공격자(워크스페이스 A 멤버)가 워크스페이스 B 유저의 UUID를 사전 지식/IDOR 등으로 확보
2. 댓글 본문에 `@[user:<workspace-B-user-uuid>]` 를 수동 입력하여 POST
3. 서버가 `persistAndPublish({ userId: <ws-B-user>, kind: "mention", payload: { summary: body.body, noteId } })` 실행
4. 워크스페이스 B 유저가 워크스페이스 A 노트의 댓글 내용을 notification에서 읽음

**영향**: 코멘트 본문(`summary: body.body`) + `noteId`가 접근 권한 없는 외부 워크스페이스 유저에게 노출됨.

**수정 방향**: POST 핸들러에서 `type === "user"` 멘션의 `id`를 `workspaceMembers` 테이블로 검증:
```ts
const validUserIds = new Set(
  (await db.select({ uid: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, note.workspaceId),
        inArray(workspaceMembers.userId, userMentionIds),
      ))
  ).map((r) => r.uid)
);
const safeUserMentions = userMentionIds.filter((id) => validUserIds.has(id));
```

---

### S1-012 — 코멘트 author 이름 미표시 (Plan 2B 미완성 피처)

**파일**: `apps/web/src/components/comments/CommentThread.tsx:100` + `apps/api/src/routes/comments.ts:295-310`

**현상**: `CommentItem`이 `{c.authorId.slice(0, 8)}` (UUID 앞 8자)를 author로 표시한다. `GET /notes/:noteId/comments`의 `serialize(r)` 함수도 `authorId` 컬럼만 내려보내고 `name`/`email`을 JOIN하지 않는다.

```ts
// CommentThread.tsx:100
<span>{c.authorId.slice(0, 8)}</span>  // "4b3c8d9a"
```

**문맥**: 코드 주석에 "user profile lookup (name + avatar) lands with the mention combobox in Task 19" 라고 적혀 있다. Plan 2B는 Task 19까지 완료로 표기됐지만 profile lookup은 `@mention 검색` 쪽만 처리하고 *코멘트 표시* 는 미완성인 채로 남아 있다.

**영향**: 모든 코멘트 패널에서 유저 이름 대신 UUID prefix 표시 → production UX 훼손.

**수정 방향**:
1. `GET /notes/:noteId/comments` → `comments.authorId`로 user JOIN, `name` + `avatarUrl` 포함
2. `CommentResponse` 타입에 `authorName: string` 필드 추가
3. `CommentItem` 렌더에서 `c.authorName` 표시

---

## Low

### S1-013 — share.ts 알림 본문에 한국어 하드코딩 (i18n 위반)

**파일**: `apps/api/src/routes/share.ts:440, 515`

```ts
summary: `${actor?.name ?? "누군가"}님이 "${note.title}"를 공유했습니다`,
```

서버 사이드 알림 본문에 한국어 문자열이 직접 박혀 있다. `messages/{ko,en}/*.json` i18n 파이프라인 외부. EN 환경에서 한국어 알림이 노출됨.

**수정 방향**: 알림 payload에 번역 키(`kind` + 인자 dict)를 저장하고 클라이언트 렌더 시 `t("notification.share_invite", { from: ..., title: ... })`로 변환, 또는 서버에서 accept-language 기반으로 분기.

---

### S1-014 — CommentThread orphan 라벨 판별 heuristic 오류

**파일**: `apps/web/src/components/comments/CommentThread.tsx:43-44`

```ts
const isOrphanBlock =
  root.anchorBlockId === null && root.replies.length > 0;
```

`anchorBlockId`가 처음부터 null인 **페이지-레벨 코멘트**(block 앵커 없이 생성된 스레드)에 답글이 달리면 `isOrphanBlock = true` 로 잘못 판정돼 "이 블록은 삭제되었습니다" 류의 라벨이 오표시된다.

**수정 방향**: schema에 `wasBlockAnchored: boolean` sentinel 컬럼 추가 또는 생성 시 `anchorBlockId` 값이 있었는지 기록하는 보조 컬럼. 단기: `isOrphanBlock` 라벨을 `replies.length > 0 && root.anchorBlockId === null && /* was_anchored sentinel */` 조건으로 좁히거나 orphan 라벨 제거.

---

### S1-015 — 블록-앵커 코멘트는 `canWrite`(에디터) 전용

**파일**: `apps/api/src/routes/comments.ts:91-95`

```ts
const allowed = body.anchorBlockId != null
  ? await canWrite(userId, resource)
  : await canComment(userId, resource);
```

`commenter` 역할 유저는 페이지-레벨 코멘트만 달 수 있고, 블록을 선택해서 앵커 코멘트를 다는 것은 불가능하다. 이는 Notion(commenter가 블록 코멘트 가능)과 다른 동작. Plan 2B 설계 의도이나, UI가 commenter에게 블록 선택 제스처를 숨기지 않으면 서버에서 403이 반환돼 사용자가 이유를 알 수 없다.

---

## Area 3 추가 관찰 (비-발견)

| 항목 | 관찰 |
|---|---|
| `block-orphan-reaper` 성능 | onChange마다 전체 comment 쿼리 + 전체 Y.Doc walk. 문서 변경 빈도 높고 comment 수 많으면 부하. 그러나 에러 격리 + async라 immediate 위험 없음. 추후 debounce 고려. |
| `wiki-link-sync` 레이스 | DELETE→INSERT 사이 다른 tx가 끼면 `onConflictDoNothing`으로 처리. 데이터 일관성 유지 ✅ |
| reaper priority < persistence | `priority: 200 > default(100)` → reaper가 persistence보다 먼저 `onChange` 실행 ← 의도대로. 코드 주석과 구현 일치 ✅ |
