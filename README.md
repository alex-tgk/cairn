# Cairn

Cairn is a local-first work, memory, and context system for AI coding agents. Phase 1 replaces the essential workflows currently split across Beads, Engram, and `agents-context` without requiring embeddings, inference, or a daemon.

The first executable foundation is implemented: Cairn can create stable project identity, register renamed or cloned workspaces in SQLite, report project status, verify database integrity and FTS5, and compile into a standalone executable.

## Install

Install the current release with Homebrew:

```sh
brew install alex-tgk/tap/cairn
```

Then verify it:

```sh
cairn --version
cairn doctor
```

The current Homebrew Formula builds the tagged source. Prebuilt release executables and Homebrew bottles remain planned.

## Quick path

```sh
bun install
bun run check
bun run build

./dist/cairn --version
./dist/cairn init /path/to/project
./dist/cairn status /path/to/project
./dist/cairn work create "Implement the next slice" --priority 1 --type feature
./dist/cairn work create "Implement a child" --parent <parent-id>
./dist/cairn work list
./dist/cairn work tree [<root-id>]
./dist/cairn work dep add <blocked-id> <blocker-id>
./dist/cairn work dep list <blocked-id>
./dist/cairn work blocked
./dist/cairn work ready --explain
./dist/cairn work show <work-item-id>
./dist/cairn work update <work-item-id> --priority 0 --assignee agent-name
./dist/cairn work claim <work-item-id> --assignee agent-name
./dist/cairn work close <work-item-id>
./dist/cairn work history <work-item-id>
./dist/cairn work label add <work-item-id> <label>
./dist/cairn work label list <work-item-id>
./dist/cairn work note append <work-item-id> "Root cause identified"
./dist/cairn work comment add <work-item-id> <author> "Looks good to me"
./dist/cairn work comment list <work-item-id>
./dist/cairn doctor
```

Use `CAIRN_DATA_DIR` to override the platform data directory during development or testing.

## Accepted direction

| Topic | Decision |
| --- | --- |
| Phase 1 | Replace essential Beads, Engram, and `agents-context` workflows |
| Storage | One user-level SQLite database with FTS5 |
| Identity | Stable project UUID plus separate physical workspace registrations |
| Runtime | Strict TypeScript on Bun with `bun:sqlite` |
| Distribution | Standalone platform executables and a custom Homebrew tap |
| Model dependency | No required embeddings or inference |

## Implementation status

| Capability | Status |
| --- | --- |
| Project manifest and workspace identity | Implemented |
| SQLite migrations, WAL, foreign keys, and FTS5 | Implemented |
| `init`, `status`, `doctor`, JSON output | Implemented |
| macOS, Linux, and Windows CI scaffold | Implemented |
| Source release and Homebrew Formula | Implemented |
| Prebuilt release executables and Homebrew bottles | Planned |
| Work capture, editing, listing, lifecycle, and history | Implemented |
| Arbitrary-depth, single-parent work hierarchy | Implemented |
| Blocking dependencies and ready/blocked explanations | Implemented |
| Comments, labels, and notes | Implemented |
| Durable memory | Planned |
| Local context indexing and unified search | Planned |
| Beads and Engram migration | Planned |

## Documentation

- [Product brief](docs/product-brief.md)
- [Architecture](docs/architecture.md)
- [Roadmap](docs/roadmap.md)
- [Distribution](docs/distribution.md)
- [Decision records](docs/README.md#decision-records)
- [Contributing](CONTRIBUTING.md)

## Non-goals for Phase 1

- Embeddings, vector search, or model-generated memory
- Cloud accounts or multi-user synchronization
- Database branching and merge
- Graphical interface
- Replacing Serena or codebase-memory

## License

Cairn is available under the [MIT License](LICENSE).
