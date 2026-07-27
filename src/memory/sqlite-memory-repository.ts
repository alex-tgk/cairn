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
  normalizeMemoryRelation,
  restoreMemory,
  type Memory,
  type MemoryEventDraft,
  type MemoryScope,
  type MemorySearchCursor,
  type MemoryTransition,
} from "./memory.ts";
import type {
  LinkedContextDocument,
  LinkedWorkItem,
  MemoryFilter,
  MemoryRepository,
  MemorySearchResult,
  MemoryTimeline,
} from "./memory-repository.ts";

type MemoryRow = Selectable<MemoryTable>;

// Read-only lookups against work_items and context_documents: those tables
// are owned by the work and context domains respectively, but Cairn's
// domains share one physical database (see docs/architecture.md), so the
// memory infrastructure adapter may read them directly to validate and
// resolve backlink targets without importing work/context application code.
// All writes for this feature stay confined to memory_work_links and
// memory_context_links, which the memory domain owns.
type LinkableWorkItemRow = Readonly<{
  id: string;
  status: string;
  title: string;
  type: string;
}>;

type LinkableContextDocumentRow = Readonly<{
  id: string;
  relative_path: string;
  title: string;
}>;

const UUID_PREFIX_PATTERN = /^[0-9a-f-]+$/u;

function mapLinkedWorkItem(row: LinkableWorkItemRow): LinkedWorkItem {
  return { id: row.id, status: row.status, title: row.title, type: row.type };
}

function mapLinkedContextDocument(
  row: LinkableContextDocumentRow,
): LinkedContextDocument {
  return { id: row.id, relativePath: row.relative_path, title: row.title };
}

