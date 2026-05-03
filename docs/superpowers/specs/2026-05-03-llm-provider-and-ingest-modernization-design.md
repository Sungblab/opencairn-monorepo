# LLM Provider And Ingest Modernization

> Date: 2026-05-03
> Status: Draft umbrella spec
> Owner: Sungbin
> Author: Sungbin + Codex
> Scope: LLM provider expansion, document parser modernization, and retrieval routing

## 1. Goal

Modernize OpenCairn's AI substrate without disrupting the current product
surface.

The current stack is broadly sound:

- Gemini and Ollama behind `packages/llm`
- Hono API chat paths with Gemini streaming
- Python `runtime.Agent` workers on Temporal
- PostgreSQL, pgvector, full-text search, and concept graph data
- `opendataloader-pdf`, PyMuPDF, MarkItDown, trafilatura, faster-whisper, and
  provider multimodal fallbacks for ingest

The missing piece is not a full rewrite. The missing piece is a set of stable
interfaces that let OpenCairn plug into the wider LLM and document AI ecosystem
while preserving self-hosting, workspace permissions, and provider-specific
Gemini features.

This is an umbrella spec split into three phases:

1. Phase A: OpenAI-compatible provider
2. Phase B: Parser Gateway and CanonicalDocument benchmark
3. Phase C: Adaptive RAG router

## 2. Why Now

OpenCairn originally removed the OpenAI provider on 2026-04-15 because it was
positioned as a paid hosted alternative with fewer native product features than
Gemini. That decision still makes sense for an OpenAI-company-specific
provider. It does not make sense for an OpenAI-compatible endpoint layer.

The OpenAI API shape has become the compatibility layer for local and hosted
model gateways:

- vLLM exposes an OpenAI-compatible server with chat, completions, embeddings,
  and rerank endpoints.
- Ollama exposes OpenAI compatibility for common client integrations.
- LiteLLM normalizes many providers behind OpenAI-format request and response
  surfaces, including routing, fallback, and budget controls.
- Docling's VLM path can target local or hosted OpenAI-compatible inference
  servers such as vLLM, LM Studio, or Ollama.

At the same time, document parsing has moved beyond flat text extraction.
Docling, Marker, MinerU, and similar tools can produce structured document
objects with tables, figures, formulas, reading order, bounding boxes, and
export formats suitable for RAG. OpenCairn should evaluate those tools through
a parser gateway rather than replacing its current ingest path blindly.

## 3. Non-Goals

- Do not replace Gemini native paths with a generic OpenAI-compatible client.
- Do not remove Ollama.
- Do not introduce LangGraph, LangChain, or Pydantic AI as the primary agent
  runtime.
- Do not replace Temporal.
- Do not replace PostgreSQL/pgvector with Qdrant, Weaviate, Milvus, Neo4j, or
  OpenSearch in this spec.
- Do not make Marker a hard dependency until licensing and deployment boundaries
  are resolved.
- Do not make Docling mandatory for self-host installs until CPU performance is
  benchmarked against representative fixtures.
- Do not route every query through graph retrieval.

## 4. Current Baseline

### 4.1 LLM

Current provider policy:

- `gemini`: hosted/default/BYOK path with native Gemini features.
- `ollama`: self-host/local path with graceful degradation.

Current split:

- Python worker and agents use `packages/llm`.
- Some Hono chat paths have TypeScript-side Gemini wiring.

This split must be acknowledged in the implementation plan. Phase A is not
complete unless both Python worker use cases and TypeScript API chat use cases
have a clear provider story.

### 4.2 Ingest

The current ingest surface includes:

- PDF
- Office documents
- HWP/HWPX
- text and Markdown
- image, audio, and video
- web URLs and YouTube
- Notion and Drive import
- literature import

Important existing parser paths:

- `opendataloader-pdf` for PDF text extraction and converted HWP/HWPX PDFs
- PyMuPDF for PDF inspection, scan detection, and fallback metadata
- MarkItDown for Office text extraction
- unoserver/H2Orestart for document-to-PDF conversion and HWP/HWPX support
- trafilatura for static web extraction
- faster-whisper for local STT fallback
- provider multimodal paths for image, OCR, audio, and enrichment

### 4.3 Retrieval

OpenCairn already has the right primitives:

- workspace-scoped notes and permissions
- `note_chunks`
- pgvector embeddings
- PostgreSQL full-text search
- concept graph and grounded evidence surfaces
- wiki logs and source provenance

