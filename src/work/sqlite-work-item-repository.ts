import {
  type Kysely,
  type Selectable,
  sql,
} from "kysely";

import {
  type CairnDatabaseSchema,
  CairnQueryDatabase,
  type WorkItemEventTable,
  type WorkItemTable,
} from "../storage/query-database.ts";
import {
  restoreWorkItem,
  appendWorkItemNote,
  createWorkItemTransition,
  normalizeWorkItemCommentAuthor,
  normalizeWorkItemCommentBody,
  normalizeWorkItemLabel,
  WorkItemConflictError,
  WorkItemId,
  WorkItemOpenDescendantsError,
  WorkItemPriority,
  WorkItemRelationError,
  WorkItemTitle,
  type WorkItem,
  type WorkItemEvent,
  type WorkItemEventDraft,
  type WorkItemEventPayload,
  type WorkItemTransition,
} from "./work-item.ts";
import type {
  WorkDependency,
  WorkDependencyDirection,
  WorkItemComment,
  WorkItemRepository,
  WorkReadiness,
  WorkTreeNode,
} from "./work-item-repository.ts";

type WorkItemRow = Selectable<WorkItemTable>;
type WorkItemEventRow = Selectable<WorkItemEventTable>;
type WorkTreeRow = WorkItemRow &
  Readonly<{
    depth: number;
    parent_id: string | null;
  }>;
type WorkDependencyRow = WorkItemRow &
  Readonly<{
    blocked_id: string;
    blocker_id: string;
    dependency_created_at: string;
  }>;

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

function searchTags(item: WorkItem, labels: readonly string[]): string {
  const base = `${item.type} ${item.status} p${item.priority.toNumber()}`;
  return labels.length === 0 ? base : `${base} ${labels.join(" ")}`;
}

function searchBody(item: WorkItem): string {
  return item.notes.length === 0
    ? item.description
    : `${item.description}\n${item.notes}`;
}

const UUID_PREFIX_PATTERN = /^[0-9a-f-]+$/u;

export class SqliteWorkItemRepository implements WorkItemRepository {
  constructor(private readonly database: CairnQueryDatabase) {}

  async create(item: WorkItem, parentId?: WorkItemId): Promise<void> {
    await this.database.immediateTransaction(async (database) => {
      if (parentId) {
        if (item.id.toString() === parentId.toString()) {
          throw new WorkItemRelationError(
            "self_parent",
            item.id.toString(),
            parentId.toString(),
          );
        }
        await this.requireRelatedItem(database, item.projectId, parentId);
      }
      await this.insertWorkItem(database, item);
      await this.insertCreatedEvent(database, item, parentId);
      await this.insertSearchProjection(database, item);
      if (parentId) {
        await this.insertParent(database, item, parentId, item.createdAt);
      }
    });
  }

  async applyTransition(transition: WorkItemTransition): Promise<void> {
    await this.database.immediateTransaction(async (database) => {
      await this.requireItemRevision(
        database,
        transition.item.projectId,
        transition.item.id,
        transition.expectedRevision,
      );
      if (transition.event.eventType === "closed") {
        await this.requireNoOpenDescendants(database, transition.item);
      }
      await this.applyTransitionInTransaction(database, transition);
    });
  }

  async addBlocker(
    projectId: string,
    blockedId: WorkItemId,
    blockerId: WorkItemId,
    expectedRevision: number,
    now: string,
  ): Promise<WorkItem> {
    return await this.database.immediateTransaction(async (database) => {
      if (blockedId.toString() === blockerId.toString()) {
        throw new WorkItemRelationError(
          "self_dependency",
          blockedId.toString(),
          blockerId.toString(),
        );
      }
      const blocked = await this.requireItemRevision(
        database,
        projectId,
        blockedId,
        expectedRevision,
      );
      await this.requireRelatedItem(database, projectId, blockerId);
      const existing = await database
        .selectFrom("work_item_dependencies")
        .select("blocked_id")
        .where("project_id", "=", projectId)
        .where("blocked_id", "=", blockedId.toString())
        .where("blocker_id", "=", blockerId.toString())
        .executeTakeFirst();
      if (existing) {
        return blocked;
      }
      await this.requireNoDependencyCycle(
        database,
        projectId,
        blockedId,
        blockerId,
      );
      await database
        .insertInto("work_item_dependencies")
        .values({
          blocked_id: blockedId.toString(),
          blocker_id: blockerId.toString(),
          created_at: now,
          project_id: projectId,
        })
        .execute();
      const transition = createWorkItemTransition(
        blocked,
        "dependency_added",
        { blockerId: blockerId.toString() },
        now,
      );
      await this.applyTransitionInTransaction(database, transition);
      return transition.item;
    });
  }

