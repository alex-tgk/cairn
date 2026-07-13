import {
  type Kysely,
  type Selectable,
  sql,
} from "kysely";

import {
  type CairnDatabaseSchema,
  CairnQueryDatabase,
  type MemoryEventTable,
  type MemoryTable,
} from "../storage/query-database.ts";
import {
  MemoryConflictError,
  MemoryId,
  MemoryTitle,
  restoreMemory,
  type Memory,
  type MemoryEventDraft,
  type MemoryScope,
  type MemoryTransition,
} from "./memory.ts";
import type { MemoryFilter, MemoryRepository } from "./memory-repository.ts";

type MemoryRow = Selectable<MemoryTable>;

function mapMemory(row: MemoryRow): Memory {
  return restoreMemory({
    content: row.content,
    createdAt: row.created_at,
    id: MemoryId.from(row.id),
    projectId: row.project_id,
    revision: row.revision,
    scope: row.scope,
    title: MemoryTitle.from(row.title),
    topic: row.topic,
    type: row.type,
    updatedAt: row.updated_at,
  });
}

function searchTags(memory: Memory): string {
  return memory.topic === null
    ? `${memory.type} ${memory.scope}`
    : `${memory.type} ${memory.scope} ${memory.topic}`;
}

function buildFilterCondition(projectId: string, filter: MemoryFilter | undefined) {
  const conditions = [
    sql`(memories.scope = 'personal' OR memories.project_id = ${projectId})`,
  ];
  if (filter?.scope !== undefined) {
    conditions.push(sql`memories.scope = ${filter.scope}`);
  }
  if (filter?.type !== undefined) {
    conditions.push(sql`memories.type = ${filter.type}`);
  }
  if (filter?.topic !== undefined) {
    conditions.push(sql`memories.topic = ${filter.topic}`);
  }
  return sql.join(conditions, sql` AND `);
}

function limitClause(filter: MemoryFilter | undefined) {
  return filter?.limit === undefined ? sql`` : sql`LIMIT ${filter.limit}`;
}

export class SqliteMemoryRepository implements MemoryRepository {
  constructor(private readonly database: CairnQueryDatabase) {}

  async create(memory: Memory): Promise<void> {
    await this.database.immediateTransaction(async (database) => {
      await this.insertMemory(database, memory);
      await this.insertEvent(database, memory.id.toString(), {
        createdAt: memory.createdAt,
        eventType: "created",
        payload: {
          scope: memory.scope,
          topic: memory.topic,
          type: memory.type,
        },
        revision: memory.revision,
      });
      await this.insertSearchProjection(database, memory);
    });
  }

  async applyUpsert(transition: MemoryTransition): Promise<void> {
    await this.database.immediateTransaction(async (database) => {
      const result = await database
        .updateTable("memories")
        .set({
          content: transition.memory.content,
          revision: transition.memory.revision,
          title: transition.memory.title.toString(),
          type: transition.memory.type,
          updated_at: transition.memory.updatedAt,
        })
        .where("id", "=", transition.memory.id.toString())
        .where("revision", "=", transition.expectedRevision)
        .executeTakeFirst();
      if (result.numUpdatedRows === 0n) {
        throw new MemoryConflictError(
          transition.memory.id.toString(),
          transition.expectedRevision,
        );
      }
      await this.insertEvent(
        database,
        transition.memory.id.toString(),
        transition.event,
      );
      await this.updateSearchProjection(database, transition.memory);
    });
  }

  async findById(id: MemoryId): Promise<Memory | null> {
    const row = await this.database.queries
      .selectFrom("memories")
      .selectAll()
      .where("id", "=", id.toString())
      .executeTakeFirst();
    return row ? mapMemory(row) : null;
  }