The next retrieval improvement should be routing and evidence policy, not a
large external RAG framework.

## 5. Phase A: OpenAI-Compatible Provider

### 5.1 Recommendation

Add a provider named `openai_compatible`, not `openai`.

The name is intentional. The provider is for OpenAI API-compatible endpoints,
not only OpenAI's hosted service.

Expected targets:

- vLLM
- Ollama `/v1` compatibility
- LM Studio
- LiteLLM Proxy
- OpenRouter
- Together, Groq, Fireworks, or similar gateways
- internal company LLM gateways
- future self-host inference servers

### 5.2 Environment

Recommended environment shape:

```text
LLM_PROVIDER=gemini | ollama | openai_compatible

OPENAI_COMPAT_BASE_URL=http://localhost:8000/v1
OPENAI_COMPAT_API_KEY=
OPENAI_COMPAT_CHAT_MODEL=
OPENAI_COMPAT_EMBED_MODEL=
OPENAI_COMPAT_RERANK_MODEL=
OPENAI_COMPAT_VISION_MODEL=
```

Do not reuse `OPENAI_API_KEY` as the primary variable. That name implies one
vendor and increases the chance of confusing local self-host configurations
with public hosted OpenAI credentials.

### 5.3 Provider Capabilities

All providers should expose a capabilities contract.

```text
ProviderCapabilities
  chat
  stream
  embeddings
  tools
  vision
  pdf
  audio_transcription
  tts
  rerank
  deep_research
  context_cache
  grounding
```

Capabilities are runtime facts. Code must branch on them instead of assuming
that all providers can do Gemini-native operations.

Examples:

- Gemini supports native Deep Research, TTS, grounding, context cache, and
  strong multimodal paths.
- Ollama supports local chat and embeddings but has limited OCR, no native
  Deep Research, and no provider batch embeddings.
- OpenAI-compatible endpoints vary by server. vLLM may expose embeddings and
  rerank; a chat-only LiteLLM route may not.

### 5.4 Python Worker Scope

Phase A should extend `packages/llm`:

- add `OpenAICompatibleProvider`
- extend `ProviderConfig`
- update `get_provider()`
- add tests for:
  - chat generation
  - streaming if the base provider interface supports it
  - embeddings
  - tool calling when the endpoint supports OpenAI-style tools
  - clear failure when an optional capability is absent

The implementation should use `httpx` directly unless the repo already has a
thin client pattern that is safer. Avoid introducing a heavy LLM framework for
this provider.

### 5.5 TypeScript API Scope

Phase A must also account for Hono chat paths that currently call Gemini
directly.

Add a minimal TypeScript provider boundary under the API layer rather than
copying the full Python provider abstraction:

```text
apps/api/src/lib/llm/
  provider.ts
  gemini.ts
  openai-compatible.ts
```

Minimum API operations:

- stream chat completion
- embed text for chat retrieval
- report usage when available
- surface provider-not-configured errors consistently

Ollama support can be satisfied through `openai_compatible` when the user points
at Ollama's compatible endpoint. Native Python Ollama remains in
`packages/llm`.

### 5.6 Security

OpenAI-compatible endpoints are powerful network targets. The provider must
follow the existing SSRF and self-host assumptions:

- server-side base URLs come from env or encrypted BYOK-style settings only
- no user-submitted arbitrary base URL in a request body
- if per-user endpoints are added later, they need allow-listing or the same
  private-network protections as MCP connectors
- log model names and provider kind, not plaintext API keys

### 5.7 Phase A Acceptance

Phase A is complete when:

- `LLM_PROVIDER=openai_compatible` works in worker provider tests.
- API chat can use the OpenAI-compatible provider for streaming text.
- Embeddings can be configured through the compatible endpoint or fail with a
  clear typed error.
- Gemini-specific features remain Gemini-only and still degrade gracefully for
  Ollama and OpenAI-compatible providers.
- `.env.example` documents the new variables.
- Tests cover unsupported-capability behavior.

## 6. Phase B: Parser Gateway And CanonicalDocument

### 6.1 Recommendation

Do not replace existing parsers directly. Introduce a parser gateway and a
canonical intermediate representation.

The parser gateway chooses a parser based on MIME type, feature flags, file
size, deployment capabilities, and benchmark results.

