import type { Database } from "bun:sqlite";
import {
  type Generated,
  Kysely,
  sql,
} from "kysely";

import type {
  WorkItemEventType,
  WorkItemStatus,
  WorkItemType,
} from "../work/work-item.ts";
import { BunSqliteDialect } from "./bun-sqlite-dialect.ts";

export type ProjectTable = Readonly<{
  created_at: string;
  id: string;
  name: string;
  updated_at: string;
}>;

export type WorkspaceTable = Readonly<{
  first_seen_at: string;
  id: string;
  last_seen_at: string;
  path: string;
  project_id: string;
}>;

export type SearchEntryTable = Readonly<{
  body: string;
  created_at: string;
  entity_id: string;
  entity_kind: string;
  id: Generated<number>;
  project_id: string | null;
  source_path: string | null;
  tags: string;
  title: string;
  updated_at: string;
  workspace_id: string | null;
}>;

export type WorkItemTable = Readonly<{
  assignee: string | null;
  claimed_at: string | null;
  closed_at: string | null;
  created_at: string;
  description: string;
  id: string;
  notes: string;
  priority: number;
  project_id: string;
  revision: number;
  status: WorkItemStatus;
  title: string;
  type: WorkItemType;
  updated_at: string;
}>;

export type WorkItemEventTable = Readonly<{
  created_at: string;
  event_type: WorkItemEventType;
  id: Generated<number>;
  payload_json: string;
  revision: number;
  work_item_id: string;
}>;

export type WorkItemHierarchyTable = Readonly<{
  child_id: string;
  created_at: string;
  parent_id: string;
  project_id: string;
}>;

export type WorkItemDependencyTable = Readonly<{
  blocked_id: string;
  blocker_id: string;
  created_at: string;
  project_id: string;
}>;

export type WorkItemLabelTable = Readonly<{
  created_at: string;
  label: string;
  project_id: string;
  work_item_id: string;
}>;

export type WorkItemCommentTable = Readonly<{
  author: string;
  body: string;
  created_at: string;
  id: Generated<number>;
  project_id: string;
  revision: number;
  work_item_id: string;
}>;

export type ContextSourceTable = Readonly<{
  config_hash: string;
  created_at: string;
  exclude_json: string;
  id: string;
  include_json: string;
  kind: string;
  max_file_bytes: number;
  name: string;
  project_id: string;
  root_relative_path: string;
  updated_at: string;
}>;

export type ContextDocumentTable = Readonly<{
  active: 0 | 1;
  byte_size: number;
  content_hash: string;
  first_indexed_at: string;
  id: string;
  kind: string;
  last_seen_at: string;
  project_id: string;
  relative_path: string;
  source_id: string;
  tags_json: string;
  title: string;
  updated_at: string;
  workspace_id: string;
}>;

export type ContextDocumentVersionTable = Readonly<{
  byte_size: number;
  content: string;
  content_hash: string;
  document_id: string;
  id: Generated<number>;
  indexed_at: string;
}>;

export type ContextIndexRunTable = Readonly<{
  added_count: number;
  completed_at: string | null;
  discovered_count: number;
  error_count: number;
  error_json: string;
  id: string;
  mode: "refresh" | "rebuild";
  removed_count: number;
  skipped_count: number;
  source_id: string;
  started_at: string;
  status: "running" | "succeeded" | "failed" | "partial";
  unchanged_count: number;
  updated_count: number;
  workspace_id: string;
}>;

export type SchemaMigrationTable = Readonly<{
  applied_at: string;
  name: string;
  version: number;
}>;

export interface CairnDatabaseSchema {
  context_document_versions: ContextDocumentVersionTable;
  context_documents: ContextDocumentTable;
  context_index_runs: ContextIndexRunTable;
  context_sources: ContextSourceTable;
  projects: ProjectTable;
  schema_migrations: SchemaMigrationTable;
  search_entries: SearchEntryTable;
  work_item_comments: WorkItemCommentTable;
  work_item_dependencies: WorkItemDependencyTable;
  work_item_events: WorkItemEventTable;
  work_item_hierarchy: WorkItemHierarchyTable;
  work_item_labels: WorkItemLabelTable;
  work_items: WorkItemTable;
  workspaces: WorkspaceTable;
}

export class CairnQueryDatabase {
  readonly queries: Kysely<CairnDatabaseSchema>;

  constructor(database: Database) {
    this.queries = new Kysely<CairnDatabaseSchema>({
      dialect: new BunSqliteDialect({ database }),
    });
  }

  async immediateTransaction<Result>(
    action: (database: Kysely<CairnDatabaseSchema>) => Promise<Result>,
  ): Promise<Result> {
    return this.queries.connection().execute(async (database) => {
      await sql.raw("BEGIN IMMEDIATE").execute(database);
      try {
        const result = await action(database);
        await sql.raw("COMMIT").execute(database);
        return result;
      } catch (error) {
        await sql.raw("ROLLBACK").execute(database);
        throw error;
      }
    });
  }

  async close(): Promise<void> {
    await this.queries.destroy();
  }
}
