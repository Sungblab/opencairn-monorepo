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
  minCitedProjects?: number;
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
        minCitedProjects: testCase.minCitedProjects,
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

  it("preserves project and graph provenance metadata for verifier paths", () => {
    const ledger = buildChatSourceLedger([
      {
        noteId: "note-graph",
        noteChunkId: "chunk-graph",
        projectId: "project-graph",
        title: "Graph relationship",
        quote: "Graph evidence links alpha to beta through an inferred edge.",
        producer: "graph",
        provenance: {
          kind: "inferred",
          support: "mentions",
          evidenceId: "edge-alpha-beta",
        },
      },
    ]);

    expect(ledger.entries[0]).toMatchObject({
      projectId: "project-graph",
      producer: "graph",
      provenance: "inferred",
      support: "mentions",
      evidenceId: "edge-alpha-beta",
    });
  });
});

describe("answer verifier project diversity", () => {
  const ledger = buildChatSourceLedger([
    {
      noteId: "note-alpha",
      noteChunkId: "chunk-alpha",
      projectId: "project-alpha",
      title: "Alpha project",
      quote: "Alpha project evidence says workspace fanout should cite alpha rollout details.",
    },
    {
      noteId: "note-beta",
      noteChunkId: "chunk-beta",
      projectId: "project-beta",
      title: "Beta project",
      quote: "Beta project evidence says workspace fanout should cite beta adoption risks.",
    },
  ]);

  it("warns when a workspace fanout answer cites only one project", () => {
    const result = verifyGroundedAnswer({
      answer:
        "Workspace fanout should cite alpha rollout details [S1]. Alpha project evidence covers rollout details [S1].",
      ledger,
      minCitedProjects: 2,
    });

    expect(result.verdict).toBe("warn");
    expect(result.findings).toContainEqual({
      sentence: "cited project coverage",
      reason: "insufficient_project_coverage",
      labels: ["S1"],
    });
  });

  it("passes when a workspace fanout answer cites evidence from multiple projects", () => {
    const result = verifyGroundedAnswer({
      answer:
        "Workspace fanout should cite alpha rollout details [S1]. Workspace fanout should also cite beta adoption risks [S2].",
      ledger,
      minCitedProjects: 2,
    });

    expect(result.verdict).toBe("pass");
    expect(result.citedProjects).toEqual(["project-alpha", "project-beta"]);
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
