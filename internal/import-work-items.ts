#!/usr/bin/env bun

// Internal one-off tool: imports issues from an external issue tracker's
// JSONL export into Cairn work items. Only flat issue fields are imported
// (title, description, status, priority, type, assignee, timestamps, and the
// close reason as a note). Dependencies, comments, and labels from the
// source tracker are explicitly out of scope for bulk import.
//
// Usage:
//   bun run internal/import-work-items.ts <export.jsonl> --path <dir> [--data-dir <dir>] [--dry-run] [--json]
//
// Idempotent: each imported work item is tagged with an `import-source:<issue-id>`
// label. Re-running the script against the same export skips issues that
// already have a matching label.

import { readFileSync } from "node:fs";

import {
  addWorkLabel,
  appendWorkNote,
  closeWork,
  claimWork,
  createWork,
  listWork,
} from "../src/work/work-service.ts";
import { WORK_ITEM_STATUSES, WORK_ITEM_TYPES } from "../src/work/work-item.ts";

type ExternalIssue = Readonly<{
  _type?: string;
  id: string;
  title: string;
  description?: string;
  acceptance_criteria?: string;
  status?: string;
  priority?: number;
  issue_type?: string;
  assignee?: string;
  owner?: string;
  close_reason?: string;
}>;

type Options = Readonly<{
  file: string;
  path: string;
  dataDirectory: string | undefined;
  dryRun: boolean;
  json: boolean;
}>;

function parseArguments(argv: readonly string[]): Options {
  const positional: string[] = [];
  let path: string | undefined;
  let dataDirectory: string | undefined;
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
      "Usage: bun run internal/import-work-items.ts <export.jsonl> --path <dir> [--data-dir <dir>] [--dry-run] [--json]",
    );
    process.exit(2);
  }

  return { file, path: path ?? process.cwd(), dataDirectory, dryRun, json };
}

function parseIssues(fileContents: string): ExternalIssue[] {
  return fileContents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ExternalIssue)
    .filter((issue) => issue._type === undefined || issue._type === "issue");
}

function normalizeStatus(status: string | undefined): "open" | "in_progress" | "closed" {
  if (status && (WORK_ITEM_STATUSES as readonly string[]).includes(status)) {
    return status as "open" | "in_progress" | "closed";
  }
  return "open";
}

function normalizeType(type: string | undefined): (typeof WORK_ITEM_TYPES)[number] {
  if (type && (WORK_ITEM_TYPES as readonly string[]).includes(type)) {
    return type as (typeof WORK_ITEM_TYPES)[number];
  }
  return "task";
}

function normalizePriority(priority: number | undefined): number {
  if (priority === undefined || Number.isNaN(priority)) {
    return 2;
  }
  return Math.min(4, Math.max(0, Math.trunc(priority)));
}

function context(options: Options): Readonly<{ path: string; dataDirectory?: string }> {
  return options.dataDirectory === undefined
    ? { path: options.path }
    : { dataDirectory: options.dataDirectory, path: options.path };
}

async function alreadyImported(options: Options, issueId: string): Promise<boolean> {
  const existing = await listWork({
    ...context(options),
    labels: [`import-source:${issueId}`],
  });
  return existing.length > 0;
}

async function importIssue(
  issue: ExternalIssue,
  options: Options,
): Promise<{ id: string; issueId: string; skipped: boolean }> {
  if (await alreadyImported(options, issue.id)) {
    return { id: "", issueId: issue.id, skipped: true };
  }

  if (options.dryRun) {
    return { id: "", issueId: issue.id, skipped: false };
  }

  const created = await createWork({
    ...context(options),
    ...(issue.assignee !== undefined ? { assignee: issue.assignee } : {}),
    ...(issue.description !== undefined ? { description: issue.description } : {}),
    priority: normalizePriority(issue.priority),
    title: issue.title,
    type: normalizeType(issue.issue_type),
  });

  await addWorkLabel({
    ...context(options),
    id: created.id,
    label: `import-source:${issue.id}`,
  });

  const noteLines = [
    `Imported from external issue ${issue.id}.`,
    issue.acceptance_criteria ? `Acceptance criteria: ${issue.acceptance_criteria}` : undefined,
    issue.owner ? `Owner: ${issue.owner}` : undefined,
    issue.close_reason ? `Close reason: ${issue.close_reason}` : undefined,
  ].filter((line): line is string => line !== undefined);
  if (noteLines.length > 0) {
    await appendWorkNote({ ...context(options), id: created.id, note: noteLines.join("\n") });
  }

  const status = normalizeStatus(issue.status);
  if (status === "in_progress" || status === "closed") {
    await claimWork({
      ...context(options),
      assignee: issue.assignee?.trim() || issue.owner?.trim() || "imported",
      id: created.id,
    });
  }
  if (status === "closed") {
    await closeWork({ ...context(options), id: created.id });
  }

  return { id: created.id, issueId: issue.id, skipped: false };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const issues = parseIssues(readFileSync(options.file, "utf8"));

  const results: { id: string; issueId: string; skipped: boolean }[] = [];
  for (const issue of issues) {
    results.push(await importIssue(issue, options));
  }

  const created = results.filter((result) => !result.skipped);
  const skipped = results.filter((result) => result.skipped);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          created: created.map((result) => ({ id: result.id, issueId: result.issueId })),
          createdCount: created.length,
          dryRun: options.dryRun,
          skippedCount: skipped.length,
          skippedIssueIds: skipped.map((result) => result.issueId),
          totalIssues: issues.length,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `${options.dryRun ? "[dry-run] " : ""}Imported ${created.length} of ${issues.length} issue(s); skipped ${skipped.length} already-imported issue(s).`,
    );
  }
}

await main();
