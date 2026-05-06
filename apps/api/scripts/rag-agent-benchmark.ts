import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

type PermissionManifest = {
  manifestVersion: string;
  notes: Array<{ id: string; projectId: string; readers: string[] }>;
  cases: Array<{
    id: string;
    actingUserId: string;
    query: string;
    temptingRawCandidateNoteIds: string[];
    retrievalCandidates: Array<{ id: string; noteId: string; projectId: string }>;
    citations: Array<{ id: string; noteId: string; projectId: string }>;
  }>;
};

type CitationManifest = {
  manifestVersion: string;
  evaluationCriteria: Record<string, string>;
  fixtures: Array<{
    id: string;
    question: string;
    expectedEvidenceIds: string[];
    allowedCitationIds: string[];
    unsupportedClaimExamples: string[];
  }>;
};

type AgenticManifest = {
  manifestVersion: string;
  metrics: string[];
  fixtures: Array<{
    id: string;
    targetKind: string;
    executionScope: "actual_first_slice" | "follow_up_skeleton";
    plan: { steps: Array<{ id: string; kind: string; status: string }> };
    actions: Array<{
      id: string;
      kind: string;
      risk: string;
      approvalRequired: boolean;
      status: string;
      actorUserId?: string;
      input?: unknown;
      preview?: unknown;
      result?: unknown;
      errorCode?: string | null;
    }>;
    followUps: string[];
  }>;
};

type JsonlRow = {
  area: "permission_aware_rag" | "citation_grounding" | "agentic_workflow" | "summary";
  caseId: string;
  manifestVersion?: string;
  metrics?: Record<string, number | string | boolean>;
  failures?: string[];
  followUps?: string[];
  notes?: string[];
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const benchmarkRoot = resolve(repoRoot, "apps/api/benchmarks/rag-agent");
const resultRoot = resolve(repoRoot, "apps/api/benchmarks/results");
const jsonlOut = resolve(resultRoot, "rag-agent-first-baseline-2026-05-06.jsonl");
const markdownOut = resolve(resultRoot, "rag-agent-first-baseline-2026-05-06.md");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "unavailable";
  }
}

function scorePermission(manifest: PermissionManifest): JsonlRow[] {
  const noteReaders = new Map(manifest.notes.map((note) => [note.id, note.readers]));
  return manifest.cases.map((fixture) => {
    const failures: string[] = [];
    const isReadable = (noteId: string): boolean =>
      noteReaders.get(noteId)?.includes(fixture.actingUserId) ?? false;

    for (const candidate of fixture.retrievalCandidates) {
      if (!isReadable(candidate.noteId)) {
        failures.push(`candidate:${candidate.id}:unreadable_note:${candidate.noteId}`);
      }
    }
    for (const citation of fixture.citations) {
      if (!isReadable(citation.noteId)) {
        failures.push(`citation:${citation.id}:unreadable_note:${citation.noteId}`);
      }
    }

    const blockedTemptingSources = fixture.temptingRawCandidateNoteIds.filter(
      (noteId) => !isReadable(noteId),
    ).length;

    return {
      area: "permission_aware_rag",
      caseId: fixture.id,
      manifestVersion: manifest.manifestVersion,
      metrics: {
        retrieval_candidate_count: fixture.retrievalCandidates.length,
        citation_count: fixture.citations.length,
        blocked_tempting_source_count: blockedTemptingSources,
        permission_leakage_count: failures.length,
        permission_leakage_pass: failures.length === 0,
      },
      failures,
    };
  });
}

function scoreCitationSkeleton(manifest: CitationManifest): JsonlRow[] {
  return manifest.fixtures.map((fixture) => {
    const failures: string[] = [];
    if (fixture.expectedEvidenceIds.length === 0) failures.push("missing_expected_evidence");
    if (fixture.allowedCitationIds.length === 0) failures.push("missing_allowed_citation");
    if (fixture.unsupportedClaimExamples.length === 0) {
      failures.push("missing_unsupported_claim_example");
    }
    return {
      area: "citation_grounding",
      caseId: fixture.id,
      manifestVersion: manifest.manifestVersion,
      metrics: {
        expected_evidence_count: fixture.expectedEvidenceIds.length,
        allowed_citation_count: fixture.allowedCitationIds.length,
        unsupported_claim_example_count: fixture.unsupportedClaimExamples.length,
        llm_judge_enabled: false,
        manifest_shape_pass: failures.length === 0,
      },
      failures,
      notes: ["LLM judge is intentionally not attached in this first slice."],
    };
  });
}

