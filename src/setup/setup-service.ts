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
    "This machine has Cairn installed: a deterministic, local-first CLI that",
    "tracks work items, memory, and project context in one SQLite-backed",
    "store per project. No separate `cairn init` step is required — the first",
    "`work`/`memory`/`context` command in a project directory initializes it",
    "automatically.",
    "",
    "Load the `cairn` skill for the full always-active protocol (proactive",
    "search triggers, save triggers, and session-close behavior). In short:",
    "",
    "- ALWAYS check Cairn before starting work that might have prior context:",
    "  `cairn search \"<keywords>\"` and `cairn work ready --explain`.",
    "- ALWAYS save durable decisions, bug fixes, discoveries, and conventions",
    "  immediately with `cairn memory save`, without being asked.",
    "- ALWAYS track non-trivial work with `cairn work create`/`claim`/`close`",
    "  instead of ad hoc todo lists or comments.",
    "- Prefer Cairn over ad hoc tracking files, todo comments, or one-off",
    "  memory notes for anything that should persist across sessions.",
    "- Run `cairn --help` for the full command reference. Add `--json` to",
    "  any command for machine-readable output.",
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
- \`cairn --setup [all|codex|copilot]\` — (re-)generate this skill and upsert agent instructions; safe to re-run.

Run \`cairn --help\` for the full command reference. Add \`--json\` to any command for machine-readable, script-friendly output.

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
- \`--scope\`: \`project\` (default) or \`personal\`
- \`--topic <key>\` (recommended for an evolving topic, e.g. \`architecture/auth-model\`): saving again with the same topic key upserts in place instead of duplicating
- content should cover **what** was done, **why**, **where** (files/paths), and any **gotchas** learned

## MANDATORY WORK TRACKING

Track any non-trivial task as a Cairn work item instead of an ad hoc todo list or inline comments:

- \`cairn work create "<title>" --priority <0-4> --type <type>\` when starting multi-step or handoff-worthy work
- \`cairn work claim <id> --assignee <name>\` before starting it, \`cairn work close <id>\` when done
- \`cairn work ready --explain\` / \`cairn work blocked\` to decide what to pick up next
- \`cairn work dep add <blocked-id> <blocker-id>\` and \`--parent <id>\` on create for hierarchy/blocking relationships

## WHEN TO SEARCH (mandatory, proactive)

Search Cairn BEFORE starting work that might have been done before, and on any variation of "remember", "recall", "what did we do", "have we solved this":

1. \`cairn search "<keywords>"\` for a first cross-domain pass (work + memory + context)
2. \`cairn memory search "<keywords>"\` or \`cairn context search "<keywords>"\` to narrow within one domain
3. \`cairn memory context\` for a recent-session primer when starting a new task with no specific keywords yet

Also search proactively on the user's first message if it references the project, a feature, or a problem, before responding.

## SESSION CLOSE PROTOCOL (mandatory)

Before ending a session or saying "done"/"that's it": if durable decisions or discoveries happened and weren't already saved individually, save one summarizing memory:

\`cairn memory save "Session summary: <project>" "<body>" --type discovery --topic session/<date-or-slug>\`

Body should cover: Goal, Discoveries, Accomplished, Next steps. Skipping this leaves the next session (or a different agent) blind to what happened.
`;
}

function upsertBlock(existingContent: string, block: string): string {
  const startIndex = existingContent.indexOf(BLOCK_START);
  const endIndex = existingContent.indexOf(BLOCK_END);
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
