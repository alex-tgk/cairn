import { randomUUID } from "node:crypto";

import { getProjectStatus } from "../project/project-service.ts";
import { openCairnDatabase } from "../storage/database.ts";
import { CairnQueryDatabase } from "../storage/query-database.ts";
import { SqliteWorkItemRepository } from "./sqlite-work-item-repository.ts";
import {
  claimWorkItem,
  closeWorkItem,
  createWorkItem,
  reopenWorkItem,
  updateWorkItem,
  WorkItemConflictError,
  WorkItemId,
  type WorkItem,
  type WorkItemChanges,
  type WorkItemEvent,
  type WorkItemStatus,
  type WorkItemTransition,
  type WorkItemType,
} from "./work-item.ts";
import type { WorkItemRepository } from "./work-item-repository.ts";
import type { WorkDependencyDirection } from "./work-item-repository.ts";

export type WorkItemView = Readonly<{
  assignee: string | null;
  claimedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  description: string;
  id: string;
  notes: string;
  priority: number;
  projectId: string;
  revision: number;
  shortId: string;
  status: WorkItemStatus;
  title: string;
  type: WorkItemType;
  updatedAt: string;
}>;

export type WorkTreeNodeView = WorkItemView &
  Readonly<{
    depth: number;
    parentId: string | null;
    parentShortId: string | null;
  }>;

export type WorkDependencyView = Readonly<{
  blockedId: string;
  blockedShortId: string;
  blockerId: string;
  blockerShortId: string;
  createdAt: string;
  relatedItem: WorkItemView;
}>;

export type WorkReadinessView = WorkItemView &
  Readonly<{
    blockers: readonly Readonly<{
      id: string;
      shortId: string;
      status: WorkItemStatus;
      title: string;
    }>[];
    readiness: "ready" | "blocked";
    reason: string;
  }>;

export type WorkCommentView = Readonly<{
  author: string;
  body: string;
  createdAt: string;
  revision: number;
}>;

type WorkContextOptions = Readonly<{
  dataDirectory?: string;
  path: string;
}>;

type CreateWorkOptions = WorkContextOptions &
  Readonly<{
    assignee?: string | undefined;
    description?: string | undefined;
    idFactory?: (() => string) | undefined;
    now?: (() => string) | undefined;
    priority?: number | undefined;
    parent?: string | undefined;
    title: string;
    type?: WorkItemType | undefined;
  }>;

type ShowWorkOptions = WorkContextOptions & Readonly<{ id: string }>;
type TransitionWorkOptions = ShowWorkOptions &
  Readonly<{
    expectedRevision?: number | undefined;
    now?: (() => string) | undefined;
  }>;
type ClaimWorkOptions = TransitionWorkOptions & Readonly<{ assignee: string }>;
type UpdateWorkOptions = TransitionWorkOptions &
  Readonly<{ changes: WorkItemChanges }>;
type ParentWorkOptions = TransitionWorkOptions &
  Readonly<{ parent?: string | undefined }>;
type TreeWorkOptions = WorkContextOptions &
  Readonly<{ root?: string | undefined }>;
type BlockerWorkOptions = TransitionWorkOptions &
  Readonly<{ blocker: string }>;
type DependencyListOptions = ShowWorkOptions &
  Readonly<{ direction: WorkDependencyDirection }>;
type LabelWorkOptions = TransitionWorkOptions & Readonly<{ label: string }>;
type NoteWorkOptions = TransitionWorkOptions & Readonly<{ note: string }>;
type CommentWorkOptions = TransitionWorkOptions &
  Readonly<{ author: string; body: string }>;

export class WorkItemNotFoundError extends Error {
  readonly code = "work_not_found";
  override readonly name = "WorkItemNotFoundError";

  constructor(readonly reference: string) {
    super(`Work item not found: ${reference}`);
  }
}

export class WorkItemAmbiguousReferenceError extends Error {
  readonly code = "ambiguous_work_reference";
  override readonly name = "WorkItemAmbiguousReferenceError";

  constructor(
    readonly reference: string,
    readonly candidateIds: readonly string[],
  ) {
    super(`Ambiguous work item reference: ${reference}`);
  }
}

