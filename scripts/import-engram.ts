#!/usr/bin/env bun

// Imports observations exported from Engram (`engram export`, JSON format)
// into Cairn memories. Each observation becomes one memory; sessions and
// prompts are not imported (Cairn has no equivalent concept for either, and
// ADR 0010 defers anything beyond the essential save/search/topic contract).
//
// Usage:
//   bun run scripts/import-engram.ts <engram-export.json> --path <dir> [--data-dir <dir>] [--project <name>] [--dry-run] [--json]
//
// Idempotent: every imported memory is saved with topic
// `import/engram/<sync_id>`, so re-running the script upserts the same
// memory in place instead of duplicating it (per ADR 0010's topic-upsert
// rule).

import { readFileSync } from "node:fs";

import { saveMemory } from "../src/memory/memory-service.ts";
import { MEMORY_TYPES } from "../src/memory/memory.ts";

type EngramObservation = Readonly<{
  id: number;
  sync_id: string;
  session_id: string;
  type: string;
  title: string;
  content: string;
  project: string;
  scope: string;
  topic_key?: string | null;
}>;

type EngramExport = Readonly<{
  version?: string;
  exported_at?: string;
  sessions?: readonly unknown[];
  observations?: readonly EngramObservation[];
  prompts?: readonly unknown[];
}>;

type Options = Readonly<{
  file: string;
  path: string;
  dataDirectory: string | undefined;
  project: string | undefined;
  dryRun: boolean;
  json: boolean;
}>;

// Engram has used at least one type ("refactor") outside Cairn's closed
// MEMORY_TYPES set. Map any unknown type to the closest existing Cairn type
// rather than failing the import.
const TYPE_FALLBACKS: Record<string, (typeof MEMORY_TYPES)[number]> = {
  refactor: "pattern",
};

function parseArguments(argv: readonly string[]): Options {
  const positional: string[] = [];
  let path: string | undefined;
  let dataDirectory: string | undefined;
  let project: string | undefined;
  let dryRun = false;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--path") {
      index += 1;
      path = argv[index];
    } else if (argument === "--data-dir") {
      index += 1;
      dataDirectory = argv[index];
    } else if (argument === "--project") {
      index += 1;
      project = argv[index];
    } else if (argument === "--dry-run") {
      dryRun = true;
    } else if (argument === "--json") {
      json = true;
    } else if (argument.length > 0) {
      positional.push(argument);
    }
  }

  const file = positional[0];
  if (!file) {
    console.error(
      "Usage: bun run scripts/import-engram.ts <engram-export.json> --path <dir> [--data-dir <dir>] [--project <name>] [--dry-run] [--json]",
    );
    process.exit(2);
  }

  return {
    dataDirectory,
    dryRun,
    file,
    json,
    path: path ?? process.cwd(),
    project,
  };
}

function normalizeType(type: string): (typeof MEMORY_TYPES)[number] {
  if ((MEMORY_TYPES as readonly string[]).includes(type)) {
    return type as (typeof MEMORY_TYPES)[number];
  }
  return TYPE_FALLBACKS[type] ?? "discovery";
}

function normalizeScope(scope: string): "project" | "personal" {
  return scope === "personal" ? "personal" : "project";
}

function context(options: Options): Readonly<{ path: string; dataDirectory?: string }> {
  return options.dataDirectory === undefined
    ? { path: options.path }
    : { dataDirectory: options.dataDirectory, path: options.path };
}

async function importObservation(
  observation: EngramObservation,
  options: Options,
): Promise<{ id: string; syncId: string }> {
  const topic = `import/engram/${observation.sync_id}`;
  if (options.dryRun) {
    return { id: "", syncId: observation.sync_id };
  }

  const saved = await saveMemory({
    ...context(options),
    content: observation.content,
    scope: normalizeScope(observation.scope),
    title: observation.title,
    topic,
    type: normalizeType(observation.type),
  });

  return { id: saved.id, syncId: observation.sync_id };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const parsed = JSON.parse(readFileSync(options.file, "utf8")) as EngramExport;
  const allObservations = parsed.observations ?? [];
  const observations = options.project
    ? allObservations.filter((observation) => observation.project === options.project)
    : allObservations;

  const results: { id: string; syncId: string }[] = [];
  for (const observation of observations) {
    results.push(await importObservation(observation, options));
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          dryRun: options.dryRun,
          imported: results.map((result) => ({ id: result.id, syncId: result.syncId })),
          importedCount: results.length,
          totalObservations: allObservations.length,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `${options.dryRun ? "[dry-run] " : ""}Imported ${results.length} of ${allObservations.length} observation(s)${options.project ? ` for project "${options.project}"` : ""}.`,
    );
  }
}

await main();
