#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { join } from "node:path";

import packageJson from "../package.json";
import { resolveDataDirectory } from "./platform/data-directory.ts";
import {
  getProjectStatus,
  initializeProject,
  ProjectNotFoundError,
} from "./project/project-service.ts";
import {
  checkDatabaseHealth,
  openCairnDatabase,
} from "./storage/database.ts";
import {
  parseWorkItemStatus,
  parseWorkItemType,
  WorkItemClaimConflictError,
  WorkItemConflictError,
  WorkItemOpenDescendantsError,
  WorkItemRelationError,
  WorkItemTransitionError,
  WorkItemValidationError,
  type WorkItemChanges,
} from "./work/work-item.ts";
import {
  addWorkBlocker,
  addWorkComment,
  addWorkLabel,
  appendWorkNote,
  claimWork,
  clearWorkParent,
  closeWork,
  createWork,
  listBlockedWork,
  listReadyWork,
  listWork,
  listWorkComments,
  listWorkDependencies,
  listWorkHistory,
  listWorkLabels,
  listWorkTree,
  reopenWork,
  removeWorkBlocker,
  removeWorkLabel,
  showWork,
  setWorkParent,
  updateWork,
  WorkItemAmbiguousReferenceError,
  WorkItemNotFoundError,
} from "./work/work-service.ts";
import {
  MemoryConflictError,
  MemoryRelationError,
  MemoryValidationError,
  parseMemoryScope,
  parseMemoryType,
} from "./memory/memory.ts";import {
  listMemories,
  saveMemory,
  searchMemories,
  showMemory,
  getMemoryTimeline,
  listMemoryRelations,
  relateMemories,
  unrelateMemories,
  pinMemory,
  unpinMemory,
  archiveMemory,
  unarchiveMemory,
  listSessionSummaries,
  getContextPrimer,
  MemoryAmbiguousReferenceError,
  MemoryNotFoundError,
} from "./memory/memory-service.ts";
import {
  ContextScopeValidationError,
  getContextStatus,
  primeContextWorkspace,
  runContextIndex,
  searchContextWorkspace,
} from "./context/context-workspace-service.ts";
import {
  ContextQueryValidationError,
  parseContextSearchLimit,
} from "./context/context-query.ts";
import type {
  ContextIndexStatusSummary,
  ContextIndexSummary,
  ContextPrimeView,
  ContextSearchResultView,
} from "./context/context-service.ts";
import { SEARCH_ENTITY_KINDS, type SearchEntityKind } from "./search/search-repository.ts";
import { parseSearchLimit, SearchQueryValidationError } from "./search/search-query.ts";
import type { SearchResultView } from "./search/search-service.ts";
import {
  SearchScopeValidationError,
  searchWorkspace,
} from "./search/search-workspace-service.ts";
import {
  parseExternalDependencyEdges,
  parseExternalIssuesJsonl,
  parseExternalMemoryExport,
} from "./migration/migration.ts";
import {
  importContextEntries,
  importMemories,
  importWorkItems,
} from "./migration/migration-service.ts";
import { runSetupCommand, isSetupTargetOption } from "./setup/setup-service.ts";

