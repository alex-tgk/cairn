---
marp: true
theme: cairn-talk
paginate: true
title: "Cairn: Context Efficiency, Staleness, and Honest AI Agent Memory"
footer: "Cairn · Context Efficiency"
---

<!-- _class: title -->

# Cairn as a lens on AI agent memory

**Context efficiency, staleness, and whether it actually saves tokens**

A talk built around Cairn's own architecture and decisions.

---

## Why this talk

Three questions kept coming up while outlining "AI agent memory":

1. What could make Cairn even more context-efficient?
2. How does Cairn make sure data isn't stale?
3. Is Cairn actually saving context tokens for the agent?

Grounded in Cairn's real docs: `architecture.md`, ADR 0008/0009/0010,
`project-state.md`, `roadmap.md` — not marketing claims.

---

## The problem with typical agent memory

- Scrollback + note files + one-off "remember this" tools
- No shared schema across work / decisions / docs
- No freshness signal — a fact from 6 months ago looks as confident
  as one from this morning
- Re-deriving "what did we decide and why" costs tokens *every session*

Cairn's bet: one deterministic, local-first SQLite store beats
re-deriving context from raw history each time.

---

## Cairn's three domains

| Domain | Purpose | Freshness signal |
|---|---|---|
| **Work** | issues / tasks / hierarchy | revisions + audit history |
| **Memory** | durable decisions, discoveries | topic-key upsert, (now) age/staleness |
| **Context** | indexed project files | content hash + index status |

Kept deliberately separate — unified search is a **read projection**,
not a shared writable model.

---

## Staleness: work domain

- Optimistic concurrency via revisions (`--if-revision`)
- Every mutation captured in an audit trail (`work history`)
- "Stale" here means *someone else changed this since you last read it*
  → a conflict error, never a silent overwrite

---

## Staleness: context domain

- SHA-256 content hashing — unchanged file ⇒ **zero churn**
- `context status` reports `not_indexed` / `indexed` / `refresh_required`
  — never assumes freshness
- **No background watcher.** Deliberate ADR 0009 deferral:
  deterministic and predictable over "always live"
- A fatal config/discovery failure leaves the previous good index intact

---

## Staleness: memory domain (the gap — now closed)

Before this talk: `createdAt` was just a field, not a signal.
A memory from months ago looked as confident as one from yesterday.

**Shipped for this talk:**

- `ageDays` + `stale` on every memory (default: 90 days, from `updatedAt`)
- Pinned memories are never stale — pinning *is* the "still true" signal
- `--stale-after-days <n>` to override per query
- Amended ADR 0010 to make this an explicit, documented contract

---

## Staleness: context search (the other gap — now closed)

ADR 0009 already refused to claim arbitrary content is fresh —
but only in `context status`, not in search *results themselves*.

**Shipped for this talk:**

- `contentHash` + `indexedAt` on every context search result
  (and on context rows in unified `search`)
- An agent can now decide whether to trust a hit **without**
  a second `context status` call
- Amended ADR 0009

---

## Staleness: stalled blocked work (bonus gap — now closed)

`work ready --explain` already explains *why* something is ready.
Blocked items had no equivalent "is this actually dead?" signal.

**Shipped for this talk:**

- `stalled` + `daysSinceLastBlockerActivity` on `work blocked`
- Default: 30 days with no activity across the blocking chain
- Derived entirely from existing audit timestamps — no new storage
- Amended ADR 0008

---

## Does Cairn save context tokens?

- **One unified search**, not three separate greps across
  scrollback / notes / docs
- **Deterministic weighted BM25**, fixed field weights, stable tie-breaks
  — no embedding calls, no vector index, no re-ranking cost per query
  (explicitly deferred in ADR 0009)
- **Structured JSON contracts** — typed fields, not raw log parsing
- **Safe literal-term OR parsing** — no query-crafting tax on the agent

---

## The honest part

There is **no hard measured "N% token savings" number** — yet.

Only architectural reasoning for why one deterministic structured query
beats re-deriving context from raw scrollback each session.

**Better than citing reasoning alone:** a live before/after demo —
reconstruct a past decision from raw session history vs. one
`cairn memory search` call, with real token/character counts.

---

## What's still open (named on stage, not hidden)

- Memory ↔ work/context backlinks — no first-class link yet from a
  memory to the item/file it explains
- Cursor-based pagination for `work list` / `memory search`
- Cross-referencing confidence for other domains beyond blocked work
  (e.g. a memory nobody has touched or related to in a long time)

Tracked as open Cairn work items under the triage epic — not lost in
a talk-prep doc.

---

## Takeaways

1. Deterministic beats "magic" — no embeddings, no inference, reproducible
2. Staleness is a *design choice per domain*, not a uniform guarantee —
   say so on stage
3. Closing the memory/context/work staleness gaps took **no new
   migrations** — the data already existed, it just wasn't surfaced
4. The real proof of context-efficiency is a live demo with real
   token counts, not architecture slides alone

---

<!-- _class: closing -->

# Questions?

`docs/talk-notes-context-efficiency.md` — full brainstorm and sourcing
`docs/roadmap.md` — "Backlog: candidate ideas" for what's next
