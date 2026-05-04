import type { ChatSourceLedger, ChatSourceLedgerEntry } from "./chat-source-ledger";

export type AnswerVerifierVerdict = "pass" | "warn" | "fail";

export type AnswerVerificationFinding = {
  sentence: string;
  reason:
    | "missing_citation"
    | "unknown_citation"
    | "weak_support"
    | "empty_ledger"
    | "refusal_without_sources"
    | "insufficient_project_coverage";
  labels: string[];
};

export type AnswerVerificationResult = {
  verdict: AnswerVerifierVerdict;
  citedLabels: string[];
  citedProjects: string[];
  findings: AnswerVerificationFinding[];
  coverage: {
    materialSentences: number;
    citedMaterialSentences: number;
  };
};

export type VerifyGroundedAnswerInput = {
  answer: string;
  ledger: ChatSourceLedger;
  minOverlap?: number;
  minCitedProjects?: number;
};

const CITATION_RE = /\[(?:\^?\d+|S\d+)(?:\s*,\s*(?:\^?\d+|S\d+))*\]/g;
const RAW_LABEL_RE = /S\d+|\^?\d+/g;
const REFUSAL_RE =
  /(근거가 부족|답변할 수 없|확인할 수 없|no answer|not enough|insufficient|cannot verify)/i;

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ");
}

function tokens(value: string): Set<string> {
  return new Set(
    normalize(value)
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 1),
  );
}

function sentenceFragments(answer: string): string[] {
  return answer
    .replace(/\[(S\d+(?:\s*,\s*S\d+)*)\]/g, "[$1] ")
    .split(/(?<=[.!?。！？])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function citationLabels(sentence: string): string[] {
  const labels = new Set<string>();
  for (const group of sentence.matchAll(CITATION_RE)) {
    for (const label of group[0].matchAll(RAW_LABEL_RE)) {
      labels.add(normalizeLabel(label[0]));
    }
  }
  return [...labels];
}

function stripCitations(sentence: string): string {
  return sentence.replace(CITATION_RE, "").trim();
}

function isMaterialSentence(sentence: string): boolean {
  const text = stripCitations(sentence);
  if (text.length < 12) return false;
  if (/^(요약|summary|결론|therefore)\s*[:：]?$/i.test(text)) return false;
  return true;
}

function sourceTokens(
  entry: ChatSourceLedgerEntry,
  cache: Map<string, Set<string>>,
): Set<string> {
  const cached = cache.get(entry.sourceId);
  if (cached) return cached;
  const computed = tokens(`${entry.title} ${entry.headingPath ?? ""} ${entry.quote}`);
  cache.set(entry.sourceId, computed);
  return computed;
}

function overlapRatio(
  sentenceTokens: Set<string>,
  entry: ChatSourceLedgerEntry,
  cache: Map<string, Set<string>>,
): number {
  if (sentenceTokens.size === 0) return 0;
  const entryTokens = sourceTokens(entry, cache);
  let overlap = 0;
  for (const token of sentenceTokens) {
    if (entryTokens.has(token)) overlap += 1;
  }
  return overlap / sentenceTokens.size;
}

function uniqueLabels(answer: string): string[] {
  const labels = new Set<string>();
  for (const group of answer.matchAll(CITATION_RE)) {
    for (const label of group[0].matchAll(RAW_LABEL_RE)) {
      labels.add(normalizeLabel(label[0]));
    }
  }
  return [...labels];
}

function normalizeLabel(label: string): string {
  if (label.startsWith("S")) return label;
  return `S${label.replace(/^\^/, "")}`;
}

export function verifyGroundedAnswer(
  input: VerifyGroundedAnswerInput,
): AnswerVerificationResult {
  const minOverlap = input.minOverlap ?? 0.18;
  const citedLabels = uniqueLabels(input.answer);
  const citedProjects = citedProjectIds(citedLabels, input.ledger);
  const findings: AnswerVerificationFinding[] = [];
  const materialSentences = sentenceFragments(input.answer).filter(isMaterialSentence);
  const sourceTokenCache = new Map<string, Set<string>>();

  if (input.ledger.entries.length === 0) {
    if (REFUSAL_RE.test(input.answer)) {
      return {
        verdict: "pass",
        citedLabels,
        citedProjects,
        findings: [],
        coverage: {
          materialSentences: materialSentences.length,
          citedMaterialSentences: 0,
        },
      };
    }
    return {
      verdict: "fail",
      citedLabels,
      citedProjects,
      findings: [
        {
          sentence: input.answer.trim(),
          reason: "empty_ledger",
          labels: [],
        },
      ],
      coverage: {
        materialSentences: materialSentences.length,
        citedMaterialSentences: 0,
      },
    };
  }

  let citedMaterialSentences = 0;
  for (const sentence of materialSentences) {
    const labels = citationLabels(sentence);
    if (labels.length === 0) {
      findings.push({ sentence, reason: "missing_citation", labels });
      continue;
    }
    citedMaterialSentences += 1;

    const entries = labels.map((label) => input.ledger.byLabel.get(label));
    const unknown = labels.filter((label, index) => entries[index] === undefined);
    if (unknown.length > 0) {
      findings.push({ sentence, reason: "unknown_citation", labels: unknown });
      continue;
    }

    const sentenceTokens = tokens(stripCitations(sentence));
    const bestOverlap = Math.max(
      ...entries
        .filter((entry): entry is ChatSourceLedgerEntry => entry !== undefined)
        .map((entry) => overlapRatio(sentenceTokens, entry, sourceTokenCache)),
    );
    if (bestOverlap < minOverlap) {
      findings.push({ sentence, reason: "weak_support", labels });
    }
  }

  const requiredProjectCount = requiredCitedProjectCount(
    input.minCitedProjects,
    input.ledger,
  );
  if (requiredProjectCount > 0 && citedProjects.length < requiredProjectCount) {
    findings.push({
      sentence: input.answer.trim(),
      reason: "insufficient_project_coverage",
      labels: citedLabels,
    });
  }

  const hasFailure = findings.some((finding) =>
    ["missing_citation", "unknown_citation", "empty_ledger"].includes(finding.reason),
  );
  const verdict: AnswerVerifierVerdict =
    findings.length === 0 ? "pass" : hasFailure ? "fail" : "warn";

  return {
    verdict,
    citedLabels,
    citedProjects,
    findings,
    coverage: {
      materialSentences: materialSentences.length,
      citedMaterialSentences,
    },
  };
}

function citedProjectIds(labels: string[], ledger: ChatSourceLedger): string[] {
  const projects = new Set<string>();
  for (const label of labels) {
    const projectId = ledger.byLabel.get(label)?.projectId;
    if (projectId) projects.add(projectId);
  }
  return [...projects];
}

function requiredCitedProjectCount(
  minCitedProjects: number | undefined,
  ledger: ChatSourceLedger,
): number {
  if (!minCitedProjects || minCitedProjects < 2) return 0;
  const availableProjects = new Set<string>();
  for (const entry of ledger.entries) {
    if (entry.projectId) availableProjects.add(entry.projectId);
  }
  return Math.min(minCitedProjects, availableProjects.size);
}
