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
import { parseWorkItemType } from "./work/work-item.ts";
import {
  createWork,
  listWork,
  showWork,
} from "./work/work-service.ts";

const HELP = `Cairn ${packageJson.version}

Usage:
  cairn init [path] [--json]
  cairn status [path] [--json]
  cairn doctor [--json]
  cairn work create <title> [--description <text>] [--priority <0-4>]
                    [--type <type>] [--assignee <name>] [--path <path>] [--json]
  cairn work show <id> [--path <path>] [--json]
  cairn work list [--path <path>] [--json]
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
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
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
  items: ReturnType<typeof listWork>,
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
      `${item.id}: ${item.title} [${item.status}, p${item.priority}, ${item.type}]`,
    );
  }
}

function runWorkCommand(arguments_: readonly string[], json: boolean): number {
  const [action, primary] = arguments_;
  const path = optionValue(arguments_, "--path") ?? process.cwd();

  if (action === "create") {
    const priorityValue = optionValue(arguments_, "--priority");
    const typeValue = optionValue(arguments_, "--type");
    printResult(
      createWork({
        assignee: optionValue(arguments_, "--assignee"),
        description: optionValue(arguments_, "--description"),
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
    printResult(showWork({ id: primary ?? "", path }), json);
    return 0;
  }

  if (action === "list") {
    printWorkList(listWork({ path }), json);
    return 0;
  }

  throw new Error(`Unknown Cairn work command: ${action ?? ""}`);
}

export function runCli(arguments_: readonly string[]): number {
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
    return runWorkCommand(commandArguments, json);
  }

  console.error(`Unknown Cairn command: ${command ?? ""}`);
  console.error(HELP);
  return 2;
}

if (import.meta.main) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      console.error(error.message);
      process.exitCode = 1;
    } else {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