const HELP = `Cairn ${packageJson.version}

Usage:
  cairn init [path] [--json]
  cairn status [path] [--json]
  cairn doctor [--json]
  cairn work create <title> [--description <text>] [--priority <0-4>]
                    [--type <type>] [--assignee <name>] [--parent <id>]
                    [--path <path>] [--json]
  cairn work show <id> [--path <path>] [--json]
  cairn work list [--status <status>] [--priority <0-4>] [--type <type>]
                  [--assignee <name> | --unassigned]
                  [--label <label> ...] [--parent <id> | --root]
                  [--limit <n>] [--path <path>] [--json]
  cairn work claim <id> --assignee <name> [--if-revision <n>] [--path <path>] [--json]
  cairn work close <id> [--if-revision <n>] [--path <path>] [--json]
  cairn work reopen <id> [--if-revision <n>] [--path <path>] [--json]
  cairn work history <id> [--path <path>] [--json]
  cairn work tree [id] [--path <path>] [--json]
  cairn work dep add <blocked-id> <blocker-id> [--if-revision <n>] [--path <path>] [--json]
  cairn work dep remove <blocked-id> <blocker-id> [--if-revision <n>] [--path <path>] [--json]
  cairn work dep list <id> [--direction <blockers|dependents>] [--path <path>] [--json]
  cairn work label add <id> <label> [--if-revision <n>] [--path <path>] [--json]
  cairn work label remove <id> <label> [--if-revision <n>] [--path <path>] [--json]
  cairn work label list <id> [--path <path>] [--json]
  cairn work note append <id> <text> [--if-revision <n>] [--path <path>] [--json]
  cairn work comment add <id> <author> <body> [--if-revision <n>] [--path <path>] [--json]
  cairn work comment list <id> [--path <path>] [--json]
  cairn work ready [--explain] [--status <status>] [--priority <0-4>]
                   [--type <type>] [--assignee <name> | --unassigned]
                   [--label <label> ...] [--parent <id> | --root]
                   [--limit <n>] [--path <path>] [--json]
  cairn work blocked [--status <status>] [--priority <0-4>] [--type <type>]
                     [--assignee <name> | --unassigned]
                     [--label <label> ...] [--parent <id> | --root]
                     [--limit <n>] [--path <path>] [--json]
  cairn work update <id> [--title <text>] [--description <text>]
                    [--priority <0-4>] [--type <type>]
                    [--assignee <name> | --clear-assignee]
                    [--parent <id> | --clear-parent]
                    [--if-revision <n>]
                    [--path <path>] [--json]
  cairn memory save <title> <content> --type <type> [--scope <project|personal>]
                     [--topic <key>] [--path <path>] [--json]
  cairn memory show <id> [--path <path>] [--json]
  cairn memory list [--type <type>] [--scope <project|personal>]
                     [--topic <key>] [--limit <n>] [--include-archived]
                     [--path <path>] [--json]
  cairn memory search <query> [--type <type>] [--scope <project|personal>]
                       [--topic <key>] [--limit <n>] [--include-archived]
                       [--path <path>] [--json]
  cairn memory relate <id> <related-id> [--path <path>] [--json]
  cairn memory unrelate <id> <related-id> [--path <path>] [--json]
  cairn memory relations <id> [--path <path>] [--json]
  cairn memory timeline <id> [--before <n>] [--after <n>] [--path <path>] [--json]
  cairn memory pin <id> [--path <path>] [--json]
  cairn memory unpin <id> [--path <path>] [--json]
  cairn memory archive <id> [--path <path>] [--json]
  cairn memory unarchive <id> [--path <path>] [--json]
  cairn memory sessions [--scope <project|personal>] [--limit <n>]
                        [--path <path>] [--json]
  cairn memory context [--limit <n>] [--path <path>] [--json]
  cairn context refresh [--all] [--path <path>] [--json]
  cairn context rebuild [--all] [--path <path>] [--json]
  cairn context status [--all] [--path <path>] [--json]
  cairn context search <query> [--all] [--path <path>] [--limit <n>] [--json]
  cairn context prime <question> [--path <path>] [--limit <n>] [--json]
  cairn search <query> [--all] [--path <path>] [--kind <kind>]
               [--limit <n>] [--json]
  cairn setup <all|codex|copilot> [--home <dir>] [--json]
  cairn --setup [all|codex|copilot] [--home <dir>] [--json]
               (defaults to "all" when no target is given)
  cairn --version
  cairn --help
`;

function hasFlag(arguments_: readonly string[], flag: string): boolean {
  return arguments_.includes(flag);
}

