# ADR 0001: Name the project Cairn and start with durable memory

## Status

Accepted on July 10, 2026.

## Context

The project began in a placeholder directory named `brainstorm`. Its purpose is to replace the fragmented local AI memory-management workflow with a coherent tool.

The current local stack also includes repository context, graph synthesis, and code-intelligence tools. Treating all of them as the first replacement target would combine several different problem domains and make it difficult to ship a trustworthy core.

## Decision

- Use **Cairn** as both the product and repository name.
- Build durable memory first.
- Defer broader repository and project context until the memory core is proven.
- Keep Serena and codebase-memory outside the initial replacement boundary.

The name reflects durable markers left behind so later travelers—or agents—can recover the path.

## Consequences

- Product language should use `memory`, `record`, `scope`, `topic`, `timeline`, and `provenance` before generic `context` language.
- Initial acceptance criteria must describe capture and retrieval, not repository indexing or generated synthesis.
- Existing context tools continue operating during the first phases.
- A later context phase requires its own product exploration and ADRs.
