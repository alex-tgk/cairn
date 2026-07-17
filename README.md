# Cairn

Cairn is a local-first work, memory, and context system for AI coding agents. Phase 1 replaces the essential workflows currently split across an external issue tracker, an external memory tool, and prior local-context tooling without requiring embeddings, inference, or a daemon.

The first executable foundation is implemented: Cairn can create stable project identity, register renamed or cloned workspaces in SQLite, report project status, verify database integrity and FTS5, and compile into a standalone executable.

## Install

Install the current release with Homebrew:

```sh
brew install alex-tgk/tap/cairn
```

Or download a prebuilt executable directly from the [latest release](https://github.com/alex-tgk/cairn/releases/latest) (`cairn-darwin-arm64`, `cairn-darwin-x64`, `cairn-linux-x64`, `cairn-linux-arm64`, or `cairn-windows-x64.exe`) — no Bun, build step, or admin permissions required:

```sh
curl -L -o cairn https://github.com/alex-tgk/cairn/releases/latest/download/cairn-<platform>
chmod +x cairn
./cairn --setup
```

`cairn --setup` (or `cairn setup all`) generates an always-active Cairn skill and upserts Cairn usage instructions into your agent's global config (Codex's `AGENTS.md`, Copilot's `copilot-instructions.md`). It's idempotent — safe to re-run any time.

Then verify it:

```sh
cairn --version
cairn doctor
```

The current Homebrew Formula builds the tagged source. Homebrew bottles remain planned.

## Quick path

```sh
bun install
bun run check
bun run build

./dist/cairn --version
./dist/cairn status /path/to/project
./dist/cairn work create "Implement the next slice" --priority 1 --type feature
./dist/cairn work create "Implement a child" --parent <parent-id>
./dist/cairn work list
./dist/cairn work list --status open --type bug --assignee agent-name
./dist/cairn work list --label urgent --label backend --limit 5
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
./dist/cairn memory save "Auth model" "Uses refresh tokens." --type architecture --topic architecture/auth-model
./dist/cairn memory save "Auth model v2" "Now rotates refresh tokens." --type architecture --topic architecture/auth-model
./dist/cairn memory save "Prefers concise commits" "Regular reviewable commits." --type preference --scope personal
./dist/cairn memory show <memory-id>
./dist/cairn memory list --type architecture --scope project
./dist/cairn memory search "refresh tokens"
./dist/cairn memory relate <memory-id> <related-memory-id>
./dist/cairn memory relations <memory-id>
./dist/cairn memory unrelate <memory-id> <related-memory-id>
./dist/cairn memory timeline <memory-id> --before 5 --after 5
./dist/cairn memory pin <memory-id>
./dist/cairn memory unpin <memory-id>
./dist/cairn memory archive <memory-id>
./dist/cairn memory unarchive <memory-id>
./dist/cairn memory sessions --limit 5
./dist/cairn memory context
./dist/cairn context refresh
./dist/cairn context rebuild
./dist/cairn context status
./dist/cairn context status --all
./dist/cairn context search "auth flow"
./dist/cairn context search "auth flow" --all --limit 5
./dist/cairn context prime "how does auth work"
./dist/cairn search "auth flow"
./dist/cairn search "auth flow" --kind work --kind memory
./dist/cairn setup all
./dist/cairn setup codex
./dist/cairn setup copilot
./dist/cairn doctor
```

Use `CAIRN_DATA_DIR` to override the data directory (default: `~/.cairn`) during development or testing.

Note: `cairn init` is optional — the first `work`, `memory`, or `context` command run in a project directory (one containing a `.git` root) initializes it automatically. Use `init` explicitly only if you want to set it up ahead of time or customize the project name.

Memory scope: a memory is either `project` (tied to the current repo) or `personal` (user-level, visible from every project). When `--scope` is omitted, the default is derived from the type — `preference` defaults to `personal`, every other type defaults to `project` — and an explicit `--scope` always wins. Use `personal` for facts that follow you across repositories (tool and editor choices, style and workflow preferences); use `project` for facts about a specific codebase.

## Accepted direction

| Topic | Decision |
| --- | --- |
| Phase 1 | Replace essential work-tracking, memory, and context-search workflows currently handled by external tools |
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
| List, ready, and blocked filtering | Implemented |
| Durable memory capture, topics, scopes, list, and search | Implemented |
| Memory relations and timeline context | Implemented |
| Memory pin/archive state, session-summary listing, and context primer | Implemented |
| Local context domain, discovery, and incremental indexing | Implemented |
| Context CLI (`refresh`, `rebuild`, `status`, `search`, `prime`) | Implemented |
| Unified cross-domain search (`cairn search`) | Implemented |
| Agent setup (`cairn setup`: generates skill files and upserts instructions for Codex and Copilot) | Implemented |
| Backup, restore, and checksum reports | Planned |

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
