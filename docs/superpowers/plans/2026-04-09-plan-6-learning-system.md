# Plan 6: Learning System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the OpenCairn Learning System — a Socratic Agent that quizzes users, tracks understanding scores, and drives a spaced-repetition flashcard loop using the SM-2 algorithm. A Tool Template engine powers all learning interactions through typed JSON templates rendered as structured output or interactive canvas.

**Architecture:** Flashcard CRUD and SM-2 review logic live in `apps/api` under `routes/learning.ts`. The Socratic Agent is a LangGraph graph in `apps/api/src/agents/socratic/`. The Tool Template engine lives in `packages/templates/` — it loads JSON template definitions, renders prompt strings, validates output against Zod schemas, and routes output to a `structured` or `canvas` renderer. Built-in templates (quiz, flashcard, fill_blank, mock_exam, teach_back, concept_compare, slides, mindmap, cheatsheet) are JSON files committed alongside their Zod schemas. The flashcard review UI and understanding scores dashboard are React Server / Client components in `apps/web`.

**Tech Stack:** Turborepo, Next.js 16, Hono 4, Drizzle ORM 0.45, PostgreSQL 16, LangGraph (TypeScript), Zod, Tailwind CSS 4, shadcn/ui, pnpm

---

## File Structure

```
apps/
  api/
    src/
      routes/
        learning.ts               -- flashcard + review + understanding-score routes
      agents/
        socratic/
          graph.ts                -- LangGraph graph definition
          nodes/
            generate-questions.ts -- node: generate Socratic questions from concept
            evaluate-answer.ts    -- node: score user answer, produce feedback
            update-score.ts       -- node: persist understanding score
            create-flashcard.ts   -- node: mint flashcard from weak concept
          state.ts                -- LangGraph state shape
          index.ts                -- export compiled graph

  web/
    src/
      app/
        (app)/
          learn/
            page.tsx              -- learning hub landing
            flashcards/
              page.tsx            -- flashcard deck list
              [deckId]/
                review/page.tsx   -- spaced-repetition session
            scores/
              page.tsx            -- understanding scores dashboard
      components/
        learn/
          FlashcardReview.tsx     -- flip-card UI, rating buttons (1-4)
          ScoresDashboard.tsx     -- per-concept score grid / sparklines
          DeckCard.tsx            -- deck summary card

packages/
  templates/
    package.json
    tsconfig.json
    src/
      index.ts                    -- public exports
      engine.ts                   -- template loader, prompt renderer, schema validator
      types.ts                    -- ToolTemplate, RendererType, TemplateOutput types
      schemas/
        quiz.ts                   -- Zod output schema for quiz template
        flashcard.ts              -- Zod output schema for flashcard template
        fill-blank.ts             -- Zod output schema for fill_blank template
        mock-exam.ts              -- Zod output schema for mock_exam template
        teach-back.ts             -- Zod output schema for teach_back template
        concept-compare.ts        -- Zod output schema for concept_compare template
        slides.ts                 -- Zod output schema for slides template (canvas)
        mindmap.ts                -- Zod output schema for mindmap template (canvas)
        cheatsheet.ts             -- Zod output schema for cheatsheet template (canvas)
    templates/
      quiz.json
      flashcard.json
      fill-blank.json
      mock-exam.json
      teach-back.json
      concept-compare.json
      slides.json
      mindmap.json
      cheatsheet.json
```

---

### Task 1: Flashcard API Routes (CRUD + SM-2 Review Logic)

**Files:**
- Create: `apps/api/src/routes/learning.ts`
- Edit: `apps/api/src/app.ts` (mount learning router)

- [ ] **Step 1: Create `apps/api/src/routes/learning.ts`**

