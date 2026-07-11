# Cairn documentation

This directory separates accepted decisions from proposals so contributors can tell what is fixed, what is recommended, and what remains open.

## Product and delivery

| Document | Purpose |
| --- | --- |
| [Product brief](product-brief.md) | Defines the problem, target user, scope, outcomes, and risks. |
| [Architecture](architecture.md) | Defines the system boundary and proposed internal shape. |
| [Roadmap](roadmap.md) | Orders decisions and delivery milestones. |

## Decision records

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](decisions/0001-name-and-initial-scope.md) | Accepted | Use the name Cairn and start with durable memory. |
| [0002](decisions/0002-deterministic-self-contained-core.md) | Accepted | Keep core operation deterministic and model-independent. |

## Status language

- **Accepted**: explicitly decided in the July 10, 2026 project session.
- **Proposed**: a recommended starting point that still needs approval.
- **Open**: unresolved and capable of changing the implementation plan.

## Next documentation step

Resolve the Phase 0 decision gates in the [roadmap](roadmap.md), recording each durable technical choice as an ADR.
