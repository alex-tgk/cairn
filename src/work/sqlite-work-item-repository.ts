import type { Database } from "bun:sqlite";

import {
  restoreWorkItem,
  WorkItemId,
  WorkItemPriority,
  WorkItemTitle,
  type WorkItem,
  type WorkItemStatus,
  type WorkItemType,
} from "./work-item.ts";
import type { WorkItemRepository } from "./work-item-repository.ts";

type WorkItemRow = Readonly<{
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

const SELECT_WORK_ITEM = `
  SELECT id, project_id, title, description, status, priority, type, assignee,
         created_at, updated_at, claimed_at, closed_at
  FROM work_items
`;

function mapWorkItem(row: WorkItemRow): WorkItem {
  return restoreWorkItem({
    assignee: row.assignee,
    claimedAt: row.claimed_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    description: row.description,
    id: WorkItemId.from(row.id),
    priority: WorkItemPriority.from(row.priority),
    projectId: row.project_id,
    status: row.status,
    title: WorkItemTitle.from(row.title),
    type: row.type,
    updatedAt: row.updated_at,
  });
}

export class SqliteWorkItemRepository implements WorkItemRepository {
  constructor(private readonly database: Database) {}

  create(item: WorkItem): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.insertWorkItem(item);
      this.insertCreatedEvent(item);
      this.insertSearchProjection(item);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  findById(projectId: string, id: WorkItemId): WorkItem | null {
    const row = this.database
      .query<WorkItemRow, [string, string]>(
        `${SELECT_WORK_ITEM} WHERE project_id = ? AND id = ?`,
      )
      .get(projectId, id.toString());
    return row ? mapWorkItem(row) : null;
  }

  listByProject(projectId: string): readonly WorkItem[] {
    return this.database
      .query<WorkItemRow, [string]>(
        `${SELECT_WORK_ITEM}
         WHERE project_id = ?
         ORDER BY priority ASC, created_at ASC, id ASC`,
      )
      .all(projectId)
      .map(mapWorkItem);
  }

  private insertWorkItem(item: WorkItem): void {
    this.database
      .query<
        void,
        [
          string,
          string,
          string,
          string,
          WorkItemStatus,
          number,
          WorkItemType,
          string | null,
          string,
          string,
        ]
      >(
        `INSERT INTO work_items(
           id, project_id, title, description, status, priority, type,
           assignee, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        item.id.toString(),
        item.projectId,
        item.title.toString(),
        item.description,
        item.status,
        item.priority.toNumber(),
        item.type,
        item.assignee,
        item.createdAt,
        item.updatedAt,
      );
  }

  private insertCreatedEvent(item: WorkItem): void {
    this.database
      .query<void, [string, string]>(
        `INSERT INTO work_item_events(work_item_id, event_type, created_at)
         VALUES (?, 'created', ?)`,
      )
      .run(item.id.toString(), item.createdAt);
  }

  private insertSearchProjection(item: WorkItem): void {
    const tags = `${item.type} ${item.status} p${item.priority.toNumber()}`;
    this.database
      .query<
        void,
        [string, string, string, string, string, string, string]
      >(
        `INSERT INTO search_entries(
           entity_kind, entity_id, project_id, title, body, tags,
           created_at, updated_at
         ) VALUES ('work_item', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        item.id.toString(),
        item.projectId,
        item.title.toString(),
        item.description,
        tags,
        item.createdAt,
        item.updatedAt,
      );
  }
}
