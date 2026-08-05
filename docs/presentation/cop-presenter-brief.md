# CoP Presenter Brief

Hi AI Community of Practice,

Thanks so much for inviting me to share with the AI Powered Engineering
Community of Practice. I am looking forward to it.

---

## Presentation Overview

**Presenter:** Alex Carroll

**Title:**

> Build Your Own AI Agent Memory — Or Just Use Cairn

**Subtitle / One-liner:**

> A practical walkthrough of what it takes to give coding agents durable,
> trustworthy context — and how a local, deterministic tool can provide it.

**Target audience:**

> Engineers working with AI coding agents, especially developer-experience,
> platform, and engineering-productivity teams. The session is useful to any
> engineer considering a memory, context, or work-tracking layer for agents.

**Estimated time:**

> 25 minutes for the presentation, plus 10–15 minutes for Q&A.

---

## Session Content

**Demo / Walkthrough:**

> I will walk through the design of a local agent-memory system from first
> principles, showing the practical concerns that appear when moving beyond
> a note file or a single chat session: durable storage, migrations,
> work-tracking relationships, typed memories, fresh project context, and a
> small retrieval interface. I will then use Cairn's CLI examples to show the
> resulting workflow: capture work and decisions, retrieve relevant context,
> and tell whether the result is current.

**How it works / Discovery:**

> The starting problem is that coding-agent sessions begin without the
> decisions, work state, and project context accumulated in earlier sessions.
> It is tempting to build a quick local solution, but the system becomes more
> complex as soon as it must stay correct under changing data and multiple
> writers. Building Cairn made the hidden requirements concrete: separate work,
> memory, and context domains; versioned SQLite migrations; auditability;
> explicit staleness signals; and deterministic retrieval rather than an
> inference-dependent black box.

**Takeaways for engineers:**

> Attendees will leave with a useful checklist for evaluating or designing
> agent-memory tooling: make the source of truth queryable, distinguish
> structural work hierarchy from blocking dependencies, design for revision and
> freshness, and keep the session-start retrieval path cheap and predictable.
> They will also see how a local-first CLI can make that workflow immediately
> usable without standing up a service or depending on an embedding model.

**Content bullet points:**

1. Why an AI coding agent loses important context between sessions.
2. What “just build it” actually entails: storage, migrations, and concurrency.
3. Work tracking: hierarchy, blocking dependencies, audit history, and revisions.
4. Durable memory: typed facts, project versus personal scope, and evolving decisions.
5. Context search: indexing, freshness, deterministic ranking, and token efficiency.
6. A unified retrieval interface for work, memory, and context.
7. What Cairn provides out of the box, plus the trade-offs and remaining gaps.

---

## Supporting Docs / Repos

- [Cairn repository README](https://github.com/alex-tgk/cairn/blob/main/README.md)
- [Presentation slide source](https://github.com/alex-tgk/cairn/blob/main/docs/presentation/cairn-cop-talk-slides.md)
- [Presentation prep notes](https://github.com/alex-tgk/cairn/blob/main/docs/presentation/cairn-cop-talk-notes.md)
- [Cairn architecture](https://github.com/alex-tgk/cairn/blob/main/docs/architecture.md)
- [Cairn roadmap](https://github.com/alex-tgk/cairn/blob/main/docs/roadmap.md)

---

## Anything Else?

> This is intended as a practical engineering talk rather than a product
> pitch. No attendee setup is required. The source deck and supporting notes
> can be shared after the session. I would welcome Q&A on the trade-offs of
> local-first, deterministic retrieval versus more inference-heavy approaches.

Thanks again,

Alex Carroll
AI Powered Engineering CoP
