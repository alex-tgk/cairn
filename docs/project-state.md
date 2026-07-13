# Current Cairn project state

This is the cross-agent handoff. Update it whenever implementation status, verified behavior, or the next work slice changes.

## Current release

- Version: `0.1.0`
- Branch: `main`
- Repository: `https://github.com/alex-tgk/cairn`
- Release: `https://github.com/alex-tgk/cairn/releases/tag/v0.1.0`
- Homebrew: `brew install alex-tgk/tap/cairn`
- Runtime: Bun 1.3.14 with strict TypeScript
- Storage: SQLite through Kysely 0.28.17 and Cairn's deterministic `bun:sqlite` dialect
- Verification: 98 tests, type checking, compiled-binary smoke test, and green macOS, Linux, and Windows CI

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
- Typed Kysely work-item queries behind an async repository port, with explicit
  immediate SQLite transactions and embedded migrations preserved
- Migration 3 work extensions with aggregate and event revisions plus allocated
  hierarchy, dependency, label, comment, and notes storage
- Compare-and-set work mutations, conflict-safe claims, explicit revision guards,
  and project-local unambiguous UUID-prefix references
- Structured JSON errors for work conflicts, claim conflicts, ambiguous references,
  validation failures, and missing work
- Arbitrary-depth parent assignment, deterministic recursive tree queries,
  transactional cycle checks, and open-descendant closure protection
- Blocking dependency add, remove, and directional list commands with
  transactional cycle checks and revision-protected audit history
- Deterministic ready and blocked queries with active-blocker explanations
- `work label add`, `work label remove`, and `work label list` with trimmed,
  lowercased, idempotent labels reflected in the search-tag projection
- `work note append` for append-only, order-preserving notes
- `work comment add` and `work comment list` for immutable, authored,
  order-preserving comments sharing the work item's revision sequence
- List, ready, and blocked filtering by status, priority, type, assignee or
  unassigned work, labels (AND semantics), parent or roots, and result limit
- Migration 4 context-source and document-version storage with incremental
  hashing, active/removed tracking, and an index-run audit trail (domain,
  service, and repository only; no CLI surface yet)
- Migration 5 memory and memory-event storage with project and personal
  scopes, a closed type set, and topic-addressable upsert
- `memory save`, `memory show`, `memory list`, and `memory search` with
  scope/type/topic filtering and deterministic FTS5 ranking
- Topic-key upsert: saving with an existing `(scope, project)` topic updates
  that memory in place, preserves its id, and increments its revision instead
  of creating a duplicate
- Migration 6 memory-relations storage with a canonical, lexicographically
  ordered pair constraint for symmetric, idempotent linking
- `memory relate`, `memory unrelate`, and `memory relations` for
  cross-memory linking, resolved consistently from either side of a relation
- `memory timeline` for deterministic before/after chronological context,
  scoped to a memory's own project or personal visibility boundary

## Not implemented

- Pin/archive state and the `context` primer command
- Context source discovery and indexing CLI commands and user-facing search
- Beads and Engram import
- Backup and restore commands
- Prebuilt release executables, Homebrew bottles, and macOS signing/notarization

## Next work slice

Slice 3 (durable memory) has capture, topic-upsert, list, search, relations,
and timeline context implemented per ADR 0010. Continue Slice 3 with the
deferred pin/archive and session-summary work, or begin wiring the existing
context-indexing domain (migration 4) to CLI commands as part of Slice 4:

1. Pin/archive state and session-summary-specific listing plus the `context`
   primer command
2. Context source configuration, refresh/rebuild CLI commands, and
   user-facing search
3. Stable human and JSON CLI contracts
4. Tests, documentation, and migration implications in the same work units

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
