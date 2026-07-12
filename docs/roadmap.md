# Deliver Cairn as verified vertical slices

The roadmap is ordered by dependency and risk reduction rather than dates.

## Delivery sequence

| Slice | Outcome | Status |
| --- | --- | --- |
| 0. Product and architecture | Scope and durable decisions | Complete |
| 1. Project and SQLite foundation | Rename-safe identity and executable CLI | Implemented locally |
| 2. Work tracking | Essential Beads workflows | In progress |
| 3. Durable memory | Essential Engram workflows | Planned |
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
- [ ] Parent/child and blocking dependencies
- [ ] Ready and blocked explanations
- [ ] Labels, comments, and notes

## Slice 3: durable memory

Implement memory types, scopes, topics, sessions, relations, search, timeline context, provenance, and session summaries. Exit when one process saves a memory and a later process recovers it deterministically.

## Slice 4: context and unified search

Implement source configuration, safe file discovery, incremental hashing, document versions, FTS ranking, snippets, project primer, and a typed cross-domain search projection.

## Slice 5: migration and operations

Implement read-only Beads and Engram inventories, idempotent dry-run imports, count/checksum reports, backup, restore, export, and recovery guidance.

## Slice 6: distribution

Validate release artifacts on supported platforms, add signing and checksums, create a versioned GitHub release, then publish the first formula and bottle through the custom Homebrew tap.

## Review rule

Each slice must include its domain behavior, database migration, CLI/JSON contract, tests, user documentation, and rollback or migration implications in the same work unit.
