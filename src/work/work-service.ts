import { randomUUID } from "node:crypto";

import { getProjectStatus } from "../project/project-service.ts";
import { openCairnDatabase } from "../storage/database.ts";
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

function withWorkRepository<Result>(
  options: WorkContextOptions,
  action: (repository: WorkItemRepository, projectId: string) => Result,
): Result {
  const project = resolveWorkProject(options);
  const database = openCairnDatabase(project.databasePath);
  try {
    return action(new SqliteWorkItemRepository(database), project.projectId);
  } finally {
    database.close();
  }
}

function requireWorkItem(
  repository: WorkItemRepository,
  projectId: string,
  id: WorkItemId,
): WorkItem {
  const item = repository.findById(projectId, id);
  if (!item) {
    throw new WorkItemNotFoundError(`Work item not found: ${id.toString()}`);
  }
  return item;
}

function transitionWork(
  options: TransitionWorkOptions,
  transition: (item: WorkItem, now: string) => WorkItemTransition,
): WorkItemView {
  return withWorkRepository(options, (repository, projectId) => {
    const item = requireWorkItem(
      repository,
      projectId,
      WorkItemId.from(options.id),
    );
    const result = transition(
      item,
      (options.now ?? (() => new Date().toISOString()))(),
    );
    repository.applyTransition(result);
    return toWorkItemView(result.item);
  });
}

export function createWork(options: CreateWorkOptions): WorkItemView {
  return withWorkRepository(options, (repository, projectId) => {
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
    repository.create(item);
    return toWorkItemView(item);
  });
}

export function showWork(options: ShowWorkOptions): WorkItemView {
  return withWorkRepository(options, (repository, projectId) =>
    toWorkItemView(
      requireWorkItem(repository, projectId, WorkItemId.from(options.id)),
    ),
  );
}

export function listWork(options: WorkContextOptions): readonly WorkItemView[] {
  return withWorkRepository(options, (repository, projectId) =>
    repository.listByProject(projectId).map(toWorkItemView),
  );
}

export function claimWork(options: ClaimWorkOptions): WorkItemView {
  return transitionWork(options, (item, now) =>
    claimWorkItem(item, options.assignee, now),
  );
}

export function closeWork(options: TransitionWorkOptions): WorkItemView {
  return transitionWork(options, closeWorkItem);
}

export function reopenWork(options: TransitionWorkOptions): WorkItemView {
  return transitionWork(options, reopenWorkItem);
}

export function updateWork(options: UpdateWorkOptions): WorkItemView {
  return transitionWork(options, (item, now) =>
    updateWorkItem(item, options.changes, now),
  );
}

export function listWorkHistory(
  options: ShowWorkOptions,
): readonly WorkItemEvent[] {
  return withWorkRepository(options, (repository, projectId) => {
    const id = WorkItemId.from(options.id);
    requireWorkItem(repository, projectId, id);
    return repository.listEvents(projectId, id);
  });
}
