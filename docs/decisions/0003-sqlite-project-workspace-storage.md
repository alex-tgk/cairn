# ADR 0003: Use SQLite with stable project and workspace identity

## Status

Accepted July 11, 2026.

## Context

Cairn needs local transactions, dependency queries, full-text retrieval, cross-project search, and operation without a daemon. Absolute paths are not stable identity, as demonstrated by the `brainstorm` to `cairn` directory rename.

Dolt was considered for database history, branching, and synchronization. Those capabilities are not Phase 1 requirements and would add operational complexity.

## Decision

- Use one user-level SQLite database as the source of truth.
- Enable WAL, foreign keys, a busy timeout, versioned migrations, integrity checks, and FTS5.
- Store a stable project UUID in `.cairn/project.toml`.
- Represent every physical checkout, clone, or worktree as a workspace record.
- Store project-relative source paths and hashes rather than treating absolute paths as durable identity.
- Preserve history through explicit audit events and deterministic exports instead of database branching.

## Consequences

- Directory moves update workspace registration without changing project identity.
- Cross-project and personal queries use one database.
- The global database becomes a backup and migration responsibility.
- Multi-machine merge and synchronization remain deferred.
