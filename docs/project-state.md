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
- Verification: 109 tests, type checking, compiled-binary smoke test, and green macOS, Linux, and Windows CI

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
- Migration 7 memory pin/archive state; `memory pin`, `memory unpin`,
  `memory archive`, and `memory unarchive`, with archived memories excluded
  from `list`/`search` by default and included via `--include-archived`
- `memory sessions` for session-summary-specific listing and `memory context`
  as a deterministic primer surfacing pinned memories, the most recent
  session summary, and recent non-session-summary memories
- Slice 3 (durable memory) is complete per ADR 0010
- `ProjectStatus` now includes `workspaceId`, resolved from the registered
  workspace row rather than only the caller-generated id, so downstream
  domains (context) can address a workspace deterministically
- `cairn context refresh`, `cairn context rebuild`, and `cairn context status`
  wiring the existing migration-4 context-indexing domain to the CLI, scoped
  to the current project/workspace by default or every already-registered
  project/workspace with `--all` (never crawling unregistered directories)
- `cairn context search "<query>"` with safe literal-term parsing (rejects
  raw FTS syntax and empty/punctuation-only queries), OR semantics, weighted
  BM25 ranking (title 10, body 1, tags 5, source-path 4) with deterministic
  title/source-path/entity-id tie-breaks, matched-term reporting, and a
  fixed-marker (`»`/`«`) snippet, scoped to the current project/workspace by
  default or every registered project/workspace with `--all`
- `cairn context prime "<question>"` composing project identity, index
  status (including `not_indexed`/`refresh_required` warnings and a
  recommended `cairn context refresh` command), and question-specific
  search results in a stable order; rejects `--all` since prime is
  single-project only
- Slice 4's search/prime CLI surface follows ADR 0009's exit code mapping
  (0 success including empty results, 2 invalid query/limit/scope)
- New `search` domain (`src/search/`): a read-only projection over the
  shared `search_entries`/`search_entries_fts` table, independent of the
  work/memory/context domain modules per the architecture's "search is a
  read-only projection, not a source model" rule
- `cairn search "<query>"` unified cross-domain search spanning
  `work_item`, `memory`, and `context_document` entity kinds in one
  weighted-BM25 ranked query (same title/body/tags/source-path weights as
  context search), with `--kind <work|memory|context>` filtering
  (repeatable), `--all`/`--path` scope selection, and the same safe
  literal-term query parsing and exit-code contract as `context search`
- `scripts/import-beads.ts`: idempotent import of `bd export` JSONL issues
  into work items through the existing `work-service.ts` public API (no raw
  SQL), mapping status/priority/type 1:1 where valid Cairn enum values and
  falling back to `open`/2/`task` otherwise, transitioning claim/close state
  to match Beads status, appending acceptance criteria/owner/close reason as
  a note, and tagging each item with a `bd:<issue-id>` label so re-runs skip
  already-imported issues. Per ADR 0008, dependencies/comments/labels are
  intentionally excluded (bulk graph import is out of scope)
- `scripts/import-engram.ts`: idempotent import of `engram export` JSON
  observations into memories through `memory-service.ts`'s `saveMemory`,
  using an `import/engram/<sync_id>` topic key so re-runs upsert the same
  memory per ADR 0010's topic-upsert rule; maps Engram's `type` 1:1 onto
  Cairn's `MEMORY_TYPES` where valid, with a documented fallback (observed
  Engram `refactor` type, which is outside Cairn's closed set, maps to
  `pattern`); sessions and prompts are not imported (no Cairn equivalent).
  Both scripts were verified against real `bd export`/`engram export` data
  from local repos, including a re-run idempotency check

## Not implemented

- Context source configuration CLI commands (add/list/remove sources)
- Count/checksum inventory reports, backup, restore, export, and recovery
  guidance
- Prebuilt release executables, Homebrew bottles, and macOS signing/notarization

## Next work slice

Slice 4 (context and unified search) is complete: `cairn context refresh`,
`rebuild`, `status`, `search`, `prime`, and the cross-domain `cairn search`
are all wired per ADR 0009 and the architecture's search-domain rules.
Slice 5's flat-field Beads/Engram import scripts are done; Candidate next
work:

1. Context source configuration CLI commands (add/list/remove sources),
   currently only configurable via `.cairn/context.toml`
2. Slice 5 (migration and operations) remainder: count/checksum inventory
   reports, backup, restore, export, and recovery guidance
3. Tests, documentation, and migration implications in the same work units

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
