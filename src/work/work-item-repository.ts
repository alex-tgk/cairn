import type { WorkItem, WorkItemId } from "./work-item.ts";

export interface WorkItemRepository {
  create(item: WorkItem): void;
  findById(projectId: string, id: WorkItemId): WorkItem | null;
  listByProject(projectId: string): readonly WorkItem[];
}
