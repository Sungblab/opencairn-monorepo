# Session 1 — Iteration 3 Findings

> **범위**: Area 5 (에디터 블록 요소 심층) + Area 6 (DocEditor 커맨드 루프) + Area 7/8 (공유 토큰·렌더 보안)
> **감사일**: 2026-04-28
> **읽은 파일**: apps/web/src/components/editor/elements/{math-block · math-inline · wiki-link-element} · apps/web/src/components/editor/blocks/{callout/callout-element · toggle/toggle-element · columns/columns-plugin} · apps/web/src/components/editor/plugins/mermaid-fence · apps/web/src/hooks/{useMermaidRender · use-doc-editor-command} · apps/api/src/lib/share-token

---

## ✅ 검증 통과

| 항목 | 결과 |
|---|---|
| `math-block.tsx` KaTeX `renderToString` + `dangerouslySetInnerHTML` | ✅ KaTeX는 스크립트 없는 HTML 생성, XSS 안전. `throwOnError: true`로 에러 경계 명확 |
| `math-inline.tsx` 동일 패턴 | ✅ |
| `wiki-link-element.tsx` — `next/link` href 구성 | ✅ 경로 구조 `/app/w/${wsSlug}/p/${projectId}/notes/${targetId}`. `{children}` 렌더로 Slate 선택 동작 보존 |
| `wiki-link-element.tsx` — `deleted` 소프트딜리트 처리 | ✅ `deleted` 플래그 → strikethrough tombstone 표시 |
| `share-token.ts` — 엔트로피 | ✅ `randomBytes(32).toString("base64url")` → 256-bit, URL-safe |
| `useMermaidRender.ts` — XSS 방어 | ✅ `m.initialize({ securityLevel: "strict" })`. SVG 내 스크립트 실행 차단됨 |
| `useMermaidRender.ts` — 언마운트 취소 | ✅ `cancelled = true` 플래그 + render 후 check |
| `mermaid-fence.tsx` — undo 트랩 방어 | ✅ `remove_node` of `mermaid` 타입 체크로 무한 undo 루프 차단 |
| `mermaid-fence.tsx` — `replaceNodes` API | ✅ Plate v49 올바른 변환 API |
| `callout-element.tsx` — icon cycling | ✅ `onMouseDown + e.preventDefault()` → focus 이탈 없이 kind 변경 |
| `callout-element.tsx` — `editor.api.findPath` + `editor.tf.setNodes` | ✅ Plate v49 호환 |
| `toggle-element.tsx` — 접힌 상태 렌더 | ✅ CSS `display: none` (Slate 트리 유지), `aria-expanded` 속성 ✅ |
| `columns-plugin.tsx` — `@platejs/layout/react` import | ✅ Plate v49 layout 플러그인 직접 사용, bundle kit 미사용 |
| `use-doc-editor-command.ts` — 취소 패턴 | ✅ `AbortController` per-run, 이전 요청 취소. 상태 머신: idle→running→ready|error |
| `use-doc-editor-command.ts` — SSE 이벤트 소비 | ✅ `doc_editor_result` + `cost` 이벤트 정상 소비 |

---

## Low

### S1-016 — MermaidFencePlugin: onChange 내 O(N) 전체 최상위 노드 순회

**파일**: `apps/web/src/components/editor/plugins/mermaid-fence.tsx`

**현상**: `onChange` 핸들러가 호출될 때마다 `editor.children`의 모든 최상위 블록을 순회하면서 `mermaid-fence` 타입 노드를 탐색한다. 문서 내 비-Mermaid 블록이 편집될 때도 전체 스캔이 실행된다.

**영향**: 문서 블록 수가 수천 개를 넘거나, 편집 빈도가 매우 높을 경우(실시간 협업 중) 불필요한 CPU 소비. 일반적인 문서 크기(수십~수백 블록)에서는 즉각적 위험 없음.

**수정 방향**: `onChange`에 `{ at: [], match: { type: "mermaid-fence" } }` 조건 필터를 적용하거나, Mermaid 노드가 하나 이상 있을 때만(`editor.nodes` → count > 0) 스캔 로직 진입. 단기적으로 문서 크기에 제한이 있다면 허용 가능.

---

## 관찰 사항 (비-발견)

| 항목 | 관찰 |
|---|---|
| Hocuspocus 유닛 테스트 | `apps/hocuspocus/src/**/*.test.ts` 0개. `onAuthenticate` / `storeImpl` / `block-orphan-reaper` 모두 테스트 미작성. S1-002·S1-003·S1-006 등 High 이슈가 테스트 없이 방치. 추후 테스트 커버리지 추가 권고. |
| `mermaid-fence` 싱글턴 import | `useMermaidRender`의 `import("mermaid")` lazy 싱글턴 패턴. 코드 스플리팅 및 초기 번들 크기 최적화 ✅ |
| `wiki-link-element` non-void inline | `{children}` 렌더 — Plate inline 요소는 반드시 non-void여야 Slate selection 동작. ✅ 올바른 구현 |

---

## 종료 판정

**Iteration 2**: Critical 0 / High 0  
**Iteration 3**: Critical 0 / High 0  

→ **연속 2 iteration Critical/High 0건 달성 — 감사 종료** (최대 8 iteration 중 3에서 종료)
