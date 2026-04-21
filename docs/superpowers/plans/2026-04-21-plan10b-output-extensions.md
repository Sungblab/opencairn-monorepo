# Plan 10B: Output Extensions — Infographic, Data Table, Knowledge Health Report

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 10 Document Studio에 Infographic(PDF), Data Table(XLSX), Knowledge Health Report(PDF) 3개 출력 포맷을 추가한다.

**Architecture:** Infographic/Data Table은 기존 `packages/templates/` skill 패턴을 따른다 — Zod schema + JSON prompt template → 컴파일러 → R2. Knowledge Health Report는 DB에서 Curator/Temporal/SM-2 결과를 집계한 뒤 Gemini 내러티브를 생성해 PDF로 출력하는 전용 엔드포인트(`POST /api/documents/health-report`)로 구현한다.

**Tech Stack:** TypeScript 5.x, Hono 4, Drizzle ORM 0.45, `xlsx` npm (SheetJS), Playwright (기존 pdf.ts 재사용), Gemini API (`packages/llm`), Next.js 16, Zod 3.24+

**Prerequisites (반드시 먼저 완료):**
- **Plan 10** (Document Skills) 전체 구현 완료. 본 plan은 Plan 10이 생성하는 아래 파일들이 존재한다고 가정한다:
  - `packages/templates/src/engine.ts` — `loadTemplate`, `renderPrompt`, `validateOutput`
  - `packages/templates/src/schemas/index.ts` — `schemaRegistry` 객체
  - `apps/api/src/lib/document-compilers/pdf.ts` — `compilePdf(html: string): Promise<Buffer>`
  - `apps/api/src/lib/document-compilers/docx.ts` — Plan 10 DOCX 컴파일러
  - `apps/api/src/lib/r2.ts` — `uploadToR2(key, buf, mime): Promise<void>`, `getSignedUrl(key): Promise<string>`
  - `apps/api/src/routes/documents.ts` — `POST /api/documents/compile` 라우트 (skillName switch 포함)
  - `packages/db/src/schema/documents.ts` — `documents` 테이블
  - `packages/db/src/schema/document_section_sources.ts` — `documentSectionSources` 테이블
  - `apps/web/src/app/(app)/studio/components/SkillPicker.tsx`

---

## File Structure

```
packages/templates/
  src/schemas/
    infographic.ts          신규 — Zod 스키마
    data_table.ts           신규 — Zod 스키마
    index.ts                수정 — 2개 registry 등록

  templates/
    infographic.json        신규 — skill 정의
    data_table.json         신규 — skill 정의

apps/api/src/
  lib/document-compilers/
    xlsx.ts                 신규 — DataTableOutput → XLSX Buffer
    infographic-html.ts     신규 — InfographicOutput → HTML string

  routes/
    documents.ts            수정 — infographic / data_table 분기 추가
    health-report.ts        신규 — POST /api/documents/health-report

  app.ts                    수정 — healthReportRouter 마운트

apps/web/src/app/(app)/studio/
  components/
    SkillPicker.tsx         수정 — 시각화 섹션 + 지식베이스 분석 섹션 추가
```

---

### Task 1: Infographic Zod 스키마 + skill 정의

**Files:**
- Create: `packages/templates/src/schemas/infographic.ts`
- Create: `packages/templates/templates/infographic.json`
- Modify: `packages/templates/src/schemas/index.ts`

- [ ] **Step 1: `packages/templates/src/schemas/infographic.ts` 생성**

```typescript
import { z } from "zod";

export const infographicSchema = z.object({
  title: z.string().max(100),
  subtitle: z.string().max(200),
  theme: z.enum(["blue", "green", "ember", "stone"]),
  stats: z
    .array(
      z.object({
        label: z.string(),
        value: z.string(),
        unit: z.string().optional(),
      })
    )
    .max(4),
  sections: z.array(
    z.object({
      heading: z.string(),
      type: z.enum(["stat_row", "key_points", "comparison"]),
      items: z.array(z.string()),
    })
  ),
  footer_note: z.string().optional(),
});

export type InfographicOutput = z.infer<typeof infographicSchema>;
```