function positionalPath(arguments_: readonly string[]): string {
  return arguments_.find((argument) => !argument.startsWith("-")) ?? process.cwd();
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

function optionValues(
  arguments_: readonly string[],
  option: string,
): readonly string[] {
  const values: string[] = [];
  for (const [index, argument] of arguments_.entries()) {
    if (argument !== option) {
      continue;
    }
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${option}`);
    }
    values.push(value);
  }
  return values;
}

function optionalRevision(arguments_: readonly string[]): number | undefined {
  const value = optionValue(arguments_, "--if-revision");
  if (value === undefined) {
    return undefined;
  }
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 1) {
    throw new WorkItemValidationError(
      "Expected revision must be a positive integer",
    );
  }
  return revision;
}

function workListFilter(arguments_: readonly string[]) {
  const statusValue = optionValue(arguments_, "--status");
  const priorityValue = optionValue(arguments_, "--priority");
  const typeValue = optionValue(arguments_, "--type");
  const limitValue = optionValue(arguments_, "--limit");
  const assignee = optionValue(arguments_, "--assignee");
  const unassigned = hasFlag(arguments_, "--unassigned");
  const parent = optionValue(arguments_, "--parent");
  const root = hasFlag(arguments_, "--root");
  if (assignee !== undefined && unassigned) {
    throw new Error("Use either --assignee or --unassigned, not both");
  }
  if (parent !== undefined && root) {
    throw new Error("Use either --parent or --root, not both");
  }
  const labels = optionValues(arguments_, "--label");
  let limit: number | undefined;
  if (limitValue !== undefined) {
    limit = Number(limitValue);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new WorkItemValidationError(
        "Result limit must be a positive integer",
      );
    }
  }
  return {
    assignee,
    labels: labels.length === 0 ? undefined : labels,
    limit,
    parent,
    priority: priorityValue === undefined ? undefined : Number(priorityValue),
    root: root ? true : undefined,
    status: statusValue === undefined
      ? undefined
      : parseWorkItemStatus(statusValue),
    type: typeValue === undefined ? undefined : parseWorkItemType(typeValue),
    unassigned: unassigned ? true : undefined,
  };
}

function workItemChanges(arguments_: readonly string[]): WorkItemChanges {
  const assignee = optionValue(arguments_, "--assignee");
  const clearAssignee = hasFlag(arguments_, "--clear-assignee");
  if (assignee !== undefined && clearAssignee) {
    throw new Error("Use either --assignee or --clear-assignee, not both");
  }
  const description = optionValue(arguments_, "--description");
  const priority = optionValue(arguments_, "--priority");
  const title = optionValue(arguments_, "--title");
  const type = optionValue(arguments_, "--type");
  return {
    ...(assignee === undefined ? {} : { assignee }),
    ...(clearAssignee ? { assignee: null } : {}),
    ...(description === undefined ? {} : { description }),
    ...(priority === undefined ? {} : { priority: Number(priority) }),
    ...(title === undefined ? {} : { title }),
    ...(type === undefined ? {} : { type: parseWorkItemType(type) }),
  };
}

function printResult(value: object, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    console.log(`${key}: ${String(entry)}`);
  }
}

function printWorkList(
  items: Awaited<ReturnType<typeof listWork>>,
  json: boolean,
): void {
  if (json) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }
  if (items.length === 0) {
    console.log("No work items.");
    return;
  }
  for (const item of items) {
    console.log(
      `${item.shortId}: ${item.title} [${item.status}, p${item.priority}, ${item.type}]`,
    );
  }
}

function printWorkHistory(
  events: Awaited<ReturnType<typeof listWorkHistory>>,
  json: boolean,
): void {
  if (json) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }
  for (const event of events) {
    console.log(
      `${event.createdAt}: r${event.revision} ${event.eventType} ${JSON.stringify(event.payload)}`,
    );
  }
}

function printWorkTree(
  nodes: Awaited<ReturnType<typeof listWorkTree>>,
  json: boolean,
): void {
  if (json) {
    console.log(JSON.stringify(nodes, null, 2));
    return;
  }
  if (nodes.length === 0) {
    console.log("No work items.");
    return;
  }
  for (const node of nodes) {
    console.log(`${"  ".repeat(node.depth)}${node.shortId}: ${node.title}`);
  }
}

function printDependencies(
  dependencies: Awaited<ReturnType<typeof listWorkDependencies>>,
  json: boolean,
): void {
  if (json) {
    console.log(JSON.stringify(dependencies, null, 2));
    return;
  }
  if (dependencies.length === 0) {
    console.log("No blocking dependencies.");
    return;
  }
  for (const dependency of dependencies) {
    console.log(
      `${dependency.blockedShortId} blocked by ${dependency.blockerShortId}`,
    );
  }
}

function printReadiness(
  items: Awaited<ReturnType<typeof listReadyWork>>,
  json: boolean,
  explain: boolean,
): void {
  if (json) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }
  if (items.length === 0) {
    console.log("No work items.");
    return;
  }
  for (const item of items) {
    const explanation = explain ? ` — ${item.reason}` : "";
    console.log(`${item.shortId}: ${item.title}${explanation}`);
  }
}

function printLabels(labels: readonly string[], json: boolean): void {
  if (json) {
    console.log(JSON.stringify(labels, null, 2));
    return;
  }
  if (labels.length === 0) {
    console.log("No labels.");
    return;
  }
  for (const label of labels) {
    console.log(label);
  }
}

function printComments(
  comments: Awaited<ReturnType<typeof listWorkComments>>,
  json: boolean,
): void {
  if (json) {
    console.log(JSON.stringify(comments, null, 2));
    return;
  }
  if (comments.length === 0) {
    console.log("No comments.");
    return;
  }
  for (const comment of comments) {
    console.log(`${comment.createdAt} ${comment.author}: ${comment.body}`);
  }
}

async function runWorkCommand(
  arguments_: readonly string[],
  json: boolean,
): Promise<number> {
  const [action, primary] = arguments_;
  const path = optionValue(arguments_, "--path") ?? process.cwd();

  if (action === "create") {
    const priorityValue = optionValue(arguments_, "--priority");
    const typeValue = optionValue(arguments_, "--type");
    printResult(
      await createWork({
        assignee: optionValue(arguments_, "--assignee"),
        description: optionValue(arguments_, "--description"),
        parent: optionValue(arguments_, "--parent"),
        path,
        priority: priorityValue === undefined ? undefined : Number(priorityValue),
        title: primary ?? "",
        type: typeValue === undefined ? undefined : parseWorkItemType(typeValue),
      }),
      json,
    );
    return 0;
  }

  if (action === "show") {
    printResult(await showWork({ id: primary ?? "", path }), json);
    return 0;
  }

  if (action === "list") {
    printWorkList(
      await listWork({ path, ...workListFilter(arguments_) }),
      json,
    );
    return 0;
  }

  if (action === "ready") {
    printReadiness(
      await listReadyWork({ path, ...workListFilter(arguments_) }),
      json,
      hasFlag(arguments_, "--explain"),
    );
    return 0;
  }

  if (action === "blocked") {
    printReadiness(
      await listBlockedWork({ path, ...workListFilter(arguments_) }),
      json,
      true,
    );
    return 0;
  }

  if (action === "dep") {
    const operation = primary;
    const id = arguments_[2] ?? "";
    const blocker = arguments_[3] ?? "";
    if (operation === "add") {
      printResult(
        await addWorkBlocker({
          blocker,
          expectedRevision: optionalRevision(arguments_),
          id,
          path,
        }),
        json,
      );
      return 0;
    }
    if (operation === "remove") {
      printResult(
        await removeWorkBlocker({
          blocker,
          expectedRevision: optionalRevision(arguments_),
          id,
          path,
        }),
        json,
      );
      return 0;
    }
    if (operation === "list") {
      const direction = optionValue(arguments_, "--direction") ?? "blockers";
      if (direction !== "blockers" && direction !== "dependents") {
        throw new WorkItemValidationError(
          "Dependency direction must be blockers or dependents",
        );
      }
      printDependencies(
        await listWorkDependencies({ direction, id, path }),
        json,
      );
      return 0;
    }
    throw new WorkItemValidationError(
      `Unknown dependency command: ${operation ?? ""}`,
    );
  }

  if (action === "label") {
    const operation = primary;
    const id = arguments_[2] ?? "";
    const label = arguments_[3] ?? "";
    if (operation === "add") {
      printResult(
        await addWorkLabel({
          expectedRevision: optionalRevision(arguments_),
          id,
          label,
          path,
        }),
        json,
      );
      return 0;
    }
    if (operation === "remove") {
      printResult(
        await removeWorkLabel({
          expectedRevision: optionalRevision(arguments_),
          id,
          label,
          path,
        }),
        json,
      );
      return 0;
    }
    if (operation === "list") {
      printLabels(await listWorkLabels({ id, path }), json);
      return 0;
    }
    throw new WorkItemValidationError(
      `Unknown label command: ${operation ?? ""}`,
    );
  }

  if (action === "note") {
    const operation = primary;
    const id = arguments_[2] ?? "";
    const note = arguments_[3] ?? "";
    if (operation === "append") {
      printResult(
        await appendWorkNote({
          expectedRevision: optionalRevision(arguments_),
          id,
          note,
          path,
        }),
        json,
      );
      return 0;
    }
    throw new WorkItemValidationError(
      `Unknown note command: ${operation ?? ""}`,
    );
  }

  if (action === "comment") {
    const operation = primary;
    const id = arguments_[2] ?? "";
    if (operation === "add") {
      printResult(
        await addWorkComment({
          author: arguments_[3] ?? "",
          body: arguments_[4] ?? "",
          expectedRevision: optionalRevision(arguments_),
          id,
          path,
        }),
        json,
      );
      return 0;
    }
    if (operation === "list") {
      printComments(await listWorkComments({ id, path }), json);
      return 0;
    }
    throw new WorkItemValidationError(
      `Unknown comment command: ${operation ?? ""}`,
    );
  }

  if (action === "claim") {
    printResult(
      await claimWork({
        assignee: optionValue(arguments_, "--assignee") ?? "",
        expectedRevision: optionalRevision(arguments_),
        id: primary ?? "",
        path,
      }),
      json,
    );
    return 0;
  }

  if (action === "close") {
    printResult(
      await closeWork({
        expectedRevision: optionalRevision(arguments_),
        id: primary ?? "",
        path,
      }),
      json,
    );
    return 0;
  }

  if (action === "reopen") {
    printResult(
      await reopenWork({
        expectedRevision: optionalRevision(arguments_),
        id: primary ?? "",
        path,
      }),
      json,
    );
    return 0;
  }

  if (action === "history") {
    printWorkHistory(
      await listWorkHistory({ id: primary ?? "", path }),
      json,
    );
    return 0;
  }

  if (action === "tree") {
    const root = primary === undefined || primary.startsWith("-")
      ? undefined
      : primary;
    printWorkTree(await listWorkTree({ path, root }), json);
    return 0;
  }

  if (action === "update") {
    const parent = optionValue(arguments_, "--parent");
    const clearParent = hasFlag(arguments_, "--clear-parent");
    if (parent !== undefined && clearParent) {
      throw new WorkItemValidationError(
        "Use either --parent or --clear-parent, not both",
      );
    }
    const changes = workItemChanges(arguments_);
    if ((parent !== undefined || clearParent) && Object.keys(changes).length > 0) {
      throw new WorkItemValidationError(
        "Parent changes must be applied separately from metadata changes",
      );
    }
    if (parent !== undefined) {
      printResult(
        await setWorkParent({
          expectedRevision: optionalRevision(arguments_),
          id: primary ?? "",
          parent,
          path,
        }),
        json,
      );
      return 0;
    }
    if (clearParent) {
      printResult(
        await clearWorkParent({
          expectedRevision: optionalRevision(arguments_),
          id: primary ?? "",
          path,
        }),
        json,
      );
      return 0;
    }
    printResult(
      await updateWork({
        changes,
        expectedRevision: optionalRevision(arguments_),
        id: primary ?? "",
        path,
      }),
      json,
    );
    return 0;
  }

  throw new Error(`Unknown Cairn work command: ${action ?? ""}`);
}

function memoryListFilter(arguments_: readonly string[]) {
  const typeValue = optionValue(arguments_, "--type");
  const scopeValue = optionValue(arguments_, "--scope");
  const topic = optionValue(arguments_, "--topic");
  const limitValue = optionValue(arguments_, "--limit");
  let limit: number | undefined;
  if (limitValue !== undefined) {
    limit = Number(limitValue);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new MemoryValidationError("Result limit must be a positive integer");
    }
  }
  return {
    includeArchived: hasFlag(arguments_, "--include-archived") || undefined,
    limit,
    scope: scopeValue === undefined ? undefined : parseMemoryScope(scopeValue),
    topic,
    type: typeValue === undefined ? undefined : parseMemoryType(typeValue),
  };
}

function printMemoryList(
  memories: Awaited<ReturnType<typeof listMemories>>,
  json: boolean,
): void {
  if (json) {
    console.log(JSON.stringify(memories, null, 2));
    return;
  }
  if (memories.length === 0) {
    console.log("No memories.");
    return;
  }
  for (const memory of memories) {
    const topic = memory.topic === null ? "" : ` #${memory.topic}`;
    const markers = `${memory.pinned ? " 📌" : ""}${memory.archived ? " (archived)" : ""}`;
    console.log(
      `${memory.shortId}: ${memory.title} [${memory.type}, ${memory.scope}]${topic}${markers}`,
    );
  }
}

function printMemoryTimeline(
  timeline: Awaited<ReturnType<typeof getMemoryTimeline>>,
  json: boolean,
): void {
  if (json) {
    console.log(JSON.stringify(timeline, null, 2));
    return;
  }
  for (const memory of timeline.before) {
    console.log(`  ${memory.shortId}: ${memory.title}`);
  }
  console.log(`> ${timeline.target.shortId}: ${timeline.target.title}`);
  for (const memory of timeline.after) {
    console.log(`  ${memory.shortId}: ${memory.title}`);
  }
}

function printContextPrimer(
  primer: Awaited<ReturnType<typeof getContextPrimer>>,
  json: boolean,
): void {
  if (json) {
    console.log(JSON.stringify(primer, null, 2));
    return;
  }
  console.log("Pinned memories:");
  if (primer.pinnedMemories.length === 0) {
    console.log("  (none)");
  }
  for (const memory of primer.pinnedMemories) {
    console.log(`  ${memory.shortId}: ${memory.title}`);
  }
  console.log("Most recent session summary:");
  console.log(
    primer.recentSessionSummary === null
      ? "  (none)"
      : `  ${primer.recentSessionSummary.shortId}: ${primer.recentSessionSummary.title}`,
  );
  console.log("Recent memories:");
  if (primer.recentMemories.length === 0) {
    console.log("  (none)");
  }
  for (const memory of primer.recentMemories) {
    console.log(`  ${memory.shortId}: ${memory.title} [${memory.type}]`);
  }
}

function printContextIndexSummaries(
  summaries: readonly ContextIndexSummary[],
  json: boolean,
): void {
  if (json) {
    console.log(JSON.stringify(summaries, null, 2));
    return;
  }
  if (summaries.length === 0) {
    console.log("No registered projects to index.");
    return;
  }
  for (const summary of summaries) {
    console.log(
      `${summary.workspacePath} [${summary.projectId}]: ${summary.status} (${summary.mode})`,
    );
    console.log(
      `  added=${summary.counts.added} updated=${summary.counts.updated} removed=${summary.counts.removed} unchanged=${summary.counts.unchanged} skipped=${summary.counts.skipped} errors=${summary.counts.errors}`,
    );
    for (const error of summary.errors) {
      console.log(`  error: ${error}`);
    }
  }
}

function printContextStatusSummaries(
  statuses: readonly ContextIndexStatusSummary[],
  json: boolean,
): void {
  if (json) {
    console.log(JSON.stringify(statuses, null, 2));
    return;
  }
  if (statuses.length === 0) {
    console.log("No registered projects to report.");
    return;
  }
  for (const status of statuses) {
    console.log(
      `${status.workspacePath} [${status.projectId}]: ${status.state}`,
    );
    if (status.sources.length === 0) {
      console.log("  (no sources configured)");
      continue;
    }
    for (const source of status.sources) {
      console.log(
        `  ${source.name}: ${source.state} (${source.activeDocumentCount}/${source.totalDocumentCount} documents, ${source.versionCount} versions)`,
      );
    }
  }
}

function printContextSearchResult(
  result: ContextSearchResultView,
  json: boolean,
): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.matches.length === 0) {
    console.log(`No context matches for: ${result.query}`);
    return;
  }
  for (const match of result.matches) {
    console.log(`${match.relativePath} [${match.projectId}/${match.workspaceId}]`);
    console.log(`  tags: ${match.tags.join(", ") || "(none)"}`);
    console.log(`  matched: ${match.matchedTerms.join(", ") || "(none)"}`);
    console.log(`  ${match.snippet}`);
  }
}

