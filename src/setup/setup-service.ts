// Generates and upserts agent-facing setup artifacts for external coding
// agents: a skill file describing Cairn's CLI, and an idempotent
// instructions block appended into the agent's global instructions file.
// Re-running `cairn setup` for the same target replaces its block/file in
// place rather than duplicating content.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const SETUP_TARGETS = ["codex", "copilot"] as const;
export type SetupTarget = (typeof SETUP_TARGETS)[number];
export type SetupTargetOption = "all" | SetupTarget;

export type SetupContext = Readonly<{
  homeDirectory?: string;
}>;

type TargetConfig = Readonly<{
  agentsFilePath: (home: string) => string;
  skillFilePath: (home: string) => string;
}>;

const BLOCK_START = "<!-- cairn:setup -->";
const BLOCK_END = "<!-- /cairn:setup -->";

const TARGET_CONFIG: Record<SetupTarget, TargetConfig> = {
  codex: {
    agentsFilePath: (home) => join(home, ".codex", "AGENTS.md"),
    skillFilePath: (home) => join(home, ".codex", "skills", "cairn", "SKILL.md"),
  },
  copilot: {
    agentsFilePath: (home) => join(home, ".copilot", "copilot-instructions.md"),
    skillFilePath: (home) =>
      join(home, ".copilot", "skills", "cairn", "SKILL.md"),
  },
};