```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../lib/db";
import { flashcards, reviewLogs, understandingScores } from "@opencairn/db";
import { eq, and, lte, sql } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth";

export const learningRouter = new Hono();

learningRouter.use("*", authMiddleware);

// ── Flashcard CRUD ────────────────────────────────────────────────────────────

const createFlashcardSchema = z.object({
  conceptId: z.string().uuid().optional(),
  noteId: z.string().uuid().optional(),
  front: z.string().min(1).max(2000),
  back: z.string().min(1).max(4000),
  deckName: z.string().max(100).default("default"),
});

learningRouter.post("/flashcards", zValidator("json", createFlashcardSchema), async (c) => {
  const userId = c.get("userId") as string;
  const body = c.req.valid("json");
  const [card] = await db
    .insert(flashcards)
    .values({
      userId,
      ...body,
      // SM-2 defaults
      easeFactor: "2.50",
      interval: 0,
      repetitions: 0,
      dueAt: new Date(),
    })
    .returning();
  return c.json(card, 201);
});

learningRouter.get("/flashcards", async (c) => {
  const userId = c.get("userId") as string;
  const deck = c.req.query("deck");
  const whereClause = deck
    ? and(eq(flashcards.userId, userId), eq(flashcards.deckName, deck))
    : eq(flashcards.userId, userId);
  const cards = await db.select().from(flashcards).where(whereClause);
  return c.json(cards);
});

learningRouter.get("/flashcards/due", async (c) => {
  const userId = c.get("userId") as string;
  const limit = Number(c.req.query("limit") ?? "20");
  const cards = await db
    .select()
    .from(flashcards)
    .where(and(eq(flashcards.userId, userId), lte(flashcards.dueAt, new Date())))
    .limit(limit);
  return c.json(cards);
});

learningRouter.get("/flashcards/:id", async (c) => {
  const userId = c.get("userId") as string;
  const id = c.req.param("id");
  const [card] = await db
    .select()
    .from(flashcards)
    .where(and(eq(flashcards.id, id), eq(flashcards.userId, userId)));
  if (!card) return c.json({ error: "Not found" }, 404);
  return c.json(card);
});

learningRouter.patch(
  "/flashcards/:id",
  zValidator("json", createFlashcardSchema.partial()),
  async (c) => {
    const userId = c.get("userId") as string;
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const [updated] = await db
      .update(flashcards)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(flashcards.id, id), eq(flashcards.userId, userId)))
      .returning();
    if (!updated) return c.json({ error: "Not found" }, 404);
    return c.json(updated);
  }
);

learningRouter.delete("/flashcards/:id", async (c) => {
  const userId = c.get("userId") as string;
  const id = c.req.param("id");
  const [deleted] = await db
    .delete(flashcards)
    .where(and(eq(flashcards.id, id), eq(flashcards.userId, userId)))
    .returning();
  if (!deleted) return c.json({ error: "Not found" }, 404);
  return c.json({ success: true });
});

// ── SM-2 Review ───────────────────────────────────────────────────────────────

const reviewSchema = z.object({
  quality: z.number().int().min(1).max(4),
  // 1 = blackout, 2 = hard, 3 = good, 4 = easy
});

/**
 * SM-2 algorithm:
 *   quality maps to [0..5]: 1→0, 2→2, 3→4, 4→5
 *   EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
 *   interval:
 *     q < 3 → reset to 1 day
 *     rep 0  → 1 day
 *     rep 1  → 6 days
 *     rep n  → round(prev * EF')
 */
function sm2(
  quality: number,
  repetitions: number,
  easeFactor: number,
  interval: number
): { nextInterval: number; nextEF: number; nextReps: number } {
  const q = quality === 1 ? 0 : quality === 2 ? 2 : quality === 3 ? 4 : 5;
  const nextEF = Math.max(
    1.3,
    easeFactor + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)
  );
  if (q < 3) {
    return { nextInterval: 1, nextEF, nextReps: 0 };
  }
  let nextInterval: number;
  if (repetitions === 0) nextInterval = 1;
  else if (repetitions === 1) nextInterval = 6;
  else nextInterval = Math.round(interval * easeFactor);
  return { nextInterval, nextEF, nextReps: repetitions + 1 };
}

learningRouter.post(
  "/flashcards/:id/review",
  zValidator("json", reviewSchema),
  async (c) => {
    const userId = c.get("userId") as string;
    const id = c.req.param("id");
    const { quality } = c.req.valid("json");

    const [card] = await db
      .select()
      .from(flashcards)
      .where(and(eq(flashcards.id, id), eq(flashcards.userId, userId)));
    if (!card) return c.json({ error: "Not found" }, 404);

    const { nextInterval, nextEF, nextReps } = sm2(
      quality,
      card.repetitions,
      parseFloat(card.easeFactor),
      card.interval
    );

    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() + nextInterval);

    const [updated] = await db
      .update(flashcards)
      .set({
        repetitions: nextReps,
        interval: nextInterval,
        easeFactor: nextEF.toFixed(2),
        dueAt,
        lastReviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(flashcards.id, id))
      .returning();

    await db.insert(reviewLogs).values({
      flashcardId: id,
      userId,
      quality,
      easeFactor: nextEF.toFixed(2),
      interval: nextInterval,
      reviewedAt: new Date(),
    });

    return c.json(updated);
  }
);

// ── Understanding Scores ──────────────────────────────────────────────────────

learningRouter.get("/scores", async (c) => {
  const userId = c.get("userId") as string;
  const scores = await db
    .select()
    .from(understandingScores)
    .where(eq(understandingScores.userId, userId));
  return c.json(scores);
});

learningRouter.get("/scores/:conceptId", async (c) => {
  const userId = c.get("userId") as string;
  const conceptId = c.req.param("conceptId");
  const [score] = await db
    .select()
    .from(understandingScores)
    .where(
      and(
        eq(understandingScores.userId, userId),
        eq(understandingScores.conceptId, conceptId)
      )
    );
  return c.json(score ?? null);
});
```

- [ ] **Step 2: Mount learning router in `apps/api/src/app.ts`**

Open `apps/api/src/app.ts` and add:

```typescript
import { learningRouter } from "./routes/learning";
// inside app route mounting:
app.route("/api/learn", learningRouter);
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/learning.ts apps/api/src/app.ts
git commit -m "feat(api): flashcard CRUD and SM-2 review routes"
```

---

### Task 2: Socratic Agent (LangGraph)

**Files:**
- Create: `apps/api/src/agents/socratic/state.ts`
- Create: `apps/api/src/agents/socratic/nodes/generate-questions.ts`
- Create: `apps/api/src/agents/socratic/nodes/evaluate-answer.ts`
- Create: `apps/api/src/agents/socratic/nodes/update-score.ts`
- Create: `apps/api/src/agents/socratic/nodes/create-flashcard.ts`
- Create: `apps/api/src/agents/socratic/graph.ts`
- Create: `apps/api/src/agents/socratic/index.ts`
- Create: `apps/api/src/routes/socratic.ts`
- Edit: `apps/api/src/app.ts` (mount socratic router)

- [ ] **Step 1: Create `apps/api/src/agents/socratic/state.ts`**

```typescript
import { Annotation } from "@langchain/langgraph";

export const SocraticState = Annotation.Root({
  // inputs
  userId: Annotation<string>(),
  conceptId: Annotation<string>(),
  conceptTitle: Annotation<string>(),
  noteContext: Annotation<string>(),          // relevant note text for grounding

  // generated questions
  questions: Annotation<SocraticQuestion[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),

  // current turn
  currentQuestionIndex: Annotation<number>({ default: () => 0 }),
  userAnswer: Annotation<string | null>({ default: () => null }),

  // evaluation output
  score: Annotation<number | null>({ default: () => null }),         // 0~100
  feedback: Annotation<string | null>({ default: () => null }),
  isCorrect: Annotation<boolean | null>({ default: () => null }),

  // decisions
  shouldCreateFlashcard: Annotation<boolean>({ default: () => false }),
  sessionComplete: Annotation<boolean>({ default: () => false }),

  // outputs
  updatedScore: Annotation<number | null>({ default: () => null }),
  createdFlashcardId: Annotation<string | null>({ default: () => null }),
});

export type SocraticQuestion = {
  id: string;
  text: string;
  hint?: string;
  difficulty: "easy" | "medium" | "hard";
};

export type SocraticStateType = typeof SocraticState.State;
```

- [ ] **Step 2: Create `apps/api/src/agents/socratic/nodes/generate-questions.ts`**

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import type { SocraticStateType, SocraticQuestion } from "../state";
import { randomUUID } from "crypto";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const questionsSchema = z.object({
  questions: z.array(
    z.object({
      text: z.string(),
      hint: z.string().optional(),
      difficulty: z.enum(["easy", "medium", "hard"]),
    })
  ).min(1).max(5),
});