  async removeBlocker(
    projectId: string,
    blockedId: WorkItemId,
    blockerId: WorkItemId,
    expectedRevision: number,
    now: string,
  ): Promise<WorkItem> {
    return await this.database.immediateTransaction(async (database) => {
      if (blockedId.toString() === blockerId.toString()) {
        throw new WorkItemRelationError(
          "self_dependency",
          blockedId.toString(),
          blockerId.toString(),
        );
      }
      const blocked = await this.requireItemRevision(
        database,
        projectId,
        blockedId,
        expectedRevision,
      );
      await this.requireRelatedItem(database, projectId, blockerId);
      const result = await database
        .deleteFrom("work_item_dependencies")
        .where("project_id", "=", projectId)
        .where("blocked_id", "=", blockedId.toString())
        .where("blocker_id", "=", blockerId.toString())
        .executeTakeFirst();
      if (result.numDeletedRows === 0n) {
        return blocked;
      }
      const transition = createWorkItemTransition(
        blocked,
        "dependency_removed",
        { blockerId: blockerId.toString() },
        now,
      );
      await this.applyTransitionInTransaction(database, transition);
      return transition.item;
    });
  }

  async listDependencies(
    projectId: string,
    id: WorkItemId,
    direction: WorkDependencyDirection,
  ): Promise<readonly WorkDependency[]> {
    const relatedColumn = direction === "blockers" ? "blocker_id" : "blocked_id";
    const matchColumn = direction === "blockers" ? "blocked_id" : "blocker_id";
    const rows = await sql<WorkDependencyRow>`
      SELECT related.*, dependency.blocked_id, dependency.blocker_id,
             dependency.created_at AS dependency_created_at
      FROM work_item_dependencies AS dependency
      INNER JOIN work_items AS related
        ON related.project_id = dependency.project_id
       AND related.id = dependency.${sql.ref(relatedColumn)}
      WHERE dependency.project_id = ${projectId}
        AND dependency.${sql.ref(matchColumn)} = ${id.toString()}
      ORDER BY related.priority ASC, related.created_at ASC, related.id ASC
    `.execute(this.database.queries);
    return rows.rows.map((row) => ({
      blockedId: WorkItemId.from(row.blocked_id),
      blockerId: WorkItemId.from(row.blocker_id),
      createdAt: row.dependency_created_at,
      relatedItem: mapWorkItem(row),
    }));
  }

  async addLabel(
    projectId: string,
    id: WorkItemId,
    label: string,
    expectedRevision: number,
    now: string,
  ): Promise<WorkItem> {
    const normalized = normalizeWorkItemLabel(label);
    return await this.database.immediateTransaction(async (database) => {
      const item = await this.requireItemRevision(
        database,
        projectId,
        id,
        expectedRevision,
      );
      const existing = await database
        .selectFrom("work_item_labels")
        .select("label")
        .where("project_id", "=", projectId)
        .where("work_item_id", "=", id.toString())
        .where("label", "=", normalized)
        .executeTakeFirst();
      if (existing) {
        return item;
      }
      await database
        .insertInto("work_item_labels")
        .values({
          created_at: now,
          label: normalized,
          project_id: projectId,
          work_item_id: id.toString(),
        })
        .execute();
      const transition = createWorkItemTransition(
        item,
        "label_added",
        { label: normalized },
        now,
      );
      await this.applyTransitionInTransaction(database, transition);
      return transition.item;
    });
  }