- [ ] **Step 2: `packages/templates/templates/infographic.json` 생성**

```json
{
  "id": "infographic",
  "name": "Infographic",
  "description": "KG 개념과 노트에서 시각적 인포그래픽 PDF를 생성합니다.",
  "renderer": "canvas",
  "output_schema_id": "infographic",
  "variables": ["topic", "context"],
  "prompt_template": "Create a visual infographic for the following topic.\n\nTopic: {{topic}}\n\nSource material:\n{{context}}\n\nChoose one theme: blue, green, ember, or stone. Include up to 4 key stats. Add 2-4 sections using these types: stat_row (list of short items), key_points (bullet list), comparison (side-by-side items). Keep all text concise.\n\nReturn JSON: { \"title\": string, \"subtitle\": string, \"theme\": \"blue\"|\"green\"|\"ember\"|\"stone\", \"stats\": [{\"label\": string, \"value\": string, \"unit\"?: string}], \"sections\": [{\"heading\": string, \"type\": \"stat_row\"|\"key_points\"|\"comparison\", \"items\": string[]}], \"footer_note\"?: string }"
}
```

- [ ] **Step 3: `packages/templates/src/schemas/index.ts`에 infographic 등록**

`schemaRegistry` 객체에 다음 줄을 추가한다:

```typescript
import { infographicSchema } from "./infographic";

// schemaRegistry 객체 안:
infographic: infographicSchema,
```

- [ ] **Step 4: 빌드로 타입 검증**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
pnpm -F @opencairn/templates build
```

Expected: 타입 에러 없이 `dist/` 업데이트.

- [ ] **Step 5: Commit**

```bash
git add packages/templates/src/schemas/infographic.ts \
        packages/templates/templates/infographic.json \
        packages/templates/src/schemas/index.ts
git commit -m "feat(templates): add infographic skill schema and JSON definition"
```

---

### Task 2: Data Table Zod 스키마 + skill 정의

**Files:**
- Create: `packages/templates/src/schemas/data_table.ts`
- Create: `packages/templates/templates/data_table.json`
- Modify: `packages/templates/src/schemas/index.ts`

- [ ] **Step 1: `packages/templates/src/schemas/data_table.ts` 생성**

```typescript
import { z } from "zod";

export const dataTableSchema = z.object({
  title: z.string().max(200),
  description: z.string().max(500),
  headers: z.array(z.string()).min(1).max(20),
  rows: z.array(z.array(z.union([z.string(), z.number()]))).max(50),
  source_concepts: z.array(z.string()).default([]),
});

export type DataTableOutput = z.infer<typeof dataTableSchema>;
```

- [ ] **Step 2: `packages/templates/templates/data_table.json` 생성**

```json
{
  "id": "data_table",
  "name": "Data Table",
  "description": "노트와 KG에서 구조화된 비교표 또는 데이터 테이블을 추출해 XLSX로 내보냅니다.",
  "renderer": "structured",
  "output_schema_id": "data_table",
  "variables": ["query", "context"],
  "prompt_template": "Extract a structured data table from the following knowledge base content.\n\nQuery: {{query}}\n\nSource material:\n{{context}}\n\nCreate a table with clear headers and rows. Maximum 50 rows. List the concept IDs used as sources in source_concepts.\n\nReturn JSON: { \"title\": string, \"description\": string, \"headers\": string[], \"rows\": (string|number)[][], \"source_concepts\": string[] }"
}
```

- [ ] **Step 3: `packages/templates/src/schemas/index.ts`에 data_table 등록**

```typescript
import { dataTableSchema } from "./data_table";

// schemaRegistry 객체 안:
data_table: dataTableSchema,
```

- [ ] **Step 4: 빌드로 타입 검증**

```bash
pnpm -F @opencairn/templates build
```

Expected: 타입 에러 없음.

- [ ] **Step 5: Commit**

```bash
git add packages/templates/src/schemas/data_table.ts \
        packages/templates/templates/data_table.json \
        packages/templates/src/schemas/index.ts