```text
source object
  -> ParserGateway
      -> current parser adapters
      -> DoclingAdapter
      -> MarkerAdapter (optional external)
      -> MinerUAdapter (optional benchmark)
  -> CanonicalDocument
  -> normalize/chunk/enrich/embed/graph
```

### 6.2 CanonicalDocument

`CanonicalDocument` must be parser-agnostic.

Required fields:

```text
CanonicalDocument
  source
    source_type
    mime_type
    original_file_key
    parser
    parser_version
    parse_started_at
    parse_completed_at
  pages[]
    page_number
    width
    height
    blocks[]
  blocks[]
    id
    type
    text
    markdown
    html
    bbox
    page_number
    reading_order
    confidence
    source_offsets
    relationships
  tables[]
  figures[]
  formulas[]
  warnings[]
  raw_artifact_key
```

Block types should include at least:

- paragraph
- heading
- list
- table
- figure
- formula
- caption
- code
- page_header
- page_footer
- unknown

### 6.3 Parser Candidates

#### Current adapters

Keep these as baseline and fallback:

- opendataloader-pdf
- PyMuPDF
- MarkItDown
- trafilatura
- faster-whisper
- provider multimodal paths

#### Docling

Docling is the strongest default modernization candidate because it is designed
around structured document conversion, supports CPU acceleration settings, and
can export structured document formats suitable for downstream RAG.

Risk:

- CPU performance may be too slow for the default self-host profile.
- OCR and table structure settings can change runtime cost materially.

Decision:

- benchmark first
- do not make it mandatory until fixture data supports it

#### Marker

Marker is a strong PDF-quality candidate, but it is not a safe hard dependency
for OpenCairn core.

Risks:

- code license and model weight license need commercial compatibility review
- GPU/VRAM expectations make it a poor default for small Fly.io/self-host
  deployments
- PyTorch dependency footprint is significant

Decision:

- evaluate as an optional external parser service
- do not vendor into worker core

#### MinerU

MinerU should be included as a benchmark candidate for PDF/image/Office to
Markdown or JSON conversion.

Decision:

- benchmark only
- no core dependency until licensing, output quality, and deployment footprint
  are measured

### 6.4 Benchmark Fixture Set

The benchmark must include representative documents:

- clean digital PDF paper
- scanned Korean PDF
- slide-heavy PDF
- table-heavy financial or spreadsheet PDF
- DOCX with headings and tables
- PPTX with images and speaker-style structure
- XLSX table workbook
- HWP/HWPX converted path
- web article
- image-only document

Metrics:

- success/failure
- wall-clock time
- peak memory
- CPU-only viability
- GPU-only or GPU-preferred paths
- table fidelity
- heading/reading-order fidelity
- figure/caption fidelity
- formula fidelity
- Korean text quality
- output size
- source offset and bbox coverage
- downstream chunk quality

### 6.5 Fly.io And Self-Host Constraint

The default deployment may be Fly.io Docker apps plus managed Postgres, Redis,
object storage, and Temporal.

Therefore Phase B must not assume:

- local GPU
- huge persistent disk
- local MinIO as the only storage model
- one Docker Compose process containing every service

Parser services that need GPU or large model weights should be optional external
services with explicit configuration.

### 6.6 Phase B Acceptance

Phase B is complete when:

- `CanonicalDocument` is specified and represented in shared or worker schema.
- existing parser outputs can be normalized into it.
- benchmark fixtures and a repeatable benchmark command exist.
- Docling, Marker, and MinerU decisions are based on benchmark output rather
  than preference.
- no existing ingest source regresses.

## 7. Phase C: Adaptive RAG Router

### 7.1 Recommendation

Do not reintroduce LightRAG as a core dependency. Use OpenCairn's own graph,
chunk, wiki, and evidence data.

The router should select retrieval policy based on query shape:

```text
simple factual query
  -> dense + keyword

multi-hop relationship query
  -> graph retrieval + dense support

ambiguous or high-stakes query
  -> dense + keyword + graph fusion + rerank + verifier
```

### 7.2 Retrieval Inputs

The router can use:

- user query
- selected chat mode
- page/project/workspace scope
- pinned context
- detected freshness requirements
- query complexity features
- available graph density
- source evidence confidence

### 7.3 Retrieval Outputs

The router returns:

