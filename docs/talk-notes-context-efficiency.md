# Talk prep notes: context efficiency, staleness, and feature ideas

> Captured from a talk-prep session in `content-systems` (2026-07-27) exploring
> "AI agent memory" talk ideas built around Cairn itself. These are
> brainstormed candidates grounded in Cairn's own architecture docs and ADRs
> (`docs/architecture.md`, ADR 0009, ADR 0010, `docs/project-state.md`,
> `docs/roadmap.md`), not committed roadmap items — triage before promoting
> anything here into `roadmap.md` or a new ADR.

See [talk-context-efficiency-slides.md](talk-context-efficiency-slides.md)
for the slide deck built from these notes (Marp-formatted markdown; render
with `npx @marp-team/marp-cli talk-context-efficiency-slides.md -o slides.html`
or the Marp VS Code extension).

## Context: what prompted this

While outlining a talk about Cairn as an example of context-efficient,
deterministic AI agent tooling, three questions came up:

1. What could make Cairn even better / more context-efficient?
2. How does Cairn make sure data isn't stale?
3. Is Cairn actually saving context tokens for the agent?

## 1. Feature ideas (candidates, not committed)

- **Surface memory staleness/age more prominently.** Work items and context
  documents have strong staleness signals (revisions, audit history, content
  hashes, explicit `not_indexed`/`refresh_required` status per ADR 0009), but
  a memory saved months ago is returned by `memory search`/`memory context`
  with the same apparent confidence as one saved yesterday — `createdAt` is
  just a field, not a ranking or display signal. Consider decay-aware
  ordering or an explicit "stale" flag past some age for non-pinned memories.
- **Link memories to the work items or context documents they explain.**
  `memory relate` already links memory-to-memory (ADR canonical pair
  linking), but there's no first-class link from a memory back to the work
  item it resolved or the file/decision it documents — that traversal today
  requires a second `work show`/`context search` and manual correlation.
- **Expose index staleness inline in `context search` results**, not only in
  `context status`. ADR 0009 already refuses to claim arbitrary content is
  fresh without a refresh — extending that same honesty into search results
  (a per-result "as of" hash/timestamp) would let an agent decide whether to
  trust a hit without a second status call.
- **Cursor-based pagination for `work list`/`memory search`** for large
  projects, cheaper to resume than recomputing a limited result set.
- **Confidence from cross-referencing signals** — e.g. a `blocked` work item
  with no dependency progress in N sessions could surface as "stale/likely
  abandoned" the same way `work ready --explain` already explains readiness.

## 2. How staleness is prevented (grounded in Cairn's actual design)

Cairn's staleness story differs by domain, and is deliberately conservative
rather than magic — per ADR 0009, it never silently declares data fresh:

- **Context domain (files/docs):** incremental indexing hashes file content
  (SHA-256) and only creates a new immutable version and re-projects into
  search when the hash actually changes — an unchanged file causes zero churn.
  `context status` reports one of `not_indexed`, `indexed`, or
  `refresh_required` rather than assuming freshness, and a fatal
  configuration/discovery failure leaves the previous good index intact
  instead of corrupting it. There is **no background watcher or automatic
  refresh** — this was an explicit deferral in ADR 0009 (deterministic,
  model-independent, and predictable over "always live") — refresh is a
  conscious step (`cairn context refresh`), and `rebuild` is reserved for a
  forced full re-read.
- **Work domain:** optimistic concurrency via revisions (`--if-revision`)
  prevents silently overwriting newer state, and every mutation is captured
  in an audit trail (`work history`) — staleness here means "someone else
  changed this since you last read it," and Cairn makes that a conflict
  error rather than a silent overwrite.
- **Memory domain:** topic-key upsert (`(scope, project, topic)`) means a
  memory documenting an evolving decision is updated in place and its
  revision incremented, instead of accumulating stale duplicate memories
  that both look equally current in search results.
- **Honest gap:** as noted in feature ideas above, memory doesn't yet have
  an explicit staleness/decay signal the way context and work do — worth
  naming on stage as a known asymmetry rather than implying uniform coverage.

## 3. Does Cairn save context tokens?

Yes, by design choices visible in the architecture docs, not just as a
marketing claim:

- **One unified, typed search instead of three separate greps.** `cairn
  search` projects work, memory, and context into one shared `search_entries`
  FTS5 table and returns one ranked, deterministic result set — instead of an
  agent re-reading scrollback, opening note files, and separately grepping a
  docs folder to reconstruct "what did we decide and why."
- **Deterministic weighted BM25 ranking with fixed field weights** (title 10,
  body 1, tags 5, source path 4 for context) plus stable tie-breaks means
  results are small, ranked, and reproducible — no embedding model call, no
  vector index, no non-deterministic re-ranking cost per query (explicitly
  deferred in ADR 0009: "embeddings, vector or semantic search, inference").
- **Structured JSON contracts return only relevant typed fields** (`work
  show`, `memory show`, etc.) instead of requiring the agent to parse raw
  session logs or full file contents to extract the same facts.
- **Query terms are parsed into safe literal terms with OR semantics for
  recall** — the agent doesn't need to craft a complex query or read through
  irrelevant matches to get a usable result.

**Open honesty for the talk:** there's no hard measured "N% token savings"
number for Cairn today — only architectural reasoning about why one
deterministic structured query beats re-deriving context from raw
scrollback/notes each session. A live before/after demo (reconstruct a past
decision from raw session history vs. one `cairn memory search` call, with
real token/character counts) would be more convincing on stage than citing
the reasoning alone.
