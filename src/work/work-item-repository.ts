import type {
  WorkItem,
  WorkItemEvent,
  WorkItemId,
  WorkItemTransition,
} from "./work-item.ts";

export interface WorkItemRepository {
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
  listTree(
    projectId: string,
    rootId?: WorkItemId,
  ): Promise<readonly WorkTreeNode[]>;
  setParent(
    projectId: string,
    childId: WorkItemId,
    parentId: WorkItemId,
    expectedRevision: number,
    now: string,
  ): Promise<WorkItem>;
}

export type WorkTreeNode = Readonly<{
  depth: number;
  item: WorkItem;
  parentId: WorkItemId | null;
}>;