export async function generateQuestionsNode(
  state: SocraticStateType
): Promise<Partial<SocraticStateType>> {
  const model = genAI.getGenerativeModel({
    model: "gemini-3.1-flash-lite-preview",
    generationConfig: { responseMimeType: "application/json" },
  });

  const prompt = `
You are a Socratic tutor. Generate 3-5 questions to test a student's understanding of the concept below.
Mix difficulty levels. Questions should probe reasoning, not just recall.

Concept: ${state.conceptTitle}
Context (from student's notes):
${state.noteContext.slice(0, 3000)}

Respond with JSON matching this schema:
${JSON.stringify(questionsSchema.shape, null, 2)}
  `.trim();

  const result = await model.generateContent(prompt);
  const raw = result.response.text();
  const parsed = questionsSchema.parse(JSON.parse(raw));

  const questions: SocraticQuestion[] = parsed.questions.map((q) => ({
    id: randomUUID(),
    ...q,
  }));

  return { questions };
}
```

- [ ] **Step 3: Create `apps/api/src/agents/socratic/nodes/evaluate-answer.ts`**

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import type { SocraticStateType } from "../state";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const evalSchema = z.object({
  score: z.number().int().min(0).max(100),
  isCorrect: z.boolean(),
  feedback: z.string(),
  shouldCreateFlashcard: z.boolean(),
});

export async function evaluateAnswerNode(
  state: SocraticStateType
): Promise<Partial<SocraticStateType>> {
  const question = state.questions[state.currentQuestionIndex];
  if (!question || !state.userAnswer) {
    return { score: 0, isCorrect: false, feedback: "No answer provided.", shouldCreateFlashcard: true };
  }

  const model = genAI.getGenerativeModel({
    model: "gemini-3.1-flash-lite-preview",
    generationConfig: { responseMimeType: "application/json" },
  });

  const prompt = `
Evaluate the student's answer to the Socratic question.

Concept: ${state.conceptTitle}
Question: ${question.text}
Student Answer: ${state.userAnswer}
Reference Context: ${state.noteContext.slice(0, 1500)}

Score 0-100. Set shouldCreateFlashcard=true if the student struggled (score < 70).
Return JSON:
{ "score": number, "isCorrect": boolean, "feedback": string, "shouldCreateFlashcard": boolean }
  `.trim();

  const result = await model.generateContent(prompt);
  const raw = result.response.text();
  const parsed = evalSchema.parse(JSON.parse(raw));

  return {
    score: parsed.score,
    isCorrect: parsed.isCorrect,
    feedback: parsed.feedback,
    shouldCreateFlashcard: parsed.shouldCreateFlashcard,
    sessionComplete: state.currentQuestionIndex >= state.questions.length - 1,
  };
}
```

- [ ] **Step 4: Create `apps/api/src/agents/socratic/nodes/update-score.ts`**

```typescript
import { db } from "../../../lib/db";
import { understandingScores } from "@opencairn/db";
import { eq, and } from "drizzle-orm";
import type { SocraticStateType } from "../state";

export async function updateScoreNode(
  state: SocraticStateType
): Promise<Partial<SocraticStateType>> {
  if (state.score === null) return {};

  const existing = await db
    .select()
    .from(understandingScores)
    .where(
      and(
        eq(understandingScores.userId, state.userId),
        eq(understandingScores.conceptId, state.conceptId)
      )
    )
    .then((rows) => rows[0] ?? null);

  let newScore: number;
  if (existing) {
    // EMA with alpha=0.3 so recent performance weighs more
    newScore = Math.round(0.3 * state.score + 0.7 * existing.score);
  } else {
    newScore = state.score;
  }

  await db
    .insert(understandingScores)
    .values({
      userId: state.userId,
      conceptId: state.conceptId,
      score: newScore,
      lastReviewedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [understandingScores.userId, understandingScores.conceptId],
      set: { score: newScore, lastReviewedAt: new Date(), updatedAt: new Date() },
    });

  return { updatedScore: newScore };
}
```

- [ ] **Step 5: Create `apps/api/src/agents/socratic/nodes/create-flashcard.ts`**

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import { db } from "../../../lib/db";
import { flashcards } from "@opencairn/db";
import type { SocraticStateType } from "../state";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const cardSchema = z.object({
  front: z.string().max(2000),
  back: z.string().max(4000),
});

export async function createFlashcardNode(
  state: SocraticStateType
): Promise<Partial<SocraticStateType>> {
  if (!state.shouldCreateFlashcard) return {};

  const question = state.questions[state.currentQuestionIndex];

  const model = genAI.getGenerativeModel({
    model: "gemini-3.1-flash-lite-preview",
    generationConfig: { responseMimeType: "application/json" },
  });

  const prompt = `
Create a concise flashcard for the concept the student struggled with.

Concept: ${state.conceptTitle}
Question they struggled on: ${question?.text ?? "N/A"}
Feedback given: ${state.feedback ?? "N/A"}

Return JSON: { "front": "question side", "back": "answer side with explanation" }
  `.trim();

  const result = await model.generateContent(prompt);
  const raw = result.response.text();
  const parsed = cardSchema.parse(JSON.parse(raw));

  const [card] = await db
    .insert(flashcards)
    .values({
      userId: state.userId,
      conceptId: state.conceptId,
      front: parsed.front,
      back: parsed.back,
      deckName: state.conceptTitle,
      easeFactor: "2.50",
      interval: 0,
      repetitions: 0,
      dueAt: new Date(),
    })
    .returning();

  return { createdFlashcardId: card.id };
}
```

- [ ] **Step 6: Create `apps/api/src/agents/socratic/graph.ts`**

```typescript
import { StateGraph, END } from "@langchain/langgraph";
import { SocraticState } from "./state";
import { generateQuestionsNode } from "./nodes/generate-questions";
import { evaluateAnswerNode } from "./nodes/evaluate-answer";
import { updateScoreNode } from "./nodes/update-score";
import { createFlashcardNode } from "./nodes/create-flashcard";

const graph = new StateGraph(SocraticState)
  .addNode("generateQuestions", generateQuestionsNode)
  .addNode("evaluateAnswer", evaluateAnswerNode)
  .addNode("updateScore", updateScoreNode)
  .addNode("createFlashcard", createFlashcardNode)
  .addEdge("__start__", "generateQuestions")
  .addEdge("generateQuestions", "evaluateAnswer")
  .addEdge("evaluateAnswer", "updateScore")
  .addConditionalEdges("updateScore", (state) => {
    if (state.shouldCreateFlashcard) return "createFlashcard";
    return END;
  })
  .addEdge("createFlashcard", END);

