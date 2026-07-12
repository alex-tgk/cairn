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

const HELP = `Cairn ${packageJson.version}

Usage:
  cairn init [path] [--json]
  cairn status [path] [--json]
  cairn doctor [--json]
  cairn --version
  cairn --help
`;

function hasFlag(arguments_: readonly string[], flag: string): boolean {
  return arguments_.includes(flag);
}

function positionalPath(arguments_: readonly string[]): string {
  return arguments_.find((argument) => !argument.startsWith("-")) ?? process.cwd();
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
