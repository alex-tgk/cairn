# Cairn documentation

Start with the product boundary, then follow the architecture and roadmap into implementation.

## Product and delivery

| Document | Purpose |
| --- | --- |
| [Product brief](product-brief.md) | Defines Phase 1 functionality and success criteria. |
| [Architecture](architecture.md) | Defines domains, storage, identity, and implemented boundaries. |
| [Roadmap](roadmap.md) | Orders the implementation slices. |
| [Distribution](distribution.md) | Defines binaries, CI, releases, and Homebrew delivery. |
| [Project state](project-state.md) | Gives every agent the current implementation handoff. |

## Decision records

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](decisions/0001-name-and-initial-scope.md) | Accepted | Cairn replaces work, memory, and context workflows. |
| [0002](decisions/0002-deterministic-self-contained-core.md) | Accepted | Core operation remains deterministic and model-independent. |
| [0003](decisions/0003-sqlite-project-workspace-storage.md) | Accepted | SQLite is the source of truth with stable project/workspace identity. |
| [0004](decisions/0004-typescript-bun-runtime.md) | Accepted | Build the CLI in strict TypeScript on Bun. |
| [0005](decisions/0005-standalone-binaries-homebrew-tap.md) | Accepted | Ship standalone binaries and use a custom Homebrew tap first. |
| [0006](decisions/0006-arbitrary-depth-work-hierarchy.md) | Accepted | Use arbitrary-depth, single-parent work hierarchy separate from blocking dependencies. |
| [0007](decisions/0007-kysely-database-adapters.md) | Accepted | Use Kysely as typed SQL inside infrastructure adapters while retaining `bun:sqlite`. |
| [0008](decisions/0008-essential-beads-cutover-contract.md) | Accepted | Complete the Beads cutover with revisions, atomic claims, explainable readiness, and essential collaboration. |

## Status language

- **Accepted**: approved product or architecture direction.
- **Implemented**: present in code and covered by verification.
- **Planned**: in Phase 1 but not implemented yet.
- **Deferred**: intentionally outside Phase 1.