  async removeLabel(
    projectId: string,
    id: WorkItemId,
    label: string,
    expectedRevision: number,
    now: string,
  ): Promise<WorkItem> {
    const normalized = normalizeWorkItemLabel(label);
    return await this.database.immediateTransaction(async (database) => {
      const item = await this.requireItemRevision(
        database,
        projectId,
        id,
        expectedRevision,
      );
      const result = await database
        .deleteFrom("work_item_labels")
        .where("project_id", "=", projectId)
        .where("work_item_id", "=", id.toString())
        .where("label", "=", normalized)
        .executeTakeFirst();
      if (result.numDeletedRows === 0n) {
        return item;
      }
      const transition = createWorkItemTransition(
        item,
        "label_removed",
        { label: normalized },
        now,
      );
      await this.applyTransitionInTransaction(database, transition);
      return transition.item;
    });
  }

  async listLabels(
    projectId: string,
    id: WorkItemId,
  ): Promise<readonly string[]> {
    return await this.currentLabels(this.database.queries, projectId, id);
  }

  async appendNote(
    projectId: string,
    id: WorkItemId,
    note: string,
    expectedRevision: number,
    now: string,
  ): Promise<WorkItem> {
    return await this.database.immediateTransaction(async (database) => {
      const item = await this.requireItemRevision(
        database,
        projectId,
        id,
        expectedRevision,
      );
      const transition = appendWorkItemNote(item, note, now);
      await this.applyTransitionInTransaction(database, transition);
      return transition.item;
    });
  }

  async addComment(
    projectId: string,
    id: WorkItemId,
    author: string,
    body: string,
    expectedRevision: number,
    now: string,
  ): Promise<WorkItem> {
    const normalizedAuthor = normalizeWorkItemCommentAuthor(author);
    const normalizedBody = normalizeWorkItemCommentBody(body);
    return await this.database.immediateTransaction(async (database) => {
      const item = await this.requireItemRevision(
        database,
        projectId,
        id,
        expectedRevision,
      );
      const transition = createWorkItemTransition(
        item,
        "comment_added",
        { author: normalizedAuthor },
        now,
      );
      await database
        .insertInto("work_item_comments")
        .values({
          author: normalizedAuthor,
          body: normalizedBody,
          created_at: now,
          project_id: projectId,
          revision: transition.item.revision,
          work_item_id: id.toString(),
        })
        .execute();
      await this.applyTransitionInTransaction(database, transition);
      return transition.item;
    });
  }

  async listComments(
    projectId: string,
    id: WorkItemId,
  ): Promise<readonly WorkItemComment[]> {
    const rows = await this.database.queries
      .selectFrom("work_item_comments")
      .select(["id", "author", "body", "created_at", "revision"])
      .where("project_id", "=", projectId)
      .where("work_item_id", "=", id.toString())
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();
    return rows.map((row) => ({
      author: row.author,
      body: row.body,
      createdAt: row.created_at,
      id: row.id,
      revision: row.revision,
      workItemId: id.toString(),
    }));
  }

  async listReady(projectId: string): Promise<readonly WorkReadiness[]> {
    const rows = await sql<WorkItemRow>`
      SELECT item.*
      FROM work_items AS item
      WHERE item.project_id = ${projectId}
        AND item.status = 'open'
        AND NOT EXISTS (
          SELECT 1
          FROM work_item_dependencies AS dependency
          INNER JOIN work_items AS blocker
            ON blocker.project_id = dependency.project_id
           AND blocker.id = dependency.blocker_id
          WHERE dependency.project_id = item.project_id
            AND dependency.blocked_id = item.id
            AND blocker.status <> 'closed'
        )
      ORDER BY item.priority ASC, item.created_at ASC, item.id ASC
    `.execute(this.database.queries);
    return rows.rows.map((row) => ({ blockers: [], item: mapWorkItem(row) }));
  }

  async listBlocked(projectId: string): Promise<readonly WorkReadiness[]> {
    const rows = await sql<WorkItemRow>`
      SELECT item.*
      FROM work_items AS item
      WHERE item.project_id = ${projectId}
        AND item.status <> 'closed'
        AND EXISTS (
          SELECT 1
          FROM work_item_dependencies AS dependency
          INNER JOIN work_items AS blocker
            ON blocker.project_id = dependency.project_id
           AND blocker.id = dependency.blocker_id
          WHERE dependency.project_id = item.project_id
            AND dependency.blocked_id = item.id
            AND blocker.status <> 'closed'
        )
      ORDER BY item.priority ASC, item.created_at ASC, item.id ASC
    `.execute(this.database.queries);
    return await Promise.all(
      rows.rows.map(async (row) => ({
        blockers: await this.listActiveBlockers(projectId, WorkItemId.from(row.id)),
        item: mapWorkItem(row),
      })),
    );
  }

