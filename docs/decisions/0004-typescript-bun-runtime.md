# ADR 0004: Build Cairn in strict TypeScript on Bun

## Status

Accepted July 11, 2026, contingent on cross-platform release validation. The database-access clause was amended by [ADR 0007](0007-kysely-database-adapters.md).

## Context

Cairn needs a typed multi-domain model, embedded SQLite and FTS5, fast CLI startup, tests, and standalone distribution. Python, Go, and TypeScript runtimes were considered.

## Decision

- Use strict TypeScript for domain, application, CLI, and infrastructure code.
- Use Bun for execution, `bun:sqlite`, testing, and standalone compilation.
- Keep domain and application modules independent from Bun and SQLite imports.
- Start with direct parameterized SQL behind domain-owned adapters. ADR 0007 later introduces Kysely inside those adapters as the schema grows.
- Reconsider Go only if Bun fails release compatibility, signing, size, or stability requirements.

## Consequences

- Development aligns with the primary maintainer's strongest language.
- End users receive executables and do not need Bun installed.
- CI must verify every supported operating system.
- Bun-specific behavior remains isolated at infrastructure boundaries.
