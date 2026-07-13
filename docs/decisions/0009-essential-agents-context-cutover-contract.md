# Replace essential agents-context workflows with scoped incremental context

## Status

Accepted July 13, 2026.

## Context

The current `agents-context` tool provides useful local documentation lookup, but its implementation is a destructive global rebuild. A build discovers repositories under one development root, mixes local files with generated project cards, Contentful network content, and an Engram export, then drops and recreates one SQLite document index. Search is global OR-only FTS without project or workspace scope, a stable tie-break, freshness status, or JSON output. The primer is a shell wrapper over three failure-swallowing global searches plus direct Engram calls.

Cairn already identifies a logical project with `.cairn/project.toml` and records every physical checkout, clone, moved directory, and worktree separately. The context replacement must use that identity, remain deterministic and model-independent under ADR 0002, and share the database without rebuilding work or memory data.

## Decision

### Command scope and cutover intent

- Context commands resolve the current Cairn project and workspace by default. Cross-project operation is explicit with `--all`.
- `--all` operates only on projects and workspaces already registered with Cairn. It never crawls a development root, invents path-derived project identity, or writes manifests into unregistered repositories.
- Cross-project search and refresh choose the latest existing registered workspace for each project. A command scoped by `--path` uses that exact resolved workspace.
- Search with no matches is a successful empty result. Status before the first refresh is a successful `not_indexed` result rather than a database error.

| Existing intent | Cairn intent |
| --- | --- |
| `agents-context build ~/dev` | Run `cairn init` once in each wanted repository, then `cairn context refresh --all`. |
| `agents-context search "<query>"` | Use `cairn context search "<query>"` for the current project or add `--all` for registered projects. |
| `agents-context stats` | Use `cairn context status`, with `--all` for the registered-project inventory. |
| `agents-context-prime "$PWD" "<question>"` | Use `cairn context prime "<question>"` from the project or pass `--path`. |
| Destructive rebuild as the normal update | Use incremental `refresh`; reserve `rebuild` for an explicit forced re-read and projection repair. |

### Source configuration and safe discovery

- A project may track an optional versioned `.cairn/context.toml`. Built-in high-signal defaults apply when it is absent.
- Sources have unique project-local names, workspace-relative POSIX roots, include and exclude globs, and a per-file byte limit capped at one megabyte. Absolute roots and traversal outside the workspace are invalid.
- Discovery considers regular UTF-8 files only, uses stable code-point path ordering, does not follow symbolic links, verifies path containment, and records SHA-256 hashes of raw bytes.
- Git-visible tracked and untracked files honor standard Git ignore rules when Git is available. A cross-platform filesystem fallback retains all built-in and configured safety rules when Git is unavailable.
- Generated, dependency, cache, vendor, and Cairn-internal directories are excluded. Secret, private-key, SQLite, oversized, NUL-containing, and invalid-UTF-8 matches are denied even when a broad include glob matches them.

### Incremental storage and workspace identity

- Reserve migration 4 for `context_sources`, `context_documents`, `context_document_versions`, and `context_index_runs`.
- `context_sources` owns normalized project configuration and its fingerprint. It contains no absolute workspace path.
- A context document is identified by source, workspace, and workspace-relative path. It stores the current content hash and active state. Immutable versions preserve content, hash, size, and index time. Index runs preserve refresh or rebuild mode, status, counts, timing, and structured failures.
- Active documents project transactionally into the shared `search_entries` table. Deactivation removes the projection; context storage remains separate from work and memory domain tables.
- `refresh` discovers paths in stable order and hashes eligible bytes. An unchanged hash creates no version and causes no FTS churn. New or changed content creates one immutable version and updates its projection. Successfully absent or newly excluded paths become inactive.
- A fatal configuration or discovery failure leaves the previous active index intact. A partial run is recorded and reported as operational failure rather than silently declaring the index fresh.
- `rebuild` forces file reads and recreates current projections while preserving source and document identity. It never drops shared Cairn tables or reconstructs unrelated domains.
- Default refresh, status, search, and prime operations use the resolved current workspace. After a directory move, refreshing the new workspace supersedes indexed rows for the missing old workspace. Existing parallel worktrees remain distinct and return their own content when addressed directly.

### Search and primer behavior

- User queries are parsed into safe literal Unicode terms; raw FTS syntax is not accepted. Empty or punctuation-only queries fail validation before SQLite.
- Terms use OR semantics for recall. Context results use weighted BM25 with title `10`, body `1`, tags `5`, and source path `4`, followed by deterministic title, source-path, and entity-ID tie-breaks.
- Entity kind, project, and workspace filters apply before the result limit. Results include typed project, workspace, source, document, relative-path, tag, matched-term, and fixed-marker snippet data. The raw numeric BM25 score is an implementation detail.
- `context prime` composes project identity, index status, deterministic local project metadata, commands and setup context, and question-specific results in a stable section order.
- Prime does not automatically refresh and never makes hidden model, embedding, network, Engram, or LightRAG calls. A missing or known-stale index produces an explicit warning and the exact refresh command.

### Output and failure principles

- Every context command has equivalent human and JSON output. JSON mode writes exactly one success value without progress text.
- Exit code `0` means successful operation, including an empty search or `not_indexed` status. Exit code `2` means invalid command arguments, source configuration, query, or limit. Exit code `1` means an operational, partial, database, or filesystem failure.
- JSON failures write one structured error object to standard error with a stable code and message. Human failures provide the same meaning and a concrete recovery action when one is known.
- Status distinguishes `not_indexed`, `indexed`, and `refresh_required`. It reports the last successful run and known configuration or workspace drift; it does not claim that arbitrary filesystem content is fresh without a refresh.

### Explicit deferrals

The essential cutover does not include exact `agents-context` CLI or output compatibility, implicit discovery or initialization of arbitrary repositories under `~/dev`, Contentful or other web crawling, duplicate Engram ingestion, LightRAG card exports, embeddings, vector or semantic search, inference, a daemon or filesystem watcher, automatic refresh during prime, cloud synchronization, or code intelligence already provided by Serena and codebase-memory.

## Consequences

- Agents receive lower-noise current-project context by default while retaining explicit cross-project lookup.
- Directory moves and parallel worktrees no longer depend on absolute paths as document identity, but each wanted repository must first be registered with Cairn.
- Incremental hashes and immutable versions make refresh explainable and cheap for unchanged content, at the cost of additional schema and lifecycle rules.
- Raw FTS5 queries, triggers, and projection repair remain parameterized SQLite-specific infrastructure under ADR 0007.
- The existing `agents-context`, Engram, and LightRAG tools remain separate during migration; the new context commands do not silently invoke them.