function printContextPrimeView(
  primer: ContextPrimeView,
  json: boolean,
): void {
  if (json) {
    console.log(JSON.stringify(primer, null, 2));
    return;
  }
  console.log(
    `Project: ${primer.projectIdentity.name} [${primer.projectIdentity.projectId}]`,
  );
  console.log(`Workspace: ${primer.projectIdentity.workspacePath}`);
  console.log(`Index status: ${primer.indexStatus.state}`);
  for (const warning of primer.warnings) {
    console.log(`Warning: ${warning}`);
  }
  if (primer.recommendedCommand !== null) {
    console.log(`Recommended: ${primer.recommendedCommand}`);
  }
  console.log(`Question: ${primer.question}`);
  if (primer.results.length === 0) {
    console.log("No matching context found.");
    return;
  }
  for (const match of primer.results) {
    console.log(`  ${match.relativePath}: ${match.snippet}`);
  }
}

const SEARCH_KIND_ALIASES: Readonly<Record<string, SearchEntityKind>> = {
  context: "context_document",
  context_document: "context_document",
  memory: "memory",
  work: "work_item",
  work_item: "work_item",
};

function parseSearchKinds(
  arguments_: readonly string[],
): readonly SearchEntityKind[] | undefined {
  const values = optionValues(arguments_, "--kind");
  if (values.length === 0) {
    return undefined;
  }
  return values.map((value) => {
    const kind = SEARCH_KIND_ALIASES[value];
    if (kind === undefined) {
      throw new SearchQueryValidationError(
        `Unknown --kind "${value}"; expected one of ${SEARCH_ENTITY_KINDS.join(", ")}`,
      );
    }
    return kind;
  });
}

