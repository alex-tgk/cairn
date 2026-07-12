export const WORK_ITEM_TYPES = [
  "task",
  "bug",
  "feature",
  "epic",
  "chore",
] as const;

export type WorkItemStatus = "open" | "in_progress" | "closed";
export type WorkItemType = (typeof WORK_ITEM_TYPES)[number];
export type WorkItemEventType = "created" | "claimed" | "closed" | "reopened";
export type WorkItemEventPayload = Readonly<
  Record<string, string | number | null>
>;

export class WorkItemValidationError extends Error {
  override readonly name = "WorkItemValidationError";
}

export class WorkItemTransitionError extends Error {
  override readonly name = "WorkItemTransitionError";
}

export class WorkItemId {
  private constructor(private readonly value: string) {}

  static from(value: string): WorkItemId {
    const normalized = value.trim();
    if (normalized.length === 0) {
      throw new WorkItemValidationError("Work item id must not be empty");
    }
    return new WorkItemId(normalized);
  }

  toString(): string {
    return this.value;
  }
}

export class WorkItemTitle {
  private constructor(private readonly value: string) {}

  static from(value: string): WorkItemTitle {
    const normalized = value.trim();
    if (normalized.length === 0) {
      throw new WorkItemValidationError("Work item title must not be empty");
    }
    return new WorkItemTitle(normalized);
  }

  toString(): string {
    return this.value;
  }
}

export class WorkItemPriority {
  private constructor(private readonly value: number) {}

  static from(value: number): WorkItemPriority {
    if (!Number.isInteger(value) || value < 0 || value > 4) {
      throw new WorkItemValidationError(
        "Work item priority must be an integer from 0 to 4",
      );
    }
    return new WorkItemPriority(value);
  }

  toNumber(): number {
    return this.value;
  }
}

export function parseWorkItemType(value: string): WorkItemType {
  switch (value) {
    case "task":
    case "bug":
    case "feature":
    case "epic":
    case "chore":
      return value;
    default:
      throw new WorkItemValidationError(
        `Work item type must be one of: ${WORK_ITEM_TYPES.join(", ")}`,
      );
  }
}

export type WorkItem = Readonly<{
  assignee: string | null;
  claimedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  description: string;
  id: WorkItemId;
  priority: WorkItemPriority;
  projectId: string;
  status: WorkItemStatus;
  title: WorkItemTitle;
  type: WorkItemType;
  updatedAt: string;
}>;

export type WorkItemEventDraft = Readonly<{
  createdAt: string;
  eventType: WorkItemEventType;
  payload: WorkItemEventPayload;
}>;

export type WorkItemEvent = WorkItemEventDraft &
  Readonly<{
    id: number;
    workItemId: string;
  }>;

export type WorkItemTransition = Readonly<{
  event: WorkItemEventDraft;
  item: WorkItem;
}>;

type CreateWorkItemInput = Readonly<{
  assignee?: string | undefined;
  description?: string | undefined;
  id: WorkItemId;
  now: string;
  priority?: number | undefined;
  projectId: string;
  title: string;
  type?: WorkItemType | undefined;
}>;

export function createWorkItem(input: CreateWorkItemInput): WorkItem {
  return {
    assignee: input.assignee?.trim() || null,
    claimedAt: null,
    closedAt: null,
    createdAt: input.now,
    description: input.description?.trim() ?? "",
    id: input.id,
    priority: WorkItemPriority.from(input.priority ?? 2),
    projectId: input.projectId,
    status: "open",
    title: WorkItemTitle.from(input.title),
    type: input.type ?? "task",
    updatedAt: input.now,
  };
}

export function restoreWorkItem(item: WorkItem): WorkItem {
  return item;
}

export function claimWorkItem(
  item: WorkItem,
  assignee: string,
  now: string,
): WorkItemTransition {
  if (item.status === "closed") {
    throw new WorkItemTransitionError("Closed work must be reopened before claim");
  }
  const normalizedAssignee = assignee.trim();
  if (normalizedAssignee.length === 0) {
    throw new WorkItemValidationError("Work item assignee must not be empty");
  }
  return {
    event: {
      createdAt: now,
      eventType: "claimed",
      payload: { assignee: normalizedAssignee, status: "in_progress" },
    },
    item: {
      ...item,
      assignee: normalizedAssignee,
      claimedAt: now,
      status: "in_progress",
      updatedAt: now,
    },
  };
}

export function closeWorkItem(
  item: WorkItem,
  now: string,
): WorkItemTransition {
  if (item.status === "closed") {
    throw new WorkItemTransitionError("Work item is already closed");
  }
  return {
    event: {
      createdAt: now,
      eventType: "closed",
      payload: { status: "closed" },
    },
    item: { ...item, closedAt: now, status: "closed", updatedAt: now },
  };
}

export function reopenWorkItem(
  item: WorkItem,
  now: string,
): WorkItemTransition {
  if (item.status !== "closed") {
    throw new WorkItemTransitionError("Only closed work can be reopened");
  }
  return {
    event: {
      createdAt: now,
      eventType: "reopened",
      payload: { status: "open" },
    },
    item: { ...item, closedAt: null, status: "open", updatedAt: now },
  };
}
