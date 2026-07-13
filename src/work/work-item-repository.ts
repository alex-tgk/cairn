import type {
  WorkItem,
  WorkItemEvent,
  WorkItemId,
  WorkItemTransition,
} from "./work-item.ts";

export interface WorkItemRepository {
  applyTransition(transition: WorkItemTransition): Promise<void>;
  create(item: WorkItem): Promise<void>;
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
}
