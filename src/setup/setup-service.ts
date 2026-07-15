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
    "## Cairn (local-first work, memory, and context tracking)",
    "",
    "This machine has Cairn installed: a deterministic, local-first CLI that",
    "tracks work items, memory, and project context in a single SQLite-backed",
    "store per project.",
    "",
    "- Use `cairn work` to create, claim, close, and query work items",
    "  (supports parent/child hierarchy and blocking dependencies).",
    "- Use `cairn memory` to save and search durable memory (decisions,",
    "  patterns, discoveries) instead of ad hoc note files.",
    "- Use `cairn context` to refresh, search, and prime local project",
    "  context.",
    "- Use `cairn search <query> [--all]` for unified read-only search",
    "  across work, memory, and context.",
    "- Run `cairn --help` for the full command reference. Add `--json` to",
    "  any command for machine-readable output.",
    "- Prefer Cairn over ad hoc tracking files, todo comments, or one-off",
    "  memory notes for anything that should persist across sessions.",
    BLOCK_END,
  ].join("\n");
}

function skillFileContent(): string {
  return `# Cairn

Trigger: work tracking, memory, project context, "what should I work on next", "remember this", "have we done this before".

Cairn is a local-first CLI that unifies work tracking, memory, and context search in one deterministic SQLite-backed store per project. Prefer it over ad hoc todo files, note files, or one-off memory tools.

## Commands

- \`cairn work create|show|list|claim|close|reopen|update|ready|blocked|tree|dep|label|note|comment|history\` — work item lifecycle, hierarchy, and blocking dependencies.
- \`cairn memory save|show|list|search|relate|unrelate|relations|timeline|pin|unpin|archive|unarchive|sessions|context\` — durable memory storage and retrieval.
- \`cairn context refresh|rebuild|status|search|prime\` — local project context indexing and search.
- \`cairn search <query> [--all]\` — unified read-only search across work, memory, and context.

Run \`cairn --help\` for the full command reference. Add \`--json\` to any command for machine-readable output.
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
