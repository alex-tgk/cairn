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
  WorkItemId,
  type WorkItem,
  type WorkItemChanges,
  type WorkItemEvent,
  type WorkItemStatus,
  type WorkItemTransition,
  type WorkItemType,
} from "./work-item.ts";
import type { WorkItemRepository } from "./work-item-repository.ts";

export type WorkItemView = Readonly<{
  assignee: string | null;
  claimedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  description: string;
  id: string;
  priority: number;
  projectId: string;
  status: WorkItemStatus;
  title: string;
  type: WorkItemType;
  updatedAt: string;
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
    title: string;
    type?: WorkItemType | undefined;
  }>;

type ShowWorkOptions = WorkContextOptions & Readonly<{ id: string }>;
type TransitionWorkOptions = ShowWorkOptions &
  Readonly<{ now?: (() => string) | undefined }>;
type ClaimWorkOptions = TransitionWorkOptions & Readonly<{ assignee: string }>;
type UpdateWorkOptions = TransitionWorkOptions &
  Readonly<{ changes: WorkItemChanges }>;

export class WorkItemNotFoundError extends Error {
  override readonly name = "WorkItemNotFoundError";
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
  return {
    assignee: item.assignee,
    claimedAt: item.claimedAt,
    closedAt: item.closedAt,
    createdAt: item.createdAt,
    description: item.description,
    id: item.id.toString(),
    priority: item.priority.toNumber(),
    projectId: item.projectId,
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
  id: WorkItemId,
): Promise<WorkItem> {
  const item = await repository.findById(projectId, id);
  if (!item) {
    throw new WorkItemNotFoundError(`Work item not found: ${id.toString()}`);
  }
  return item;
}

async function transitionWork(
  options: TransitionWorkOptions,
  transition: (item: WorkItem, now: string) => WorkItemTransition,
): Promise<WorkItemView> {
  return withWorkRepository(options, async (repository, projectId) => {
    const item = await requireWorkItem(
      repository,
      projectId,
      WorkItemId.from(options.id),
    );
    const result = transition(
      item,
      (options.now ?? (() => new Date().toISOString()))(),
    );
    await repository.applyTransition(result);
    return toWorkItemView(result.item);
  });
}

export async function createWork(
  options: CreateWorkOptions,
): Promise<WorkItemView> {
  return withWorkRepository(options, async (repository, projectId) => {
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
    await repository.create(item);
    return toWorkItemView(item);
  });
}

export async function showWork(
  options: ShowWorkOptions,
): Promise<WorkItemView> {
  return withWorkRepository(options, async (repository, projectId) =>
    toWorkItemView(
      await requireWorkItem(
        repository,
        projectId,
        WorkItemId.from(options.id),
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
    const id = WorkItemId.from(options.id);
    await requireWorkItem(repository, projectId, id);
    return await repository.listEvents(projectId, id);
  });
}
