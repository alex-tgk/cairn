import type { Database } from "bun:sqlite";

import {
  restoreWorkItem,
  WorkItemId,
  WorkItemPriority,
  WorkItemTitle,
  type WorkItem,
  type WorkItemEvent,
  type WorkItemEventDraft,
  type WorkItemEventPayload,
  type WorkItemEventType,
  type WorkItemStatus,
  type WorkItemTransition,
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

type WorkItemEventRow = Readonly<{
  created_at: string;
  event_type: WorkItemEventType;
  id: number;
  payload_json: string;
  work_item_id: string;
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

function parseEventPayload(value: string): WorkItemEventPayload {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Invalid work-item event payload");
  }
  const payload: Record<string, string | number | null> = {};
  for (const [key, entry] of Object.entries(parsed)) {
    if (typeof entry === "string" || typeof entry === "number" || entry === null) {
      payload[key] = entry;
      continue;
    }
    throw new Error("Invalid work-item event payload value");
  }
  return payload;
}

function mapWorkItemEvent(row: WorkItemEventRow): WorkItemEvent {
  return {
    createdAt: row.created_at,
    eventType: row.event_type,
    id: row.id,
    payload: parseEventPayload(row.payload_json),
    workItemId: row.work_item_id,
  };
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

  applyTransition(transition: WorkItemTransition): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.updateWorkItem(transition.item);
      this.insertEvent(transition.item.id, transition.event);
      this.updateSearchProjection(transition.item);
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

  listEvents(projectId: string, id: WorkItemId): readonly WorkItemEvent[] {
    return this.database
      .query<WorkItemEventRow, [string, string]>(
        `SELECT event.id, event.work_item_id, event.event_type,
                event.payload_json, event.created_at
         FROM work_item_events AS event
         INNER JOIN work_items AS item ON item.id = event.work_item_id
         WHERE item.project_id = ? AND item.id = ?
         ORDER BY event.created_at ASC, event.id ASC`,
      )
      .all(projectId, id.toString())
      .map(mapWorkItemEvent);
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
    this.insertEvent(item.id, {
      createdAt: item.createdAt,
      eventType: "created",
      payload: {
        priority: item.priority.toNumber(),
        status: item.status,
        type: item.type,
      },
    });
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

  private updateWorkItem(item: WorkItem): void {
    const result = this.database
      .query<
        void,
        [
          string,
          string,
          WorkItemStatus,
          number,
          WorkItemType,
          string | null,
          string,
          string | null,
          string | null,
          string,
          string,
        ]
      >(
        `UPDATE work_items
         SET title = ?, description = ?, status = ?, priority = ?, type = ?,
             assignee = ?, updated_at = ?, claimed_at = ?, closed_at = ?
         WHERE project_id = ? AND id = ?`,
      )
      .run(
        item.title.toString(),
        item.description,
        item.status,
        item.priority.toNumber(),
        item.type,
        item.assignee,
        item.updatedAt,
        item.claimedAt,
        item.closedAt,
        item.projectId,
        item.id.toString(),
      );
    if (result.changes === 0) {
      throw new Error(`Work item not found: ${item.id.toString()}`);
    }
  }

  private insertEvent(id: WorkItemId, event: WorkItemEventDraft): void {
    this.database
      .query<void, [string, WorkItemEventType, string, string]>(
        `INSERT INTO work_item_events(
           work_item_id, event_type, payload_json, created_at
         ) VALUES (?, ?, ?, ?)`,
      )
      .run(
        id.toString(),
        event.eventType,
        JSON.stringify(event.payload),
        event.createdAt,
      );
  }

  private updateSearchProjection(item: WorkItem): void {
    const tags = `${item.type} ${item.status} p${item.priority.toNumber()}`;
    const result = this.database
      .query<void, [string, string, string, string, string, string]>(
        `UPDATE search_entries
         SET title = ?, body = ?, tags = ?, updated_at = ?
         WHERE entity_kind = 'work_item' AND entity_id = ? AND project_id = ?`,
      )
      .run(
        item.title.toString(),
        item.description,
        tags,
        item.updatedAt,
        item.id.toString(),
        item.projectId,
      );
    if (result.changes === 0) {
      throw new Error(`Work-item search projection not found: ${item.id.toString()}`);
    }
  }
}
