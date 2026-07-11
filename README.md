# Cairn

Cairn is a planned local-first memory engine for AI agents. Its core purpose is to let one agent leave durable, structured context that another agent can recover later without requiring embeddings, an inference model, or a network service.

The project is currently in product definition and architecture planning. No implementation stack has been selected yet.

## Start here

1. Read the [product brief](docs/product-brief.md) for the problem, users, scope, and success criteria.
2. Read the [architecture direction](docs/architecture.md) for system boundaries and the proposed walking skeleton.
3. Read the [roadmap](docs/roadmap.md) for decision gates and delivery milestones.
4. Use the [documentation index](docs/README.md) to find accepted decisions.

## Accepted direction

| Topic | Decision |
| --- | --- |
| Name | Cairn is both the product and repository name. |
| Initial boundary | Build the durable memory capability first; broader project and code context comes later. |
| Runtime dependency | Core operations must work without embeddings or an inference model. |
| Operating model | Local-first, self-contained, deterministic, and explainable. |

## Initial outcome

The first usable release should prove one complete path:

> An agent saves a structured memory, a later process retrieves it using deterministic criteria, and the result explains where it came from.

## Initial non-goals

- Semantic or graph retrieval powered by a model
- Repository indexing and code intelligence
- A graphical interface
- Multi-user or hosted operation
- Replacing Serena or codebase-memory

These boundaries protect the first release from inheriting the operational cost and failure modes of the current multi-service stack.
