import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildChatSourceLedger,
  formatChatSourceLedgerForPrompt,
  type ChatSourceLedgerInput,
} from "../../src/lib/chat-source-ledger.js";
import {
  verifyGroundedAnswer,
  type AnswerVerifierVerdict,
  type AnswerVerificationFinding,
} from "../../src/lib/answer-verifier.js";

type GroundedChatCase = {
  id: string;
  sources: ChatSourceLedgerInput[];
  answer: string;
  expectedVerdict: AnswerVerifierVerdict;
  expectedReasons?: AnswerVerificationFinding["reason"][];
};

function loadCases(): GroundedChatCase[] {
  const path = resolve(__dirname, "../fixtures/grounded-chat-cases.jsonl");
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as GroundedChatCase);
}

describe("grounded chat verifier eval cases", () => {
  for (const testCase of loadCases()) {
    it(`${testCase.id} -> ${testCase.expectedVerdict}`, () => {
      const ledger = buildChatSourceLedger(testCase.sources);
      const result = verifyGroundedAnswer({
        answer: testCase.answer,
        ledger,
      });

      expect(result.verdict).toBe(testCase.expectedVerdict);
      if (testCase.expectedReasons) {
        expect(result.findings.map((finding) => finding.reason)).toEqual(
          expect.arrayContaining(testCase.expectedReasons),
        );
      }
    });
  }
});

describe("chat source ledger", () => {
  it("dedupes repeated chunks and assigns stable labels", () => {
    const ledger = buildChatSourceLedger([
      { noteChunkId: "chunk-a", noteId: "note-a", title: "One", quote: "A" },
      { noteChunkId: "chunk-a", noteId: "note-a", title: "One duplicate", quote: "B" },
      { noteId: "note-b", title: "Two", quote: "C", producer: "graph" },
    ]);

    expect(ledger.entries).toHaveLength(2);
    expect(ledger.entries.map((entry) => entry.label)).toEqual(["S1", "S2"]);
    expect(ledger.entries[1]).toMatchObject({
      sourceId: "note:note-b",
      producer: "graph",
    });
  });

  it("keeps sparse sources distinct when metadata is empty", () => {
    const ledger = buildChatSourceLedger([{}, {}]);

    expect(ledger.entries).toHaveLength(2);
    expect(ledger.entries.map((entry) => entry.sourceId)).toEqual([
      "source:0",
      "source:1",
    ]);
  });

  it("formats prompt sources with citation labels", () => {
    const ledger = buildChatSourceLedger([
      {
        noteId: "note-a",
        title: "Policy",
        headingPath: "Limits",
        quote: "Every factual sentence needs a source label.",
      },
    ]);

    expect(formatChatSourceLedgerForPrompt(ledger)).toBe(
      "[S1] Policy · Limits: Every factual sentence needs a source label.",
    );
  });
});

describe("answer verifier multilingual support", () => {
  it("counts single-character Korean evidence tokens", () => {
    const ledger = buildChatSourceLedger([
      {
        noteId: "note-ko",
        title: "한국어 메모",
        quote: "꿈 삶 산 강",
      },
    ]);

    const result = verifyGroundedAnswer({
      answer: "꿈 삶 산 강 내용입니다 [S1].",
      ledger,
      minOverlap: 0.5,
    });

    expect(result.verdict).toBe("pass");
  });
});

describe("answer verifier runtime citation formats", () => {
  it("accepts chat runtime numeric footnote citations", () => {
    const ledger = buildChatSourceLedger([
      {
        noteId: "note-runtime",
        noteChunkId: "chunk-runtime",
        title: "Runtime policy",
        quote: "Runtime verification uses retrieved source evidence.",
      },
    ]);

    const result = verifyGroundedAnswer({
      answer: "Runtime verification uses retrieved source evidence [^1].",
      ledger,
    });

    expect(result.verdict).toBe("pass");
    expect(result.citedLabels).toEqual(["S1"]);
  });
});