function scoreAgenticSkeleton(manifest: AgenticManifest): JsonlRow[] {
  return manifest.fixtures.map((fixture) => {
    const failures: string[] = [];
    const planValid =
      fixture.plan.steps.length > 0 &&
      fixture.plan.steps.every((step) => step.id && step.kind && step.status);
    if (!planValid) failures.push("invalid_plan_shape");

    let approvalBoundaryPasses = 0;
    let approvalBoundaryChecks = 0;
    let auditComplete = 0;

    for (const action of fixture.actions) {
      const risky = ["write", "destructive", "external", "expensive"].includes(action.risk);
      if (risky) {
        approvalBoundaryChecks += 1;
        if (action.approvalRequired) approvalBoundaryPasses += 1;
        else failures.push(`missing_approval_boundary:${action.id}`);
      }

      const hasTerminalPayload =
        action.status === "failed"
          ? Boolean(action.errorCode)
          : action.status === "completed"
            ? action.result !== undefined && action.result !== null
            : true;
      const complete =
        Boolean(action.input) &&
        Boolean(action.preview) &&
        Boolean(action.status) &&
        Boolean(action.actorUserId) &&
        hasTerminalPayload;
      if (complete) auditComplete += 1;
      else failures.push(`incomplete_action_audit:${action.id}`);
    }

    const approvalRate =
      approvalBoundaryChecks === 0 ? 1 : approvalBoundaryPasses / approvalBoundaryChecks;
    const auditRate = fixture.actions.length === 0 ? 0 : auditComplete / fixture.actions.length;

    return {
      area: "agentic_workflow",
      caseId: fixture.id,
      manifestVersion: manifest.manifestVersion,
      metrics: {
        plan_validity_rate: planValid ? 1 : 0,
        approval_boundary_pass_rate: approvalRate,
        action_audit_completeness: auditRate,
        actual_verification_target: fixture.executionScope === "actual_first_slice",
      },
      failures,
      followUps: fixture.followUps,
    };
  });
}

function metricRows(rows: JsonlRow[], area: JsonlRow["area"]): JsonlRow[] {
  return rows.filter((row) => row.area === area);
}