git commit -m "feat(templates): add data_table skill schema and JSON definition"
```

---

### Task 3: XLSX 컴파일러

**Files:**
- Create: `apps/api/src/lib/document-compilers/xlsx.ts`

- [ ] **Step 1: `xlsx` 패키지 설치**

```bash
pnpm -F @opencairn/api add xlsx
pnpm -F @opencairn/api add -D @types/xlsx
```

Expected: `apps/api/package.json`에 `xlsx` 추가됨.

- [ ] **Step 2: `apps/api/src/lib/document-compilers/xlsx.ts` 생성**

```typescript
import * as XLSX from "xlsx";
import type { DataTableOutput } from "@opencairn/templates";

export function compileXlsx(data: DataTableOutput): Buffer {
  const aoa: (string | number)[][] = [data.headers, ...data.rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // 헤더 행 너비 자동 조정
  ws["!cols"] = data.headers.map((h) => ({ wch: Math.max(h.length + 2, 12) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
```

- [ ] **Step 3: 수동 스모크 테스트 (node 스크립트)**

`apps/api/src/lib/document-compilers/` 디렉토리에서 아래를 실행해 XLSX 파일이 생성되는지 확인한다:

```bash
node -e "
const { compileXlsx } = require('./dist/lib/document-compilers/xlsx');
const buf = compileXlsx({
  title: 'Test',
  description: 'Test',
  headers: ['Name', 'Score'],
  rows: [['Alice', 95], ['Bob', 82]],
  source_concepts: []
});
require('fs').writeFileSync('/tmp/test.xlsx', buf);
console.log('OK, size:', buf.length);
"
```

Expected: `OK, size: <숫자>` 출력 + `/tmp/test.xlsx` 생성.

- [ ] **Step 4: API 빌드 타입 검증**

```bash
pnpm -F @opencairn/api build
```

Expected: 타입 에러 없음.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/document-compilers/xlsx.ts apps/api/package.json
git commit -m "feat(api): add xlsx compiler for data_table skill"
```

---

### Task 4: Infographic HTML 렌더러

**Files:**
- Create: `apps/api/src/lib/document-compilers/infographic-html.ts`

- [ ] **Step 1: `apps/api/src/lib/document-compilers/infographic-html.ts` 생성**

```typescript
import type { InfographicOutput } from "@opencairn/templates";

const THEMES: Record<string, { bg: string; accent: string; text: string; cardBg: string }> = {
  blue:  { bg: "#eff6ff", accent: "#2563eb", text: "#1e3a5f", cardBg: "#dbeafe" },
  green: { bg: "#f0fdf4", accent: "#16a34a", text: "#14532d", cardBg: "#dcfce7" },
  ember: { bg: "#fff7ed", accent: "#ea580c", text: "#431407", cardBg: "#fed7aa" },
  stone: { bg: "#f5f5f4", accent: "#44403c", text: "#1c1917", cardBg: "#e7e5e4" },
};

export function renderInfographicHtml(data: InfographicOutput): string {
  const t = THEMES[data.theme] ?? THEMES.blue;

  const statsHtml =
    data.stats.length > 0
      ? `<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:32px">
          ${data.stats
            .map(
              (s) => `
            <div style="background:${t.cardBg};border-radius:10px;padding:20px 24px;flex:1;min-width:130px;text-align:center">
              <div style="font-size:32px;font-weight:800;color:${t.accent}">
                ${s.value}${s.unit ? `<span style="font-size:15px;font-weight:400"> ${s.unit}</span>` : ""}
              </div>
              <div style="font-size:13px;color:#6b7280;margin-top:6px">${s.label}</div>
            </div>`
            )
            .join("")}
        </div>`
      : "";

  const sectionsHtml = data.sections
    .map((sec) => {
      let content: string;
      if (sec.type === "key_points") {
        content = `<ul style="margin:0;padding-left:20px">
          ${sec.items.map((i) => `<li style="margin:6px 0;color:${t.text};font-size:14px">${i}</li>`).join("")}
        </ul>`;
      } else if (sec.type === "stat_row") {
        content = `<div style="display:flex;gap:10px;flex-wrap:wrap">
          ${sec.items
            .map(
              (i) => `<span style="background:white;border-radius:6px;padding:6px 14px;font-size:13px;color:${t.text}">${i}</span>`
            )
            .join("")}
        </div>`;
      } else {
        // comparison
        content = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          ${sec.items
            .map(
              (i) => `<div style="background:white;border-radius:8px;padding:10px 14px;font-size:13px;color:${t.text}">${i}</div>`
            )
            .join("")}
        </div>`;
      }
      return `
        <div style="margin-bottom:28px">
          <h3 style="font-size:15px;font-weight:700;color:${t.accent};margin:0 0 12px;text-transform:uppercase;letter-spacing:.05em">${sec.heading}</h3>
          ${content}
        </div>`;
    })
    .join("");

  const footer = data.footer_note
    ? `<p style="margin-top:32px;font-size:11px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:16px">${data.footer_note}</p>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>* { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }</style>
</head>
<body style="margin:0;padding:40px;background:${t.bg};min-height:100vh">
  <div style="max-width:820px;margin:0 auto">
    <h1 style="font-size:34px;font-weight:900;color:${t.text};margin:0 0 8px;line-height:1.2">${data.title}</h1>
    <p style="font-size:16px;color:#6b7280;margin:0 0 36px;line-height:1.6">${data.subtitle}</p>
    ${statsHtml}
    ${sectionsHtml}
    ${footer}
  </div>
</body>
</html>`;
}
```

- [ ] **Step 2: API 빌드로 타입 검증**

```bash
pnpm -F @opencairn/api build
```

Expected: 타입 에러 없음.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/document-compilers/infographic-html.ts
git commit -m "feat(api): add infographic HTML renderer (theme-aware template)"
```

---

### Task 5: `documents.ts` 라우트 분기 확장

**Files:**
- Modify: `apps/api/src/routes/documents.ts`

> Plan 10 Task 4.6에서 생성된 `POST /api/documents/compile` 라우트의 skillName switch에 두 개의 새 케이스를 추가한다.

- [ ] **Step 1: `apps/api/src/routes/documents.ts` 열기**

파일 상단 import 섹션에 추가:

```typescript
import { infographicSchema } from "@opencairn/templates";
import { dataTableSchema } from "@opencairn/templates";
import { renderInfographicHtml } from "../lib/document-compilers/infographic-html";
import { compileXlsx } from "../lib/document-compilers/xlsx";
import { documentSectionSources } from "@opencairn/db";
```

- [ ] **Step 2: compiler 선택 switch 블록에 케이스 추가**

기존 switch/if 블록 (Plan 10이 생성한 것)에서 마지막 케이스 바로 위에 삽입:

```typescript
case "infographic": {
  const validated = infographicSchema.parse(llmOutput);
  const html = renderInfographicHtml(validated);
  compiledBuffer = await compilePdf(html);
  mimeType = "application/pdf";
  fileExtension = "pdf";
  break;
}

case "data_table": {
  const validated = dataTableSchema.parse(llmOutput);
  compiledBuffer = compileXlsx(validated);
  mimeType =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  fileExtension = "xlsx";
  // KG 앵커 저장
  if (validated.source_concepts.length > 0 && documentId) {
    await db.insert(documentSectionSources).values(
      validated.source_concepts.map((conceptId) => ({
        documentId,
        sourceNodeId: conceptId,
      }))
    );
  }
  break;
}
```

> `compiledBuffer`, `mimeType`, `fileExtension`, `documentId` 는 Plan 10의 documents.ts에서 이미 선언된 변수다. 해당 변수명이 다를 경우 Plan 10 파일의 실제 변수명으로 맞춘다.

- [ ] **Step 3: API 빌드**

```bash
pnpm -F @opencairn/api build
```

Expected: 타입 에러 없음.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/documents.ts
git commit -m "feat(api): add infographic and data_table branches to /documents/compile route"
```

---

### Task 6: `health-report.ts` 전용 엔드포인트

**Files:**
- Create: `apps/api/src/routes/health-report.ts`

- [ ] **Step 1: `apps/api/src/routes/health-report.ts` 생성**

```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, avg, count, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../lib/db";
import {
  documents,
  notes,
  staleAlerts,
  suggestions,
  understandingScores,
} from "@opencairn/db";
import { authMiddleware } from "../middleware/auth";
import { getProvider } from "@opencairn/llm";
import { compilePdf } from "../lib/document-compilers/pdf";
import { uploadToR2, getSignedUrl } from "../lib/r2";

export const healthReportRouter = new Hono().use("*", authMiddleware);

const requestSchema = z.object({
  projectId: z.string().uuid(),
});

healthReportRouter.post(
  "/",
  zValidator("json", requestSchema),
  async (c) => {
    const session = c.get("session");
    const { projectId } = c.req.valid("json");

    // ── 1. DB 집계 ──────────────────────────────────────────────────────────
    const projectNoteIds = db
      .select({ id: notes.id })
      .from(notes)
      .where(eq(notes.projectId, projectId));

    const [
      orphanRows,
      contradictionRows,
      duplicateRows,
      staleRows,
      scoreRows,
    ] = await Promise.all([
      db
        .select({ n: count() })
        .from(suggestions)
        .where(
          and(
            eq(suggestions.projectId, projectId),
            eq(suggestions.type, "curator_orphan"),
            eq(suggestions.status, "pending")
          )
        ),
      db
        .select({ n: count() })
        .from(suggestions)
        .where(
          and(
            eq(suggestions.projectId, projectId),
            eq(suggestions.type, "curator_contradiction"),
            eq(suggestions.status, "pending")
          )
        ),
      db
        .select({ n: count() })
        .from(suggestions)
        .where(
          and(
            eq(suggestions.projectId, projectId),
            eq(suggestions.type, "curator_duplicate"),
            eq(suggestions.status, "pending")
          )
        ),
      db
        .select({ n: count() })
        .from(staleAlerts)
        .where(
          and(
            inArray(staleAlerts.noteId, projectNoteIds),
            isNull(staleAlerts.reviewedAt)
          )
        ),
      db
        .select({ avg: avg(understandingScores.score) })
        .from(understandingScores)
        .where(eq(understandingScores.userId, session.userId)),
    ]);

    const orphanCount = Number(orphanRows[0]?.n ?? 0);
    const contradictionCount = Number(contradictionRows[0]?.n ?? 0);
    const duplicateCount = Number(duplicateRows[0]?.n ?? 0);
    const staleCount = Number(staleRows[0]?.n ?? 0);
    const avgScore = Number(scoreRows[0]?.avg ?? 0);

    // 데이터가 전혀 없으면 생성 거부
    if (orphanCount + contradictionCount + staleCount + avgScore === 0) {
      return c.json(
        {
          error:
            "데이터 없음 — Plan 6/8 에이전트 완료 후 활성화됩니다. (suggestions, stale_alerts, understanding_scores 테이블이 비어있습니다)",
        },
        422
      );
    }

    // ── 2. health_score 계산 ────────────────────────────────────────────────
    const rawScore =
      100 -
      orphanCount * 2 -
      contradictionCount * 5 -
      staleCount * 1 +
      avgScore * 0.3;
    const healthScore = Math.round(Math.min(100, Math.max(0, rawScore)));

    // ── 3. Gemini 내러티브 생성 ─────────────────────────────────────────────
    const provider = await getProvider();
    const metricsJson = JSON.stringify({
      orphan_count: orphanCount,
      contradiction_count: contradictionCount,
      duplicate_count: duplicateCount,
      stale_count: staleCount,
      avg_understanding_score: Math.round(avgScore),
      health_score: healthScore,
    });

    const prompt = `당신은 개인 지식베이스 전문 분석가입니다. 아래 지표를 바탕으로 한국어 지식 건강 보고서를 작성하세요.

지표:
${metricsJson}

아래 JSON 형식으로 반환하세요:
{
  "summary": "2-3문장 요약",
  "health_score": ${healthScore},
  "sections": [
    { "title": "개념 커버리지", "findings": ["발견사항1"], "action_items": ["액션1"] },
    { "title": "지식 품질", "findings": [], "action_items": [] },
    { "title": "학습 현황", "findings": [], "action_items": [] },
    { "title": "우선 액션", "findings": [], "action_items": [] }
  ]
}

데이터가 없는 섹션은 findings와 action_items를 빈 배열로 두세요. 모든 텍스트는 한국어로 작성하세요.`;

    const raw = await provider.generate(prompt, {
      response_mime_type: "application/json",
    });
    const reportData = JSON.parse(raw) as {
      summary: string;
      health_score: number;
      sections: Array<{
        title: string;
        findings: string[];
        action_items: string[];
      }>;
    };

    // ── 4. HTML 렌더 ────────────────────────────────────────────────────────
    const html = renderHealthReportHtml(reportData, healthScore);

    // ── 5. PDF 컴파일 ───────────────────────────────────────────────────────
    const buffer = await compilePdf(html);

    // ── 6. R2 업로드 ────────────────────────────────────────────────────────
    const r2Key = `documents/${session.userId}/${projectId}/health-report-${Date.now()}.pdf`;
    await uploadToR2(r2Key, buffer, "application/pdf");
    const signedUrl = await getSignedUrl(r2Key);

    // ── 7. documents 테이블 insert ──────────────────────────────────────────
    const [doc] = await db
      .insert(documents)
      .values({
        userId: session.userId,
        projectId,
        skillName: "health_report",
        r2Key,
        mimeType: "application/pdf",
        title: `Knowledge Health Report — ${healthScore}/100점`,
      })
      .returning();

    return c.json({ signedUrl, documentId: doc.id, healthScore });
  }
);

// ── HTML 렌더 헬퍼 (이 파일 내부 전용) ───────────────────────────────────────

function renderHealthReportHtml(
  data: {
    summary: string;
    health_score: number;
    sections: Array<{ title: string; findings: string[]; action_items: string[] }>;
  },
  healthScore: number
): string {
  const scoreColor =
    healthScore >= 80 ? "#16a34a" : healthScore >= 50 ? "#d97706" : "#dc2626";

  const activeSections = data.sections.filter(
    (s) => s.findings.length > 0 || s.action_items.length > 0
  );

  const sectionsHtml = activeSections
    .map(
      (s) => `
    <div style="margin-bottom:28px;border-left:4px solid #6366f1;padding-left:18px">
      <h3 style="font-size:15px;font-weight:700;margin:0 0 10px;color:#1e293b">${s.title}</h3>
      ${
        s.findings.length > 0
          ? `<ul style="margin:0 0 10px;padding-left:20px">
              ${s.findings.map((f) => `<li style="margin:5px 0;color:#475569;font-size:14px">${f}</li>`).join("")}
            </ul>`
          : ""
      }
      ${
        s.action_items.length > 0
          ? `<div style="background:#f0f9ff;border-radius:8px;padding:12px 16px;margin-top:8px">
              <strong style="font-size:12px;color:#0369a1;letter-spacing:.05em">액션 아이템</strong>
              <ul style="margin:6px 0 0;padding-left:18px">
                ${s.action_items
                  .map(
                    (a) =>
                      `<li style="margin:4px 0;color:#0c4a6e;font-size:13px">${a}</li>`
                  )
                  .join("")}
              </ul>
            </div>`
          : ""
      }
    </div>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>* { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }</style>
</head>
<body style="margin:0;padding:40px;background:#f8fafc">
  <div style="max-width:760px;margin:0 auto;background:white;border-radius:12px;padding:40px;box-shadow:0 1px 4px rgba(0,0,0,.08)">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px">
      <div>
        <h1 style="font-size:24px;font-weight:800;color:#0f172a;margin:0 0 4px">Knowledge Health Report</h1>
        <p style="color:#64748b;margin:0;font-size:13px">
          ${new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })}
        </p>
      </div>
      <div style="text-align:center;background:${scoreColor}18;border-radius:12px;padding:16px 24px;flex-shrink:0">
        <div style="font-size:40px;font-weight:800;color:${scoreColor};line-height:1">${healthScore}</div>
        <div style="font-size:12px;color:#64748b;margin-top:2px">/ 100</div>
      </div>
    </div>

    <p style="color:#334155;line-height:1.75;margin:0 0 32px;padding-bottom:28px;border-bottom:1px solid #e2e8f0;font-size:15px">
      ${data.summary}
    </p>

    ${sectionsHtml}
  </div>
</body>
</html>`;
}
```

- [ ] **Step 2: API 빌드로 타입 검증**

```bash
pnpm -F @opencairn/api build
```

Expected: 타입 에러 없음.

> **주의:** `getProvider()`의 `generate()` 시그니처는 `packages/llm`의 실제 구현에 맞춰 조정한다. Gemini provider는 `response_mime_type: "application/json"` 옵션을 지원한다 (Plan 4 Phase B에서 확인된 패턴).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/health-report.ts
git commit -m "feat(api): add /documents/health-report endpoint with DB aggregation and Gemini narrative"
```

---

### Task 7: `app.ts`에 health-report 라우트 마운트

**Files:**
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: `apps/api/src/app.ts` 열기**

기존 import 섹션에 추가:

```typescript
import { healthReportRouter } from "./routes/health-report";
```

- [ ] **Step 2: 라우트 마운트 추가**

다른 `app.route(...)` 줄들 바로 아래에 추가:

```typescript
app.route("/api/documents/health-report", healthReportRouter);
```

- [ ] **Step 3: API 빌드**

```bash
pnpm -F @opencairn/api build
```

Expected: 빌드 성공.

- [ ] **Step 4: 스모크 테스트 (docker-compose 실행 중 가정)**

```bash
curl -X POST http://localhost:4000/api/documents/health-report \
  -H "Content-Type: application/json" \
  -H "Cookie: <세션 쿠키>" \
  -d '{"projectId": "<유효한 projectId UUID>"}'
```

Expected A (Plan 6/8 미완료 시): `{"error":"데이터 없음 — ..."}` with 422
Expected B (데이터 있을 시): `{"signedUrl":"...","documentId":"...","healthScore":72}`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app.ts
git commit -m "feat(api): mount health-report router at /api/documents/health-report"
```

---

### Task 8: SkillPicker UI 업데이트

**Files:**
- Modify: `apps/web/src/app/(app)/studio/components/SkillPicker.tsx`

> Plan 10 Task 7이 생성한 `SkillPicker.tsx`에 두 개의 새 섹션을 추가한다.

- [ ] **Step 1: `SkillPicker.tsx` 열기**

파일 구조를 확인한다. Plan 10의 SkillPicker는 skill 목록을 평면으로 렌더링한다.

- [ ] **Step 2: 섹션 타입 정의 추가**

파일 상단 (기존 imports 아래)에 추가:

```typescript
// SkillPicker 내부 섹션 메타데이터
const SKILL_SECTIONS = [
  {
    label: "📄 문서 출력",
    skillIds: ["latex_paper", "docx_report", "html_slides", "pptx_download", "pdf_freeform", "review_document"],
  },
  {
    label: "🎓 학습 자료",
    skillIds: ["quiz", "flashcard", "fill-blank", "mock-exam", "teach-back", "concept-compare", "cheatsheet", "anki_deck_export"],
  },
  {
    label: "✨ 시각화",
    skillIds: ["infographic", "data_table"],
  },
] as const;
```

- [ ] **Step 3: 렌더 로직 수정**

기존의 skill 목록 렌더링 부분을 섹션별 그룹으로 교체한다. 기존 skill 카드 컴포넌트(`SkillCard` 또는 인라인 렌더)를 유지하면서 섹션 헤더만 추가한다:

```tsx
{/* 기존 skill 섹션들 */}
{SKILL_SECTIONS.map((section) => {
  const sectionSkills = skills.filter((s) =>
    (section.skillIds as readonly string[]).includes(s.id)
  );
  if (sectionSkills.length === 0) return null;
  return (
    <div key={section.label} className="mb-8">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        {section.label}
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {sectionSkills.map((skill) => (
          <SkillCard key={skill.id} skill={skill} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
})}

{/* 지식베이스 분석 섹션 — Health Report 전용 카드 */}
<div className="mb-8">
  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
    🔍 지식베이스 분석
  </h3>
  <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3">
    <div>
      <p className="font-semibold text-card-foreground">Knowledge Health Report</p>
      <p className="text-sm text-muted-foreground mt-1">
        내 KG 상태를 진단하고 액션 플랜을 생성합니다.
        <br />
        <span className="text-xs text-muted-foreground/70">
          Plan 6/8 완료 후 더욱 풍부한 분석이 제공됩니다.
        </span>
      </p>
    </div>
    <button
      onClick={onHealthReport}
      className="self-start px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
    >
      PDF 보고서 생성
    </button>
  </div>
</div>
```

- [ ] **Step 4: `onHealthReport` prop 추가**

`SkillPicker` 컴포넌트의 props 타입에 추가:

```typescript
interface SkillPickerProps {
  skills: ToolTemplate[];
  onSelect: (skill: ToolTemplate) => void;
  onHealthReport: () => void;   // 추가
  projectId: string;
}
```

- [ ] **Step 5: Studio 페이지에서 `onHealthReport` 핸들러 연결**

`apps/web/src/app/(app)/studio/page.tsx`에서 SkillPicker에 핸들러를 전달:

```typescript
async function handleHealthReport() {
  const res = await fetch("/api/documents/health-report", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId }),
  });
  if (res.status === 422) {
    const { error } = await res.json();
    alert(error); // 실제로는 toast로 교체
    return;
  }
  const { signedUrl, healthScore } = await res.json();
  window.open(signedUrl, "_blank");
}

// SkillPicker에:
<SkillPicker
  skills={skills}
  onSelect={handleSkillSelect}
  onHealthReport={handleHealthReport}
  projectId={projectId}
/>
```

- [ ] **Step 6: TypeScript 타입 검증**

```bash
pnpm -F @opencairn/web tsc --noEmit
```

Expected: 타입 에러 없음.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/\(app\)/studio/components/SkillPicker.tsx \
        apps/web/src/app/\(app\)/studio/page.tsx
git commit -m "feat(web): add 시각화 section and Knowledge Health Report card to SkillPicker"
```

---

## Verification

- [ ] `POST /api/documents/compile` `skillName=infographic` → PDF R2 업로드 → signed URL 반환
- [ ] `POST /api/documents/compile` `skillName=data_table` → XLSX R2 업로드 → signed URL 반환, `document_section_sources`에 KG 앵커 저장됨
- [ ] `POST /api/documents/health-report` (Plan 6/8 미완료 시) → 422 + 안내 메시지
- [ ] `POST /api/documents/health-report` (suggestions 데이터 있을 시) → PDF 생성 + health_score 반환
- [ ] Studio SkillPicker에 "✨ 시각화", "🔍 지식베이스 분석" 섹션이 표시됨
- [ ] Health Report 카드 "PDF 보고서 생성" 버튼 → 새 탭에서 PDF 열림
- [ ] infographic 인포그래픽 theme 4종 (blue/green/ember/stone) 색상 정상 적용
- [ ] data_table XLSX 파일이 Excel에서 열리고 헤더/데이터 행이 정확함

---

## Summary

| Task | 핵심 결과물 |
|------|------------|
| 1 | infographic Zod 스키마 + JSON 정의 |
| 2 | data_table Zod 스키마 + JSON 정의 |
| 3 | xlsx.ts 컴파일러 (SheetJS) |
| 4 | infographic-html.ts HTML 렌더러 (4 테마) |
| 5 | documents.ts 라우트에 infographic/data_table 분기 |
| 6 | health-report.ts 전용 엔드포인트 (DB 집계 + Gemini + PDF) |
| 7 | app.ts 마운트 |
| 8 | SkillPicker UI 섹션 구분 + Health Report 카드 |
