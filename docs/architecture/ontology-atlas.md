# Ontology Atlas

OpenCairn's Ontology Atlas is the semantic layer on top of the workspace
knowledge graph. The graph stores concrete nodes and edges; the ontology layer
normalizes those nodes into classes and those edges into controlled predicates.

## Model

The Atlas follows the RDF triple shape:

```text
subject -- predicate --> object
```

Every Atlas edge is exposed as an ontology triple in the API response when it
passes predicate domain/range validation.

## Classes

OpenCairn currently exposes four ontology classes:

| Class | Meaning |
| --- | --- |
| `concept` | A named idea, term, method, theorem, person, place, or artifact extracted from source material. |
| `note` | A user-visible page or source note. |
| `source` | A source bundle or imported source grouping. |
| `artifact` | A generated or imported project artifact. |

## Predicates

The initial controlled predicate vocabulary is intentionally small:

| Predicate | Primary use |
| --- | --- |
| `is_related_to` | Associative concept relation, aligned with SKOS `related`. |
| `is_a` | Concept hierarchy, aligned with SKOS broader/narrower semantics. |
| `part_of` | Part-whole relation. |
| `contains` | Parent-child containment for project/source structures. |
| `depends_on` | Prerequisite or dependency relation between concepts. |
| `causes` | Causal relation between concepts. |
| `links_to` | Explicit wiki/page link. |
| `derived_from` | Provenance-style relation from a concept or note to supporting material. |
| `appears_with` | Inferred co-mention relation. |
| `near_in_source` | Inferred source-proximity relation. |
| `same_as_candidate` | Possible duplicate or synonym mapping, aligned with SKOS close matching. |

The API includes the class/predicate catalog, triples, and any domain/range
violations in `WorkspaceAtlasResponse.ontology`.

## Extraction Contract

The Compiler agent extracts both concepts and semantic relations. Relations
must use the controlled predicate vocabulary and must refer only to concepts
returned in the same extraction payload. The worker persists accepted relations
as `concept_edges.relation_type`, and the Atlas normalizes those relation types
back into ontology predicates.

## Validation

The API validates each Atlas edge against predicate domain/range constraints.
Invalid edges remain visible as graph edges for debugging, but they are excluded
from the ontology triple list and surfaced as violations.

## Inference

The API derives simple transitive triples for predicates marked as transitive,
such as `is_a`, `part_of`, and `contains`. These inferred triples are included
in `WorkspaceAtlasResponse.ontology.triples` with `inferred=true`; they do not
create additional display edges.

## Retrieval

Chat retrieval uses ontology-aware graph expansion. Semantic predicates such as
`depends_on`, `is_a`, `part_of`, `causes`, and `derived_from` are weighted above
generic `is_related_to` links. Display-oriented predicates such as
`appears_with` and `near_in_source` are downweighted and treated as fallback
context. The selected graph path is carried into evidence metadata as
`path=...` so answer generation can expose the ontology route behind a source.

## Agentic Maintenance

Curator audits ontology quality after orphan and duplicate checks. It creates
reviewable suggestions for unknown predicates, broad relations that need a more
specific predicate, high-confidence display edges that may deserve semantic
promotion, and reciprocal `is_a` cycles.

When a maintainer accepts a deterministic ontology suggestion, the Plan 8
suggestion API applies the graph mutation before resolving the suggestion:
unknown predicates are normalized to a controlled fallback relation, hierarchy
cycles delete the reverse edge, and relation refinements update the edge only
when the suggestion includes a proposed predicate. Suggestions without a safe
predicate remain accepted as review records but require manual relation choice.
