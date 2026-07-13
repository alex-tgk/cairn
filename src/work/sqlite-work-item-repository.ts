import {
  type Kysely,
  type Selectable,
} from "kysely";

import {
  type CairnDatabaseSchema,
  CairnQueryDatabase,
  type WorkItemEventTable,
  type WorkItemTable,
} from "../storage/query-database.ts";
import {
  restoreWorkItem,
  WorkItemConflictError,
  WorkItemId,
  WorkItemPriority,
  WorkItemTitle,
  type WorkItem,
  type WorkItemEvent,
  type WorkItemEventDraft,
  type WorkItemEventPayload,
  type WorkItemTransition,
} from "./work-item.ts";
import type { WorkItemRepository } from "./work-item-repository.ts";

type WorkItemRow = Selectable<WorkItemTable>;
type WorkItemEventRow = Selectable<WorkItemEventTable>;

function mapWorkItem(row: WorkItemRow): WorkItem {
  return restoreWorkItem({
    assignee: row.assignee,
    claimedAt: row.claimed_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    description: row.description,
    id: WorkItemId.from(row.id),
    notes: row.notes,
    priority: WorkItemPriority.from(row.priority),
    projectId: row.project_id,
    revision: row.revision,
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
    revision: row.revision,
    workItemId: row.work_item_id,
  };
}

function searchTags(item: WorkItem): string {
  return `${item.type} ${item.status} p${item.priority.toNumber()}`;
}

function searchBody(item: WorkItem): string {
  return item.notes.length === 0
    ? item.description
    : `${item.description}\n${item.notes}`;
}

const UUID_PREFIX_PATTERN = /^[0-9a-f-]+$/u;

export class SqliteWorkItemRepository implements WorkItemRepository {
  constructor(private readonly database: CairnQueryDatabase) {}

  async create(item: WorkItem): Promise<void> {
    await this.database.immediateTransaction(async (database) => {
      await this.insertWorkItem(database, item);
      await this.insertCreatedEvent(database, item);
      await this.insertSearchProjection(database, item);
    });
  }

  async applyTransition(transition: WorkItemTransition): Promise<void> {
    await this.database.immediateTransaction(async (database) => {
      await this.updateWorkItem(database, transition);
      await this.insertEvent(database, transition.item.id, transition.event);
      await this.updateSearchProjection(database, transition.item);
    });
  }

  async findById(projectId: string, id: WorkItemId): Promise<WorkItem | null> {
    const row = await this.database.queries
      .selectFrom("work_items")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("id", "=", id.toString())
      .executeTakeFirst();
    return row ? mapWorkItem(row) : null;
  }

  async findByReference(
    projectId: string,
    reference: string,
  ): Promise<readonly WorkItem[]> {
    const normalized = reference.trim().toLowerCase();
    const exact = await this.database.queries
      .selectFrom("work_items")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("id", "=", normalized)
      .executeTakeFirst();
    if (exact) {
      return [mapWorkItem(exact)];
    }

    const hexadecimalLength = normalized.replaceAll("-", "").length;
    if (
      hexadecimalLength < 6
      || !UUID_PREFIX_PATTERN.test(normalized)
    ) {
      return [];
    }

    const matches = await this.database.queries
      .selectFrom("work_items")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("id", "like", `${normalized}%`)
      .orderBy("id", "asc")
      .execute();
    return matches.map(mapWorkItem);
  }

  async listByProject(projectId: string): Promise<readonly WorkItem[]> {
    const rows = await this.database.queries
      .selectFrom("work_items")
      .selectAll()
      .where("project_id", "=", projectId)
      .orderBy("priority", "asc")
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();
    return rows.map(mapWorkItem);
  }

  async listEvents(
    projectId: string,
    id: WorkItemId,
  ): Promise<readonly WorkItemEvent[]> {
    const rows = await this.database.queries
      .selectFrom("work_item_events as event")
      .innerJoin("work_items as item", "item.id", "event.work_item_id")
      .select([
        "event.id",
        "event.work_item_id",
        "event.event_type",
        "event.payload_json",
        "event.created_at",
        "event.revision",
      ])
      .where("item.project_id", "=", projectId)
      .where("item.id", "=", id.toString())
      .orderBy("event.created_at", "asc")
      .orderBy("event.id", "asc")
      .execute();
    return rows.map(mapWorkItemEvent);
  }

  private async insertWorkItem(
    database: Kysely<CairnDatabaseSchema>,
    item: WorkItem,
  ): Promise<void> {
    await database
      .insertInto("work_items")
      .values({
        assignee: item.assignee,
        claimed_at: item.claimedAt,
        closed_at: item.closedAt,
        created_at: item.createdAt,
        description: item.description,
        id: item.id.toString(),
        notes: item.notes,
        priority: item.priority.toNumber(),
        project_id: item.projectId,
        revision: item.revision,
        status: item.status,
        title: item.title.toString(),
        type: item.type,
        updated_at: item.updatedAt,
      })
      .execute();
  }

  private async insertCreatedEvent(
    database: Kysely<CairnDatabaseSchema>,
    item: WorkItem,
  ): Promise<void> {
    await this.insertEvent(database, item.id, {
      createdAt: item.createdAt,
      eventType: "created",
      payload: {
        priority: item.priority.toNumber(),
        status: item.status,
        type: item.type,
      },
      revision: item.revision,
    });
  }

  private async insertSearchProjection(
    database: Kysely<CairnDatabaseSchema>,
    item: WorkItem,
  ): Promise<void> {
    await database
      .insertInto("search_entries")
      .values({
        body: searchBody(item),
        created_at: item.createdAt,
        entity_id: item.id.toString(),
        entity_kind: "work_item",
        project_id: item.projectId,
        source_path: null,
        tags: searchTags(item),
        title: item.title.toString(),
        updated_at: item.updatedAt,
        workspace_id: null,
      })
      .execute();
  }

  private async updateWorkItem(
    database: Kysely<CairnDatabaseSchema>,
    transition: WorkItemTransition,
  ): Promise<void> {
    const item = transition.item;
    const result = await database
      .updateTable("work_items")
      .set({
        assignee: item.assignee,
        claimed_at: item.claimedAt,
        closed_at: item.closedAt,
        description: item.description,
        notes: item.notes,
        priority: item.priority.toNumber(),
        revision: item.revision,
        status: item.status,
        title: item.title.toString(),
        type: item.type,
        updated_at: item.updatedAt,
      })
      .where("project_id", "=", item.projectId)
      .where("id", "=", item.id.toString())
      .where("revision", "=", transition.expectedRevision)
      .executeTakeFirst();
    if (result.numUpdatedRows === 0n) {
      throw new WorkItemConflictError(
        item.id.toString(),
        transition.expectedRevision,
      );
    }
  }

  private async insertEvent(
    database: Kysely<CairnDatabaseSchema>,
    id: WorkItemId,
    event: WorkItemEventDraft,
  ): Promise<void> {
    await database
      .insertInto("work_item_events")
      .values({
        created_at: event.createdAt,
        event_type: event.eventType,
        payload_json: JSON.stringify(event.payload),
        revision: event.revision,
        work_item_id: id.toString(),
      })
      .execute();
  }

  private async updateSearchProjection(
    database: Kysely<CairnDatabaseSchema>,
    item: WorkItem,
  ): Promise<void> {
    const result = await database
      .updateTable("search_entries")
      .set({
        body: searchBody(item),
        tags: searchTags(item),
        title: item.title.toString(),
        updated_at: item.updatedAt,
      })
      .where("entity_kind", "=", "work_item")
      .where("entity_id", "=", item.id.toString())
      .where("project_id", "=", item.projectId)
      .executeTakeFirst();
    if (result.numUpdatedRows === 0n) {
      throw new Error(
        `Work-item search projection not found: ${item.id.toString()}`,
      );
    }
  }
}
