// Application-layer orchestration for importing external data into Cairn.
// These functions call the existing public work/memory service APIs; they
// hold no domain rules of their own beyond mapping external shapes onto
// Cairn's existing mutation functions.

import { Database } from "bun:sqlite";

import { saveMemory, type MemoryView } from "../memory/memory-service.ts";
import {
  addWorkBlocker,
  addWorkLabel,
  appendWorkNote,
  claimWork,
  closeWork,
  createWork,
  listWork,
  setWorkParent,
  type WorkItemView,
} from "../work/work-service.ts";
import {
  normalizeContextKind,
  normalizeIssuePriority,
  normalizeIssueStatus,
  normalizeIssueType,
  normalizeMemoryScope,
  normalizeMemoryType,
  type ExternalContextRow,
  type ExternalDependencyEdge,
  type ExternalIssue,
  type ExternalObservation,
} from "./migration.ts";

type CairnContext = Readonly<{ path: string; dataDirectory?: string }>;

function context(options: CairnContext): CairnContext {
  return options.dataDirectory === undefined
    ? { path: options.path }
    : { dataDirectory: options.dataDirectory, path: options.path };
}

async function findImportedByLabel(
  options: CairnContext,
  label: string,
): Promise<WorkItemView | undefined> {
  const existing = await listWork({ ...context(options), labels: [label] });
  return existing[0];
}

export type ImportedWorkItem = Readonly<{
  id: string;
  issueId: string;
  skipped: boolean;
}>;

export type SkippedDependencyEdge = Readonly<{
  issueId: string;
  dependsOnId: string;
  type: string;
  reason: string;
}>;

export type ImportWorkItemsResult = Readonly<{
  items: readonly ImportedWorkItem[];
  createdCount: number;
  skippedCount: number;
  totalIssues: number;
  edgesAppliedCount: number;
  edgesSkipped: readonly SkippedDependencyEdge[];
  dryRun: boolean;
}>;

export type ImportWorkItemsOptions = CairnContext &
  Readonly<{
    issues: readonly ExternalIssue[];
    dependencyEdges?: readonly ExternalDependencyEdge[];
    dryRun?: boolean;
  }>;

