import { resolve } from "node:path";

import { loadContextConfig } from "./context-config.ts";
import { discoverContextFiles } from "./context-discovery.ts";
import type {
  ContextIndexMode,
  ContextIndexRepository,
  ContextIndexRunCounts,
  ContextIndexRunRecord,
  ContextIndexRunStatus,
  ContextIndexStatus,
} from "./context-index-repository.ts";

export type IndexContextInput = Readonly<{
  mode: ContextIndexMode;
  projectId: string;
  repository: ContextIndexRepository;
  workspaceId: string;
  workspacePath: string;
}>;

export type ContextSourceIndexSummary = Readonly<{
  counts: ContextIndexRunCounts;
  errors: readonly string[];
  mode: ContextIndexMode;
  name: string;
  runId: string;
  sourceId: string;
  status: ContextIndexRunStatus;
}>;

export type ContextIndexSummary = Readonly<{
  configFingerprint: string;
  counts: ContextIndexRunCounts;
  errors: readonly string[];
  mode: ContextIndexMode;
  projectId: string;
  sources: readonly ContextSourceIndexSummary[];
  status: ContextIndexRunStatus;
  workspaceId: string;
  workspacePath: string;
}>;

export type ContextIndexState =
  | "not_indexed"
  | "indexed"
  | "refresh_required";

export type GetContextIndexStatusInput = Readonly<{
  projectId: string;
  repository: ContextIndexRepository;
  workspaceId: string;
  workspacePath: string;
}>;

export type ContextSourceStatusSummary = Readonly<{
  activeDocumentCount: number;
  configFingerprint: string;
  lastRun: ContextIndexRunRecord | null;
  name: string;
  rootRelativePath: string;
  sourceId: string;
  state: ContextIndexState;
  totalDocumentCount: number;
  versionCount: number;
}>;

export type ContextIndexStatusSummary = Readonly<{
  filesystemFreshness: "unknown";
  projectId: string;
  sources: readonly ContextSourceStatusSummary[];
  state: ContextIndexState;
  workspaceId: string;
  workspacePath: string;
}>;

const ZERO_COUNTS: ContextIndexRunCounts = {
  added: 0,
  discovered: 0,
  errors: 0,
  removed: 0,
  skipped: 0,
  unchanged: 0,
  updated: 0,
};

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function addCounts(
  total: ContextIndexRunCounts,
  next: ContextIndexRunCounts,
): ContextIndexRunCounts {
  return {
    added: total.added + next.added,
    discovered: total.discovered + next.discovered,
    errors: total.errors + next.errors,
    removed: total.removed + next.removed,
    skipped: total.skipped + next.skipped,
    unchanged: total.unchanged + next.unchanged,
    updated: total.updated + next.updated,
  };
}

function aggregateRunStatus(
  sources: readonly ContextSourceIndexSummary[],
): ContextIndexRunStatus {
  if (sources.every(({ status }) => status === "succeeded")) {
    return "succeeded";
  }
  if (sources.every(({ status }) => status === "failed")) {
    return "failed";
  }
  if (sources.every(({ status }) => status === "running")) {
    return "running";
  }
  return "partial";
}

function sourceIndexState(status: ContextIndexStatus): ContextIndexState {
  if (status.lastRun === null) {
    return "not_indexed";
  }
  return status.lastRun.status === "succeeded"
    ? "indexed"
    : "refresh_required";
}

function aggregateIndexState(
  sources: readonly ContextSourceStatusSummary[],
): ContextIndexState {
  if (
    sources.length === 0 ||
    sources.every(({ state }) => state === "not_indexed")
  ) {
    return "not_indexed";
  }
  if (sources.every(({ state }) => state === "indexed")) {
    return "indexed";
  }
  return "refresh_required";
}

export async function indexContext(
  input: IndexContextInput,
): Promise<ContextIndexSummary> {
  const workspacePath = resolve(input.workspacePath);
  const loadedConfig = loadContextConfig(workspacePath);
  const preparedSources = [...loadedConfig.config.sources]
    .sort((left, right) => compareText(left.name, right.name))
    .map((source) => ({
      discovery: discoverContextFiles(workspacePath, source),
      source,
    }));

  const summaries: ContextSourceIndexSummary[] = [];
  for (const prepared of preparedSources) {
    const sourceRecord = await input.repository.upsertSource({
      loadedConfig,
      projectId: input.projectId,
      source: prepared.source,
    });
    const run = await input.repository.applyIndex({
      files: prepared.discovery.files,
      mode: input.mode,
      projectId: input.projectId,
      skippedCount: prepared.discovery.skipped.length,
      sourceId: sourceRecord.id,
      workspaceId: input.workspaceId,
    });
    summaries.push({
      counts: run.counts,
      errors: run.errors,
      mode: run.mode,
      name: sourceRecord.name,
      runId: run.id,
      sourceId: sourceRecord.id,
      status: run.status,
    });
  }

  return {
    configFingerprint: loadedConfig.fingerprint,
    counts: summaries.reduce(
      (total, source) => addCounts(total, source.counts),
      ZERO_COUNTS,
    ),
    errors: summaries.flatMap(({ errors, name }) =>
      errors.map((error) => `${name}: ${error}`),
    ),
    mode: input.mode,
    projectId: input.projectId,
    sources: summaries,
    status: aggregateRunStatus(summaries),
    workspaceId: input.workspaceId,
    workspacePath,
  };
}

export async function getContextIndexStatus(
  input: GetContextIndexStatusInput,
): Promise<ContextIndexStatusSummary> {
  const statuses = await input.repository.listStatus({
    projectId: input.projectId,
    workspaceId: input.workspaceId,
  });
  const sources = [...statuses]
    .sort(
      (left, right) =>
        compareText(left.source.name, right.source.name) ||
        compareText(left.source.id, right.source.id),
    )
    .map((status): ContextSourceStatusSummary => ({
      activeDocumentCount: status.activeDocumentCount,
      configFingerprint: status.source.configHash,
      lastRun: status.lastRun,
      name: status.source.name,
      rootRelativePath: status.source.rootRelativePath,
      sourceId: status.source.id,
      state: sourceIndexState(status),
      totalDocumentCount: status.totalDocumentCount,
      versionCount: status.versionCount,
    }));

  return {
    filesystemFreshness: "unknown",
    projectId: input.projectId,
    sources,
    state: aggregateIndexState(sources),
    workspaceId: input.workspaceId,
    workspacePath: resolve(input.workspacePath),
  };
}
