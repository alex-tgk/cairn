# Cairn agent instructions

Cairn is a local-first CLI that will replace essential Beads, Engram, and `agents-context` workflows with one deterministic SQLite system.

## Start here

1. Read [README.md](README.md) for commands and current capability status.
2. Read [docs/project-state.md](docs/project-state.md) for the live handoff and next slice.
3. Read [docs/architecture.md](docs/architecture.md) before changing boundaries or storage.
4. Read [docs/roadmap.md](docs/roadmap.md) before selecting work.
5. Read relevant ADRs under `docs/decisions/` before revisiting a decision.

## Build and verify

```sh
bun install --frozen-lockfile
bun run check
bun run build
./dist/cairn --version
./dist/cairn doctor --json
```

Use `CAIRN_DATA_DIR` for isolated development and test runs. Never commit SQLite database files, secrets, tokens, or machine-local paths.

## Architecture rules

- Keep work, memory, and context as separate domains.
- Treat unified search as a read projection, not a generic writable model.
- Keep domain and application code independent from Bun and `bun:sqlite`.
- Use parameterized SQL behind domain-owned storage adapters.
- Identify projects by the UUID in `.cairn/project.toml`; absolute paths belong only to workspace records.
- Core behavior must remain deterministic and require no embedding or inference model.
- Add schema changes through ordered migrations with integration tests.

## Engineering workflow

- Use test-driven vertical slices: failing behavior test, minimal implementation, refactor.
- Run `bun run check` and a compiled-binary smoke test before committing.
- Commit with Conventional Commits and keep each commit to one reviewable work unit.
- Do not add `Co-Authored-By` or AI attribution.
- Push verified commits regularly so work is recoverable by other agents.
- Preserve unrelated local changes and never commit `.serena/` or generated build output.

## Cross-agent continuity

Chat history and agent-specific memory are not project sources of truth.

- Update `docs/project-state.md` whenever implementation status or the next slice changes.
- Record durable product and architecture decisions as ADRs in `docs/decisions/`.
- Update this file when collaboration preferences or engineering rules change.
- Update the README, architecture, roadmap, and distribution docs with the behavior they describe.
- Save useful agent-specific memory as an additional convenience, never as the only record.

## Current implementation boundary

Implemented: project manifests, platform data directories, SQLite migrations 1-2, project/workspace registration, FTS5 health, `init`, `status`, `doctor`, `work create`, `work show`, deterministic project-scoped `work list`, JSON output, compiled builds, and cross-platform CI configuration.

Next: work lifecycle and audit history, followed by dependency-based ready/blocked queries as defined in [docs/roadmap.md](docs/roadmap.md).
