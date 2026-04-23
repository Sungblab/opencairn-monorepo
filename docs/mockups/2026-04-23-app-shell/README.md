# OpenCairn App Shell Mockup (2026-04-23)

Target state mockup for the full OpenCairn app — 3-column shell (sidebar / tab area / chat panel) plus all feature screens (existing + Deep Research + settings).

## View

Open `index.html` directly in a browser:

```
file:///C:/Users/Sungbin/Documents/GitHub/opencairn-monorepo/docs/mockups/2026-04-23-app-shell/index.html
```

Navigate via the sidebar or hash URLs (`#/dashboard`, `#/project`, `#/research`, ...).

## Scope

Built for the S4 design option — full product mockup covering:

- Public: landing, auth, onboarding
- Shell + existing features: dashboard, workspace, project, note editor, comments, import
- New: command palette, notifications, Deep Research (hub / planning / streaming / completed), research-meta block in notes
- Settings: profile, AI (BYOK), billing, workspace admin, members

## Design constraints

- neutral mono palette only (cairn-light default; dark/sepia/high-contrast via theme switcher)
- Pretendard for headlines and body; font-serif only for wordmark
- 존댓말 copy, no competitor mentions, minimal tech stack exposure
- Design tokens mirror `apps/web/src/app/globals.css` (--theme-bg/surface/fg/…)

## Not in this mockup

- Real data / auth — this is static HTML
- Backend wiring — linked specs/plans derive from approved mockup
- Full responsive layouts below 768px (phone) — desktop-first first pass