  async findByTopic(
    scope: MemoryScope,
    projectId: string | null,
    topic: string,
  ): Promise<Memory | null> {
    let query = this.database.queries
      .selectFrom("memories")
      .selectAll()
      .where("scope", "=", scope)
      .where("topic", "=", topic);
    query = projectId === null
      ? query.where("project_id", "is", null)
      : query.where("project_id", "=", projectId);
    const row = await query.executeTakeFirst();
    return row ? mapMemory(row) : null;
  }

  async findByReference(
    projectId: string,
    reference: string,
  ): Promise<readonly Memory[]> {
    const rows = await sql<MemoryRow>`
      SELECT *
      FROM memories
      WHERE (scope = 'personal' OR project_id = ${projectId})
        AND (id = ${reference} OR id LIKE ${`${reference}%`})
      ORDER BY id
    `.execute(this.database.queries);
    return rows.rows.map(mapMemory);
  }

  async listByProject(
    projectId: string,
    filter?: MemoryFilter,
  ): Promise<readonly Memory[]> {
    const condition = buildFilterCondition(projectId, filter);
    const limit = limitClause(filter);
    const rows = await sql<MemoryRow>`
      SELECT *
      FROM memories
      WHERE ${condition}
      ORDER BY created_at DESC, id DESC
      ${limit}
    `.execute(this.database.queries);
    return rows.rows.map(mapMemory);
  }

  async search(
    projectId: string,
    query: string,
    filter?: MemoryFilter,
  ): Promise<readonly Memory[]> {
    const condition = buildFilterCondition(projectId, filter);
    const limit = limitClause(filter);
    const rows = await sql<MemoryRow>`
      SELECT memories.*
      FROM search_entries_fts
      JOIN search_entries ON search_entries.id = search_entries_fts.rowid
      JOIN memories ON memories.id = search_entries.entity_id
      WHERE search_entries.entity_kind = 'memory'
        AND search_entries_fts MATCH ${query}
        AND ${condition}
      ORDER BY search_entries_fts.rank, memories.created_at DESC, memories.id DESC
      ${limit}
    `.execute(this.database.queries);
    return rows.rows.map(mapMemory);
  }

  private async insertMemory(
    database: Kysely<CairnDatabaseSchema>,
    memory: Memory,
  ): Promise<void> {
    await database
      .insertInto("memories")
      .values({
        content: memory.content,
        created_at: memory.createdAt,
        id: memory.id.toString(),
        project_id: memory.projectId,
        revision: memory.revision,
        scope: memory.scope,
        title: memory.title.toString(),
        topic: memory.topic,
        type: memory.type,
        updated_at: memory.updatedAt,
      })
      .execute();
  }

  private async insertEvent(
    database: Kysely<CairnDatabaseSchema>,
    memoryId: string,
    event: MemoryEventDraft,
  ): Promise<void> {
    await database
      .insertInto("memory_events")
      .values({
        created_at: event.createdAt,
        event_type: event.eventType,
        memory_id: memoryId,
        payload_json: JSON.stringify(event.payload),
        revision: event.revision,
      })
      .execute();
  }

  private async insertSearchProjection(
    database: Kysely<CairnDatabaseSchema>,
    memory: Memory,
  ): Promise<void> {
    await database
      .insertInto("search_entries")
      .values({
        body: memory.content,
        created_at: memory.createdAt,
        entity_id: memory.id.toString(),
        entity_kind: "memory",
        project_id: memory.projectId,
        source_path: null,
        tags: searchTags(memory),
        title: memory.title.toString(),
        updated_at: memory.updatedAt,
        workspace_id: null,
      })
      .execute();
  }

  private async updateSearchProjection(
    database: Kysely<CairnDatabaseSchema>,
    memory: Memory,
  ): Promise<void> {
    await database
      .updateTable("search_entries")
      .set({
        body: memory.content,
        tags: searchTags(memory),
        title: memory.title.toString(),
        updated_at: memory.updatedAt,
      })
      .where("entity_kind", "=", "memory")
      .where("entity_id", "=", memory.id.toString())
      .execute();
  }
}
