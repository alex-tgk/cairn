# Current Cairn project state

This is the cross-agent handoff. Update it whenever implementation status, verified behavior, or the next work slice changes.

## Current release

- Version: `0.1.0`
- Branch: `main`
- Runtime: Bun 1.3.14 with strict TypeScript
- Storage: SQLite through `bun:sqlite`
- Verification: 19 tests, type checking, compiled-binary smoke test

## Implemented

- Platform-specific global data directories and `CAIRN_DATA_DIR`
- Runtime-validated `.cairn/project.toml`
- Stable project identity and rename-safe workspace registration
- SQLite migration 1 with projects, workspaces, and FTS5 search projection
- WAL, foreign keys, busy timeout, integrity, and schema checks
- `init`, `status`, `doctor`, `--help`, `--version`, and JSON output
- Standalone Bun compilation with leaked-artifact cleanup
- macOS, Linux, and Windows CI scaffold

## Not implemented

- Work items, dependencies, ready/blocked queries, comments, or audit events
- Durable memory, sessions, topics, relations, or timelines
- Context source discovery, incremental indexing, or user-facing search
- Beads and Engram import
- Backup and restore commands

## Next work slice

Implement essential work tracking:

1. Migration 2 for work items, dependencies, comments, labels, and audit events
2. Create, show, list, update, claim, close, and reopen use cases
3. Parent/child and blocking dependencies
4. Ready and blocked queries with explanations
5. Stable human and JSON CLI contracts
6. Tests, documentation, and migration implications in the same work units

## Durable decisions

- Phase 1 replaces essential Beads, Engram, and `agents-context` workflows.
- SQLite is the source of truth; Dolt remains a rejected Phase 1 alternative.
- Project identity is independent from filesystem paths.
- TypeScript/Bun remains contingent on cross-platform release validation.
- Distribution uses standalone executables and `alex-tgk/homebrew-tap` first.
- Verified work is committed and pushed regularly.
- Repository documentation is the cross-LLM source of truth.
