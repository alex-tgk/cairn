# Cursor-based (keyset) pagination for work list and memory list/search

## Status

Accepted July 27, 2026.

## Context

`cairn work list`, `cairn memory list`, and `cairn memory search` returned a
single, bounded result set with only a `--limit` cap and no way to resume
past the cap. For large projects the only way to see "the rest" was to raise
`--limit` and re-run the whole query, recomputing every earlier row each
time. This is the offset-pagination problem even though the code never used
`OFFSET`: an unbounded `--limit` is O(n) to answer and gives no cheap seek
point.

Each affected domain already had a deterministic tie-broken `ORDER BY`
backed by an index:

- Work (`listByProject`/`listReady`/`listBlocked` in
  `sqlite-work-item-repository.ts`): `priority ASC, created_at ASC, id ASC`,
  backed by `work_items_project_order_index (project_id, status, priority,
  created_at, id)` from migration 2.
- Memory list (`listByProject` in `sqlite-memory-repository.ts`): `created_at
  DESC, id DESC`, backed by `memories_scope_project_archived_order_index
  (scope, project_id, archived, created_at, id)` from migration 7.
- Memory search (`search`): FTS5 `rank ASC` (SQLite's BM25-derived
  relevance, smaller is more relevant), tie-broken by `created_at DESC, id
  DESC`. `rank` is a computed value from the `search_entries_fts` virtual
  table, not a stored or indexed column.

Because every existing order already ends in the primary key `id` as a
tiebreaker, each domain already had everything keyset (seek-based) cursor
pagination needs: a stable, total order with no ties. This decision adds an
opaque cursor on top of those existing orders rather than introducing a new
sort order or a generic cross-domain pagination utility.

## Decision

### Opaque cursor value type

- `src/shared/cursor.ts` provides a single domain-agnostic value type:
  `encodeCursor`/`decodeCursor`, which base64url-encode/decode an arbitrary
  JSON-serializable payload and throw `CursorDecodeError` on malformed
  input (invalid base64url, invalid JSON, or a non-object payload). This
  module knows nothing about work items, memories, or SQL — it is a thin,
  reusable encoding, not a shared pagination engine, so it does not create a
  cross-domain dependency between the work and memory domains.
- Each domain defines its own typed cursor payload and its own
  encode/decode wrapper that validates the payload's shape and re-throws the
  domain's own validation error on failure, so CLI exit-code behavior stays
  consistent with that domain's existing validation conventions (exit 1, the
  same as an invalid `--limit` or `--stale-after-days` today):
  - `WorkItemCursor { priority, createdAt, id }` with
    `encodeWorkItemCursor`/`decodeWorkItemCursor` in `src/work/work-item.ts`,
    throwing `WorkItemValidationError`.
  - `MemoryListCursor { createdAt, id }` and `MemorySearchCursor { createdAt,
    id, rank }` with their own encode/decode helpers in
    `src/memory/memory.ts`, throwing `MemoryValidationError`.
- The token is intentionally opaque to callers: it is not a page number and
  callers must not construct or edit one by hand. A cursor from one command
  (e.g. `memory list`) must not be reused with a different command (e.g.
  `memory search`) — the payload shapes differ and decoding will fail
  validation.

### Keyset seek predicates

- Work (ascending order) seeks strictly past the cursor tuple:
  `priority > ? OR (priority = ? AND created_at > ?) OR (priority = ? AND
  created_at = ? AND id > ?)`, added to `buildFilterCondition` in
  `sqlite-work-item-repository.ts` and shared by `listByProject`,
  `listReady`, and `listBlocked`.
- Memory list (descending order) seeks strictly before the cursor tuple:
  `created_at < ? OR (created_at = ? AND id < ?)`.
- Memory search (ascending on `rank`, descending on the `created_at, id`
  tiebreaker) seeks with: `rank > ? OR (rank = ? AND created_at < ?) OR
  (rank = ? AND created_at = ? AND id < ?)`, implemented as a standalone
  `searchCursorCondition()` since search's `WHERE`/ranking shape differs
  from the plain list query.
- No new migration was added. Every seek predicate is satisfied by an
  existing index's trailing columns (`priority, created_at, id` for work;
  `created_at, id` for memory list). Memory search's `rank` predicate is the
  one exception — see the stability caveat below.