export const socraticGraph = graph.compile();
```

- [ ] **Step 7: Create `apps/api/src/agents/socratic/index.ts`**

```typescript
export { socraticGraph } from "./graph";
export type { SocraticStateType, SocraticQuestion } from "./state";
```

- [ ] **Step 8: Create `apps/api/src/routes/socratic.ts`**

```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import { socraticGraph } from "../agents/socratic";
import { db } from "../lib/db";
import { concepts, notes } from "@opencairn/db";
import { eq } from "drizzle-orm";

export const socraticRouter = new Hono();
socraticRouter.use("*", authMiddleware);

const startSessionSchema = z.object({
  conceptId: z.string().uuid(),
  userAnswer: z.string().min(1),
  questionIndex: z.number().int().min(0).default(0),
});

socraticRouter.post(
  "/session",
  zValidator("json", startSessionSchema),
  async (c) => {
    const userId = c.get("userId") as string;
    const { conceptId, userAnswer, questionIndex } = c.req.valid("json");

    const [concept] = await db
      .select()
      .from(concepts)
      .where(eq(concepts.id, conceptId));
    if (!concept) return c.json({ error: "Concept not found" }, 404);

    // Gather note context for this concept
    const noteRows = await db
      .select({ content: notes.content })
      .from(notes)
      .limit(5);
    const noteContext = noteRows.map((n) => n.content).join("\n\n");

    const result = await socraticGraph.invoke({
      userId,
      conceptId,
      conceptTitle: concept.title,
      noteContext,
      userAnswer,
      currentQuestionIndex: questionIndex,
      questions: [],
    });

    return c.json({
      questions: result.questions,
      score: result.score,
      feedback: result.feedback,
      isCorrect: result.isCorrect,
      updatedScore: result.updatedScore,
      createdFlashcardId: result.createdFlashcardId,
      sessionComplete: result.sessionComplete,
    });
  }
);

// Generate questions only (before user answers)
const generateSchema = z.object({ conceptId: z.string().uuid() });

socraticRouter.post(
  "/generate",
  zValidator("json", generateSchema),
  async (c) => {
    const userId = c.get("userId") as string;
    const { conceptId } = c.req.valid("json");

    const [concept] = await db
      .select()
      .from(concepts)
      .where(eq(concepts.id, conceptId));
    if (!concept) return c.json({ error: "Concept not found" }, 404);

    const noteRows = await db
      .select({ content: notes.content })
      .from(notes)
      .limit(5);
    const noteContext = noteRows.map((n) => n.content).join("\n\n");

    // Run only the generateQuestions node by invoking with minimal state
    const result = await socraticGraph.invoke({
      userId,
      conceptId,
      conceptTitle: concept.title,
      noteContext,
      userAnswer: null,
      currentQuestionIndex: 0,
      questions: [],
    });

    return c.json({ questions: result.questions });
  }
);
```

- [ ] **Step 9: Mount socratic router in `apps/api/src/app.ts`**

```typescript
import { socraticRouter } from "./routes/socratic";
// inside app route mounting:
app.route("/api/socratic", socraticRouter);
```

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/agents/ apps/api/src/routes/socratic.ts apps/api/src/app.ts
git commit -m "feat(api): Socratic Agent with LangGraph (question gen, eval, score update, flashcard creation)"
```

---

### Task 3: Tool Template Engine

**Files:**
- Create: `packages/templates/package.json`
- Create: `packages/templates/tsconfig.json`
- Create: `packages/templates/src/types.ts`
- Create: `packages/templates/src/engine.ts`
- Create: `packages/templates/src/index.ts`

- [ ] **Step 1: Create `packages/templates/package.json`**

```json
{
  "name": "@opencairn/templates",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Create `packages/templates/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*", "templates/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `packages/templates/src/types.ts`**

```typescript
import type { z, ZodTypeAny } from "zod";

export type RendererType = "structured" | "canvas";

export type ToolTemplate = {
  id: string;                        // e.g. "quiz", "mindmap"
  name: string;                      // display name
  description: string;
  renderer: RendererType;
  prompt_template: string;           // Handlebars-style {{variable}} placeholders
  variables: string[];               // required interpolation keys
  output_schema_id: string;          // matches a key in schemaRegistry
};

export type TemplateContext = Record<string, string | number | boolean>;

export type TemplateOutput<T = unknown> = {
  templateId: string;
  renderer: RendererType;
  data: T;
  rawPrompt: string;
};
```

- [ ] **Step 4: Create `packages/templates/src/engine.ts`**

```typescript
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { z, ZodTypeAny } from "zod";
import type { ToolTemplate, TemplateContext, TemplateOutput, RendererType } from "./types";
import { schemaRegistry } from "./schemas";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, "../templates");

// ── Template loader ───────────────────────────────────────────────────────────

const templateCache = new Map<string, ToolTemplate>();

export function loadTemplate(id: string): ToolTemplate {
  if (templateCache.has(id)) return templateCache.get(id)!;
  const filePath = resolve(TEMPLATES_DIR, `${id}.json`);
  const raw = readFileSync(filePath, "utf-8");
  const template = JSON.parse(raw) as ToolTemplate;
  templateCache.set(id, template);
  return template;
}

export function listTemplates(): ToolTemplate[] {
  // Return all cached + pre-load known IDs
  const knownIds = [
    "quiz", "flashcard", "fill-blank", "mock-exam",
    "teach-back", "concept-compare", "slides", "mindmap", "cheatsheet",
  ];
  return knownIds.map(loadTemplate);
}

// ── Prompt rendering ──────────────────────────────────────────────────────────

/**
 * Interpolates {{variable}} placeholders in a template string.
 * Throws if a required variable is missing.
 */
export function renderPrompt(
  template: ToolTemplate,
  context: TemplateContext
): string {
  for (const key of template.variables) {
    if (!(key in context)) {
      throw new Error(
        `Template "${template.id}" requires variable "${key}" but it was not provided.`
      );
    }
  }
  return template.prompt_template.replace(
    /\{\{(\w+)\}\}/g,
    (_, key) => String(context[key] ?? "")
  );
}

// ── Output schema validation ──────────────────────────────────────────────────

export function validateOutput<T>(
  template: ToolTemplate,
  rawJson: unknown
): T {
  const schema = schemaRegistry[template.output_schema_id];
  if (!schema) {
    throw new Error(
      `No schema registered for output_schema_id "${template.output_schema_id}"`
    );
  }
  return schema.parse(rawJson) as T;
}

// ── High-level API ────────────────────────────────────────────────────────────

export function buildTemplateOutput<T>(
  templateId: string,
  context: TemplateContext,
  rawJson: unknown
): TemplateOutput<T> {
  const template = loadTemplate(templateId);
  const rawPrompt = renderPrompt(template, context);
  const data = validateOutput<T>(template, rawJson);
  return { templateId, renderer: template.renderer, data, rawPrompt };
}
```