function printSearchResult(result: SearchResultView, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.matches.length === 0) {
    console.log(`No matches for: ${result.query}`);
    return;
  }
  for (const match of result.matches) {
    const scope =
      match.workspaceId === null
        ? match.projectId
        : `${match.projectId}/${match.workspaceId}`;
    const label = match.sourcePath ?? match.title;
    console.log(`[${match.entityKind}] ${label} (${match.entityId}) [${scope}]`);
    console.log(`  tags: ${match.tags.join(", ") || "(none)"}`);
    console.log(`  matched: ${match.matchedTerms.join(", ") || "(none)"}`);
    console.log(`  ${match.snippet}`);
  }
}

async function runSearchCommand(
  arguments_: readonly string[],
  json: boolean,
): Promise<number> {
  const [query] = arguments_;
  const explicitPath = optionValue(arguments_, "--path");
  const options = {
    all: hasFlag(arguments_, "--all"),
    explicitPath: explicitPath !== undefined,
    path: explicitPath ?? process.cwd(),
  };

  try {
    printSearchResult(
      await searchWorkspace(
        options,
        query ?? "",
        parseSearchKinds(arguments_),
        parseSearchLimit(optionValue(arguments_, "--limit")),
      ),
      json,
    );
    return 0;
  } catch (error) {
    if (
      error instanceof SearchScopeValidationError ||
      error instanceof SearchQueryValidationError
    ) {
      printCliError(error, json);
      return 2;
    }
    throw error;
  }
}

