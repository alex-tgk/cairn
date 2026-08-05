---
marp: true
theme: cairn-talk
paginate: true
title: "Build Your Own AI Agent Memory — Or Just Use Cairn"
footer: "Cairn · Local-first agent memory"
---

<!-- _class: title -->

# Build your own AI agent memory system

**...or don't. Let's see why.**

A walkthrough of what it actually takes to give a coding agent durable
memory — and what you get for free by not building it yourself.

---

## The problem

Every AI coding agent session starts from zero.

- Yesterday's decisions live only in scrollback
- "Remember this" tools save prose nobody can query
- Docs, issues, and notes are three different sources of truth
- Nothing tells the agent *how confident* to be in what it finds

If you've felt this pain, you've probably thought: *"I could build this."*

Let's actually do it.

---

## What "just build it" really means

A local memory/context system for an agent needs, at minimum:

1. **Storage** that survives restarts and multiple tools writing to it
2. **Work tracking** — tasks, status, dependencies
3. **Durable memory** — decisions, facts, discoveries
4. **Context search** — your codebase and docs, kept fresh
5. **One retrieval interface** an agent can call cheaply, every session

Each one sounds simple. None of them are, once you try to keep them
correct.

---

## Piece 1: storage

- SQLite is the obvious choice — no server, ships with the OS/runtime
- But: WAL mode? Foreign keys? Busy timeouts on concurrent agent writes?
- Schema changes over time → you need **versioned migrations**, not
  "just ALTER TABLE it in prod"
- Where does the file even live — `~/.myagent`? Per-project? Both?
- First fork in the road: roll your own SQL, or take on an ORM and
  hope it doesn't leak abstractions where you need raw SQL control

---

## Piece 2: work tracking

- Tasks need status, priority, type, assignment
- Real work isn't flat — you need **parent/child hierarchy**
- And *separately*, **blocking dependencies** (not the same graph!)
- Every mutation should be auditable — what changed, when, by whom
- Optimistic concurrency — two agents editing the same item shouldn't
  silently clobber each other

This alone is most of an issue tracker. You just wanted your agent to
remember what it was doing.

---

## Piece 3: durable memory

- Free-text notes don't scale — you need typed, queryable facts
- Facts get updated, not just appended — "upsert by topic," not
  duplicate rows forever
- Some facts are project-specific, some follow *you* everywhere —
  now you need a **scope** model
- A memory from six months ago and one from this morning look
  identical unless you track **staleness** explicitly
- Pinning, archiving, relating facts to each other — the list keeps growing

---

## Piece 4: context search over your codebase

- Naive approach: re-read every file, every query — slow, wasteful
- Better: hash file contents, only re-index what changed
- Now you need a **document versioning** model, not just a blob store
- Ranking: raw string match is bad, embeddings are non-deterministic,
  expensive, and need a model dependency you may not want
- Deterministic full-text search (FTS5 + BM25) is possible — but tuning
  field weights and tie-breaks correctly takes real iteration

---

## Piece 5: one retrieval interface

- The agent shouldn't have to query three different systems
- You need a **unified, ranked, typed search** across work + memory + context
- That means one shared search index that three independent domains
  project into — without becoming a shared writable dumping ground
- Plus: stable JSON output, deterministic tie-breaks, sane exit codes,
  so an agent can parse results without guessing

---

## What you'd have built, if you got this far

- A migration system
- A work-tracking domain with hierarchy + dependency graphs + audit trail
- A memory domain with scopes, topics, staleness, and relations
- A content-hashing, incrementally-indexed search engine
- A unified ranked search projection across all three
- Cross-platform packaging so your team can actually install it

**This is a multi-month project.** And it's *before* you've fixed a
single bug your team hits in production.

---

<!-- _class: closing -->

# So we built it.

## It's called Cairn.

---

## What Cairn actually is

Cairn is a **local-first, deterministic** work, memory, and context
system for AI coding agents.

- One SQLite database per machine, one manifest per project
- No server, no daemon, no background watcher
- No embeddings, no inference, no model dependency for core behavior
- A single compiled binary — `brew install alex-tgk/tap/cairn`

Everything from the last 10 slides — already built, tested, documented.

---

## Cairn's three domains

| Domain | What it replaces | Freshness signal |
|---|---|---|
| **Work** | your issue tracker | revisions + full audit history |
| **Memory** | your "remember this" tool | topic-key upsert + age/staleness |
| **Context** | your local RAG/search tool | content hash + index status |

Kept deliberately separate. Unified search is a **read projection**
across all three — never a shared writable model.

---

## Work tracking, out of the box

```sh
cairn work create "Fix the flaky CI job" --priority 1 --type bug
cairn work claim <id> --assignee agent-name
cairn work dep add <blocked-id> <blocker-id>
cairn work ready --explain
cairn work blocked --stalled-after-days 14
cairn work close <id>
```

Arbitrary-depth hierarchy, many-to-many blocking dependencies, labels,
comments, notes, optimistic concurrency, and a full audit trail —
already there.

---

## Durable memory, out of the box

```sh
cairn memory save "Use bcrypt for password hashing" "..." \
  --type decision --topic auth/password-hashing
cairn memory search "password hashing"
cairn memory context
```

- Topic-key upsert — decisions evolve in place, not as duplicate rows
- Project vs. personal scope, type-derived defaults
- `ageDays` + `stale` on every result — no more six-month-old facts
  looking as confident as this morning's

---

## Context search, out of the box

```sh
cairn context refresh
cairn context search "database migration pattern"
cairn context prime "how does auth work here?"
```

- Incremental, content-hash-based indexing — unchanged files cost zero
- Deterministic weighted BM25 — no embedding calls, fully reproducible
- Every result now carries `contentHash` + `indexedAt` — an agent can
  judge trust without a second status call

---

## One query, everything

```sh
cairn search "why did we choose SQLite"
```

One command, one ranked result set, across work items, memories, and
indexed files — typed JSON, stable tie-breaks, no guessing.

This is the command that replaces three greps and a scrollback scroll.

---

## Why Cairn beats building your own

| Building it yourself | Cairn |
|---|---|
| Months of schema/migration design | Already versioned, tested, shipped |
| Pick an embedding model, hope it's deterministic | No embeddings — reproducible by design |
| Staleness is an afterthought | Staleness signals in every domain |
| One more service to run and monitor | Single binary, no daemon |
| You maintain it forever | Open source, already maintained |

---

## Why "deterministic, no embeddings" actually matters

- No API key, no rate limit, no network dependency for core search
- Same query, same database, same result — every time, every machine
- No silent model-version drift changing your search results
- Auditable: every ranking decision traces back to a fixed formula,
  not a black box

For agent tooling, boring and reproducible beats clever and unpredictable.

---

## Getting started

```sh
brew install alex-tgk/tap/cairn
cairn --setup
cairn --version
cairn doctor --json
```

`cairn --setup` wires your agent's global instructions and (for Copilot
CLI) a session-primer extension that injects ready work and recent
memory into every session — automatically, idempotently.

---

## What's still open, honestly

- No first-class link yet from a memory back to the work item or file
  it explains — still a manual correlation today
- No cursor-based pagination yet for very large `work list` / `memory search`
  result sets
- No hard measured "N% token savings" number — only architectural
  reasoning so far; a live before/after demo would prove it better

Named on stage, not hidden. Tracked as open work items, not lost in
a slide deck.

---

<!-- _class: closing -->

# Stop rebuilding this. Start using Cairn.

`brew install alex-tgk/tap/cairn`
`github.com/alex-tgk/cairn`

### Questions?