function resolveWorkProject(options: WorkContextOptions) {
  if (options.dataDirectory === undefined) {
    return getProjectStatus({ path: options.path });
  }
  return getProjectStatus({
    dataDirectory: options.dataDirectory,
    path: options.path,
  });
}

function toWorkItemView(item: WorkItem): WorkItemView {
  const id = item.id.toString();
  return {
    assignee: item.assignee,
    claimedAt: item.claimedAt,
    closedAt: item.closedAt,
    createdAt: item.createdAt,
    description: item.description,
    id,
    notes: item.notes,
    priority: item.priority.toNumber(),
    projectId: item.projectId,
    revision: item.revision,
    shortId: id.replaceAll("-", "").slice(0, 8),
    status: item.status,
    title: item.title.toString(),
    type: item.type,
    updatedAt: item.updatedAt,
  };
}

async function withWorkRepository<Result>(
  options: WorkContextOptions,
  action: (
    repository: WorkItemRepository,
    projectId: string,
  ) => Promise<Result>,
): Promise<Result> {
  const project = resolveWorkProject(options);
  const database = new CairnQueryDatabase(
    openCairnDatabase(project.databasePath),
  );
  try {
    return await action(
      new SqliteWorkItemRepository(database),
      project.projectId,
    );
  } finally {
    await database.close();
  }
}

async function requireWorkItem(
  repository: WorkItemRepository,
  projectId: string,
  reference: string,
): Promise<WorkItem> {
  const matches = await repository.findByReference(projectId, reference);
  const item = matches[0];
  if (!item) {
    throw new WorkItemNotFoundError(reference);
  }
  if (matches.length > 1) {
    throw new WorkItemAmbiguousReferenceError(
      reference,
      matches.map(({ id }) => id.toString()),
    );
  }
  return item;
}

function requireExpectedRevision(
  item: WorkItem,
  expectedRevision: number | undefined,
): void {
  if (expectedRevision === undefined || expectedRevision === item.revision) {
    return;
  }
  throw new WorkItemConflictError(
    item.id.toString(),
    expectedRevision,
    item.revision,
  );
}

async function transitionWork(
  options: TransitionWorkOptions,
  transition: (item: WorkItem, now: string) => WorkItemTransition | null,
): Promise<WorkItemView> {
  return withWorkRepository(options, async (repository, projectId) => {
    const item = await requireWorkItem(
      repository,
      projectId,
      options.id,
    );
    requireExpectedRevision(item, options.expectedRevision);
    const result = transition(
      item,
      (options.now ?? (() => new Date().toISOString()))(),
    );
    if (!result) {
      return toWorkItemView(item);
    }
    await repository.applyTransition(result);
    return toWorkItemView(result.item);
  });
}

export async function createWork(
  options: CreateWorkOptions,
): Promise<WorkItemView> {
  return withWorkRepository(options, async (repository, projectId) => {
    const parent = options.parent === undefined
      ? undefined
      : await requireWorkItem(repository, projectId, options.parent);
    const item = createWorkItem({
      assignee: options.assignee,
      description: options.description,
      id: WorkItemId.from((options.idFactory ?? randomUUID)()),
      now: (options.now ?? (() => new Date().toISOString()))(),
      priority: options.priority,
      projectId,
      title: options.title,
      type: options.type,
    });
    await repository.create(item, parent?.id);
    return toWorkItemView(item);
  });
}

export async function setWorkParent(
  options: ParentWorkOptions & Readonly<{ parent: string }>,
): Promise<WorkItemView> {
  return withWorkRepository(options, async (repository, projectId) => {
    const child = await requireWorkItem(repository, projectId, options.id);
    const parent = await requireWorkItem(repository, projectId, options.parent);
    requireExpectedRevision(child, options.expectedRevision);
    return toWorkItemView(
      await repository.setParent(
        projectId,
        child.id,
        parent.id,
        child.revision,
        (options.now ?? (() => new Date().toISOString()))(),
      ),
    );
  });
}

export async function clearWorkParent(
  options: ParentWorkOptions,
): Promise<WorkItemView> {
  return withWorkRepository(options, async (repository, projectId) => {
    const child = await requireWorkItem(repository, projectId, options.id);
    requireExpectedRevision(child, options.expectedRevision);
    return toWorkItemView(
      await repository.clearParent(
        projectId,
        child.id,
        child.revision,
        (options.now ?? (() => new Date().toISOString()))(),
      ),
    );
  });
}

