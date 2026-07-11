# ADR 0002: Require a deterministic, self-contained memory core

## Status

Accepted on July 10, 2026.

## Context

The current RAG and graph layers require embeddings, an inference model, and supporting local services. Those dependencies add setup, resource use, health checks, nondeterministic behavior, and failure modes to workflows that should be as reliable as reading a local record.

The project must remain useful on its own rather than requiring the user to construct and operate another RAG pipeline.

## Decision

Core Cairn operations must:

- run locally without network access;
- require no embedding model or inference model;
- return deterministic, documented results for the same store and query;
- preserve provenance and expose why a record matched;
- remain usable through a scriptable interface.

Optional model-powered capabilities may be explored later only as adapters. They cannot become prerequisites for capture, identity lookup, filtered retrieval, timelines, maintenance, backup, or migration.

## Consequences

- Phase 1 relevance depends on strong metadata, topic discipline, lexical search, and explicit ranking.
- Test fixtures can define exact expected results and ordering.
- The tool can operate offline and without Ollama.
- Semantic recall may initially be weaker than vector search.
- Any future semantic adapter must preserve the deterministic core as the source of truth.
