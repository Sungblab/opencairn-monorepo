# Agentic Workflow Map

OpenCairn has several agent-facing surfaces, but new write-capable work should
route through shared actions, run projections, and review surfaces instead of
adding chat-only mutation paths.

```mermaid
flowchart TD
  User[User intent] --> Entry[Project command center, Agent Panel, source rail, upload intent]
  Entry --> Preflight[Preflight and clarification]
  Preflight --> Ledger[Unified agent action ledger]
  Ledger --> Review[Approval or review card]
  Review --> ApiApply[API permission-checked apply]
  Review --> WorkerRun[Temporal workflow when long-running]
  WorkerRun --> Callback[Internal callback and persisted result]
  ApiApply --> Result[Project object, note change, import/export status, or code run]
  Callback --> Result
  Result --> WorkflowConsole[Workflow Console projection]
  Result --> Viewer[Tab viewer or Agent Panel result card]
  Viewer --> Feedback[Task-level feedback and follow-up intent]
```

## Routing Rules

| Work type | Preferred substrate |
| --- | --- |
| Note create/update/delete/restore | Unified `agent_actions` note actions with review/apply when needed |
| Generated files and document artifacts | Project-object and agent-file paths, worker jobs for binary output |
| Import/export workflows | Existing import/export workflows projected into the action/run surfaces |
| Code workspace changes | Code project actions, approved run/install/preview substrates |
| Status UI | Workflow Console projection before adding another run/status panel |

This map summarizes the current product direction. The detailed contracts live
in `docs/architecture/agentic-workflow-roadmap.md`,
`docs/architecture/document-generation-ide-flow.md`, and the feature registry.