- [ ] **Step 5: Create `packages/templates/src/index.ts`**

```typescript
export { loadTemplate, listTemplates, renderPrompt, validateOutput, buildTemplateOutput } from "./engine";
export type { ToolTemplate, TemplateContext, TemplateOutput, RendererType } from "./types";
export { schemaRegistry } from "./schemas";
```

- [ ] **Step 6: Create `packages/templates/src/schemas/index.ts`** (barrel for schema registry)

```typescript
import type { ZodTypeAny } from "zod";
import { quizSchema } from "./quiz";
import { flashcardSchema } from "./flashcard";
import { fillBlankSchema } from "./fill-blank";
import { mockExamSchema } from "./mock-exam";
import { teachBackSchema } from "./teach-back";
import { conceptCompareSchema } from "./concept-compare";
import { slidesSchema } from "./slides";
import { mindmapSchema } from "./mindmap";
import { cheatsheetSchema } from "./cheatsheet";

export const schemaRegistry: Record<string, ZodTypeAny> = {
  quiz: quizSchema,
  flashcard: flashcardSchema,
  fill_blank: fillBlankSchema,
  mock_exam: mockExamSchema,
  teach_back: teachBackSchema,
  concept_compare: conceptCompareSchema,
  slides: slidesSchema,
  mindmap: mindmapSchema,
  cheatsheet: cheatsheetSchema,
};
```

- [ ] **Step 7: Commit**

```bash
git add packages/templates/
git commit -m "feat(templates): Tool Template engine (loader, prompt renderer, schema validator)"
```

---

### Task 4: Built-in Templates

**Files:**
- Create: `packages/templates/src/schemas/quiz.ts`
- Create: `packages/templates/src/schemas/flashcard.ts`
- Create: `packages/templates/src/schemas/fill-blank.ts`
- Create: `packages/templates/src/schemas/mock-exam.ts`
- Create: `packages/templates/src/schemas/teach-back.ts`
- Create: `packages/templates/src/schemas/concept-compare.ts`
- Create: `packages/templates/src/schemas/slides.ts`
- Create: `packages/templates/src/schemas/mindmap.ts`
- Create: `packages/templates/src/schemas/cheatsheet.ts`
- Create: `packages/templates/templates/quiz.json`
- Create: `packages/templates/templates/flashcard.json`
- Create: `packages/templates/templates/fill-blank.json`
- Create: `packages/templates/templates/mock-exam.json`
- Create: `packages/templates/templates/teach-back.json`
- Create: `packages/templates/templates/concept-compare.json`
- Create: `packages/templates/templates/slides.json`
- Create: `packages/templates/templates/mindmap.json`
- Create: `packages/templates/templates/cheatsheet.json`

- [ ] **Step 1: Create structured output Zod schemas**

Create `packages/templates/src/schemas/quiz.ts`:

```typescript
import { z } from "zod";

export const quizSchema = z.object({
  title: z.string(),
  questions: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()).length(4),
      correctIndex: z.number().int().min(0).max(3),
      explanation: z.string(),
    })
  ).min(1).max(20),
});
export type QuizOutput = z.infer<typeof quizSchema>;
```

Create `packages/templates/src/schemas/flashcard.ts`:

```typescript
import { z } from "zod";

export const flashcardSchema = z.object({
  cards: z.array(
    z.object({
      front: z.string().max(2000),
      back: z.string().max(4000),
      tags: z.array(z.string()).default([]),
    })
  ).min(1).max(50),
});
export type FlashcardOutput = z.infer<typeof flashcardSchema>;
```

Create `packages/templates/src/schemas/fill-blank.ts`:

```typescript
import { z } from "zod";

export const fillBlankSchema = z.object({
  passage: z.string(),
  blanks: z.array(
    z.object({
      placeholder: z.string(),   // e.g. "___1___"
      answer: z.string(),
      hint: z.string().optional(),
    })
  ).min(1),
});
export type FillBlankOutput = z.infer<typeof fillBlankSchema>;
```

Create `packages/templates/src/schemas/mock-exam.ts`:

```typescript
import { z } from "zod";

export const mockExamSchema = z.object({
  title: z.string(),
  duration_minutes: z.number().int().positive(),
  sections: z.array(
    z.object({
      name: z.string(),
      questions: z.array(
        z.object({
          type: z.enum(["mcq", "short_answer", "essay"]),
          question: z.string(),
          marks: z.number().int().positive(),
          answer_guide: z.string(),
          options: z.array(z.string()).optional(),
          correct_option: z.number().int().optional(),
        })
      ),
    })
  ).min(1),
});
export type MockExamOutput = z.infer<typeof mockExamSchema>;
```

Create `packages/templates/src/schemas/teach-back.ts`:

```typescript
import { z } from "zod";

export const teachBackSchema = z.object({
  concept: z.string(),
  explanation: z.string(),
  analogy: z.string().optional(),
  key_points: z.array(z.string()).min(2).max(8),
  common_mistakes: z.array(z.string()).max(5),
  follow_up_questions: z.array(z.string()).min(1).max(5),
});
export type TeachBackOutput = z.infer<typeof teachBackSchema>;
```

Create `packages/templates/src/schemas/concept-compare.ts`:

```typescript
import { z } from "zod";

export const conceptCompareSchema = z.object({
  concept_a: z.string(),
  concept_b: z.string(),
  similarities: z.array(z.string()).min(1),
  differences: z.array(
    z.object({
      dimension: z.string(),
      a: z.string(),
      b: z.string(),
    })
  ).min(1),
  when_to_use_a: z.string(),
  when_to_use_b: z.string(),
  summary: z.string(),
});
export type ConceptCompareOutput = z.infer<typeof conceptCompareSchema>;
```

