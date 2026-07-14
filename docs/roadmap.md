# Deliver Cairn as verified vertical slices

The roadmap is ordered by dependency and risk reduction rather than dates.

## Delivery sequence

| Slice | Outcome | Status |
| --- | --- | --- |
| 0. Product and architecture | Scope and durable decisions | Complete |
| 1. Project and SQLite foundation | Rename-safe identity and executable CLI | Implemented locally |
| 2. Work tracking | Essential Beads workflows | Implemented locally |
| 3. Durable memory | Essential Engram workflows | In progress |
| 4. Context and unified search | Essential `agents-context` workflows | Planned |
| 5. Migration and operations | Safe cutover, backup, and recovery | Planned |
| 6. Distribution | Signed releases and Homebrew tap | Planned |

## Slice 1 exit criteria

- [x] Strict TypeScript and Bun project
- [x] Versioned SQLite migrations
- [x] Stable project manifest with runtime validation
- [x] Separate project and workspace identity
- [x] Directory-move behavior covered by tests
- [x] WAL, foreign keys, busy timeout, integrity, and FTS5 checks
- [x] CLI and JSON boundaries
- [x] Standalone local executable
- [x] macOS, Linux, and Windows CI scaffold

## Slice 2: work tracking

Implement the minimum Beads-compatible workflow:

1. Work-item schema and audit events
2. Create, show, list, update, claim, close, and reopen
3. Parent/child and blocking dependencies
4. Ready and blocked queries with explanation
5. Labels, comments, notes, priorities, and types
6. Deterministic JSON contracts and acceptance tests

Exit when an agent can capture work, identify an unblocked next item, explain why it is ready, and close it with history preserved.

Current progress:

- [x] Migration 2 work-item and audit-event schema
- [x] Create, show, and deterministic project-scoped list
- [x] Creation audit event and unified-search projection
- [x] Claim, close, and reopen with audit history
- [x] Work-item metadata updates with audit history
- [x] Arbitrary-depth single-parent hierarchy and separate blocking dependencies
- [x] Ready and blocked explanations
- [x] Labels, comments, and notes
- [x] List, ready, and blocked filtering by status, priority, type, assignee,
      label, and parent

## Slice 3: durable memory

Implement memory types, scopes, topics, sessions, relations, search, timeline context, provenance, and session summaries. Exit when one process saves a memory and a later process recovers it deterministically.

Current progress:

- [x] Migration 5 memory and memory-event schema with project/personal scope
      and a closed type set
- [x] `memory save` with topic-key upsert, `memory show`, `memory list`, and
      `memory search` against the shared FTS5 projection
- [x] Migration 6 memory relations table; `memory relate`, `memory unrelate`,
      and `memory relations` for idempotent, symmetric cross-memory linking
- [x] `memory timeline` for chronological before/after context scoped to a
      memory's own project/personal visibility boundary
- [x] Migration 7 pin/archive state; `memory pin`, `memory unpin`,
      `memory archive`, and `memory unarchive`, with archived memories
      excluded from `list`/`search` by default (`--include-archived` opts in)
- [x] `memory sessions` for session-summary-specific listing and
      `memory context` as the primer command surfacing pinned memories, the
      most recent session summary, and recent non-session-summary memories

Slice 3 (durable memory) is complete per ADR 0010's essential Engram cutover
contract, including its explicit deferrals.

See [ADR 0010](decisions/0010-essential-engram-cutover-contract.md) for the
essential Engram cutover contract and its explicit deferrals.

## Slice 4: context and unified search

Implement source configuration, safe file discovery, incremental hashing, document versions, FTS ranking, snippets, project primer, and a typed cross-domain search projection.

Current progress:

- [x] `cairn context refresh` and `cairn context rebuild` wiring the existing
      migration-4 context-indexing domain (source discovery, incremental
      hashing, document versioning) to the CLI, scoped to the current
      project/workspace by default or every already-registered
      project/workspace with `--all`
- [x] `cairn context status` reporting per-source `not_indexed` / `indexed` /
      `refresh_required` state, document counts, and the last index run
- [x] `cairn context search "<query>"` with weighted BM25 ranking and snippets
      per ADR 0009
- [x] `cairn context prime "<question>"` composing project identity, index
      status, and question-specific results

See [ADR 0009](decisions/0009-essential-agents-context-cutover-contract.md)
for the full CLI/behavior contract.

## Slice 5: migration and operations

Implement read-only Beads and Engram inventories, idempotent dry-run imports, count/checksum reports, backup, restore, export, and recovery guidance.

## Slice 6: distribution

Validate release artifacts on supported platforms, add signing and checksums, create a versioned GitHub release, then publish the first formula and bottle through the custom Homebrew tap.

## Review rule

Each slice must include its domain behavior, database migration, CLI/JSON contract, tests, user documentation, and rollback or migration implications in the same work unit.