function instructionsBlock(): string {
  return [
    BLOCK_START,
    "## Cairn (mandatory: work tracking, memory, and project context)",
    "",
    "Cairn (`cairn`) is a deterministic, local-first CLI that replaces ad hoc",
    "todo lists, note files, and one-off memory tools with one SQLite-backed",
    "store per project. It requires no server, no embedding model, and no",
    "explicit init step — the first `work`/`memory`/`context`/`search` command",
    "run in a project directory creates its manifest automatically.",
    "",
    "Load the `cairn` skill for the full always-active protocol. This section",
    "is the quick-reference summary.",
    "",
    "### Session start",
    "",
    "At the start of any non-trivial task:",
    "",
    "1. Run `cairn status --json` to confirm/identify the current project",
    "   (or let the first `work`/`memory`/`context` command auto-initialize it).",
    "2. Run `cairn search \"<keywords>\" --json` for a first cross-domain pass",
    "   over work items, memory, and project context together.",
    "3. Run `cairn work ready --explain --json` to see unblocked work items,",
    "   and `cairn memory context --json` for a recent-session primer.",
    "4. If resuming prior work, also run `cairn work list --json` and",
    "   `cairn work show <id> --json` for the specific item.",
    "",
    "### During work",
    "",
    "- Track any non-trivial task as a work item instead of ad hoc todos:",
    "  `cairn work create \"<title>\" --priority <0-4> --type <task|bug|feature|epic|chore> --json`.",
    "- Priorities: 0 = critical/highest, 1 = high, 2 = medium (default), 3 = low, 4 = lowest.",
    "- Before starting a tracked item: `cairn work claim <id> --assignee <name> --json`.",
    "- Break down large items: `cairn work create \"Sub-task\" --parent <epic-id> --json`.",
    "- Record blocking relationships: `cairn work dep add <blocked-id> <blocker-id> --json`.",
    "- Add progress notes: `cairn work note append <id> \"<text>\" --json`; use",
    "  `cairn work comment add <id> <author> \"<text>\" --json` for discussion threads.",
    "- Tag items for later filtering: `cairn work label add <id> <label> --json`.",
    "- When you learn a durable fact, convention, decision, or bug fix, save it",
    "  immediately with `cairn memory save \"<title>\" \"<content>\" --type <type> --json`",
    "  — do NOT wait to be asked, and do NOT use ad hoc note files or",
    "  `store_memory`/`vote_memory` for facts that belong in a project's Cairn store.",
    "  Reuse `--topic <key>` for an evolving topic to upsert instead of duplicating.",
    "",
    "### Personal vs project scope",
    "",
    "Memories carry a `--scope`: `project` (tied to this repo) or `personal`",
    "(user-level, visible from EVERY project). Choosing the right scope is what",
    "makes Cairn a user-level memory, not just per-repo notes.",
    "",
    "- Use `--scope personal` for facts that follow YOU across all repositories:",
    "  editor/tool choices (tmux, LazyVim), coding-style and commit preferences,",
    "  workflow habits, environment/credential-location conventions, and any",
    "  cross-repo working agreement.",
    "- Use `--scope project` (the default) for facts about THIS codebase:",
    "  architecture, decisions, bug fixes, discoveries, patterns, and its config.",
    "- Smart default: `preference`-type memories default to `personal`; every",
    "  other type defaults to `project`. Always override explicitly when a",
    "  specific memory doesn't fit its type's default.",
    "- Rule of thumb: if the fact would still be true and useful in a completely",
    "  different repository, it is `personal`; if it only makes sense inside this",
    "  repo, it is `project`.",
    "",
    "### Session end",
    "",
    "- Close completed items: `cairn work close <id> --json` (add `--if-revision <n>`",
    "  for optimistic concurrency when relevant); reopen with `cairn work reopen <id>`.",
    "- File follow-ups as new work items rather than leaving them only in chat.",
    "- Summarize remaining ready work: `cairn work ready --json`.",
    "- Save one closing memory if durable decisions weren't already captured",
    "  individually: `cairn memory save \"Session summary: <project>\" \"<body>\"",
    "  --type session_summary --topic session/<date-or-slug> --json`. Body should",
    "  cover Goal, Discoveries, Accomplished, and Next steps.",
    "",
    "### Command reference",
    "",
    "| Command | Purpose |",
    "|---|---|",
    "| `cairn status --json` | Show current project/workspace identity |",
    "| `cairn doctor --json` | Health check (schema, FTS5, integrity) |",
    "| `cairn search \"<query>\" [--all] --json` | Unified search across work + memory + context |",
    "| `cairn work create \"<title>\" --priority <0-4> --type <t> --json` | Create a work item |",
    "| `cairn work list [--status <s>] [--assignee <a>] --json` | List/filter work items |",
    "| `cairn work show <id> --json` | Work item details |",
    "| `cairn work ready [--explain] --json` | Unblocked, actionable work items |",
    "| `cairn work blocked --json` | Work items still blocked by dependencies |",
    "| `cairn work tree [id] --json` | Parent/child work hierarchy |",
    "| `cairn work claim <id> --assignee <name> --json` | Claim (start) a work item |",
    "| `cairn work update <id> --json` | Edit title/description/priority/type/assignee/parent |",
    "| `cairn work close <id> --json` / `work reopen <id> --json` | Close or reopen |",
    "| `cairn work dep add\\|remove\\|list <ids> --json` | Manage blocking dependencies |",
    "| `cairn work label add\\|remove\\|list <id> <label> --json` | Manage labels |",
    "| `cairn work note append <id> \"<text>\" --json` | Append a progress note |",
    "| `cairn work comment add\\|list <id> ... --json` | Threaded discussion |",
    "| `cairn work history <id> --json` | Full audit trail |",
    "| `cairn memory save \"<title>\" \"<content>\" --type <t> --json` | Save durable memory |",
    "| `cairn memory search\\|list \"<query>\" --json` | Find memories by text/type/topic/scope |",
    "| `cairn memory show <id> --json` | Memory details |",
    "| `cairn memory relate\\|unrelate\\|relations <id> --json` | Link related memories |",
    "| `cairn memory timeline <id> --json` | Memories before/after a given one |",
    "| `cairn memory pin\\|unpin\\|archive\\|unarchive <id> --json` | Lifecycle management |",
    "| `cairn memory sessions --json` | Prior session summaries |",
    "| `cairn memory context --json` | Recent-session primer |",
    "| `cairn context refresh\\|rebuild\\|status\\|search\\|prime --json` | Project context index |",
    "| `cairn --setup [all\\|codex\\|copilot] --json` | (Re-)generate skill + instructions |",
    "",
    "### Rules",
    "",
    "- Use `--json` whenever parsing output programmatically.",
    "- Memory `--type` must be one of: decision, architecture, discovery, pattern,",
    "  bugfix, config, preference, session_summary. `--scope` is `project` (default)",
    "  or `personal`.",
    "- Work `--type` must be one of: task, bug, feature, epic, chore. `--status` is",
    "  one of: open, in_progress, closed.",
    "- Prefer Cairn work items and memories over markdown TODOs, inline comments,",
    "  or one-off note files for anything that should persist across sessions.",
    "- Do this proactively in every session — don't wait for the user to point",
    "  out that Cairn wasn't used.",
    BLOCK_END,
  ].join("\n");
}