function average(rows: JsonlRow[], metric: string): number {
  const values = rows
    .map((row) => row.metrics?.[metric])
    .filter((value): value is number => typeof value === "number");
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function main(): void {
  mkdirSync(resultRoot, { recursive: true });

  const permission = readJson<PermissionManifest>(
    resolve(benchmarkRoot, "permission-aware-rag.json"),
  );
  const citation = readJson<CitationManifest>(
    resolve(benchmarkRoot, "citation-grounding-fixtures.json"),
  );
  const agentic = readJson<AgenticManifest>(
    resolve(benchmarkRoot, "agentic-workflow-fixtures.json"),
  );

  const rows = [
    ...scorePermission(permission),
    ...scoreCitationSkeleton(citation),
    ...scoreAgenticSkeleton(agentic),
  ];
  const permissionRows = metricRows(rows, "permission_aware_rag");
  const citationRows = metricRows(rows, "citation_grounding");
  const agentRows = metricRows(rows, "agentic_workflow");
  const actualAgentRows = agentRows.filter(
    (row) => row.metrics?.actual_verification_target === true,
  );
  const permissionLeakageCount = permissionRows.reduce(
    (sum, row) => sum + Number(row.metrics?.permission_leakage_count ?? 0),
    0,
  );
  const summaryRow: JsonlRow = {
    area: "summary",
    caseId: "rag-agent-first-baseline-2026-05-06",
    metrics: {
      permission_case_count: permissionRows.length,
      permission_leakage_count: permissionLeakageCount,
      citation_fixture_count: citationRows.length,
      citation_llm_judge_enabled: false,
      agentic_fixture_count: agentRows.length,
      agentic_actual_fixture_count: actualAgentRows.length,
      agentic_follow_up_fixture_count: agentRows.length - actualAgentRows.length,
      plan_validity_rate: average(actualAgentRows, "plan_validity_rate"),
      approval_boundary_pass_rate: average(actualAgentRows, "approval_boundary_pass_rate"),
      action_audit_completeness: average(actualAgentRows, "action_audit_completeness"),
    },
    failures: rows.flatMap((row) => row.failures ?? []),
    followUps: [
      "Replace deterministic permission traces with DB-backed retrieval seeding.",
      "Attach a citation grounding scorer and optional LLM judge after manual labels stabilize.",
      "Add executable code_project.run fixtures with captured recovery behavior.",
      "Add mutable-note freshness fixtures that exercise Yjs reindexing end to end.",
    ],
  };
  rows.push(summaryRow);

  writeFileSync(jsonlOut, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);

  const sha = git(["rev-parse", "HEAD"]);
  const markdown = `# RAG And Agent First Baseline

Date: 2026-05-06

Runner input HEAD: \`${sha}\`

This SHA is captured before the runner rewrites the report artifact. The final
PR or merge commit can differ from this value.

Command:

\`\`\`powershell
pnpm --filter @opencairn/api benchmark:rag-agent
\`\`\`

Raw JSONL: \`apps/api/benchmarks/results/rag-agent-first-baseline-2026-05-06.jsonl\`

## Summary

| Area | Cases | Key result |
| --- | ---: | --- |
| Permission-aware RAG | ${permissionRows.length} | \`permission_leakage_count = ${permissionLeakageCount}\` |
| Citation grounding skeleton | ${citationRows.length} | Manual fixture manifest only; LLM judge disabled |
| Agentic workflow actual slice | ${actualAgentRows.length} | \`note.update\` is the first actual verification target |
| Agentic workflow follow-up skeleton | ${agentRows.length - actualAgentRows.length} | Excluded from actual metric averages |

## Metrics

| Metric | Value |
| --- | ---: |
| \`permission_leakage_count\` | ${permissionLeakageCount} |
| \`agentic_actual_fixture_count\` | ${actualAgentRows.length} |
| \`agentic_follow_up_fixture_count\` | ${agentRows.length - actualAgentRows.length} |
| \`plan_validity_rate\` | ${average(actualAgentRows, "plan_validity_rate").toFixed(2)} |
| \`approval_boundary_pass_rate\` | ${average(actualAgentRows, "approval_boundary_pass_rate").toFixed(2)} |
| \`action_audit_completeness\` | ${average(actualAgentRows, "action_audit_completeness").toFixed(2)} |

## Failure Examples And Limits

- No permission leakage failures were observed in the deterministic post-filter traces.
- Example permission failure this fixture is designed to catch: \`note-alice-private-budget\` appearing in Bob's retrieval candidates or citations would increment \`permission_leakage_count\`.
- Example grounding failure reserved for the citation skeleton: "Unreadable notes may be cited if their title is visible" is an unsupported claim for \`rag-permission-filter-before-citations\`.
- Example agentic workflow failure reserved for follow-up: \`code_project.run\` without approval or captured stdout/stderr would fail the approval and audit checks once executable fixtures are added.
- Citation grounding is only a labeled manifest. It documents expected evidence, allowed citations, and unsupported claim examples, but does not score generated model output yet.
- Agentic workflow scoring covers manifest shape and action audit structure. Only \`note.update\` is marked as the actual first-slice target; \`code_project.run\` is a follow-up skeleton.
- This run does not use DB seeding, provider calls, production ingest, parser dependency changes, or migrations.

## Follow-up

- Add DB-backed permission fixture seeding around the real retrieval path.
- Add manual answer outputs and a deterministic citation grounding scorer before attaching an LLM judge.
- Add executable \`code_project.run\` success/failure fixtures and recovery scoring.
- Add mutable-note freshness fixtures that exercise Yjs-backed reindexing.
`;
  mkdirSync(dirname(markdownOut), { recursive: true });
  writeFileSync(markdownOut, markdown);
  console.log(`Wrote ${rows.length} rows to ${jsonlOut}`);
  console.log(`Wrote summary to ${markdownOut}`);
  if ((summaryRow.failures?.length ?? 0) > 0) {
    process.exitCode = 1;
  }
}

main();