async function importIssue(
  issue: ExternalIssue,
  options: ImportWorkItemsOptions,
): Promise<ImportedWorkItem> {
  const label = `import-source:${issue.id}`;
  const existing = await findImportedByLabel(options, label);
  if (existing) {
    return { id: existing.id, issueId: issue.id, skipped: true };
  }

  if (options.dryRun) {
    return { id: "", issueId: issue.id, skipped: false };
  }

  const created = await createWork({
    ...context(options),
    ...(issue.assignee !== undefined ? { assignee: issue.assignee } : {}),
    ...(issue.description !== undefined
      ? { description: issue.description }
      : {}),
    priority: normalizeIssuePriority(issue.priority),
    title: issue.title,
    type: normalizeIssueType(issue.issue_type),
  });

  await addWorkLabel({ ...context(options), id: created.id, label });

  const noteLines = [
    `Imported from external issue ${issue.id}.`,
    issue.acceptance_criteria
      ? `Acceptance criteria: ${issue.acceptance_criteria}`
      : undefined,
    issue.owner ? `Owner: ${issue.owner}` : undefined,
    issue.close_reason ? `Close reason: ${issue.close_reason}` : undefined,
  ].filter((line): line is string => line !== undefined);
  if (noteLines.length > 0) {
    await appendWorkNote({
      ...context(options),
      id: created.id,
      note: noteLines.join("\n"),
    });
  }

  const status = normalizeIssueStatus(issue.status);
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

async function importDependencyEdges(
  edges: readonly ExternalDependencyEdge[],
  idByIssueId: ReadonlyMap<string, string>,
  options: CairnContext,
): Promise<{
  edgesAppliedCount: number;
  edgesSkipped: SkippedDependencyEdge[];
}> {
  let edgesAppliedCount = 0;
  const edgesSkipped: SkippedDependencyEdge[] = [];

  for (const edge of edges) {
    if (edge.type !== "parent-child" && edge.type !== "blocks") {
      continue;
    }

    const childId = idByIssueId.get(edge.issue_id);
    const parentId = idByIssueId.get(edge.depends_on_id);
    if (childId === undefined || parentId === undefined) {
      edgesSkipped.push({
        dependsOnId: edge.depends_on_id,
        issueId: edge.issue_id,
        reason: "one or both issues were not imported",
        type: edge.type,
      });
      continue;
    }

    try {
      if (edge.type === "parent-child") {
        await setWorkParent({ ...context(options), id: childId, parent: parentId });
      } else {
        await addWorkBlocker({
          ...context(options),
          blocker: parentId,
          id: childId,
        });
      }
      edgesAppliedCount += 1;
    } catch (error) {
      edgesSkipped.push({
        dependsOnId: edge.depends_on_id,
        issueId: edge.issue_id,
        reason: error instanceof Error ? error.message : String(error),
        type: edge.type,
      });
    }
  }

  return { edgesAppliedCount, edgesSkipped };
}

export async function importWorkItems(
  options: ImportWorkItemsOptions,
): Promise<ImportWorkItemsResult> {
  const items: ImportedWorkItem[] = [];
  for (const issue of options.issues) {
    items.push(await importIssue(issue, options));
  }

  const idByIssueId = new Map(
    items.filter((item) => item.id !== "").map((item) => [item.issueId, item.id]),
  );

  let edgesAppliedCount = 0;
  let edgesSkipped: SkippedDependencyEdge[] = [];
  if (
    options.dependencyEdges !== undefined &&
    options.dependencyEdges.length > 0 &&
    !options.dryRun
  ) {
    const result = await importDependencyEdges(
      options.dependencyEdges,
      idByIssueId,
      options,
    );
    edgesAppliedCount = result.edgesAppliedCount;
    edgesSkipped = result.edgesSkipped;
  }

  return {
    createdCount: items.filter((item) => !item.skipped).length,
    dryRun: options.dryRun ?? false,
    edgesAppliedCount,
    edgesSkipped,
    items,
    skippedCount: items.filter((item) => item.skipped).length,
    totalIssues: options.issues.length,
  };
}

export type ImportedMemory = Readonly<{ id: string; syncId: string }>;

export type ImportMemoriesResult = Readonly<{
  imported: readonly ImportedMemory[];
  importedCount: number;
  totalObservations: number;
  dryRun: boolean;
}>;

export type ImportMemoriesOptions = CairnContext &
  Readonly<{
    observations: readonly ExternalObservation[];
    project?: string;
    dryRun?: boolean;
  }>;

export async function importMemories(
  options: ImportMemoriesOptions,
): Promise<ImportMemoriesResult> {
  const filtered = options.project === undefined
    ? options.observations
    : options.observations.filter(
        (observation) => observation.project === options.project,
      );

  const imported: ImportedMemory[] = [];
  for (const observation of filtered) {
    if (options.dryRun) {
      imported.push({ id: "", syncId: observation.sync_id });
      continue;
    }

    const saved: MemoryView = await saveMemory({
      ...context(options),
      content: observation.content,
      scope: normalizeMemoryScope(observation.scope),
      title: observation.title,
      topic: `import/memory/${observation.sync_id}`,
      type: normalizeMemoryType(observation.type),
    });
    imported.push({ id: saved.id, syncId: observation.sync_id });
  }

  return {
    dryRun: options.dryRun ?? false,
    imported,
    importedCount: imported.length,
    totalObservations: options.observations.length,
  };
}

export type ImportedContextRow = Readonly<{ id: string; rowId: number }>;

export type ImportContextResult = Readonly<{
  imported: readonly ImportedContextRow[];
  importedCount: number;
  project: string;
  dryRun: boolean;
}>;

export type ImportContextOptions = CairnContext &
  Readonly<{
    sourceDatabasePath: string;
    project: string;
    dryRun?: boolean;
  }>;

export function readContextRows(
  databasePath: string,
  project: string,
): ExternalContextRow[] {
  const database = new Database(databasePath, { readonly: true });
  try {
    return database
      .query(
        "SELECT id, source, kind, title, path, project, tags, content FROM documents WHERE project = ? ORDER BY id ASC",
      )
      .all(project) as ExternalContextRow[];
  } finally {
    database.close();
  }
}

export async function importContextEntries(
  options: ImportContextOptions,
): Promise<ImportContextResult> {
  const rows = readContextRows(options.sourceDatabasePath, options.project);

  const imported: ImportedContextRow[] = [];
  for (const row of rows) {
    if (options.dryRun) {
      imported.push({ id: "", rowId: row.id });
      continue;
    }

    const content = [
      `Source: ${row.source}/${row.kind} at ${row.path}`,
      row.tags ? `Tags: ${row.tags}` : undefined,
      "",
      row.content,
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n");

    const saved = await saveMemory({
      ...context(options),
      content,
      title: row.title,
      topic: `import/context/${row.id}`,
      type: normalizeContextKind(row.kind),
    });
    imported.push({ id: saved.id, rowId: row.id });
  }

  return {
    dryRun: options.dryRun ?? false,
    imported,
    importedCount: imported.length,
    project: options.project,
  };
}
