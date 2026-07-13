#!/usr/bin/env bun

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
  claimWork,
  clearWorkParent,
  closeWork,
  createWork,
  listWork,
  listWorkHistory,
  listWorkTree,
  reopenWork,
  showWork,
  setWorkParent,
  updateWork,
  WorkItemAmbiguousReferenceError,
  WorkItemNotFoundError,
} from "./work/work-service.ts";

const HELP = `Cairn ${packageJson.version}

Usage:
  cairn init [path] [--json]
  cairn status [path] [--json]
  cairn doctor [--json]
  cairn work create <title> [--description <text>] [--priority <0-4>]
                    [--type <type>] [--assignee <name>] [--parent <id>]
                    [--path <path>] [--json]
  cairn work show <id> [--path <path>] [--json]
  cairn work list [--path <path>] [--json]
  cairn work claim <id> --assignee <name> [--if-revision <n>] [--path <path>] [--json]
  cairn work close <id> [--if-revision <n>] [--path <path>] [--json]
  cairn work reopen <id> [--if-revision <n>] [--path <path>] [--json]
  cairn work history <id> [--path <path>] [--json]
  cairn work tree [id] [--path <path>] [--json]
  cairn work update <id> [--title <text>] [--description <text>]
                    [--priority <0-4>] [--type <type>]
                    [--assignee <name> | --clear-assignee]
                    [--parent <id> | --clear-parent]
                    [--if-revision <n>]
                    [--path <path>] [--json]
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
    printWorkList(await listWork({ path }), json);
    return 0;
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

export async function runCli(arguments_: readonly string[]): Promise<number> {
  if (arguments_.length === 0 || hasFlag(arguments_, "--help") || hasFlag(arguments_, "-h")) {
    console.log(HELP);
    return 0;
  }

  if (hasFlag(arguments_, "--version") || hasFlag(arguments_, "-v")) {
    console.log(packageJson.version);
    return 0;
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
  if (error instanceof ProjectNotFoundError) {
    return { code: "project_not_found", details: {}, message: error.message };
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
