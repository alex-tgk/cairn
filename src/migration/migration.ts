// Pure parsing and normalization helpers for importing data from external
// tools into Cairn's work, memory, and context domains. These functions do
// not touch the filesystem or any Cairn repository; callers (the CLI layer
// and migration-service.ts) are responsible for reading source files and
// invoking the appropriate domain services with the normalized data.

import { MEMORY_TYPES, type MemoryType } from "../memory/memory.ts";
import { WORK_ITEM_STATUSES, WORK_ITEM_TYPES } from "../work/work-item.ts";
import type { WorkItemStatus, WorkItemType } from "../work/work-item.ts";

export type ExternalIssue = Readonly<{
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

export type ExternalDependencyEdge = Readonly<{
  issue_id: string;
  depends_on_id: string;
  type: string;
}>;

export type ExternalObservation = Readonly<{
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

export type ExternalMemoryExport = Readonly<{
  version?: string;
  exported_at?: string;
  sessions?: readonly unknown[];
  observations?: readonly ExternalObservation[];
  prompts?: readonly unknown[];
}>;

export type ExternalContextRow = Readonly<{
  id: number;
  source: string;
  kind: string;
  title: string;
  path: string;
  project: string;
  tags: string;
  content: string;
}>;

// Dependency-edge relation types that map onto Cairn's structural (parent)
// and blocking dependency models. All other edge types (e.g. "discovered-from",
// "tracks", "relates_to", "duplicate", "supersede") are intentionally skipped:
// Cairn has no generic relation-type model to receive them.
export const IMPORTABLE_DEPENDENCY_TYPES = ["parent-child", "blocks"] as const;

export function parseExternalIssuesJsonl(
  fileContents: string,
): ExternalIssue[] {
  return fileContents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ExternalIssue)
    .filter((issue) => issue._type === undefined || issue._type === "issue");
}

export function parseExternalDependencyEdges(
  fileContents: string,
): ExternalDependencyEdge[] {
  const parsed = JSON.parse(fileContents) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Dependency edges file must contain a JSON array");
  }
  return parsed as ExternalDependencyEdge[];
}

export function parseExternalMemoryExport(
  fileContents: string,
): ExternalMemoryExport {
  return JSON.parse(fileContents) as ExternalMemoryExport;
}

export function normalizeIssueStatus(
  status: string | undefined,
): WorkItemStatus {
  if (status && (WORK_ITEM_STATUSES as readonly string[]).includes(status)) {
    return status as WorkItemStatus;
  }
  return "open";
}

export function normalizeIssueType(type: string | undefined): WorkItemType {
  if (type && (WORK_ITEM_TYPES as readonly string[]).includes(type)) {
    return type as WorkItemType;
  }
  return "task";
}

export function normalizeIssuePriority(priority: number | undefined): number {
  if (priority === undefined || Number.isNaN(priority)) {
    return 2;
  }
  return Math.min(4, Math.max(0, Math.trunc(priority)));
}

// The source tool has used at least one type ("refactor") outside Cairn's
// closed MEMORY_TYPES set. Map any unknown type to the closest existing
// Cairn type rather than failing the import.
const MEMORY_TYPE_FALLBACKS: Record<string, MemoryType> = {
  refactor: "pattern",
};

export function normalizeMemoryType(type: string): MemoryType {
  if ((MEMORY_TYPES as readonly string[]).includes(type)) {
    return type as MemoryType;
  }
  return MEMORY_TYPE_FALLBACKS[type] ?? "discovery";
}

export function normalizeMemoryScope(
  scope: string,
): "project" | "personal" {
  return scope === "personal" ? "personal" : "project";
}

// The source index's `kind` column mixes real memory types with document
// kinds (file, project-card, contentful-doc, session, prompt) that have no
// direct Cairn memory type. Map anything outside Cairn's closed
// MEMORY_TYPES set to "discovery" as a safe, recoverable default.
export function normalizeContextKind(kind: string): MemoryType {
  return (MEMORY_TYPES as readonly string[]).includes(kind)
    ? (kind as MemoryType)
    : "discovery";
}
