# Build durable agent memory without a model dependency

Cairn will consolidate the essential durable-memory workflow behind a single local tool. The first release focuses on capturing and recovering agent memory; broader repository context and relationship synthesis are deliberately deferred.

## Product decision summary

| Topic | Status | Direction |
| --- | --- | --- |
| Product and repository name | Accepted | Cairn |
| First product boundary | Accepted | Durable memory first; context tooling later |
| Core dependency model | Accepted | No required embeddings or inference model |
| Retrieval behavior | Proposed | Deterministic filters, chronology, and lexical search |
| Primary interface | Proposed | Human-friendly CLI with stable machine-readable output |
| Persistence technology | Open | Decide during Phase 0 |
| Implementation language/runtime | Open | Decide during Phase 0 |

## Problem

The current local agent setup distributes memory and context responsibilities across several tools:

- Engram stores durable observations and session summaries.
- `agents-context` provides broad, fast lookup across local sources.
- LightRAG performs curated graph synthesis and requires embedding and inference services.
- `agents-rag` remains as a legacy SQLite RAG fallback.
- Ollama supports the model-dependent parts of that stack.

This works, but it creates multiple operating models, stores, commands, health checks, and failure modes. Recovering basic durable memory should not depend on a graph pipeline or a running model service.

## Initial user

The first user is a developer who works with multiple local AI coding agents and needs context to survive across sessions and tools.

The user needs to:

1. Save a decision, discovery, bug fix, convention, preference, or session handoff.
2. Recover relevant memories later by project, scope, topic, type, time, or text.
3. Inspect provenance and chronology instead of trusting an unexplained generated answer.
4. Script the same operations from different agent environments.
5. Operate offline without maintaining an embedding or inference service.

## Desired outcome

Any supported agent can leave a durable marker. A later agent can find that marker predictably, understand why it matched, and continue work without reconstructing the earlier session.

## Product principles

1. **Determinism before cleverness.** The same data and query should produce the same ordered result.
2. **Provenance is part of the result.** Every record exposes its source, timestamps, scope, and stable identity.
3. **Local operation is complete operation.** Core workflows require no hosted API or local model server.
4. **One concept, one command surface.** Capture, retrieval, inspection, and maintenance use a coherent vocabulary.
5. **Migration before replacement.** Existing durable memories must remain accessible while Cairn earns trust.
6. **Context is a later capability.** Do not smuggle repository indexing or semantic retrieval into the memory core.

## Phase 1 scope

- Structured memory records with stable identifiers
- Project and personal scopes
- Topics that can evolve without overwriting unrelated memories
- Memory types such as decision, discovery, bug fix, architecture, pattern, configuration, preference, and session summary
- Create, inspect, list, and deterministic search operations
- Chronological context around a record
- Machine-readable output for agent integration
- Local persistence, schema migration, backup, and integrity checks
- A documented import path from Engram

## Deferred scope

- Repository and document indexing
- Cross-project relationship synthesis
- Semantic/vector retrieval
- Automatic summarization or memory extraction
- Serena and codebase-memory replacement
- Remote synchronization, hosted accounts, or team permissions
- GUI or web dashboard

## Phase 1 success criteria

- [ ] A new process can retrieve a record saved by an earlier process without any model service running.
- [ ] Queries support exact filters and deterministic text matching with documented ordering.
- [ ] Every result includes stable identity, provenance, scope, and timestamps.
- [ ] Project memory cannot silently leak into an unrelated project query.
- [ ] Concurrent or interrupted writes do not corrupt the store.
- [ ] Existing Engram data can be imported or read through a documented transition path.
- [ ] CLI operations provide stable JSON output and actionable error messages.
- [ ] The core domain and query behavior are tested independently of the storage adapter.

## Risks

| Risk | Why it matters | Mitigation direction |
| --- | --- | --- |
| Rebuilding too much at once | The current stack mixes memory, context, RAG, and code intelligence. | Enforce the Phase 1 boundary through ADRs and acceptance tests. |
| Weak lexical relevance | Model-free search can miss conceptual matches. | Make filters, topic discipline, ranking, and provenance excellent before considering optional semantic adapters. |
| Migration loss | Existing memories represent operational history. | Treat import verification and record counts as release criteria. |
| Schema lock-in | An early taxonomy can become accidental policy. | Version the record schema and keep domain rules independent of persistence. |
| Agent integration drift | Different agents may format or interpret records differently. | Publish a stable CLI and JSON contract with conformance fixtures. |

## Open product questions

1. Is Engram command compatibility a release requirement or only a migration convenience?
2. Which existing Engram fields and behaviors are essential, and which are historical accidents?
3. Should Cairn support explicit record revision history in Phase 1, or model topic evolution as new linked records?
4. What retention, redaction, and secret-detection guarantees are required before broad adoption?
5. Is multi-machine synchronization a future goal, or should Cairn remain intentionally machine-local?