function skillFileContent(): string {
  return `---
name: cairn
description: "Local-first work tracking, memory, and project context. ALWAYS ACTIVE. Trigger: starting any task, remembering/recalling past work, tracking todos, project context, architecture decisions, bug fixes, conventions."
license: MIT
metadata:
  author: cairn
  version: "1.0"
---

# Cairn — Full Protocol

Cairn is a local-first CLI that unifies work tracking, memory, and project context in one deterministic SQLite-backed store per project. This protocol is MANDATORY and ALWAYS ACTIVE — not something you activate only when explicitly asked. Prefer Cairn over ad hoc todo files, note files, comments, or one-off memory tools for anything that should persist across sessions or compactions.

No separate \`cairn init\` step is needed: the first \`work\`, \`memory\`, or \`context\` command run in a project directory creates its manifest automatically.

## Commands

- \`cairn work create|show|list|claim|close|reopen|update|ready|blocked|tree|dep|label|note|comment|history\` — work item lifecycle, arbitrary-depth parent/child hierarchy, and blocking dependencies.
- \`cairn memory save|show|list|search|relate|unrelate|relations|timeline|pin|unpin|archive|unarchive|sessions|context\` — durable memory storage and retrieval.
- \`cairn context refresh|rebuild|status|search|prime\` — local project context indexing and search.
- \`cairn search <query> [--all]\` — unified read-only search across work, memory, and context in one query.
- \`cairn status\` / \`cairn doctor\` — current project identity / health check (schema, FTS5, integrity).
- \`cairn --setup [all|codex|copilot]\` — (re-)generate this skill and upsert agent instructions; safe to re-run.

Run \`cairn --help\` for the full command reference. Add \`--json\` to any command for machine-readable, script-friendly output.

## SESSION START (mandatory)

At the start of any non-trivial task, in this order:

1. \`cairn status --json\` — confirm which project/workspace you're in (or let the
   first \`work\`/\`memory\`/\`context\` command auto-initialize a new one; no
   separate \`cairn init\` step is required).
2. \`cairn search "<keywords>" --json\` — a first cross-domain pass over work
   items, memory, and project context together.
3. \`cairn work ready --explain --json\` — see what's unblocked and actionable
   right now, with the reasoning for why each item is or isn't ready.
4. \`cairn memory context --json\` — a recent-session primer when there are no
   specific keywords yet.
5. If resuming a specific item: \`cairn work list --json\` and
   \`cairn work show <id> --json\` for full detail and history.

## DURING WORK

- Track any non-trivial task as a work item instead of an ad hoc todo list:
  \`cairn work create "<title>" --priority <0-4> --type <task|bug|feature|epic|chore> --json\`
- Priority scale: \`0\` = critical/highest, \`1\` = high, \`2\` = medium (default),
  \`3\` = low, \`4\` = lowest.
- Claim before starting: \`cairn work claim <id> --assignee <name> --json\`.
- Break large items into sub-tasks: \`cairn work create "Sub-task" --parent <epic-id> --json\`.
- Record blocking relationships: \`cairn work dep add <blocked-id> <blocker-id> --json\`
  (the blocked item won't show as \`ready\` until its blocker is closed).
- \`cairn work update <id> --json\` edits title/description/priority/type/assignee/parent;
  pass \`--if-revision <n>\` for optimistic concurrency when it matters.
- Append short progress notes with \`cairn work note append <id> "<text>" --json\`;
  use \`cairn work comment add <id> <author> "<text>" --json\` for threaded discussion.
- Tag work for later filtering with \`cairn work label add <id> <label> --json\`.
- \`cairn work tree [id] --json\` shows the parent/child hierarchy;
  \`cairn work history <id> --json\` shows the full audit trail.

## PROACTIVE SAVE TRIGGERS (mandatory — do NOT wait for user to ask)

Call \`cairn memory save <title> <content> --type <type>\` IMMEDIATELY after any of these, without being asked:

- Architecture or design decision made
- Team convention documented or established
- Workflow change agreed upon
- Tool or library choice made with tradeoffs
- Bug fix completed (include root cause)
- Feature implemented with a non-obvious approach
- Configuration change or environment setup done
- Non-obvious discovery about the codebase
- Gotcha, edge case, or unexpected behavior found
- Pattern established (naming, structure, convention)
- User preference or constraint learned

Self-check after EVERY task: "Did I make a decision, fix a bug, learn something non-obvious, or establish a convention? If yes, call \`cairn memory save\` NOW."

Format:
- \`--type\`: one of the values \`cairn memory save --help\` lists (e.g. bugfix, decision, architecture, discovery, pattern, config, preference)
- \`--scope\`: \`project\` (this repo) or \`personal\` (user-level, visible from every project) — see the scope rule below
- \`--topic <key>\` (recommended for an evolving topic, e.g. \`architecture/auth-model\`): saving again with the same topic key upserts in place instead of duplicating
- content should cover **what** was done, **why**, **where** (files/paths), and any **gotchas** learned

## PERSONAL VS PROJECT SCOPE (get this right)

Scope is what makes Cairn a user-level memory rather than per-repo notes. A \`personal\` memory (\`project_id\` is null) is visible from EVERY project; a \`project\` memory is tied to the current repo.

- Use \`--scope personal\` for facts that follow YOU across all repositories:
  editor/tool choices, coding-style and commit preferences, workflow habits,
  environment and credential-location conventions, and cross-repo agreements.
- Use \`--scope project\` (default for most types) for facts about THIS codebase:
  architecture, decisions, bug fixes, discoveries, patterns, and its config.
- **Smart default**: \`preference\`-type memories default to \`personal\`; every
  other type defaults to \`project\`. You can always override with an explicit
  \`--scope\`.
- Rule of thumb: if the fact would still be true and useful in a completely
  different repository, save it \`personal\`; if it only makes sense inside this
  repo, save it \`project\`.

## WHEN TO SEARCH (mandatory, proactive)

Search Cairn BEFORE starting work that might have been done before, and on any variation of "remember", "recall", "what did we do", "have we solved this":

1. \`cairn search "<keywords>" --json\` for a first cross-domain pass (work + memory + context)
2. \`cairn memory search "<keywords>" --json\` or \`cairn context search "<keywords>" --json\` to narrow within one domain
3. \`cairn memory context --json\` for a recent-session primer when starting a new task with no specific keywords yet

Also search proactively on the user's first message if it references the project, a feature, or a problem, before responding.

## COMMAND REFERENCE

| Command | Purpose |
|---|---|
| \`cairn status --json\` | Show current project/workspace identity |
| \`cairn doctor --json\` | Health check (schema, FTS5, integrity) |
| \`cairn search "<query>" [--all] --json\` | Unified search across work + memory + context |
| \`cairn work create "<title>" --priority <0-4> --type <t> --json\` | Create a work item |
| \`cairn work list [--status <s>] [--assignee <a>] --json\` | List/filter work items |
| \`cairn work show <id> --json\` | Work item details |
| \`cairn work ready [--explain] --json\` | Unblocked, actionable work items |
| \`cairn work blocked --json\` | Work items still blocked by dependencies |
| \`cairn work tree [id] --json\` | Parent/child work hierarchy |
| \`cairn work claim <id> --assignee <name> --json\` | Claim (start) a work item |
| \`cairn work update <id> --json\` | Edit title/description/priority/type/assignee/parent |
| \`cairn work close <id> --json\` / \`work reopen <id> --json\` | Close or reopen |
| \`cairn work dep add\\|remove\\|list <ids> --json\` | Manage blocking dependencies |
| \`cairn work label add\\|remove\\|list <id> <label> --json\` | Manage labels |
| \`cairn work note append <id> "<text>" --json\` | Append a progress note |
| \`cairn work comment add\\|list <id> ... --json\` | Threaded discussion |
| \`cairn work history <id> --json\` | Full audit trail |
| \`cairn memory save "<title>" "<content>" --type <t> --json\` | Save durable memory |
| \`cairn memory search\\|list "<query>" --json\` | Find memories by text/type/topic/scope |
| \`cairn memory show <id> --json\` | Memory details |
| \`cairn memory relate\\|unrelate\\|relations <id> --json\` | Link related memories |
| \`cairn memory timeline <id> --json\` | Memories before/after a given one |
| \`cairn memory pin\\|unpin\\|archive\\|unarchive <id> --json\` | Lifecycle management |
| \`cairn memory sessions --json\` | Prior session summaries |
| \`cairn memory context --json\` | Recent-session primer |
| \`cairn context refresh\\|rebuild\\|status\\|search\\|prime --json\` | Project context index |
| \`cairn --setup [all\\|codex\\|copilot] --json\` | (Re-)generate skill + instructions |

## RULES

- Use \`--json\` whenever parsing output programmatically.
- Memory \`--type\` must be one of: decision, architecture, discovery, pattern,
  bugfix, config, preference, session_summary. \`--scope\` is \`project\` (default)
  or \`personal\`.
- Work \`--type\` must be one of: task, bug, feature, epic, chore. \`--status\` is
  one of: open, in_progress, closed. Priority is an integer 0 (critical) to 4 (lowest).
- Prefer Cairn work items and memories over markdown TODOs, inline comments,
  or one-off note files for anything that should persist across sessions.
- Never fabricate work items or memories for testing; use a scratch/temporary
  project directory instead of polluting real project data.
- Do this proactively and aggressively in every session — don't wait for the
  user to point out that Cairn wasn't used.

## SESSION CLOSE PROTOCOL (mandatory)

Before ending a session or saying "done"/"that's it":

- Close completed work items: \`cairn work close <id> --json\`.
- File any follow-ups as new work items rather than leaving them only in chat:
  \`cairn work create "Follow-up: <title>" --priority <0-4> --json\`.
- Summarize remaining ready work: \`cairn work ready --json\`.
- If durable decisions or discoveries happened and weren't already saved
  individually, save one summarizing memory:

  \`cairn memory save "Session summary: <project>" "<body>" --type session_summary --topic session/<date-or-slug> --json\`

  Body should cover: Goal, Discoveries, Accomplished, Next steps. Skipping this
  leaves the next session (or a different agent) blind to what happened.
`;
}