export async function listWorkTree(
  options: TreeWorkOptions,
): Promise<readonly WorkTreeNodeView[]> {
  return withWorkRepository(options, async (repository, projectId) => {
    const root = options.root === undefined
      ? undefined
      : await requireWorkItem(repository, projectId, options.root);
    return (await repository.listTree(projectId, root?.id)).map(
      ({ depth, item, parentId }) => {
        const parent = parentId?.toString() ?? null;
        return {
          ...toWorkItemView(item),
          depth,
          parentId: parent,
          parentShortId: parent?.replaceAll("-", "").slice(0, 8) ?? null,
        };
      },
    );
  });
}

export async function addWorkBlocker(
  options: BlockerWorkOptions,
): Promise<WorkItemView> {
  return withWorkRepository(options, async (repository, projectId) => {
    const blocked = await requireWorkItem(repository, projectId, options.id);
    const blocker = await requireWorkItem(repository, projectId, options.blocker);
    requireExpectedRevision(blocked, options.expectedRevision);
    return toWorkItemView(
      await repository.addBlocker(
        projectId,
        blocked.id,
        blocker.id,
        blocked.revision,
        (options.now ?? (() => new Date().toISOString()))(),
      ),
    );
  });
}

export async function removeWorkBlocker(
  options: BlockerWorkOptions,
): Promise<WorkItemView> {
  return withWorkRepository(options, async (repository, projectId) => {
    const blocked = await requireWorkItem(repository, projectId, options.id);
    const blocker = await requireWorkItem(repository, projectId, options.blocker);
    requireExpectedRevision(blocked, options.expectedRevision);
    return toWorkItemView(
      await repository.removeBlocker(
        projectId,
        blocked.id,
        blocker.id,
        blocked.revision,
        (options.now ?? (() => new Date().toISOString()))(),
      ),
    );
  });
}

export async function listWorkDependencies(
  options: DependencyListOptions,
): Promise<readonly WorkDependencyView[]> {
  return withWorkRepository(options, async (repository, projectId) => {
    const item = await requireWorkItem(repository, projectId, options.id);
    return (
      await repository.listDependencies(projectId, item.id, options.direction)
    ).map(({ blockedId, blockerId, createdAt, relatedItem }) => {
      const blocked = blockedId.toString();
      const blocker = blockerId.toString();
      return {
        blockedId: blocked,
        blockedShortId: blocked.replaceAll("-", "").slice(0, 8),
        blockerId: blocker,
        blockerShortId: blocker.replaceAll("-", "").slice(0, 8),
        createdAt,
        relatedItem: toWorkItemView(relatedItem),
      };
    });
  });
}

export async function addWorkLabel(
  options: LabelWorkOptions,
): Promise<WorkItemView> {
  return withWorkRepository(options, async (repository, projectId) => {
    const item = await requireWorkItem(repository, projectId, options.id);
    requireExpectedRevision(item, options.expectedRevision);
    return toWorkItemView(
      await repository.addLabel(
        projectId,
        item.id,
        options.label,
        item.revision,
        (options.now ?? (() => new Date().toISOString()))(),
      ),
    );
  });
}

export async function removeWorkLabel(
  options: LabelWorkOptions,
): Promise<WorkItemView> {
  return withWorkRepository(options, async (repository, projectId) => {
    const item = await requireWorkItem(repository, projectId, options.id);
    requireExpectedRevision(item, options.expectedRevision);
    return toWorkItemView(
      await repository.removeLabel(
        projectId,
        item.id,
        options.label,
        item.revision,
        (options.now ?? (() => new Date().toISOString()))(),
      ),
    );
  });
}

export async function listWorkLabels(
  options: ShowWorkOptions,
): Promise<readonly string[]> {
  return withWorkRepository(options, async (repository, projectId) => {
    const item = await requireWorkItem(repository, projectId, options.id);
    return await repository.listLabels(projectId, item.id);
  });
}