  async setParent(
    projectId: string,
    childId: WorkItemId,
    parentId: WorkItemId,
    expectedRevision: number,
    now: string,
  ): Promise<WorkItem> {
    return await this.database.immediateTransaction(async (database) => {
      if (childId.toString() === parentId.toString()) {
        throw new WorkItemRelationError(
          "self_parent",
          childId.toString(),
          parentId.toString(),
        );
      }
      const child = await this.requireItemRevision(
        database,
        projectId,
        childId,
        expectedRevision,
      );
      await this.requireRelatedItem(database, projectId, parentId);
      const currentParent = await this.currentParent(database, projectId, childId);
      if (currentParent === parentId.toString()) {
        return child;
      }
      await this.requireNoHierarchyCycle(database, projectId, childId, parentId);
      await database
        .insertInto("work_item_hierarchy")
        .values({
          child_id: childId.toString(),
          created_at: now,
          parent_id: parentId.toString(),
          project_id: projectId,
        })
        .onConflict((conflict) =>
          conflict.columns(["project_id", "child_id"]).doUpdateSet({
            created_at: now,
            parent_id: parentId.toString(),
          }),
        )
        .execute();
      const transition = createWorkItemTransition(
        child,
        "parent_set",
        { parentId: parentId.toString() },
        now,
      );
      await this.applyTransitionInTransaction(database, transition);
      return transition.item;
    });
  }

  async clearParent(
    projectId: string,
    childId: WorkItemId,
    expectedRevision: number,
    now: string,
  ): Promise<WorkItem> {
    return await this.database.immediateTransaction(async (database) => {
      const child = await this.requireItemRevision(
        database,
        projectId,
        childId,
        expectedRevision,
      );
      const currentParent = await this.currentParent(database, projectId, childId);
      if (currentParent === null) {
        return child;
      }
      await database
        .deleteFrom("work_item_hierarchy")
        .where("project_id", "=", projectId)
        .where("child_id", "=", childId.toString())
        .execute();
      const transition = createWorkItemTransition(
        child,
        "parent_cleared",
        { parentId: null },
        now,
      );
      await this.applyTransitionInTransaction(database, transition);
      return transition.item;
    });
  }

