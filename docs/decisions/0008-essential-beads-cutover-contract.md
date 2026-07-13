# Complete the essential Beads cutover with conflict-safe work aggregates

## Status

Accepted July 13, 2026.

## Context

Cairn can capture and update work, but it cannot yet replace the agent workflow of finding ready work, claiming it atomically, coordinating through structure and blockers, and closing it with durable history. Existing mutations read an item before writing it without a revision predicate, and a claim may overwrite another assignee.

ADR 0006 already fixes hierarchy as an arbitrary-depth, single-parent project forest that is separate from blocking dependencies. This decision completes the minimum work-tracking contract needed for Beads cutover without importing Beads' broader workflow engine or Dolt synchronization model.

## Decision

### Storage and aggregate revision

- Reserve migration 3 for the completed work domain. It adds an integer `revision` and append-only `notes` to work items, event revisions, and the hierarchy, dependency, label, and comment tables described below.
- Every actual mutation of a work aggregate increments its revision exactly once and inserts exactly one audit event with that revision in the same transaction. An idempotent no-op changes neither.
- Persist hierarchy in `work_item_hierarchy`, with each child as its primary key. Persist blockers in `work_item_dependencies(blocked_id, blocker_id)`. Store the project ID on both tables and use composite foreign keys to enforce same-project relations.
- Persist normalized labels in `work_item_labels`. Persist comments as immutable, authored, timestamped rows in `work_item_comments`; notes remain an append-only work-item field.
- Keep work-item search projections synchronized transactionally. Descriptions and notes contribute to the body, while type, status, priority, and labels contribute to tags.

### Conflict safety and claims

- All writes use compare-and-set semantics against the revision that the application read. A zero-row update is a typed conflict, never a silent overwrite.
- An optional expected-revision CLI input may protect a revision already held by a caller; omitting it does not disable the repository's optimistic-concurrency check.
- Claiming an open, available item sets its assignee and status to `in_progress`. A retry by the same assignee is an idempotent success. A claim by a different assignee, a claim of an open item assigned to someone else, or a claim of closed work is rejected.
- Two concurrent claims of the same revision produce exactly one winner. The losing attempt creates no event and changes no search projection.

### Hierarchy and blocking graphs

- Parent and blocker mutations validate and write in one serialized transaction. Self-links, cross-project links, and direct or indirect cycles are rejected.
- Hierarchy remains structural only. It does not make a child blocked or ready.
- Closing a work item with any `open` or `in_progress` descendant is rejected with deterministically ordered descendant references. Parents never close automatically.
- A blocking edge means `blocked_id` depends on `blocker_id`. A blocker is active while it is not closed.
- An item is **ready** when it is `open` and has no active blocker. An item is **blocked** when it is not closed and has at least one active blocker. An `in_progress` item with no active blocker is neither ready nor blocked.
- Ready items, blocked items, blockers, and hierarchy siblings use deterministic ordering by priority, creation time, then canonical ID.

### Human references and collaboration

- Canonical work IDs remain UUIDs. Commands accept an exact UUID or an unambiguous, project-local UUID prefix of at least six hexadecimal characters.
- Human output uses a short reference. JSON always returns the full `id`, a default eight-character `shortId`, and `revision`; ambiguous prefixes return a typed error with sorted candidates.
- Essential list and ready/blocked filters cover status, priority, type, assignee or unassigned work, labels, parent or roots, and result limit. Repeated label filters use AND semantics.
- Labels are trimmed, lowercased, non-empty, and returned lexicographically. Duplicate add and absent remove operations are idempotent.
- Notes append non-empty text and preserve append order. Comments preserve non-empty body, author, timestamp, and insertion order. Both participate in work history.
- Human and JSON commands cover tree inspection, blocker add/remove/list, ready and blocked explanations, label add/remove/list, note append, and comment add/list.

### Explicit deferrals

The essential cutover does not include exact Beads CLI or JSON compatibility, Dolt history or remote database merging, generic or cross-project relation types, gates, molecules, convoys, wisps, defer or due dates, estimates, arbitrary metadata, duplicate and hygiene reports, external-service integrations, bulk graph imports, or comment editing and deletion.

## Consequences

- Agents can safely select, claim, coordinate, and finish local work without Beads, including under competing processes.
- The work domain gains several SQLite-specific invariants and recursive queries; they remain behind domain-owned repository ports and may use explicit SQL under ADR 0007.
- UUID prefixes improve interactive use without weakening canonical identity, but scripts must persist full IDs and handle typed conflicts.
- Sharing and merging work databases between machines remains a later operations problem rather than an implicit promise of the Beads replacement.
