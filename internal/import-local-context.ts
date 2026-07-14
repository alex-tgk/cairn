#!/usr/bin/env bun

// Internal one-off tool: imports rows from a local RAG/context tool's
// SQLite document index into Cairn memories. Each row becomes one memory,
// scoped to the given Cairn project and filtered to a single source
// project name (the export's own project grouping) at a time. This
// deliberately maps into the memory domain rather than the context
// domain: the source index stores flattened, pre-chunked content without
// the on-disk file hashes Cairn's context indexer needs for incremental
// refresh, so treating each row as a discrete recoverable memory is the
// closest honest fit.
//
// Usage:
//   bun run internal/import-local-context.ts <context-index.sqlite> --path <dir> --project <name> [--data-dir <dir>] [--dry-run] [--json]
//
// Idempotent: every imported memory is saved with topic
// `import/context/<row-id>`, so re-running the script upserts the same
// memory in place instead of duplicating it.

import { Database } from "bun:sqlite";

import { saveMemory } from "../src/memory/memory-service.ts";
import { MEMORY_TYPES } from "../src/memory/memory.ts";

type SourceDocumentRow = Readonly<{
  id: number;
  source: string;
  kind: string;
  title: string;
  path: string;
  project: string;
  tags: string;
  content: string;
}>;

type Options = Readonly<{
  file: string;
  path: string;
  dataDirectory: string | undefined;
  project: string;
  dryRun: boolean;
  json: boolean;
}>;

// The source index's `kind` column mixes real memory types with document
// kinds (file, project-card, contentful-doc, session, prompt) that have no
// direct Cairn memory type. Map anything outside Cairn's closed
// MEMORY_TYPES set to "discovery" as a safe, recoverable default.
const KIND_FALLBACK: (typeof MEMORY_TYPES)[number] = "discovery";

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
  if (!file || !project) {
    console.error(
      "Usage: bun run internal/import-local-context.ts <context-index.sqlite> --path <dir> --project <name> [--data-dir <dir>] [--dry-run] [--json]",
    );
    process.exit(2);
  }

  return { dataDirectory, dryRun, file, json, path: path ?? process.cwd(), project };
}

function readDocuments(databasePath: string, project: string): SourceDocumentRow[] {
  const database = new Database(databasePath, { readonly: true });
  try {
    return database
      .query(
        "SELECT id, source, kind, title, path, project, tags, content FROM documents WHERE project = ? ORDER BY id ASC",
      )
      .all(project) as SourceDocumentRow[];
  } finally {
    database.close();
  }
}

function normalizeType(kind: string): (typeof MEMORY_TYPES)[number] {
  return (MEMORY_TYPES as readonly string[]).includes(kind)
    ? (kind as (typeof MEMORY_TYPES)[number])
    : KIND_FALLBACK;
}

function context(options: Options): Readonly<{ path: string; dataDirectory?: string }> {
  return options.dataDirectory === undefined
    ? { path: options.path }
    : { dataDirectory: options.dataDirectory, path: options.path };
}

async function importDocument(
  document: SourceDocumentRow,
  options: Options,
): Promise<{ id: string; rowId: number }> {
  const topic = `import/context/${document.id}`;
  if (options.dryRun) {
    return { id: "", rowId: document.id };
  }

  const content = [
    `Source: ${document.source}/${document.kind} at ${document.path}`,
    document.tags ? `Tags: ${document.tags}` : undefined,
    "",
    document.content,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");

  const saved = await saveMemory({
    ...context(options),
    content,
    scope: "project",
    title: document.title,
    topic,
    type: normalizeType(document.kind),
  });

  return { id: saved.id, rowId: document.id };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const documents = readDocuments(options.file, options.project);

  const results: { id: string; rowId: number }[] = [];
  for (const document of documents) {
    results.push(await importDocument(document, options));
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          dryRun: options.dryRun,
          imported: results,
          importedCount: results.length,
          project: options.project,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `${options.dryRun ? "[dry-run] " : ""}Imported ${results.length} document(s) for project "${options.project}".`,
    );
  }
}

await main();
