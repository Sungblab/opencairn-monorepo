import type { ZodTypeAny } from "zod";
import { quizSchema } from "./quiz.js";
import { flashcardSchema } from "./flashcard.js";
import { fillBlankSchema } from "./fill-blank.js";
import { mockExamSchema } from "./mock-exam.js";
import { teachBackSchema } from "./teach-back.js";
import { conceptCompareSchema } from "./concept-compare.js";
import { slidesSchema } from "./slides.js";
import { mindmapSchema } from "./mindmap.js";
import { cheatsheetSchema } from "./cheatsheet.js";

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