function mapMemory(row: MemoryRow): Memory {
  return restoreMemory({
    archived: row.archived === 1,
    content: row.content,
    createdAt: row.created_at,
    id: MemoryId.from(row.id),
    pinned: row.pinned === 1,
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
  if (filter?.includeArchived !== true) {
    conditions.push(sql`memories.archived = 0`);
  }
  if (filter?.scope !== undefined) {
    conditions.push(sql`memories.scope = ${filter.scope}`);
  }
  if (filter?.type !== undefined) {
    conditions.push(sql`memories.type = ${filter.type}`);
  }
  if (filter?.topic !== undefined) {
    conditions.push(sql`memories.topic = ${filter.topic}`);
  }
  if (filter?.cursor !== undefined) {
    const { createdAt, id } = filter.cursor;
    // Seeks strictly past the cursor's sort-key tuple, matching
    // `listByProject`'s `ORDER BY created_at DESC, id DESC` and the
    // trailing (created_at, id) columns of
    // memories_scope_project_archived_order_index, so a page boundary is
    // an indexed comparison rather than an OFFSET re-scan.
    conditions.push(sql`(
      memories.created_at < ${createdAt}
      OR (memories.created_at = ${createdAt} AND memories.id < ${id})
    )`);
  }
  return sql.join(conditions, sql` AND `);
}

function searchCursorCondition(cursor: MemorySearchCursor | undefined) {
  if (cursor === undefined) {
    return sql`1 = 1`;
  }
  const { createdAt, id, rank } = cursor;
  // Seeks strictly past the cursor's (rank, created_at, id) tuple, matching
  // `search`'s `ORDER BY search_entries_fts.rank, memories.created_at DESC,
  // memories.id DESC`. See the `MemorySearchCursor` doc comment in
  // memory.ts and ADR 0011 for why this is deterministic but not an
  // indexed keyset seek the way memory list's cursor is.
  return sql`(
    search_entries_fts.rank > ${rank}
    OR (
      search_entries_fts.rank = ${rank}
      AND memories.created_at < ${createdAt}
    )
    OR (
      search_entries_fts.rank = ${rank}
      AND memories.created_at = ${createdAt}
      AND memories.id < ${id}
    )
  )`;
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

  async applyLifecycleTransition(transition: MemoryTransition): Promise<void> {
    await this.database.immediateTransaction(async (database) => {
      const result = await database
        .updateTable("memories")
        .set({
          archived: transition.memory.archived ? 1 : 0,
          pinned: transition.memory.pinned ? 1 : 0,
          revision: transition.memory.revision,
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

  async addRelation(
    memoryId: MemoryId,
    relatedMemoryId: MemoryId,
    now: string,
  ): Promise<void> {
    const [firstId, secondId] = normalizeMemoryRelation(
      memoryId.toString(),
      relatedMemoryId.toString(),
    );
    await this.database.queries
      .insertInto("memory_relations")
      .values({ created_at: now, memory_id: firstId, related_memory_id: secondId })
      .onConflict((oc) => oc.columns(["memory_id", "related_memory_id"]).doNothing())
      .execute();
  }

  async removeRelation(
    memoryId: MemoryId,
    relatedMemoryId: MemoryId,
  ): Promise<void> {
    const [firstId, secondId] = normalizeMemoryRelation(
      memoryId.toString(),
      relatedMemoryId.toString(),
    );
    await this.database.queries
      .deleteFrom("memory_relations")
      .where("memory_id", "=", firstId)
      .where("related_memory_id", "=", secondId)
      .execute();
  }

  async findWorkItemReference(
    projectId: string,
    reference: string,
  ): Promise<readonly LinkedWorkItem[]> {
    const normalized = reference.trim().toLowerCase();
    const exact = await sql<LinkableWorkItemRow>`
      SELECT id, title, status, type
      FROM work_items
      WHERE project_id = ${projectId} AND id = ${normalized}
    `.execute(this.database.queries);
    if (exact.rows[0]) {
      return [mapLinkedWorkItem(exact.rows[0])];
    }

    const hexadecimalLength = normalized.replaceAll("-", "").length;
    if (hexadecimalLength < 6 || !UUID_PREFIX_PATTERN.test(normalized)) {
      return [];
    }

    const matches = await sql<LinkableWorkItemRow>`
      SELECT id, title, status, type
      FROM work_items
      WHERE project_id = ${projectId} AND id LIKE ${`${normalized}%`}
      ORDER BY id ASC
    `.execute(this.database.queries);
    return matches.rows.map(mapLinkedWorkItem);
  }

  async linkWorkItem(
    memoryId: MemoryId,
    workItemId: string,
    now: string,
  ): Promise<void> {
    await this.database.queries
      .insertInto("memory_work_links")
      .values({ created_at: now, memory_id: memoryId.toString(), work_item_id: workItemId })
      .onConflict((oc) => oc.columns(["memory_id", "work_item_id"]).doNothing())
      .execute();
  }

  async unlinkWorkItem(memoryId: MemoryId, workItemId: string): Promise<void> {
    await this.database.queries
      .deleteFrom("memory_work_links")
      .where("memory_id", "=", memoryId.toString())
      .where("work_item_id", "=", workItemId)
      .execute();
  }

  async listLinkedWorkItems(memoryId: MemoryId): Promise<readonly LinkedWorkItem[]> {
    const rows = await sql<LinkableWorkItemRow>`
      SELECT work_items.id, work_items.title, work_items.status, work_items.type
      FROM memory_work_links
      JOIN work_items ON work_items.id = memory_work_links.work_item_id
      WHERE memory_work_links.memory_id = ${memoryId.toString()}
      ORDER BY work_items.id ASC
    `.execute(this.database.queries);
    return rows.rows.map(mapLinkedWorkItem);
  }

  async findContextDocumentReference(
    projectId: string,
    reference: string,
  ): Promise<readonly LinkedContextDocument[]> {
    const trimmed = reference.trim();
    const exact = await sql<LinkableContextDocumentRow>`
      SELECT id, relative_path, title
      FROM context_documents
      WHERE project_id = ${projectId} AND id = ${trimmed}
    `.execute(this.database.queries);
    if (exact.rows[0]) {
      return [mapLinkedContextDocument(exact.rows[0])];
    }

    const byPath = await sql<LinkableContextDocumentRow>`
      SELECT id, relative_path, title
      FROM context_documents
      WHERE project_id = ${projectId}
        AND relative_path = ${trimmed}
        AND active = 1
      ORDER BY id ASC
    `.execute(this.database.queries);
    return byPath.rows.map(mapLinkedContextDocument);
  }

  async linkContextDocument(
    memoryId: MemoryId,
    contextDocumentId: string,
    now: string,
  ): Promise<void> {
    await this.database.queries
      .insertInto("memory_context_links")
      .values({
        context_document_id: contextDocumentId,
        created_at: now,
        memory_id: memoryId.toString(),
      })
      .onConflict((oc) =>
        oc.columns(["memory_id", "context_document_id"]).doNothing(),
      )
      .execute();
  }

  async unlinkContextDocument(
    memoryId: MemoryId,
    contextDocumentId: string,
  ): Promise<void> {
    await this.database.queries
      .deleteFrom("memory_context_links")
      .where("memory_id", "=", memoryId.toString())
      .where("context_document_id", "=", contextDocumentId)
      .execute();
  }

  async listLinkedContextDocuments(
    memoryId: MemoryId,
  ): Promise<readonly LinkedContextDocument[]> {
    const rows = await sql<LinkableContextDocumentRow>`
      SELECT context_documents.id, context_documents.relative_path, context_documents.title
      FROM memory_context_links
      JOIN context_documents
        ON context_documents.id = memory_context_links.context_document_id
      WHERE memory_context_links.memory_id = ${memoryId.toString()}
      ORDER BY context_documents.relative_path ASC
    `.execute(this.database.queries);
    return rows.rows.map(mapLinkedContextDocument);
  }

  async listRelations(memoryId: MemoryId): Promise<readonly Memory[]> {
    const id = memoryId.toString();
    const rows = await sql<MemoryRow>`
      SELECT memories.*
      FROM memory_relations
      JOIN memories ON memories.id = CASE
        WHEN memory_relations.memory_id = ${id} THEN memory_relations.related_memory_id
        ELSE memory_relations.memory_id
      END
      WHERE memory_relations.memory_id = ${id}
         OR memory_relations.related_memory_id = ${id}
      ORDER BY memories.created_at DESC, memories.id DESC
    `.execute(this.database.queries);
    return rows.rows.map(mapMemory);
  }

  async listTimeline(
    memory: Memory,
    before: number,
    after: number,
  ): Promise<MemoryTimeline> {
    const scopeCondition = memory.projectId === null
      ? sql`memories.scope = 'personal'`
      : sql`memories.scope = 'project' AND memories.project_id = ${memory.projectId}`;

    const beforeRows = await sql<MemoryRow>`
      SELECT *
      FROM memories
      WHERE ${scopeCondition}
        AND (created_at < ${memory.createdAt}
          OR (created_at = ${memory.createdAt} AND id < ${memory.id.toString()}))
      ORDER BY created_at DESC, id DESC
      LIMIT ${before}
    `.execute(this.database.queries);

    const afterRows = await sql<MemoryRow>`
      SELECT *
      FROM memories
      WHERE ${scopeCondition}
        AND (created_at > ${memory.createdAt}
          OR (created_at = ${memory.createdAt} AND id > ${memory.id.toString()}))
      ORDER BY created_at ASC, id ASC
      LIMIT ${after}
    `.execute(this.database.queries);

    return {
      after: afterRows.rows.map(mapMemory),
      before: beforeRows.rows.map(mapMemory).reverse(),
      target: memory,
    };
  }

  async search(
    projectId: string,
    query: string,
    filter?: MemoryFilter,
  ): Promise<readonly MemorySearchResult[]> {
    const condition = buildFilterCondition(projectId, filter);
    const cursorCondition = searchCursorCondition(filter?.searchCursor);
    const limit = limitClause(filter);
    const rows = await sql<MemoryRow & { rank: number }>`
      SELECT memories.*, search_entries_fts.rank AS rank
      FROM search_entries_fts
      JOIN search_entries ON search_entries.id = search_entries_fts.rowid
      JOIN memories ON memories.id = search_entries.entity_id
      WHERE search_entries.entity_kind = 'memory'
        AND search_entries_fts MATCH ${query}
        AND ${condition}
        AND ${cursorCondition}
      ORDER BY search_entries_fts.rank, memories.created_at DESC, memories.id DESC
      ${limit}
    `.execute(this.database.queries);
    return rows.rows.map((row) => ({ memory: mapMemory(row), rank: row.rank }));
  }

  private async insertMemory(
    database: Kysely<CairnDatabaseSchema>,
    memory: Memory,
  ): Promise<void> {
    await database
      .insertInto("memories")
      .values({
        archived: memory.archived ? 1 : 0,
        content: memory.content,
        created_at: memory.createdAt,
        id: memory.id.toString(),
        pinned: memory.pinned ? 1 : 0,
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
