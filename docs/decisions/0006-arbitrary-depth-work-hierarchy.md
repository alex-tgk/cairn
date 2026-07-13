# Support arbitrary-depth single-parent work hierarchy

## Status

Accepted July 12, 2026.

## Context

Agents need to decompose work beyond a fixed epic/feature/task structure. A work item may need subtasks that are themselves decomposed further, while ready/blocked scheduling must remain explainable.

Allowing multiple structural parents would turn the hierarchy into a directed acyclic graph and make ownership, traversal, and completion semantics harder to understand. Treating parent/child links as blockers would also conflate decomposition with execution order.

## Decision

- A work item may have zero or one immediate parent in the same project.
- Work hierarchy has no product-imposed depth limit. Any work-item type may appear at any level.
- Parent/child links describe structural decomposition only. Explicit blocking dependencies determine ready/blocked state.
- Parent assignment must reject self-parenting, cross-project parenting, and direct or indirect cycles.
- Ancestor, descendant, and tree queries use recursive SQLite CTEs with deterministic sibling ordering.
- Closing a parent with open descendants is rejected with an explanation. Parents are never closed automatically.
- Multiple-parent use cases must use explicit non-hierarchical relations rather than weakening the hierarchy into a DAG.

## Consequences

- Every item has one unambiguous path to its root, while roots form a project forest.
- Epic, feature, task, bug, and chore types do not encode hierarchy depth.
- Blocking dependencies remain independently queryable and may be many-to-many.
- Cycle checks and open-descendant checks must run transactionally with mutations.
- Imports must reject or explicitly report hierarchy cycles and cross-project parent links.
