import type {
  ContextSourceConfig,
  LoadedContextConfig,
} from "./context-config.ts";
import type { DiscoveredContextFile } from "./context-discovery.ts";

export type ContextIndexMode = "refresh" | "rebuild";
export type ContextIndexRunStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "partial";

export type ContextSourceRecord = Readonly<{
  configHash: string;
  createdAt: string;
  excludes: readonly string[];
  id: string;
  includes: readonly string[];
  kind: string;
  maxFileBytes: number;
  name: string;
  projectId: string;
  rootRelativePath: string;
  updatedAt: string;
}>;

export type ContextIndexRunCounts = Readonly<{
  added: number;
  discovered: number;
  errors: number;
  removed: number;
  skipped: number;
  unchanged: number;
  updated: number;
}>;

export type ContextIndexRunRecord = Readonly<{
  completedAt: string | null;
  counts: ContextIndexRunCounts;
  errors: readonly string[];
  id: string;
  mode: ContextIndexMode;
  sourceId: string;
  startedAt: string;
  status: ContextIndexRunStatus;
  workspaceId: string;
}>;

export type ContextIndexStatus = Readonly<{
  activeDocumentCount: number;
  lastRun: ContextIndexRunRecord | null;
  source: ContextSourceRecord;
  totalDocumentCount: number;
  versionCount: number;
  workspaceId: string;
}>;

export type UpsertContextSourceInput = Readonly<{
  loadedConfig: LoadedContextConfig;
  projectId: string;
  source: ContextSourceConfig;
}>;

export type ApplyContextIndexInput = Readonly<{
  files: readonly DiscoveredContextFile[];
  mode: ContextIndexMode;
  projectId: string;
  skippedCount: number;
  sourceId: string;
  workspaceId: string;
}>;

export type ListContextIndexStatusInput = Readonly<{
  projectId: string;
  workspaceId: string;
}>;

export interface ContextIndexRepository {
  applyIndex(input: ApplyContextIndexInput): Promise<ContextIndexRunRecord>;
  listStatus(
    input: ListContextIndexStatusInput,
  ): Promise<readonly ContextIndexStatus[]>;
  upsertSource(input: UpsertContextSourceInput): Promise<ContextSourceRecord>;
}