async function runContextCommand(
  arguments_: readonly string[],
  json: boolean,
): Promise<number> {
  const [action, primary] = arguments_;
  const explicitPath = optionValue(arguments_, "--path");
  const options = {
    all: hasFlag(arguments_, "--all"),
    explicitPath: explicitPath !== undefined,
    path: explicitPath ?? process.cwd(),
  };

  try {
    if (action === "refresh" || action === "rebuild") {
      printContextIndexSummaries(
        await runContextIndex(action, options),
        json,
      );
      return 0;
    }

    if (action === "status") {
      printContextStatusSummaries(await getContextStatus(options), json);
      return 0;
    }

    if (action === "search") {
      printContextSearchResult(
        await searchContextWorkspace(
          options,
          primary ?? "",
          parseContextSearchLimit(optionValue(arguments_, "--limit")),
        ),
        json,
      );
      return 0;
    }

    if (action === "prime") {
      printContextPrimeView(
        await primeContextWorkspace(
          options,
          primary ?? "",
          parseContextSearchLimit(optionValue(arguments_, "--limit")),
        ),
        json,
      );
      return 0;
    }
  } catch (error) {
    if (
      error instanceof ContextScopeValidationError ||
      error instanceof ContextQueryValidationError
    ) {
      printCliError(error, json);
      return 2;
    }
    throw error;
  }

  console.error(`Unknown Cairn context command: ${action ?? ""}`);
  return 2;
}