### Paging contract

- `listWork`, `listMemories`, and `searchMemories` now fetch `limit + 1` rows
  and return a page object — `WorkListPage { items, nextCursor }` and
  `MemoryListPage { items, nextCursor }` — instead of a bare array. If the
  lookahead row exists, it is dropped from `items` and its sort key is
  encoded as `nextCursor`; otherwise `nextCursor` is `null`. This is a
  deliberate, breaking change to those three functions' return shape; all
  callers (CLI rendering, the migration importer's duplicate-label lookup,
  and existing tests) were updated in the same change.
- The CLI adds `--cursor <token>` to `work list`, `memory list`, and `memory
  search`. JSON output includes `nextCursor` (a string, or `null` when there
  is no further page). Human-readable output prints a `next: --cursor
  <token>` hint line when `nextCursor` is not `null`, so an agent or user
  can copy it directly into the next invocation.
- A malformed or garbage cursor (bad base64url, invalid JSON, wrong payload
  shape, or a cursor from the wrong command) produces the same class of
  validation error as an invalid `--limit`: a domain validation error caught
  by the CLI's existing top-level handler, exit code 1, no crash and no
  silent fallback to page one.
- Same query, same cursor, same data always returns the same page: the seek
  predicate and `ORDER BY` are pure functions of stored, immutable-once-set
  columns for work and memory list. This is verified in
  `test/work-pagination.test.ts` and `test/memory-pagination.test.ts` by
  running the same paged query twice and asserting equal results.

### `work list`, `work ready`, `work blocked` share cursor plumbing

`work ready` and `work blocked` share `WorkItemFilter` and
`buildFilterCondition` with `work list`, so a cursor supplied on any of them
is honored at the repository level. However, only `work list` exposes a
documented `--cursor` flag and computes/returns a `nextCursor`; `listReadyWork`
and `listBlockedWork` do not do the limit+1 lookahead and do not surface
`nextCursor`. This is an undocumented byproduct of shared filter plumbing,
not a supported pagination feature of `ready`/`blocked` — a future slice
should either extend them deliberately or make the sharing explicit about
which fields it does not paginate.

### Memory search rank stability caveat

`search_entries_fts.rank` is computed by SQLite's FTS5 BM25 ranking at query
time from the current index contents; it is not a stored or indexed column.
Seeking on it is **deterministic but not indexed**: the same query against
the same data always yields the same `rank` for the same row (so cursoring
never skips or duplicates a row and two pages of the same query always
compose correctly), but the database must still evaluate BM25 for every
candidate row of the query each page rather than jumping directly into a
b-tree at the cursor position. This is an accepted efficiency tradeoff for
this slice, not a correctness gap: the memory corpus is expected to remain
small enough per project that this does not matter in practice, but a
future slice that needs indexed seeking over search results (rather than
plain list) would need to materialize rank into a stored/indexed column,
which is out of scope here.

### Explicit deferrals

- No `--cursor` support for `memory relations`, `memory timeline`, `memory
  sessions`, or `context search` in this slice; only `work list`, `memory
  list`, and `memory search` were in scope.
- No offset/page-number based pagination was added anywhere; keyset cursors
  are the only supported pagination mechanism now and going forward for
  these three commands.

## Consequences

- Agents and users can now resume `work list`, `memory list`, and `memory
  search` from where they left off without re-scanning already-seen rows,
  and without recomputing an ever-growing unbounded result set as a project
  grows.
- `listWork`, `listMemories`, and `searchMemories` are breaking changes to
  their return shape (`{ items, nextCursor }` instead of a bare array); any
  future internal consumer of these functions must account for this shape,
  as the migration importer and CLI renderer already have.
- `search()` on the memory repository now returns `{ memory, rank }` pairs
  instead of bare `Memory` objects, since the search cursor must carry the
  FTS5 rank value that was not otherwise exposed outside the repository.
- The `rank`-based seek in memory search is deterministic but not an
  indexed jump; if memory search result sets grow large enough for this to
  matter, a follow-up slice should consider materializing rank or
  otherwise restructuring the search cursor.
- `work ready`/`work blocked` silently accept a `--cursor` value through
  shared filter plumbing without documenting or fully supporting it; this
  should be resolved deliberately in a future slice rather than left as an
  implicit side effect.