function upsertBlock(existingContent: string, block: string): string {
  // Use lastIndexOf rather than indexOf: the real block is normally the last
  // thing appended to the file, and this avoids misfiring if the literal
  // marker string is ever mentioned earlier in prose (e.g. a bullet point
  // referring readers to "the <!-- cairn:setup --> block below").
  const startIndex = existingContent.lastIndexOf(BLOCK_START);
  const endIndex = existingContent.lastIndexOf(BLOCK_END);
  if (startIndex !== -1 && endIndex !== -1) {
    const before = existingContent.slice(0, startIndex);
    const after = existingContent.slice(endIndex + BLOCK_END.length);
    return `${before}${block}${after}`;
  }
  const trimmed = existingContent.trimEnd();
  return trimmed.length === 0 ? `${block}\n` : `${trimmed}\n\n${block}\n`;
}

export type SetupFileAction = "created" | "updated";

export type SetupFileResult = Readonly<{
  path: string;
  action: SetupFileAction;
}>;

export type SetupTargetResult = Readonly<{
  target: SetupTarget;
  agentsFile: SetupFileResult;
  skillFile: SetupFileResult;
}>;

export type SetupResult = Readonly<{
  targets: readonly SetupTargetResult[];
}>;

function writeAgentsFile(path: string): SetupFileResult {
  const exists = existsSync(path);
  const existingContent = exists ? readFileSync(path, "utf8") : "";
  const updatedContent = upsertBlock(existingContent, instructionsBlock());
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, updatedContent, "utf8");
  return { action: exists ? "updated" : "created", path };
}

