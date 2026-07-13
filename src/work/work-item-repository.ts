import type {
  WorkItem,
  WorkItemEvent,
  WorkItemId,
  WorkItemTransition,
} from "./work-item.ts";

export interface WorkItemRepository {
  addBlocker(
    projectId: string,
    blockedId: WorkItemId,
    blockerId: WorkItemId,
    expectedRevision: number,
    now: string,
  ): Promise<WorkItem>;
  addComment(
    projectId: string,
    id: WorkItemId,
    author: string,
    body: string,
    expectedRevision: number,
    now: string,
  ): Promise<WorkItem>;
  addLabel(
    projectId: string,
    id: WorkItemId,
    label: string,
    expectedRevision: number,
    now: string,
  ): Promise<WorkItem>;
  appendNote(
    projectId: string,
    id: WorkItemId,
    note: string,
    expectedRevision: number,
    now: string,
  ): Promise<WorkItem>;
  applyTransition(transition: WorkItemTransition): Promise<void>;
  clearParent(
    projectId: string,
    childId: WorkItemId,
    expectedRevision: number,
    now: string,
  ): Promise<WorkItem>;
  create(item: WorkItem, parentId?: WorkItemId): Promise<void>;
  findById(projectId: string, id: WorkItemId): Promise<WorkItem | null>;
  findByReference(
    projectId: string,
    reference: string,
  ): Promise<readonly WorkItem[]>;
  listEvents(
    projectId: string,
    id: WorkItemId,
  ): Promise<readonly WorkItemEvent[]>;
  listByProject(projectId: string): Promise<readonly WorkItem[]>;
  listBlocked(projectId: string): Promise<readonly WorkReadiness[]>;
  listComments(
    projectId: string,
    id: WorkItemId,
  ): Promise<readonly WorkItemComment[]>;
  listDependencies(
    projectId: string,
    id: WorkItemId,
    direction: WorkDependencyDirection,
  ): Promise<readonly WorkDependency[]>;
  listLabels(projectId: string, id: WorkItemId): Promise<readonly string[]>;
  listReady(projectId: string): Promise<readonly WorkReadiness[]>;
  listTree(
    projectId: string,
    rootId?: WorkItemId,
  ): Promise<readonly WorkTreeNode[]>;
  removeLabel(
    projectId: string,
    id: WorkItemId,
    label: string,
    expectedRevision: number,
    now: string,
  ): Promise<WorkItem>;
  setParent(
    projectId: string,
    childId: WorkItemId,
    parentId: WorkItemId,
    expectedRevision: number,
    now: string,
  ): Promise<WorkItem>;
  removeBlocker(
    projectId: string,
    blockedId: WorkItemId,
    blockerId: WorkItemId,
    expectedRevision: number,
    now: string,
  ): Promise<WorkItem>;
}

export type WorkItemComment = Readonly<{
  author: string;
  body: string;
  createdAt: string;
  id: number;
  revision: number;
  workItemId: string;
}>;

export type WorkDependencyDirection = "blockers" | "dependents";

export type WorkDependency = Readonly<{
  blockedId: WorkItemId;
  blockerId: WorkItemId;
  createdAt: string;
  relatedItem: WorkItem;
}>;

export type WorkReadiness = Readonly<{
  blockers: readonly WorkItem[];
  item: WorkItem;
}>;

export type WorkTreeNode = Readonly<{
  depth: number;
  item: WorkItem;
  parentId: WorkItemId | null;
}>;
