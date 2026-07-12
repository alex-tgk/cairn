# Contributing to Cairn

Cairn is early-stage. Contributions should preserve its deterministic, local-first core and arrive as small verified vertical slices.

## Development setup

```sh
git clone https://github.com/alex-tgk/cairn.git
cd cairn
bun install --frozen-lockfile
bun run check
bun run build
```

## Before changing code

1. Read `AGENTS.md` and `docs/project-state.md`.
2. Confirm the work belongs to the current roadmap slice.
3. Read relevant ADRs.
4. Add an ADR before changing an accepted boundary.

## Pull requests

- Keep one behavior or decision per pull request.
- Add tests before implementation changes.
- Include migrations, CLI/JSON behavior, and documentation in the same work unit.
- Run `bun run check` and `bun run build` before opening the pull request.
- Use Conventional Commit messages and never add AI attribution.