export async function appendWorkNote(
  options: NoteWorkOptions,
): Promise<WorkItemView> {
  return withWorkRepository(options, async (repository, projectId) => {
    const item = await requireWorkItem(repository, projectId, options.id);
    requireExpectedRevision(item, options.expectedRevision);
    return toWorkItemView(
      await repository.appendNote(
        projectId,
        item.id,
        options.note,
        item.revision,
        (options.now ?? (() => new Date().toISOString()))(),
      ),
    );
  });
}

export async function addWorkComment(
  options: CommentWorkOptions,
): Promise<WorkItemView> {
  return withWorkRepository(options, async (repository, projectId) => {
    const item = await requireWorkItem(repository, projectId, options.id);
    requireExpectedRevision(item, options.expectedRevision);
    return toWorkItemView(
      await repository.addComment(
        projectId,
        item.id,
        options.author,
        options.body,
        item.revision,
        (options.now ?? (() => new Date().toISOString()))(),
      ),
    );
  });
}

export async function listWorkComments(
  options: ShowWorkOptions,
): Promise<readonly WorkCommentView[]> {
  return withWorkRepository(options, async (repository, projectId) => {
    const item = await requireWorkItem(repository, projectId, options.id);
    return (await repository.listComments(projectId, item.id)).map(
      ({ author, body, createdAt, revision }) => ({
        author,
        body,
        createdAt,
        revision,
      }),
    );
  });
}

function toReadinessView(  readiness: "ready" | "blocked",
  item: WorkItem,
  blockers: readonly WorkItem[],
): WorkReadinessView {
  return {
    ...toWorkItemView(item),
    blockers: blockers.map((blocker) => {
      const id = blocker.id.toString();
      return {
        id,
        shortId: id.replaceAll("-", "").slice(0, 8),
        status: blocker.status,
        title: blocker.title.toString(),
      };
    }),
    readiness,
    reason: readiness === "ready"
      ? "Open with no active blockers"
      : `Blocked by ${blockers.length} active blocker${blockers.length === 1 ? "" : "s"}`,
  };
}

export async function listReadyWork(
  options: WorkContextOptions,
): Promise<readonly WorkReadinessView[]> {
  return withWorkRepository(options, async (repository, projectId) =>
    (await repository.listReady(projectId)).map(({ blockers, item }) =>
      toReadinessView("ready", item, blockers),
    ),
  );
}

export async function listBlockedWork(
  options: WorkContextOptions,
): Promise<readonly WorkReadinessView[]> {
  return withWorkRepository(options, async (repository, projectId) =>
    (await repository.listBlocked(projectId)).map(({ blockers, item }) =>
      toReadinessView("blocked", item, blockers),
    ),
  );
}

export async function showWork(
  options: ShowWorkOptions,
): Promise<WorkItemView> {
  return withWorkRepository(options, async (repository, projectId) =>
    toWorkItemView(
      await requireWorkItem(
        repository,
        projectId,
        options.id,
      ),
    ),
  );
}

export async function listWork(
  options: WorkContextOptions,
): Promise<readonly WorkItemView[]> {
  return withWorkRepository(options, async (repository, projectId) =>
    (await repository.listByProject(projectId)).map(toWorkItemView),
  );
}

export async function claimWork(
  options: ClaimWorkOptions,
): Promise<WorkItemView> {
  return transitionWork(options, (item, now) =>
    claimWorkItem(item, options.assignee, now),
  );
}

export async function closeWork(
  options: TransitionWorkOptions,
): Promise<WorkItemView> {
  return transitionWork(options, closeWorkItem);
}

export async function reopenWork(
  options: TransitionWorkOptions,
): Promise<WorkItemView> {
  return transitionWork(options, reopenWorkItem);
}

export async function updateWork(
  options: UpdateWorkOptions,
): Promise<WorkItemView> {
  return transitionWork(options, (item, now) =>
    updateWorkItem(item, options.changes, now),
  );
}

export async function listWorkHistory(
  options: ShowWorkOptions,
): Promise<readonly WorkItemEvent[]> {
  return withWorkRepository(options, async (repository, projectId) => {
    const item = await requireWorkItem(repository, projectId, options.id);
    return await repository.listEvents(projectId, item.id);
  });
}
