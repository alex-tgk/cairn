# Complete the essential memory cutover with topic-addressable durable memory

## Status

Accepted July 13, 2026.

## Context

Cairn replaces essential issue-tracking and context-search workflows in Slices 2 and 4, but agents still depend on an external memory tool to save durable observations, evolve a topic over time, and recover prior context deterministically. That tool's real contract, confirmed against its CLI and its own protocol documentation, is narrower than the full product brief: a save with type, scope, optional topic key, and content; a search; a context primer; and a timeline around a saved observation.

This decision fixes the essential memory contract Cairn must satisfy before the prior memory tool can be retired, and defers non-essential surface area from that tool explicitly so later slices do not silently reintroduce scope creep.

## Decision

### Storage

- Reserve migration 5 for the memory domain. Add a `memories` table and a `memory_events` audit table, mirroring the work domain's aggregate-plus-event-log shape from ADR 0008.
- A memory belongs to exactly one scope: `project` (has a `project_id`) or `personal` (`project_id` is `NULL`). Scope is fixed at creation and never changes.
- A memory has a `type` from a closed set matching the prior memory tool's actual usage: `decision`, `architecture`, `discovery`, `pattern`, `bugfix`, `config`, `preference`, `session_summary`.
- A memory has an optional, stable `topic` key (for example `architecture/auth-model`). Topic keys are scoped to `(scope, project_id)`; the same key in different scopes or projects addresses different memories.
- Every actual mutation increments an integer `revision` and inserts exactly one `memory_events` row with that revision in the same transaction, matching the work domain's audit pattern.
- Memories participate in the shared `search_entries` FTS projection (`entity_kind = 'memory'`) with title and content as body and type/topic/scope as tags, kept transactionally synchronized.

### Topic upsert semantics

- Saving with a `topic` key that does not yet exist in that `(scope, project_id)` creates a new memory.
- Saving with a `topic` key that already exists in that `(scope, project_id)` upserts: it updates the existing memory's title, content, and type in place, preserves its canonical ID, increments its revision, and records an `updated` event. It never creates a second row for the same topic.
- Saving without a topic key always creates a new, topic-less memory. Different topics must never overwrite each other, and a topic-less save must never silently collide with a topic-keyed memory.

### Provenance

- Every memory records `created_at`, `updated_at`, and the originating `project_id` (when scoped to a project). Each `memory_events` row is immutable provenance for what changed and when.
- Explicit citation text is optional free-form content the caller provides; Cairn does not infer or verify citations.

### Essential command surface

- `memory save <title> <content>` with `--type`, `--scope` (default `project`), `--project`, and `--topic` accepts the same shape as the prior memory tool's save command.
- `memory show <id>` returns one memory by canonical ID or unambiguous project-scoped/personal-scoped ID prefix, matching the work domain's reference resolution from ADR 0008.
- `memory list` supports filtering by `type`, `scope`, `topic`, and `project`, with a result limit, in deterministic order.
- `memory search <query>` performs FTS5 search across title and content with the same deterministic ranking and tie-breakers used by the existing search projection.
- Human and JSON output follow the existing CLI contract: JSON always includes `id`, `revision`, and full timestamps.

### Explicit deferrals

This decision defers memory relations, timeline context around a specific memory, pin/archive state, session-summary-specific listing, and the `context` primer command to a follow-up work unit stacked on this one. It does not include automatic memory generation, summarization, cross-machine sync, or the prior memory tool's MCP-only prompt capture, none of which are part of Cairn's deterministic core per ADR 0002.

## Consequences

- Agents gain a durable, queryable place to save and recover decisions, discoveries, fixes, conventions, and preferences without the prior memory tool, once the deferred relation and timeline work lands.
- The topic-upsert rule gives agents an explicit way to evolve a running memory (an architecture decision, a preference) without manual lookups or duplicate rows, matching existing agent workflow habits.
- Memory reuses the audit-event and search-projection patterns already proven by the work domain, reducing the risk of introducing a second inconsistent persistence style.
- Deferring relations and timeline keeps the first memory slice reviewable and testable in isolation, at the cost of temporarily incomplete parity with the prior memory tool.