async function runMemoryCommand(
  arguments_: readonly string[],
  json: boolean,
): Promise<number> {
  const [action, primary, secondary] = arguments_;
  const path = optionValue(arguments_, "--path") ?? process.cwd();

  if (action === "save") {
    const typeValue = optionValue(arguments_, "--type");
    if (typeValue === undefined) {
      throw new MemoryValidationError("Memory type is required");
    }
    const scopeValue = optionValue(arguments_, "--scope");
    printResult(
      await saveMemory({
        content: secondary ?? "",
        path,
        scope: scopeValue === undefined ? undefined : parseMemoryScope(scopeValue),
        title: primary ?? "",
        topic: optionValue(arguments_, "--topic"),
        type: parseMemoryType(typeValue),
      }),
      json,
    );
    return 0;
  }

  if (action === "show") {
    printResult(await showMemory({ id: primary ?? "", path }), json);
    return 0;
  }

  if (action === "list") {
    printMemoryList(
      await listMemories({ path, ...memoryListFilter(arguments_) }),
      json,
    );
    return 0;
  }

  if (action === "search") {
    printMemoryList(
      await searchMemories({
        path,
        query: primary ?? "",
        ...memoryListFilter(arguments_),
      }),
      json,
    );
    return 0;
  }

  if (action === "relate") {
    const relatedId = secondary ?? "";
    await relateMemories({ id: primary ?? "", path, relatedId });
    printResult({ id: primary ?? "", related: true, relatedId }, json);
    return 0;
  }

  if (action === "unrelate") {
    const relatedId = secondary ?? "";
    await unrelateMemories({ id: primary ?? "", path, relatedId });
    printResult({ id: primary ?? "", related: false, relatedId }, json);
    return 0;
  }

  if (action === "relations") {
    printMemoryList(
      await listMemoryRelations({ id: primary ?? "", path }),
      json,
    );
    return 0;
  }

  if (action === "timeline") {
    const beforeValue = optionValue(arguments_, "--before");
    const afterValue = optionValue(arguments_, "--after");
    printMemoryTimeline(
      await getMemoryTimeline({
        after: afterValue === undefined ? undefined : Number(afterValue),
        before: beforeValue === undefined ? undefined : Number(beforeValue),
        id: primary ?? "",
        path,
      }),
      json,
    );
    return 0;
  }

  if (action === "pin") {
    printResult(await pinMemory({ id: primary ?? "", path }), json);
    return 0;
  }

  if (action === "unpin") {
    printResult(await unpinMemory({ id: primary ?? "", path }), json);
    return 0;
  }

  if (action === "archive") {
    printResult(await archiveMemory({ id: primary ?? "", path }), json);
    return 0;
  }

  if (action === "unarchive") {
    printResult(await unarchiveMemory({ id: primary ?? "", path }), json);
    return 0;
  }

  if (action === "sessions") {
    const scopeValue = optionValue(arguments_, "--scope");
    const limitValue = optionValue(arguments_, "--limit");
    let limit: number | undefined;
    if (limitValue !== undefined) {
      limit = Number(limitValue);
      if (!Number.isInteger(limit) || limit < 1) {
        throw new MemoryValidationError("Result limit must be a positive integer");
      }
    }
    printMemoryList(
      await listSessionSummaries({
        limit,
        path,
        scope: scopeValue === undefined ? undefined : parseMemoryScope(scopeValue),
      }),
      json,
    );
    return 0;
  }

  if (action === "context") {
    const limitValue = optionValue(arguments_, "--limit");
    printContextPrimer(
      await getContextPrimer({
        path,
        recentLimit: limitValue === undefined ? undefined : Number(limitValue),
      }),
      json,
    );
    return 0;
  }

  throw new Error(`Unknown Cairn memory command: ${action ?? ""}`);
}

async function runImportCommand(
  arguments_: readonly string[],
  json: boolean,
): Promise<number> {
  const [action, file] = arguments_;
  const path = optionValue(arguments_, "--path") ?? process.cwd();
  const dataDirectory = optionValue(arguments_, "--data-dir");
  const dryRun = hasFlag(arguments_, "--dry-run");
  const cairnContext = dataDirectory === undefined
    ? { path }
    : { dataDirectory, path };

  if (action === "work-items") {
    if (file === undefined) {
      throw new Error("Usage: cairn import work-items <file> [--deps <file>]");
    }
    const issues = parseExternalIssuesJsonl(readFileSync(file, "utf8"));
    const depsFile = optionValue(arguments_, "--deps");
    const dependencyEdges = depsFile === undefined
      ? undefined
      : parseExternalDependencyEdges(readFileSync(depsFile, "utf8"));
    printResult(
      await importWorkItems({
        ...cairnContext,
        dryRun,
        issues,
        ...(dependencyEdges === undefined ? {} : { dependencyEdges }),
      }),
      json,
    );
    return 0;
  }

  if (action === "memories") {
    if (file === undefined) {
      throw new Error("Usage: cairn import memories <file> [--project <name>]");
    }
    const parsed = parseExternalMemoryExport(readFileSync(file, "utf8"));
    const project = optionValue(arguments_, "--project");
    printResult(
      await importMemories({
        ...cairnContext,
        dryRun,
        observations: parsed.observations ?? [],
        ...(project === undefined ? {} : { project }),
      }),
      json,
    );
    return 0;
  }

  if (action === "context") {
    const project = optionValue(arguments_, "--project");
    if (file === undefined || project === undefined) {
      throw new Error(
        "Usage: cairn import context <file> --project <name>",
      );
    }
    printResult(
      await importContextEntries({
        ...cairnContext,
        dryRun,
        project,
        sourceDatabasePath: file,
      }),
      json,
    );
    return 0;
  }

  throw new Error(`Unknown Cairn import command: ${action ?? ""}`);
}

