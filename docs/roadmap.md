# Prove durable memory before expanding into context

The roadmap is ordered by risk reduction, not dates. Each milestone produces a usable or reviewable outcome and has an explicit exit condition.

## Delivery sequence

| Milestone | Outcome | Status |
| --- | --- | --- |
| 0. Product and architecture foundation | Accepted scope, decision gates, and implementation-ready contracts | In progress |
| 1. Walking skeleton | Save and recover one durable memory end to end | Planned |
| 2. Deterministic retrieval | Filter, search, and inspect chronology predictably | Planned |
| 3. Engram transition | Preserve and verify existing durable memory | Planned |
| 4. Operational readiness | Safe daily use by multiple local agents | Planned |
| 5. Context exploration | Re-evaluate broader context without weakening the core | Deferred |

## Milestone 0: product and architecture foundation

### Deliverables

- Product brief, architecture direction, roadmap, and accepted ADRs
- Inventory of Engram behaviors and data that Cairn must preserve
- Runtime and persistence ADRs
- Versioned record schema proposal
- CLI command and JSON output contract
- Test strategy and walking-skeleton acceptance scenarios

### Exit criteria

- [ ] Every Phase 1 behavior is either required, deferred, or rejected.
- [ ] The runtime and persistence choices satisfy offline, model-free operation.
- [ ] Record identity, scope, project identity, topic evolution, and provenance are defined.
- [ ] The first vertical slice can be implemented without unresolved product choices.

## Milestone 1: walking skeleton

### Deliverables

- Project toolchain and automated tests
- Domain model for one valid memory record
- Repository port and first local persistence adapter
- `save` and `get` workflows
- Human-readable and JSON CLI output
- Restart persistence test

### Exit criteria

- [ ] A record saved by one process is recovered by another.
- [ ] Invalid records fail before persistence with actionable errors.
- [ ] Core tests run without network access or model services.
- [ ] Domain tests do not depend on the persistence implementation.

## Milestone 2: deterministic retrieval

### Deliverables

- Scope, project, topic, type, and time filters
- Timeline neighbors around a record
- Deterministic lexical search
- Explicit ranking and tie-breaking rules
- Result provenance and match explanations
- Backup and integrity-check commands

### Exit criteria

- [ ] Repeated queries over the same store return the same ordered results.
- [ ] Project and scope isolation is covered by acceptance tests.
- [ ] Search behavior is documented well enough to reproduce manually.
- [ ] Interrupted writes and concurrent access do not corrupt the store.

## Milestone 3: Engram transition

### Deliverables

- Read-only inventory of the current Engram database and behaviors
- Versioned importer or compatibility adapter
- Dry-run report with source counts, destination counts, warnings, and rejected records
- Migration verification fixtures
- Cutover and rollback runbook

### Exit criteria

- [ ] Migration is repeatable and does not mutate the source store.
- [ ] Record counts and checksums are explainable.
- [ ] Topic, scope, type, chronology, and provenance survive migration.
- [ ] Existing agent workflows have a documented compatibility path.

## Milestone 4: operational readiness

### Deliverables

- Installation and upgrade workflow
- Shell completion and agent-integration examples
- Locking, recovery, backup, and restore behavior
- Performance budgets using a representative local dataset
- Secret detection or redaction policy
- Deprecation plan for replaced memory commands

### Exit criteria

- [ ] At least two agent environments use the same stable command contract.
- [ ] Upgrade, backup, restore, and corruption recovery are tested.
- [ ] Failures identify corrective actions without exposing stored secrets.
- [ ] Cairn can become the durable-memory source of truth.

## Milestone 5: context exploration

This milestone is intentionally deferred until the memory core is trusted.

Questions to answer before expanding scope:

1. Which `agents-context` workflows are genuinely memory workflows versus repository indexing?
2. Can deterministic full-text and metadata indexing cover enough context use cases without embeddings?
3. Which LightRAG outcomes provide unique value, and can they remain optional?
4. Should code intelligence remain federated through Serena and codebase-memory?

No context capability may make embeddings or inference mandatory for core memory operations.

## Immediate next work unit

Document Engram parity before selecting implementation technology:

1. Inventory its command surface and database schema read-only.
2. Identify behaviors currently depended on by Codex, Copilot CLI, and local scripts.
3. Separate required product behavior from Engram-specific implementation details.
4. Turn the result into a compatibility matrix and Phase 1 acceptance scenarios.