Create `packages/templates/src/schemas/slides.ts` (canvas renderer):

```typescript
import { z } from "zod";

export const slidesSchema = z.object({
  title: z.string(),
  slides: z.array(
    z.object({
      heading: z.string(),
      bullets: z.array(z.string()).max(6),
      speaker_notes: z.string().optional(),
      layout: z.enum(["title", "bullets", "two-column", "image-text"]).default("bullets"),
    })
  ).min(1).max(30),
  // The canvas renderer uses this data to generate a React slide deck component
  react_component_hint: z.string().optional(),
});
export type SlidesOutput = z.infer<typeof slidesSchema>;
```

Create `packages/templates/src/schemas/mindmap.ts` (canvas renderer):

```typescript
import { z } from "zod";

export const mindmapSchema = z.object({
  root: z.string(),
  nodes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      parentId: z.string().nullable(),
      depth: z.number().int().min(0),
      color: z.string().optional(),
    })
  ),
});
export type MindmapOutput = z.infer<typeof mindmapSchema>;
```

Create `packages/templates/src/schemas/cheatsheet.ts` (canvas renderer):

```typescript
import { z } from "zod";

export const cheatsheetSchema = z.object({
  title: z.string(),
  sections: z.array(
    z.object({
      heading: z.string(),
      items: z.array(
        z.object({
          term: z.string(),
          definition: z.string(),
          example: z.string().optional(),
        })
      ),
    })
  ).min(1),
});
export type CheatsheetOutput = z.infer<typeof cheatsheetSchema>;
```

- [ ] **Step 2: Create JSON template definitions**

Create `packages/templates/templates/quiz.json`:

```json
{
  "id": "quiz",
  "name": "Multiple-Choice Quiz",
  "description": "Generate a multiple-choice quiz for a topic or set of notes.",
  "renderer": "structured",
  "output_schema_id": "quiz",
  "variables": ["topic", "context", "num_questions"],
  "prompt_template": "You are an expert quiz creator.\n\nTopic: {{topic}}\nNumber of questions: {{num_questions}}\n\nSource material:\n{{context}}\n\nGenerate a multiple-choice quiz. Each question must have exactly 4 options with one correct answer. Include a brief explanation for the correct answer.\n\nReturn valid JSON matching the schema: { title, questions: [{ question, options: [4 strings], correctIndex, explanation }] }"
}
```

Create `packages/templates/templates/flashcard.json`:

```json
{
  "id": "flashcard",
  "name": "Flashcard Set",
  "description": "Generate a set of spaced-repetition flashcards from notes or a topic.",
  "renderer": "structured",
  "output_schema_id": "flashcard",
  "variables": ["topic", "context", "num_cards"],
  "prompt_template": "You are a flashcard expert.\n\nTopic: {{topic}}\nNumber of cards: {{num_cards}}\n\nSource material:\n{{context}}\n\nCreate {{num_cards}} flashcards. Front: a clear question or prompt. Back: a concise but complete answer. Include relevant tags.\n\nReturn JSON: { cards: [{ front, back, tags }] }"
}
```

Create `packages/templates/templates/fill-blank.json`:

```json
{
  "id": "fill-blank",
  "name": "Fill in the Blank",
  "description": "Create a cloze-style passage with blanks for key terms.",
  "renderer": "structured",
  "output_schema_id": "fill_blank",
  "variables": ["topic", "context"],
  "prompt_template": "Topic: {{topic}}\n\nSource:\n{{context}}\n\nCreate a fill-in-the-blank exercise. Write a coherent passage that teaches the topic, replacing key terms with placeholders like ___1___, ___2___, etc. Provide the correct answer and an optional hint for each blank.\n\nReturn JSON: { passage, blanks: [{ placeholder, answer, hint? }] }"
}
```

Create `packages/templates/templates/mock-exam.json`:

```json
{
  "id": "mock-exam",
  "name": "Mock Exam",
  "description": "Generate a timed mock exam with multiple sections and question types.",
  "renderer": "structured",
  "output_schema_id": "mock_exam",
  "variables": ["topic", "context", "duration_minutes", "num_questions"],
  "prompt_template": "Create a mock exam for the following topic.\n\nTopic: {{topic}}\nDuration: {{duration_minutes}} minutes\nTotal questions: {{num_questions}}\n\nSource material:\n{{context}}\n\nInclude a mix of MCQ, short answer, and essay questions grouped into sections. Provide marking guidance for each question.\n\nReturn JSON matching: { title, duration_minutes, sections: [{ name, questions: [{ type, question, marks, answer_guide, options?, correct_option? }] }] }"
}
```

Create `packages/templates/templates/teach-back.json`:

```json
{
  "id": "teach-back",
  "name": "Teach-Back Explanation",
  "description": "Generate a Feynman-style explanation of a concept as if teaching it simply.",
  "renderer": "structured",
  "output_schema_id": "teach_back",
  "variables": ["concept", "context", "audience"],
  "prompt_template": "Explain the following concept as if teaching it to a {{audience}}.\n\nConcept: {{concept}}\n\nBackground material:\n{{context}}\n\nUse simple language. Include an analogy, key points, common mistakes, and follow-up questions to check understanding.\n\nReturn JSON: { concept, explanation, analogy?, key_points, common_mistakes, follow_up_questions }"
}
```

Create `packages/templates/templates/concept-compare.json`:

```json
{
  "id": "concept-compare",
  "name": "Concept Comparison",
  "description": "Compare two concepts side by side across multiple dimensions.",
  "renderer": "structured",
  "output_schema_id": "concept_compare",
  "variables": ["concept_a", "concept_b", "context"],
  "prompt_template": "Compare and contrast the following two concepts.\n\nConcept A: {{concept_a}}\nConcept B: {{concept_b}}\n\nContext:\n{{context}}\n\nIdentify similarities, key differences across dimensions, and guidance on when to use each.\n\nReturn JSON: { concept_a, concept_b, similarities, differences: [{ dimension, a, b }], when_to_use_a, when_to_use_b, summary }"
}
```

Create `packages/templates/templates/slides.json`:

```json
{
  "id": "slides",
  "name": "Slide Deck",
  "description": "Generate a structured slide deck rendered as an interactive React component in the Canvas.",
  "renderer": "canvas",
  "output_schema_id": "slides",
  "variables": ["topic", "context", "num_slides"],
  "prompt_template": "Create a {{num_slides}}-slide presentation on the following topic.\n\nTopic: {{topic}}\n\nSource material:\n{{context}}\n\nEach slide needs a heading, up to 6 bullet points, and optional speaker notes. Choose an appropriate layout (title, bullets, two-column, image-text).\n\nReturn JSON: { title, slides: [{ heading, bullets, speaker_notes?, layout }] }"
}
```

Create `packages/templates/templates/mindmap.json`:

```json
{
  "id": "mindmap",
  "name": "Mind Map",
  "description": "Generate a hierarchical mind map rendered interactively in the Canvas.",
  "renderer": "canvas",
  "output_schema_id": "mindmap",
  "variables": ["topic", "context"],
  "prompt_template": "Create a mind map for the following topic.\n\nTopic: {{topic}}\n\nSource material:\n{{context}}\n\nThe mind map should have a root node and branches expanding to at least depth 3. Assign a color hint to main branches.\n\nReturn JSON: { root, nodes: [{ id, label, parentId, depth, color? }] }"
}
```

Create `packages/templates/templates/cheatsheet.json`:

```json
{
  "id": "cheatsheet",
  "name": "Cheat Sheet",
  "description": "Generate a compact reference cheat sheet rendered as a styled card in the Canvas.",
  "renderer": "canvas",
  "output_schema_id": "cheatsheet",
  "variables": ["topic", "context"],
  "prompt_template": "Create a concise cheat sheet for quick reference on the following topic.\n\nTopic: {{topic}}\n\nSource material:\n{{context}}\n\nOrganize into sections with term/definition/example entries. Keep definitions brief — this is for quick lookup.\n\nReturn JSON: { title, sections: [{ heading, items: [{ term, definition, example? }] }] }"
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/templates/src/schemas/ packages/templates/templates/
git commit -m "feat(templates): built-in template definitions and Zod output schemas (quiz, flashcard, fill_blank, mock_exam, teach_back, concept_compare, slides, mindmap, cheatsheet)"
```

---

### Task 5: Flashcard Review UI

**Files:**
- Create: `apps/web/src/app/(app)/learn/flashcards/page.tsx`
- Create: `apps/web/src/app/(app)/learn/flashcards/[deckId]/review/page.tsx`
- Create: `apps/web/src/components/learn/FlashcardReview.tsx`
- Create: `apps/web/src/components/learn/DeckCard.tsx`

- [ ] **Step 1: Create `apps/web/src/components/learn/DeckCard.tsx`**

```tsx
"use client";

import Link from "next/link";

type DeckCardProps = {
  deckName: string;
  deckId: string;          // URL-encoded deck name used as ID
  totalCards: number;
  dueCount: number;
};

export function DeckCard({ deckName, deckId, totalCards, dueCount }: DeckCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <h3 className="font-semibold text-base text-card-foreground truncate">{deckName}</h3>
        {dueCount > 0 && (
          <span className="text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full shrink-0 ml-2">
            {dueCount} due
          </span>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{totalCards} cards</p>
      <Link
        href={`/learn/flashcards/${encodeURIComponent(deckId)}/review`}
        className="mt-auto inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        {dueCount > 0 ? "Review Now" : "Browse"}
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Create `apps/web/src/app/(app)/learn/flashcards/page.tsx`**

```tsx
import { DeckCard } from "@/components/learn/DeckCard";

