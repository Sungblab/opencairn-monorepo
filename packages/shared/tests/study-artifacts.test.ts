import { describe, expect, it } from "vitest";
import { createAgentActionRequestSchema } from "../src/agent-actions";
import {
  buildStudyArtifactRepairInput,
  studyArtifactSchema,
  studyArtifactTypeSchema,
  studyArtifactToJsonAgentFile,
  studyArtifactToJsonFileCreateAction,
  validateStudyArtifact,
} from "../src/study-artifacts";

const common = {
  title: "중간고사 대비 퀴즈",
  sourceIds: ["note-1"],
  difficulty: "mixed",
  tags: ["운영체제"],
  createdByRunId: "chat:run-1",
  renderTargets: ["interactive_view", "note", "json_file"],
} as const;

describe("study artifact contracts", () => {
  it("accepts grounded quiz sets with item-level source refs", () => {
    const parsed = studyArtifactSchema.parse({
      type: "quiz_set",
      ...common,
      questions: [
        {
          id: "q1",
          kind: "multiple_choice",
          prompt: "페이지 교체가 필요한 상황은?",
          choices: [
            { id: "a", text: "빈 프레임이 없을 때" },
            { id: "b", text: "프로세스가 종료될 때" },
          ],
          answer: { choiceIds: ["a"] },
          explanation:
            "빈 프레임이 없으면 교체 알고리즘이 희생 페이지를 고릅니다.",
          sourceRefs: [
            {
              sourceId: "note-1",
              label: "운영체제 노트",
              quote: "페이지 폴트와 프레임 할당",
            },
          ],
        },
      ],
    });

    expect(parsed.type).toBe("quiz_set");
    expect(parsed.questions[0]?.sourceRefs[0]?.sourceId).toBe("note-1");
    expect(studyArtifactToJsonAgentFile(parsed)).toMatchObject({
      filename: "quiz-set.json",
      kind: "json",
      mimeType: "application/json",
      title: "중간고사 대비 퀴즈",
    });
  });

  it("exposes every first-pass structured study artifact type", () => {
    expect(studyArtifactTypeSchema.options).toEqual([
      "quiz_set",
      "mock_exam",
      "flashcard_deck",
      "fill_blank_set",
      "exam_prep_pack",
      "compare_table",
      "glossary",
      "cheat_sheet",
      "interactive_html",
      "data_table",
    ]);
  });

  it("rejects duplicate item ids and builds repair input with validation errors", () => {
    const invalid = {
      type: "quiz_set",
      ...common,
      questions: [
        {
          id: "q1",
          kind: "short_answer",
          prompt: "스레싱이란?",
          answer: { text: "과도한 페이지 교체" },
          sourceRefs: [{ sourceId: "note-1" }],
        },
        {
          id: "q1",
          kind: "short_answer",
          prompt: "스레싱의 원인은?",
          answer: { text: "작업 집합보다 작은 프레임" },
          sourceRefs: [{ sourceId: "note-1" }],
        },
      ],
    };

    const result = validateStudyArtifact(invalid);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: "duplicate_item_id",
          path: ["questions", 1, "id"],
        }),
      );
      expect(
        buildStudyArtifactRepairInput(invalid, result.issues),
      ).toMatchObject({
        validationErrors: [
          expect.objectContaining({
            code: "duplicate_item_id",
            path: "questions.1.id",
          }),
        ],
      });
    }
  });

  it("converts study artifacts to schema-valid json file create actions", () => {
    const artifact = studyArtifactSchema.parse({
      type: "quiz_set",
      ...common,
      questions: [
        {
          id: "q1",
          kind: "short_answer",
          prompt: "스레싱이란?",
          answer: { text: "과도한 페이지 교체" },
          sourceRefs: [{ sourceId: "note-1" }],
        },
      ],
    });

    const action = studyArtifactToJsonFileCreateAction(artifact, {
      requestId: "00000000-0000-4000-8000-000000000301",
    });
    const parsed = createAgentActionRequestSchema.parse(action);

    expect(parsed).toMatchObject({
      requestId: "00000000-0000-4000-8000-000000000301",
      sourceRunId: "chat:run-1",
      kind: "file.create",
      risk: "write",
      approvalMode: "auto_safe",
      input: {
        filename: "quiz-set.json",
        kind: "json",
        mimeType: "application/json",
        title: "중간고사 대비 퀴즈",
        startIngest: false,
      },
      preview: {
        studyArtifact: {
          type: "quiz_set",
          title: "중간고사 대비 퀴즈",
          sourceIds: ["note-1"],
          renderTargets: ["interactive_view", "note", "json_file"],
        },
      },
    });
  });
});