  async listTree(
    projectId: string,
    rootId?: WorkItemId,
  ): Promise<readonly WorkTreeNode[]> {
    const root = rootId?.toString() ?? null;
    const rows = await sql<WorkTreeRow>`
      WITH RECURSIVE tree(
        id, project_id, title, description, status, priority, type, assignee,
        created_at, updated_at, claimed_at, closed_at, revision, notes,
        parent_id, depth, sort_path
      ) AS (
        SELECT item.id, item.project_id, item.title, item.description,
               item.status, item.priority, item.type, item.assignee,
               item.created_at, item.updated_at, item.claimed_at,
               item.closed_at, item.revision, item.notes,
               hierarchy.parent_id, 0,
               printf('%d|%s|%s', item.priority, item.created_at, item.id)
        FROM work_items AS item
        LEFT JOIN work_item_hierarchy AS hierarchy
          ON hierarchy.project_id = item.project_id
         AND hierarchy.child_id = item.id
        WHERE item.project_id = ${projectId}
          AND (
            (${root} IS NULL AND hierarchy.child_id IS NULL)
            OR item.id = ${root}
          )

        UNION ALL

        SELECT child.id, child.project_id, child.title, child.description,
               child.status, child.priority, child.type, child.assignee,
               child.created_at, child.updated_at, child.claimed_at,
               child.closed_at, child.revision, child.notes,
               hierarchy.parent_id, tree.depth + 1,
               tree.sort_path || '/' ||
                 printf('%d|%s|%s', child.priority, child.created_at, child.id)
        FROM tree
        INNER JOIN work_item_hierarchy AS hierarchy
          ON hierarchy.project_id = ${projectId}
         AND hierarchy.parent_id = tree.id
        INNER JOIN work_items AS child
          ON child.project_id = hierarchy.project_id
         AND child.id = hierarchy.child_id
      )
      SELECT id, project_id, title, description, status, priority, type,
             assignee, created_at, updated_at, claimed_at, closed_at,
             revision, notes, parent_id, depth
      FROM tree
      ORDER BY sort_path ASC
    `.execute(this.database.queries);
    return rows.rows.map((row) => ({
      depth: row.depth,
      item: mapWorkItem(row),
      parentId: row.parent_id === null ? null : WorkItemId.from(row.parent_id),
    }));
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
    parentId?: WorkItemId,
  ): Promise<void> {
    await this.insertEvent(database, item.id, {
      createdAt: item.createdAt,
      eventType: "created",
      payload: {
        priority: item.priority.toNumber(),
        status: item.status,
        type: item.type,
        ...(parentId ? { parentId: parentId.toString() } : {}),
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
        tags: searchTags(item, []),
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

  private async applyTransitionInTransaction(
    database: Kysely<CairnDatabaseSchema>,
    transition: WorkItemTransition,
  ): Promise<void> {
    await this.updateWorkItem(database, transition);
    await this.insertEvent(database, transition.item.id, transition.event);
    await this.updateSearchProjection(database, transition.item);
  }

  private async currentParent(
    database: Kysely<CairnDatabaseSchema>,
    projectId: string,
    childId: WorkItemId,
  ): Promise<string | null> {
    const relation = await database
      .selectFrom("work_item_hierarchy")
      .select("parent_id")
      .where("project_id", "=", projectId)
      .where("child_id", "=", childId.toString())
      .executeTakeFirst();
    return relation?.parent_id ?? null;
  }

  private async insertParent(
    database: Kysely<CairnDatabaseSchema>,
    child: WorkItem,
    parentId: WorkItemId,
    now: string,
  ): Promise<void> {
    await database
      .insertInto("work_item_hierarchy")
      .values({
        child_id: child.id.toString(),
        created_at: now,
        parent_id: parentId.toString(),
        project_id: child.projectId,
      })
      .execute();
  }

  private async requireItemRevision(
    database: Kysely<CairnDatabaseSchema>,
    projectId: string,
    id: WorkItemId,
    expectedRevision: number,
  ): Promise<WorkItem> {
    const row = await database
      .selectFrom("work_items")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("id", "=", id.toString())
      .executeTakeFirst();
    if (!row) {
      throw new WorkItemRelationError(
        "cross_project_relation",
        id.toString(),
        id.toString(),
      );
    }
    const item = mapWorkItem(row);
    if (item.revision !== expectedRevision) {
      throw new WorkItemConflictError(
        id.toString(),
        expectedRevision,
        item.revision,
      );
    }
    return item;
  }

  private async requireRelatedItem(
    database: Kysely<CairnDatabaseSchema>,
    projectId: string,
    id: WorkItemId,
  ): Promise<void> {
    const item = await database
      .selectFrom("work_items")
      .select("project_id")
      .where("id", "=", id.toString())
      .executeTakeFirst();
    if (!item || item.project_id !== projectId) {
      throw new WorkItemRelationError(
        "cross_project_relation",
        projectId,
        id.toString(),
      );
    }
  }

  private async requireNoHierarchyCycle(
    database: Kysely<CairnDatabaseSchema>,
    projectId: string,
    childId: WorkItemId,
    parentId: WorkItemId,
  ): Promise<void> {
    const cycle = await sql<{ id: string }>`
      WITH RECURSIVE ancestors(id) AS (
        SELECT parent_id
        FROM work_item_hierarchy
        WHERE project_id = ${projectId}
          AND child_id = ${parentId.toString()}

        UNION ALL

        SELECT hierarchy.parent_id
        FROM work_item_hierarchy AS hierarchy
        INNER JOIN ancestors ON ancestors.id = hierarchy.child_id
        WHERE hierarchy.project_id = ${projectId}
      )
      SELECT id FROM ancestors WHERE id = ${childId.toString()} LIMIT 1
    `.execute(database);
    if (cycle.rows.length > 0) {
      throw new WorkItemRelationError(
        "hierarchy_cycle",
        childId.toString(),
        parentId.toString(),
      );
    }
  }

  private async requireNoDependencyCycle(
    database: Kysely<CairnDatabaseSchema>,
    projectId: string,
    blockedId: WorkItemId,
    blockerId: WorkItemId,
  ): Promise<void> {
    const cycle = await sql<{ id: string }>`
      WITH RECURSIVE blockers(id) AS (
        SELECT dependency.blocker_id
        FROM work_item_dependencies AS dependency
        WHERE dependency.project_id = ${projectId}
          AND dependency.blocked_id = ${blockerId.toString()}

        UNION

        SELECT dependency.blocker_id
        FROM work_item_dependencies AS dependency
        INNER JOIN blockers ON blockers.id = dependency.blocked_id
        WHERE dependency.project_id = ${projectId}
      )
      SELECT id FROM blockers WHERE id = ${blockedId.toString()} LIMIT 1
    `.execute(database);
    if (cycle.rows.length > 0) {
      throw new WorkItemRelationError(
        "dependency_cycle",
        blockedId.toString(),
        blockerId.toString(),
      );
    }
  }

  private async listActiveBlockers(
    projectId: string,
    blockedId: WorkItemId,
  ): Promise<readonly WorkItem[]> {
    const rows = await this.database.queries
      .selectFrom("work_item_dependencies as dependency")
      .innerJoin("work_items as blocker", (join) =>
        join
          .onRef("blocker.project_id", "=", "dependency.project_id")
          .onRef("blocker.id", "=", "dependency.blocker_id"),
      )
      .selectAll("blocker")
      .where("dependency.project_id", "=", projectId)
      .where("dependency.blocked_id", "=", blockedId.toString())
      .where("blocker.status", "!=", "closed")
      .orderBy("blocker.priority", "asc")
      .orderBy("blocker.created_at", "asc")
      .orderBy("blocker.id", "asc")
      .execute();
    return rows.map(mapWorkItem);
  }

  private async requireNoOpenDescendants(
    database: Kysely<CairnDatabaseSchema>,
    item: WorkItem,
  ): Promise<void> {
    const descendants = await sql<{ id: string }>`
      WITH RECURSIVE descendants(id, sort_path) AS (
        SELECT child.id,
               printf('%d|%s|%s', child.priority, child.created_at, child.id)
        FROM work_item_hierarchy AS hierarchy
        INNER JOIN work_items AS child
          ON child.project_id = hierarchy.project_id
         AND child.id = hierarchy.child_id
        WHERE hierarchy.project_id = ${item.projectId}
          AND hierarchy.parent_id = ${item.id.toString()}

        UNION ALL

        SELECT child.id,
               descendants.sort_path || '/' ||
                 printf('%d|%s|%s', child.priority, child.created_at, child.id)
        FROM descendants
        INNER JOIN work_item_hierarchy AS hierarchy
          ON hierarchy.project_id = ${item.projectId}
         AND hierarchy.parent_id = descendants.id
        INNER JOIN work_items AS child
          ON child.project_id = hierarchy.project_id
         AND child.id = hierarchy.child_id
      )
      SELECT descendants.id
      FROM descendants
      INNER JOIN work_items AS item ON item.id = descendants.id
      WHERE item.status <> 'closed'
      ORDER BY descendants.sort_path ASC
    `.execute(database);
    const descendantIds = descendants.rows.map(({ id }) => id);
    if (descendantIds.length > 0) {
      throw new WorkItemOpenDescendantsError(
        item.id.toString(),
        descendantIds,
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
    const labels = await this.currentLabels(database, item.projectId, item.id);
    const result = await database
      .updateTable("search_entries")
      .set({
        body: searchBody(item),
        tags: searchTags(item, labels),
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

  private async currentLabels(
    database: Kysely<CairnDatabaseSchema>,
    projectId: string,
    id: WorkItemId,
  ): Promise<readonly string[]> {
    const rows = await database
      .selectFrom("work_item_labels")
      .select(["label"])
      .where("project_id", "=", projectId)
      .where("work_item_id", "=", id.toString())
      .orderBy("label", "asc")
      .execute();
    return rows.map((row) => row.label);
  }
}