## Amendment — type-derived default scope (July 16, 2026)

The original decision defaulted every memory to `project` scope when `--scope`
was omitted. In practice this stranded genuinely user-level facts (tool and
editor choices, coding-style and workflow preferences) under whichever project
an agent happened to be in, defeating Cairn's goal of holding user-level memory
that follows the user across repositories. This amendment refines the default
without changing the storage model:

- **Type-derived default scope.** When `--scope` is omitted, the default is
  derived from the memory `type`: `preference` defaults to `personal`; every
  other type continues to default to `project`. An explicit `--scope` always
  overrides the derived default. The policy lives in the memory domain
  (`defaultScopeForType`) so both the CLI and the importers apply it uniformly.
- **Scope remains immutable from the user path.** Scope is still fixed at
  creation and cannot be changed through any CLI command. The sole exception is
  a controlled, ordered data migration: migration 8 re-scopes pre-existing
  `preference` memories from `project` to `personal` to match the new default,
  records an `updated` audit event per affected memory, and keeps the shared
  search projection consistent. Future one-time corrections of this kind must
  likewise go through an ordered migration with an audit trail, never an ad hoc
  mutable-scope command.
- **Importers no longer force `project` scope.** The context importer previously
  hard-coded `scope: "project"`; it now omits scope so the type-derived default
  applies, which keeps re-import idempotency consistent with reclassified data.

## Amendment — derived, read-time staleness signal (July 27, 2026)

Memory had no first-class staleness signal the way work (revisions/audit
history) and context (content-hash plus `not_indexed`/`refresh_required`
status) do. `createdAt`/`updatedAt` were plain fields, not a ranking or
display signal, so agents had no way to see at a glance whether a saved
memory might no longer reflect reality. This amendment adds an
informational, non-storage staleness signal without changing the storage
model or migration history:

- **Derived, read-time-only signal.** Staleness is computed on every read; it
  is never persisted, requires no new migration, and adds no stored column.
  Two fields are attached to every `MemoryView` returned by the memory
  domain: `ageDays` (an integer count of whole UTC days) and `stale` (a
  boolean). Both are recomputed from `updatedAt` and the current clock on
  every call and are never cached or written back.