```text
RetrievalPlan
  retrieval_mode
  vector_top_k
  keyword_top_k
  graph_hops
  graph_edge_filters
  fusion_strategy
  rerank_required
  verifier_required
  context_budget
```

### 7.4 Policy

Rules:

- simple questions should not pay graph latency by default
- graph-only answers are not enough unless backed by source evidence
- citations must resolve to readable workspace resources
- rerank is optional and provider-capability dependent
- if graph density is low, fallback to chunk search and say when graph evidence
  is missing

### 7.5 Phase C Acceptance

Phase C is complete when:

- routing decisions are deterministic or testable
- retrieval modes have fixture tests
- simple queries do not regress latency
- multi-hop queries use concept graph evidence
- responses can show why evidence was selected

## 8. Implementation Plan Split

This umbrella spec should produce at least three implementation plans.

### Plan A: OpenAI-Compatible Provider

Owned areas:

- `packages/llm`
- `apps/api/src/lib/llm`
- `.env.example`
- focused tests for provider config, streaming, embeddings, and unsupported
  capabilities

Do first. It is the smallest change with the largest ecosystem unlock.

### Plan B: Parser Gateway And Benchmark

Owned areas:

- `apps/worker/src/worker/activities/*`
- worker schemas and tests
- benchmark fixtures and scripts
- docs for parser decision matrix

Do second. It sets up Docling/Marker/MinerU evaluation without breaking ingest.

### Plan C: Adaptive RAG Router

Owned areas:

- retrieval helpers
- chat/research/doc-editor retrieval paths
- evidence logging
- tests and eval fixtures

Do after parser output and chunk contracts stabilize.

## 9. Decision Matrix

| Topic | Decision | Reason |
| --- | --- | --- |
| OpenAI-compatible provider | Add now | Small, high ROI, unlocks vLLM/LiteLLM/Ollama `/v1`/LM Studio |
| Gemini native provider | Keep | Deep Research, TTS, grounding, context cache, multimodal features |
| Ollama native provider | Keep | Local/self-host path and existing tests |
| Docling | Benchmark as likely default parser candidate | Structured output and CPU support, but runtime cost unknown |
| Marker | Benchmark as optional external parser service | Quality promising, but GPL/model license and VRAM risk |
| MinerU | Benchmark candidate | Useful comparison against Docling/Marker/current path |
| LightRAG | Do not adopt as core dependency | OpenCairn already owns graph data and needs permission-aware retrieval |
| LangGraph | Do not reintroduce as runtime | Temporal + `runtime.Agent` already gives OpenCairn control |
| Pydantic AI | Do not adopt as core runtime | Pydantic v2 schemas are enough for now |
| pgvector/Postgres | Keep | Good operational fit; improve retrieval policy before adding services |

## 10. External References

- Docling accelerator options: <https://docling-project.github.io/docling/examples/run_with_accelerator/>
- Docling GPU support: <https://docling-project.github.io/docling/usage/gpu/>
- Docling overview: <https://www.docling.ai/>
- Marker README: <https://github.com/datalab-to/marker/blob/master/README.md>
- vLLM OpenAI-compatible server: <https://docs.vllm.ai/serving/openai_compatible_server.html>
- Ollama OpenAI compatibility: <https://docs.ollama.com/openai>
- LiteLLM docs: <https://docs.litellm.ai/>
- MinerU GitHub: <https://github.com/opendatalab/MinerU>

## 11. Open Questions

1. Should `openai_compatible` be available only through deployment env in v1, or
   should BYOK users be allowed to configure a per-user compatible endpoint?
   Recommendation: env-only first.
2. Should Docling run inside the worker process or as a separate parser service?
   Recommendation: benchmark both only if CPU in-process results are acceptable
   enough to justify further work.
3. Should Marker be offered to self-host users as a documented optional service?
   Recommendation: yes only after license review and benchmark evidence.
4. Should rerank be part of Phase A provider capabilities or Phase C retrieval?
   Recommendation: define the capability in Phase A, consume it in Phase C.

## 12. First Implementation Recommendation

Start with Plan A: OpenAI-compatible provider.

Reasons:

- It does not require DB migrations.
- It does not require parser replacement.
- It unlocks local and hosted model gateways.
- It corrects the over-narrow 2026-04-15 interpretation of "OpenAI provider".
- It can be tested with mocked HTTP responses before any live model smoke.

Phase A should be implemented in a dedicated worktree from `main`.
