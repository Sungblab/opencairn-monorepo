# 010. Document Generation IDE Flow

## Status

Accepted, initial implementation in progress.

## Context

OpenCairn already has several document-output foundations: collaborative notes,
Canvas notes for code and HTML, agent-generated files in the project tree,
Synthesis Export for `latex` / `docx` / `pdf` / `md`, Tectonic-backed LaTeX
compilation, Office ingest, and optional connector infrastructure.

Those pieces should not become parallel product concepts. Users should not need
to decide whether an output is a Canvas note, agent file, synthesis document, or
chat attachment. The product model is a project explorer where AI can create,
edit, preview, version, download, ingest, and optionally export project outputs.

## Decision

OpenCairn treats generated documents and files as project objects first.

- `md`, `html`, `code`, `tex`, `json`, and `csv` should receive in-app
  editor-grade surfaces: source editor, preview, versioning, and agent edits.
- `docx`, `pptx`, `xlsx`, `pdf`, and images should receive generation,
  preview, download, versioning, and export surfaces first.
- Advanced native editing for Office-style files should be delegated to
  provider integrations such as Google Docs, Sheets, and Slides rather than
  rebuilding a full office suite inside OpenCairn.
- File creation from chat or agents should move from fenced JSON conventions
  toward typed project-object actions such as `create_project_object`,
  `update_project_object_content`, `export_project_object`, and
  `save_to_provider`.
- Google login and Google Workspace access are separate grants. Self-hosted
  OpenCairn must work without Google credentials; Google Drive / Docs / Sheets /
  Slides export is an optional provider layer.

## Implementation Notes

The existing `agent_files` table remains the current stored-file surface while
the broader project-object model is refined. New work should extend the existing
agent-file, Canvas, synthesis-export, and connector surfaces instead of adding
chat-only artifacts.

Initial file-generation targets:

- `md`
- `docx`
- `pdf`
- `pptx`
- `xlsx`
- `csv`
- `json`
- `html`
- `tex`

Preview work should be chunked by format to avoid loading large document
libraries until the user opens that file type.

## Consequences

This keeps the OSS self-hosting path clean: generation and storage remain inside
OpenCairn, backed by local object storage such as MinIO. Hosted deployments can
add Google export without making Google a core dependency.

The tradeoff is that OpenCairn will not initially provide full native
DOCX/PPTX/XLSX editing. It will instead prioritize reliable generation,
inspection, versioning, export, and provider handoff.