function writeSkillFile(path: string): SetupFileResult {
  const exists = existsSync(path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, skillFileContent(), "utf8");
  return { action: exists ? "updated" : "created", path };
}

function applySetupTarget(target: SetupTarget, home: string): SetupTargetResult {
  const config = TARGET_CONFIG[target];
  return {
    agentsFile: writeAgentsFile(config.agentsFilePath(home)),
    skillFile: writeSkillFile(config.skillFilePath(home)),
    target,
  };
}

export function isSetupTargetOption(
  value: string,
): value is SetupTargetOption {
  return value === "all" || (SETUP_TARGETS as readonly string[]).includes(value);
}

export function applySetup(
  target: SetupTargetOption,
  options: SetupContext = {},
): SetupResult {
  const home = options.homeDirectory ?? homedir();
  const targets: readonly SetupTarget[] = target === "all"
    ? SETUP_TARGETS
    : [target];
  return { targets: targets.map((current) => applySetupTarget(current, home)) };
}

function optionValue(
  arguments_: readonly string[],
  option: string,
): string | undefined {
  const index = arguments_.indexOf(option);
  if (index === -1) {
    return undefined;
  }
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

function printSetupResult(result: SetupResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  for (const target of result.targets) {
    console.log(`${target.target}:`);
    console.log(`  agents file: ${target.agentsFile.action} ${target.agentsFile.path}`);
    console.log(`  skill file:  ${target.skillFile.action} ${target.skillFile.path}`);
  }
}

export async function runSetupCommand(
  arguments_: readonly string[],
  json: boolean,
): Promise<number> {
  const [target] = arguments_;
  if (target === undefined || !isSetupTargetOption(target)) {
    console.error(
      `Usage: cairn setup <${["all", ...SETUP_TARGETS].join("|")}> [--home <dir>] [--json]`,
    );
    return 2;
  }

  const homeDirectory = optionValue(arguments_, "--home");
  printSetupResult(
    applySetup(target, homeDirectory === undefined ? {} : { homeDirectory }),
    json,
  );
  return 0;
}
