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
