import type { Database } from "bun:sqlite";
import {
  type Generated,
  Kysely,
  sql,
} from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";

import type {
  WorkItemEventType,
  WorkItemStatus,
  WorkItemType,
} from "../work/work-item.ts";

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
  priority: number;
  project_id: string;
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
  work_item_id: string;
}>;

export type SchemaMigrationTable = Readonly<{
  applied_at: string;
  name: string;
  version: number;
}>;

export interface CairnDatabaseSchema {
  projects: ProjectTable;
  schema_migrations: SchemaMigrationTable;
  search_entries: SearchEntryTable;
  work_item_events: WorkItemEventTable;
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
