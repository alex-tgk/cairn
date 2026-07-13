# Current Cairn project state

This is the cross-agent handoff. Update it whenever implementation status, verified behavior, or the next work slice changes.

## Current release

- Version: `0.1.0`
- Branch: `main`
- Repository: `https://github.com/alex-tgk/cairn`
- Release: `https://github.com/alex-tgk/cairn/releases/tag/v0.1.0`
- Homebrew: `brew install alex-tgk/tap/cairn`
- Runtime: Bun 1.3.14 with strict TypeScript
- Storage: SQLite through `bun:sqlite`
- Verification: 19 tests, type checking, compiled-binary smoke test, and green macOS, Linux, and Windows CI

## Implemented

- Platform-specific global data directories and `CAIRN_DATA_DIR`
- Runtime-validated `.cairn/project.toml`
- Stable project identity and rename-safe workspace registration
- SQLite migration 1 with projects, workspaces, and FTS5 search projection
- WAL, foreign keys, busy timeout, integrity, and schema checks
- `init`, `status`, `doctor`, `--help`, `--version`, and JSON output
- Standalone Bun compilation with leaked-artifact cleanup
- Green macOS, Linux, and Windows source CI
- Public `v0.1.0` source release
- Public `alex-tgk/homebrew-tap` Formula with local style, strict audit, source-install, and formula-test verification
- Green tap CI on Ubuntu, Apple Silicon macOS, and Intel macOS
- Clean reinstall through the published `alex-tgk/tap/cairn` path with passing version and database-health smoke tests
- Migration 2 work-item and audit-event storage
- `work create`, `work show`, and deterministic project-scoped `work list`
- `work claim`, `work close`, `work reopen`, and `work history`
- `work update` for title, description, priority, type, and assignment
- Transactional audit events and synchronized work-item search projections

## Not implemented

- Dependencies, ready/blocked queries, comments, labels, or notes
- Durable memory, sessions, topics, relations, or timelines
- Context source discovery, incremental indexing, or user-facing search
- Beads and Engram import
- Backup and restore commands
- Prebuilt release executables, Homebrew bottles, and macOS signing/notarization

## Next work slice

Continue essential work tracking:

1. Parent/child and blocking dependencies
2. Ready and blocked queries with explanations
3. Labels, comments, and notes
4. Stable human and JSON CLI contracts
5. Tests, documentation, and migration implications in the same work units

## Durable decisions

- Phase 1 replaces essential Beads, Engram, and `agents-context` workflows.
- SQLite is the source of truth; Dolt remains a rejected Phase 1 alternative.
- Project identity is independent from filesystem paths.
- TypeScript/Bun remains contingent on cross-platform release validation.
- Distribution uses standalone executables and `alex-tgk/homebrew-tap` first.
- Verified work is committed and pushed regularly.
- Repository documentation is the cross-LLM source of truth.
- Work hierarchy allows arbitrary depth with one parent per item; hierarchy is separate from blocking dependencies.
- Hierarchy mutations reject self-parenting, cross-project links, and cycles; parents cannot close while descendants remain open.
- Kysely is the accepted typed SQL layer inside infrastructure adapters; repository ports and `bun:sqlite` remain the architectural and physical boundaries.
