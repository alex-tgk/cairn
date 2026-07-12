# Unify local agent work, memory, and context

Cairn replaces the essential local workflows currently divided across Beads, Engram, and `agents-context`. One deterministic CLI and SQLite store will let agents identify a project, inspect work, recover prior decisions, search local documentation, and leave a reliable handoff.

## Product decisions

| Topic | Direction |
| --- | --- |
| First user | A developer working with multiple local AI coding agents |
| Phase 1 boundary | Work tracking, durable memory, local context indexing, and unified search |
| Persistence | User-level SQLite database with FTS5 |
| Project identity | Tracked project UUID; physical paths are replaceable workspace records |
| Interface | Human-readable CLI with stable JSON output |
| Runtime | TypeScript on Bun, compiled into standalone executables |
| Distribution | Platform release artifacts and a custom Homebrew tap |

## Problem

The current workflow distributes responsibility across three systems:

- Beads tracks issues, dependencies, ready work, comments, and history.
- Engram stores sessions, durable observations, topics, scopes, and timelines.
- `agents-context` indexes local project material and provides deterministic full-text search.

Agents must know which tool to call, how each tool identifies a project, where each tool stores data, and how to recover when paths or services change. Cairn provides one stable project model and command surface.

## Phase 1 capabilities

### Project and workspace management

- Initialize and resolve stable project identity
- Detect moved, renamed, cloned, or worktree workspaces
- Keep logical projects independent from absolute paths
- Support project and personal scopes

### Work tracking

- Create, inspect, update, claim, close, and reopen work
- Status, priority, type, assignee, labels, comments, and notes
- Parent/child and blocking dependencies
- Ready and blocked work queries
- Deterministic filtering and history

### Durable memory

- Decisions, discoveries, fixes, conventions, preferences, and session summaries
- Project and personal scopes
- Topics, related memories, chronology, provenance, and pin/archive state
- Deterministic search and timeline context

### Local context

- Incrementally index configured project files and generated project cards
- Store source identity, relative paths, hashes, tags, and timestamps
- FTS5 search with stable ranking tie-breakers and snippets
- Project primer, index status, refresh, and rebuild

### Unified operation

- Search work, memories, and indexed context through one query surface
- Stable JSON output and exit codes
- Backup, restore, export, import, migrations, and integrity checks
- Read-only migration from Beads and Engram with dry-run reports

## Success criteria

- [x] A project keeps the same identity after its directory moves.
- [x] SQLite migrations, integrity checks, and FTS5 work without external services.
- [x] The CLI compiles and runs as a standalone executable.
- [ ] Ready work excludes actively blocked items.
- [ ] A memory saved by one process is recoverable by another with provenance.
- [ ] Indexed context updates incrementally and returns explainable results.
- [ ] One query can return typed work, memory, and context results.
- [ ] Existing Beads and Engram data can be migrated with verified counts.
- [ ] Release artifacts pass tests on macOS, Linux, and Windows.

## Deferred

- Embeddings, semantic/vector search, and inference
- Automatic memory generation or summarization
- Web interface
- Cloud accounts and team permissions
- Dolt-style database branching and merge
- Advanced Beads formulas, molecules, gates, and external service integrations
- Code intelligence already provided by Serena and codebase-memory
