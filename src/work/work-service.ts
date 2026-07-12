import { randomUUID } from "node:crypto";

import { getProjectStatus } from "../project/project-service.ts";
import { openCairnDatabase } from "../storage/database.ts";
import { SqliteWorkItemRepository } from "./sqlite-work-item-repository.ts";
import {
  createWorkItem,
  WorkItemId,
  type WorkItem,
  type WorkItemStatus,
  type WorkItemType,
} from "./work-item.ts";

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

export function createWork(options: CreateWorkOptions): WorkItemView {
  const project = resolveWorkProject(options);
  const database = openCairnDatabase(project.databasePath);
  const repository = new SqliteWorkItemRepository(database);

  try {
    const item = createWorkItem({
      assignee: options.assignee,
      description: options.description,
      id: WorkItemId.from((options.idFactory ?? randomUUID)()),
      now: (options.now ?? (() => new Date().toISOString()))(),
      priority: options.priority,
      projectId: project.projectId,
      title: options.title,
      type: options.type,
    });
    repository.create(item);
    return toWorkItemView(item);
  } finally {
    database.close();
  }
}

export function showWork(options: ShowWorkOptions): WorkItemView {
  const project = resolveWorkProject(options);
  const database = openCairnDatabase(project.databasePath);
  const repository = new SqliteWorkItemRepository(database);

  try {
    const item = repository.findById(
      project.projectId,
      WorkItemId.from(options.id),
    );
    if (!item) {
      throw new WorkItemNotFoundError(`Work item not found: ${options.id}`);
    }
    return toWorkItemView(item);
  } finally {
    database.close();
  }
}

export function listWork(options: WorkContextOptions): readonly WorkItemView[] {
  const project = resolveWorkProject(options);
  const database = openCairnDatabase(project.databasePath);
  const repository = new SqliteWorkItemRepository(database);

  try {
    return repository
      .listByProject(project.projectId)
      .map(toWorkItemView);
  } finally {
    database.close();
  }
}
