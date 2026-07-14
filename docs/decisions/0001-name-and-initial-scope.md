# ADR 0001: Name the project Cairn and unify work, memory, and context

## Status

Accepted July 10, 2026; Phase 1 boundary clarified July 11, 2026.

## Context

The project began in a placeholder directory named `brainstorm`. The local agent workflow divides essential continuity across an external issue tracker, an external memory tool, and prior local-context tooling.

## Decision

- Use **Cairn** as both the product and repository name.
- Replace essential work tracking, durable memory, and deterministic local context workflows in Phase 1.
- Keep LightRAG, Ollama, Serena, codebase-memory, and model-powered capabilities outside the Phase 1 core.
- Preserve separate work, memory, and context domains behind one command surface.

## Consequences

- Phase 1 is broader than memory alone and must be delivered as vertical slices.
- Compatibility targets actual relied-on workflows rather than every flag in the replaced tools.
- Unified search is a projection across typed domains, not a generic source model.
- Context retrieval cannot require embeddings or inference.
