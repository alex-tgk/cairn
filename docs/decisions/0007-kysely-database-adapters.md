# Use Kysely inside database adapters

## Status

Accepted July 13, 2026 and amended the same day after cross-platform verification. This amends the direct-SQL portion of ADR 0004 without changing the TypeScript, Bun, or `bun:sqlite` decisions.

## Context

Cairn's domain-owned repository ports already isolate business behavior from persistence. As the work, memory, and context domains grow, handwritten SQLite row types, positional parameter tuples, and result mapping add repetitive infrastructure code without improving the domain model.

Cairn still depends on SQLite-specific capabilities including FTS5 virtual tables and triggers, recursive CTEs, PRAGMAs, transactional migrations, and integrity checks. A database layer must not hide or weaken those capabilities.

## Decision

- Use Kysely as Cairn's typed SQL query builder inside infrastructure adapters.
- Keep domain and application modules dependent on repository ports, never Kysely types.
- Keep `bun:sqlite` as the physical driver. Do not introduce `better-sqlite3` or another native SQLite runtime.
- Initially pin Kysely `0.28.17`. Keep Cairn's small `bun:sqlite` dialect adapter in-repository so every prepared statement is finalized deterministically before the database closes.
- Do not use `kysely-bun-sqlite` `0.4.0`: Windows CI proved that its unfinalized prepared statements can keep SQLite files locked after Kysely destruction.
- Keep Cairn's ordered migrations embedded in the executable. Kysely's file-based migrator is not the runtime source of truth.
- Use Kysely for ordinary relational selection and mutation. Use parameterized raw SQL for FTS5, triggers, recursive hierarchy queries, cycle checks, PRAGMAs, and integrity operations when it is clearer or required.
- Migrate existing adapters incrementally without changing CLI or domain behavior.

## Consequences

- Table and query shapes gain compile-time checking while Cairn remains SQL-first.
- Kysely is an infrastructure implementation detail, not a promise that Cairn can switch databases without new adapters and migrations.
- The in-repository Bun dialect is deliberately small, remains an infrastructure detail, and must be covered by compiled-binary and cross-platform tests.
- Migration SQL and Kysely database types must remain synchronized through integration tests and review.