export async function runCli(arguments_: readonly string[]): Promise<number> {
  if (arguments_.length === 0 || hasFlag(arguments_, "--help") || hasFlag(arguments_, "-h")) {
    console.log(HELP);
    return 0;
  }

  if (hasFlag(arguments_, "--version") || hasFlag(arguments_, "-v")) {
    console.log(packageJson.version);
    return 0;
  }

  if (hasFlag(arguments_, "--setup")) {
    const setupIndex = arguments_.indexOf("--setup");
    const candidate = arguments_[setupIndex + 1];
    const explicitTarget = candidate !== undefined && isSetupTargetOption(candidate);
    const target = explicitTarget ? candidate : "all";
    const rest = arguments_.filter(
      (_, index) => index !== setupIndex && !(explicitTarget && index === setupIndex + 1),
    );
    return await runSetupCommand([target, ...rest], hasFlag(arguments_, "--json"));
  }

  const [command, ...commandArguments] = arguments_;
  const json = hasFlag(commandArguments, "--json");

  if (command === "init") {
    printResult(
      initializeProject({ path: positionalPath(commandArguments) }),
      json,
    );
    return 0;
  }

  if (command === "status") {
    printResult(
      getProjectStatus({ path: positionalPath(commandArguments) }),
      json,
    );
    return 0;
  }

  if (command === "doctor") {
    const databasePath = join(resolveDataDirectory(), "cairn.db");
    const database = openCairnDatabase(databasePath);
    try {
      printResult(
        { databasePath, ...checkDatabaseHealth(database) },
        json,
      );
      return 0;
    } finally {
      database.close();
    }
  }

  if (command === "work") {
    return await runWorkCommand(commandArguments, json);
  }

  if (command === "memory") {
    return await runMemoryCommand(commandArguments, json);
  }

  if (command === "context") {
    return await runContextCommand(commandArguments, json);
  }

  if (command === "search") {
    return await runSearchCommand(commandArguments, json);
  }

  if (command === "import") {
    return await runImportCommand(commandArguments, json);
  }

  if (command === "setup") {
    return await runSetupCommand(commandArguments, json);
  }

  console.error(`Unknown Cairn command: ${command ?? ""}`);
  console.error(HELP);
  return 2;
}

type CliError = Readonly<{
  code: string;
  details: Readonly<Record<string, unknown>>;
  message: string;
}>;

function describeCliError(error: unknown): CliError {
  if (error instanceof WorkItemConflictError) {
    return {
      code: error.code,
      details: {
        actualRevision: error.actualRevision,
        expectedRevision: error.expectedRevision,
        id: error.workItemId,
      },
      message: error.message,
    };
  }
  if (error instanceof WorkItemClaimConflictError) {
    return {
      code: error.code,
      details: {
        currentAssignee: error.currentAssignee,
        id: error.workItemId,
        requestedAssignee: error.requestedAssignee,
      },
      message: error.message,
    };
  }
  if (error instanceof WorkItemAmbiguousReferenceError) {
    return {
      code: error.code,
      details: {
        candidates: error.candidateIds,
        reference: error.reference,
      },
      message: error.message,
    };
  }
  if (error instanceof WorkItemOpenDescendantsError) {
    return {
      code: error.code,
      details: {
        descendants: error.descendantIds,
        id: error.workItemId,
      },
      message: error.message,
    };
  }
  if (error instanceof WorkItemRelationError) {
    return {
      code: error.code,
      details: {
        id: error.workItemId,
        relatedId: error.relatedWorkItemId,
      },
      message: error.message,
    };
  }
  if (error instanceof WorkItemNotFoundError) {
    return {
      code: error.code,
      details: { reference: error.reference },
      message: error.message,
    };
  }
  if (error instanceof WorkItemValidationError) {
    return { code: "invalid_work_item", details: {}, message: error.message };
  }
  if (error instanceof WorkItemTransitionError) {
    return { code: "invalid_transition", details: {}, message: error.message };
  }
  if (error instanceof MemoryAmbiguousReferenceError) {
    return {
      code: error.code,
      details: {
        candidates: error.candidateIds,
        reference: error.reference,
      },
      message: error.message,
    };
  }
  if (error instanceof MemoryNotFoundError) {
    return {
      code: error.code,
      details: { reference: error.reference },
      message: error.message,
    };
  }
  if (error instanceof MemoryConflictError) {
    return {
      code: error.code,
      details: {
        actualRevision: error.actualRevision,
        expectedRevision: error.expectedRevision,
        id: error.memoryId,
      },
      message: error.message,
    };
  }
  if (error instanceof MemoryValidationError) {
    return { code: "invalid_memory", details: {}, message: error.message };
  }
  if (error instanceof MemoryRelationError) {
    return {
      code: error.code,
      details: { id: error.memoryId },
      message: error.message,
    };
  }
  if (error instanceof ProjectNotFoundError) {
    return { code: "project_not_found", details: {}, message: error.message };
  }
  if (error instanceof ContextScopeValidationError) {
    return { code: error.code, details: {}, message: error.message };
  }
  if (error instanceof ContextQueryValidationError) {
    return { code: error.code, details: {}, message: error.message };
  }
  if (
    error instanceof SearchScopeValidationError ||
    error instanceof SearchQueryValidationError
  ) {
    return { code: error.code, details: {}, message: error.message };
  }
  return {
    code: "command_failed",
    details: {},
    message: error instanceof Error ? error.message : String(error),
  };
}

function printCliError(error: unknown, json: boolean): void {
  const described = describeCliError(error);
  if (json) {
    console.error(JSON.stringify({ error: described }, null, 2));
    return;
  }
  console.error(described.message);
}

if (import.meta.main) {
  try {
    process.exitCode = await runCli(process.argv.slice(2));
  } catch (error) {
    printCliError(error, process.argv.includes("--json"));
    process.exitCode = 1;
  }
}