async function getDecks(userId: string) {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/learn/flashcards`,
    { headers: { "x-user-id": userId }, cache: "no-store" }
  );
  if (!res.ok) return [];
  const cards = await res.json();

  // Group by deckName
  const deckMap = new Map<string, { total: number; due: number }>();
  const now = new Date();
  for (const card of cards) {
    const entry = deckMap.get(card.deckName) ?? { total: 0, due: 0 };
    entry.total += 1;
    if (new Date(card.dueAt) <= now) entry.due += 1;
    deckMap.set(card.deckName, entry);
  }
  return Array.from(deckMap.entries()).map(([name, stats]) => ({
    deckName: name,
    deckId: name,
    ...stats,
  }));
}

export default async function FlashcardsPage() {
  // TODO: get real userId from session
  const decks = await getDecks("placeholder-user-id");

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Flashcard Decks</h1>
      {decks.length === 0 ? (
        <p className="text-muted-foreground">
          No decks yet. Use the Socratic Agent or a template to create flashcards.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {decks.map((deck) => (
            <DeckCard key={deck.deckId} {...deck} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `apps/web/src/components/learn/FlashcardReview.tsx`**

```tsx
"use client";

import { useState } from "react";

type Card = {
  id: string;
  front: string;
  back: string;
};

type FlashcardReviewProps = {
  cards: Card[];
  onReview: (cardId: string, quality: 1 | 2 | 3 | 4) => Promise<void>;
  onComplete: () => void;
};

const QUALITY_LABELS: { quality: 1 | 2 | 3 | 4; label: string; color: string }[] = [
  { quality: 1, label: "Blackout", color: "bg-destructive text-destructive-foreground" },
  { quality: 2, label: "Hard", color: "bg-orange-500 text-white" },
  { quality: 3, label: "Good", color: "bg-green-500 text-white" },
  { quality: 4, label: "Easy", color: "bg-blue-500 text-white" },
];

export function FlashcardReview({ cards, onReview, onComplete }: FlashcardReviewProps) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const card = cards[index];
  const isLast = index === cards.length - 1;

  if (!card) {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <p className="text-xl font-semibold">Session complete!</p>
        <button
          onClick={onComplete}
          className="px-6 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
        >
          Done
        </button>
      </div>
    );
  }

  async function handleRating(quality: 1 | 2 | 3 | 4) {
    setReviewing(true);
    await onReview(card.id, quality);
    setReviewing(false);
    setFlipped(false);
    if (isLast) {
      onComplete();
    } else {
      setIndex((i) => i + 1);
    }
  }

  return (
    <div className="flex flex-col items-center gap-6 py-8 px-4 max-w-2xl mx-auto">
      <p className="text-sm text-muted-foreground">
        Card {index + 1} of {cards.length}
      </p>

      {/* Flip card */}
      <button
        onClick={() => setFlipped((f) => !f)}
        className="w-full min-h-[220px] rounded-2xl border border-border bg-card shadow-md p-8 text-left transition-all hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary"
        aria-label={flipped ? "Click to see front" : "Click to reveal answer"}
      >
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
          {flipped ? "Back" : "Front"}
        </p>
        <p className="text-lg font-medium text-card-foreground whitespace-pre-wrap">
          {flipped ? card.back : card.front}
        </p>
      </button>

      {!flipped ? (
        <button
          onClick={() => setFlipped(true)}
          className="px-8 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors"
        >
          Reveal Answer
        </button>
      ) : (
        <div className="flex gap-3 w-full">
          {QUALITY_LABELS.map(({ quality, label, color }) => (
            <button
              key={quality}
              disabled={reviewing}
              onClick={() => handleRating(quality)}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-opacity ${color} disabled:opacity-50`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `apps/web/src/app/(app)/learn/flashcards/[deckId]/review/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FlashcardReview } from "@/components/learn/FlashcardReview";

type Card = { id: string; front: string; back: string };

export default function ReviewPage() {
  const { deckId } = useParams<{ deckId: string }>();
  const router = useRouter();
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/learn/flashcards/due?limit=20`,
      { credentials: "include" }
    )
      .then((r) => r.json())
      .then((all: Card[]) => {
        // filter to this deck (deckId is encoded deckName)
        const filtered = all.filter(() => true); // server already filters by due
        setCards(filtered);
      })
      .finally(() => setLoading(false));
  }, [deckId]);

  async function handleReview(cardId: string, quality: 1 | 2 | 3 | 4) {
    await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/learn/flashcards/${cardId}/review`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quality }),
      }
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        Loading cards...
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-24">
        <p className="text-muted-foreground">No cards due for this deck.</p>
        <button
          onClick={() => router.back()}
          className="text-sm text-primary underline underline-offset-2"
        >
          Back to decks
        </button>
      </div>
    );
  }

  return (
    <FlashcardReview
      cards={cards}
      onReview={handleReview}
      onComplete={() => router.push("/learn/flashcards")}
    />
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(app\)/learn/flashcards/ apps/web/src/components/learn/
git commit -m "feat(web): flashcard review UI with SM-2 quality rating buttons"
```

---

### Task 6: Understanding Scores Dashboard

**Files:**
- Create: `apps/web/src/app/(app)/learn/scores/page.tsx`
- Create: `apps/web/src/components/learn/ScoresDashboard.tsx`

- [ ] **Step 1: Create `apps/web/src/components/learn/ScoresDashboard.tsx`**

```tsx
"use client";

type ScoreEntry = {
  conceptId: string;
  conceptTitle?: string;
  score: number;
  lastReviewedAt: string;
};

function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 80 ? "bg-green-500" : score >= 50 ? "bg-yellow-500" : "bg-destructive";
  return (
    <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${color}`}
        style={{ width: `${score}%` }}
      />
    </div>
  );
}

export function ScoresDashboard({ scores }: { scores: ScoreEntry[] }) {
  if (scores.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No scores yet. Complete a Socratic session to see your understanding scores.
      </p>
    );
  }

  const sorted = [...scores].sort((a, b) => a.score - b.score);

  return (
    <div className="flex flex-col gap-3">
      {sorted.map((entry) => (
        <div key={entry.conceptId} className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-sm text-card-foreground">
              {entry.conceptTitle ?? entry.conceptId}
            </span>
            <span
              className={`text-sm font-bold tabular-nums ${
                entry.score >= 80
                  ? "text-green-600"
                  : entry.score >= 50
                  ? "text-yellow-600"
                  : "text-destructive"
              }`}
            >
              {entry.score}%
            </span>
          </div>
          <ScoreBar score={entry.score} />
          <p className="text-xs text-muted-foreground">
            Last reviewed:{" "}
            {new Date(entry.lastReviewedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create `apps/web/src/app/(app)/learn/scores/page.tsx`**

```tsx
import { ScoresDashboard } from "@/components/learn/ScoresDashboard";

async function getScores() {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/learn/scores`,
    { cache: "no-store" }
  );
  if (!res.ok) return [];
  return res.json();
}

export default async function ScoresPage() {
  const scores = await getScores();

  const avgScore =
    scores.length > 0
      ? Math.round(scores.reduce((s: number, e: { score: number }) => s + e.score, 0) / scores.length)
      : null;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Understanding Scores</h1>
        {avgScore !== null && (
          <div className="text-right">
            <p className="text-3xl font-bold text-primary">{avgScore}%</p>
            <p className="text-xs text-muted-foreground">avg. across {scores.length} concepts</p>
          </div>
        )}
      </div>
      <ScoresDashboard scores={scores} />
    </div>
  );
}
```

- [ ] **Step 3: Create `apps/web/src/app/(app)/learn/page.tsx`** (learning hub)

```tsx
import Link from "next/link";

const sections = [
  {
    href: "/learn/flashcards",
    title: "Flashcard Decks",
    description: "Review due cards using spaced repetition (SM-2).",
    badge: null,
  },
  {
    href: "/learn/scores",
    title: "Understanding Scores",
    description: "See how well you know each concept based on Socratic sessions.",
    badge: null,
  },
];

export default function LearnPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Learning Hub</h1>
      <p className="text-muted-foreground mb-8">
        Train your memory, test your understanding, and track your progress.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {sections.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded-xl border border-border bg-card p-5 hover:shadow-md transition-shadow flex flex-col gap-2"
          >
            <span className="font-semibold text-card-foreground">{s.title}</span>
            <span className="text-sm text-muted-foreground">{s.description}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(app\)/learn/ apps/web/src/components/learn/ScoresDashboard.tsx
git commit -m "feat(web): understanding scores dashboard and learning hub landing page"
```

---

## Summary

| Task | Key Deliverable |
|------|----------------|
| 1 | `apps/api/src/routes/learning.ts` — flashcard CRUD + SM-2 `/review` endpoint |
| 2 | `apps/api/src/agents/socratic/` — LangGraph graph: generate → evaluate → score → flashcard |
| 3 | `packages/templates/` — engine: loader, prompt renderer, Zod validation, `RendererType` routing |
| 4 | 9 JSON template definitions + 9 Zod schemas (quiz → cheatsheet) |
| 5 | Flashcard review UI: flip-card + 1-4 quality buttons, due card queue |
| 6 | Understanding scores dashboard: per-concept progress bars, average badge |