- **`updatedAt` is the reference point, not `createdAt`.** Age is measured
  from `updatedAt` rather than `createdAt` because a topic-key upsert (this
  ADR's original topic-upsert rule) bumps `updatedAt` in place while
  preserving the memory's id and creation time. Measuring from `updatedAt`
  means "how long since this was last confirmed true," which is the more
  useful staleness signal for a memory that evolves over time via upserts.
- **90 day default threshold.** A memory is stale once `ageDays` exceeds 90
  by default (`DEFAULT_STALE_AFTER_DAYS` in `src/memory/memory-staleness.ts`).
  This default is deliberately conservative and purely informational in this
  slice.
- **Pinned memories are never stale.** Regardless of age, a `pinned` memory's
  `stale` field is always `false`. A pin is already an explicit "keep fresh"
  signal per this ADR's pin/archive amendment, so age-based staleness would
  contradict an agent's or user's explicit judgment that a memory remains
  current.
- **`--stale-after-days <n>` CLI override.** `memory list`, `memory search`,
  and `memory sessions` accept an optional `--stale-after-days <n>` to
  override the default threshold for that query only; it must be a positive
  integer or the command fails the same way an invalid `--limit` does today
  (an `invalid_memory`-coded error). The default threshold and the override
  apply only to the `stale` computation — they never filter, re-rank, or
  otherwise change which memories are returned.
- **Surfaced everywhere a memory is rendered.** `ageDays`/`stale` appear on
  every `MemoryView`-shaped object in JSON and human-readable output:
  `memory show`, `memory list`, `memory search`, `memory relations`,
  `memory timeline` (target, before, and after entries), `memory
  pin`/`unpin`/`archive`/`unarchive`, `memory sessions`, and `memory
  context`'s embedded `pinnedMemories`, `recentMemories`, and
  `recentSessionSummary`.
- **No ranking or filtering change in this slice.** This amendment is
  informational metadata only. It does not change `memory search`'s FTS5
  ranking, does not reorder `memory list`/`memory context` results by age or
  staleness, and does not add a `--stale-only`/`--exclude-stale` filter. A
  future work unit may build decay-aware ranking or filtering on top of this
  signal, but that is explicitly out of scope here.

## Amendment — memory backlinks to work items and context documents (July 27, 2026)

Memory relations (this ADR's original decision) link memory to memory, but
there was no first-class link from a memory back to the work item it
resolves or the context document (indexed file) it explains — that
traversal required a second `work show`/`context search` call plus manual
correlation. This amendment adds two new link tables without changing any
existing table or the memory-relation contract:

- **Migration 9 adds `memory_work_links` and `memory_context_links`.**
  `memory_work_links(memory_id, work_item_id, created_at)` and
  `memory_context_links(memory_id, context_document_id, created_at)` are
  each a plain many-to-many join with a composite primary key and a foreign
  key to `memories(id)` plus, respectively, `work_items(id)` or
  `context_documents(id)`, both `ON DELETE CASCADE`. Unlike
  `memory_relations`, there is no canonical-ordering constraint, because
  the two ends are different entity kinds and cannot collide.
- **Read-only cross-domain resolution stays in the memory infrastructure
  adapter.** `docs/architecture.md` keeps work, memory, and context as
  separate domains that happen to share one physical SQLite database.
  Consistent with that shared-database model, `SqliteMemoryRepository`
  resolves and validates link targets by reading `work_items` and
  `context_documents` directly (id-or-unambiguous-id-prefix for work items,
  matching the existing work-reference convention; exact document id or
  exact indexed relative path for context documents) — but it never writes
  to those tables. Every write for this feature is confined to the two new
  memory-owned link tables. The memory application layer
  (`memory-service.ts`) still does not import `work-service.ts` or
  `context-service.ts`.
- **New CLI surface.** `memory link-work <id> <work-item-id>`,
  `memory unlink-work <id> <work-item-id>`, `memory link-context <id>
  <reference>`, and `memory unlink-context <id> <reference>` (`<reference>`
  is a context document's id or its indexed relative path). Linking is
  idempotent; unlinking a pair that is not linked is a no-op success,
  matching `memory relate`/`unrelate`'s existing idempotency contract. An
  unresolved or ambiguous target fails with a dedicated error code
  (`work_item_not_found`, `ambiguous_work_item_reference`,
  `context_document_not_found`, `ambiguous_context_document_reference`) and
  exit code 1, matching the existing `memory_not_found`/
  `ambiguous_memory_reference` convention.
- **Surfaced on `memory show` only, in this slice.** Every `memory show`
  result (JSON and human-readable) now includes `linkedWorkItems` and
  `linkedContextDocuments` arrays with each linked target's id, title, and
  (for work items) status/type or (for context documents) relative path.
  Unlike the staleness amendment above, this is deliberately *not* added to
  `memory list`, `memory search`, `memory relations`, or `memory timeline`
  in this slice, to avoid an extra join fan-out on every list-shaped read
  and to keep the change reviewable; a future work unit may extend it if
  needed.
- **Reverse lookup deferred.** Surfacing which memories link to a given
  work item from `cairn work show`, or to a given context document from
  `cairn context search`/`cairn search`, is explicitly deferred and tracked
  in `docs/roadmap.md`'s backlog rather than implemented here, since it
  would require the work/context domains to read the new memory-owned link
  tables — the same shared-database read pattern used above, just from the
  other direction — and that is a separate, reviewable slice.
