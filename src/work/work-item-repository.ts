import type {
  WorkItem,
  WorkItemEvent,
  WorkItemId,
  WorkItemTransition,
} from "./work-item.ts";

export interface WorkItemRepository {
  applyTransition(transition: WorkItemTransition): void;
  create(item: WorkItem): void;
  findById(projectId: string, id: WorkItemId): WorkItem | null;
  listEvents(projectId: string, id: WorkItemId): readonly WorkItemEvent[];
  listByProject(projectId: string): readonly WorkItem[];
}
