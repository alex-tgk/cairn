export const WORK_ITEM_TYPES = [
  "task",
  "bug",
  "feature",
  "epic",
  "chore",
] as const;

export type WorkItemStatus = "open" | "in_progress" | "closed";
export type WorkItemType = (typeof WORK_ITEM_TYPES)[number];
export type WorkItemEventType =
  | "created"
  | "updated"
  | "claimed"
  | "closed"
  | "reopened";
export type WorkItemEventPayload = Readonly<
  Record<string, string | number | null>
>;

export class WorkItemValidationError extends Error {
  override readonly name = "WorkItemValidationError";
}

export class WorkItemTransitionError extends Error {
  override readonly name = "WorkItemTransitionError";
}

export class WorkItemConflictError extends Error {
  readonly code = "work_conflict";
  override readonly name = "WorkItemConflictError";

  constructor(
    readonly workItemId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number | null = null,
  ) {
    super(
      actualRevision === null
        ? `Work item changed after revision ${expectedRevision}: ${workItemId}`
        : `Work item revision conflict for ${workItemId}: expected ${expectedRevision}, found ${actualRevision}`,
    );
  }
}

export class WorkItemClaimConflictError extends Error {
  readonly code = "claim_conflict";
  override readonly name = "WorkItemClaimConflictError";

  constructor(
    readonly workItemId: string,
    readonly requestedAssignee: string,
    readonly currentAssignee: string | null,
  ) {
    super(
      currentAssignee === null
        ? `Work item cannot be claimed: ${workItemId}`
        : `Work item is already assigned to ${currentAssignee}: ${workItemId}`,
    );
  }
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
  notes: string;
  priority: WorkItemPriority;
  projectId: string;
  revision: number;
  status: WorkItemStatus;
  title: WorkItemTitle;
  type: WorkItemType;
  updatedAt: string;
}>;

export type WorkItemEventDraft = Readonly<{
  createdAt: string;
  eventType: WorkItemEventType;
  payload: WorkItemEventPayload;
  revision: number;
}>;

export type WorkItemEvent = WorkItemEventDraft &
  Readonly<{
    id: number;
    workItemId: string;
  }>;

export type WorkItemTransition = Readonly<{
  event: WorkItemEventDraft;
  expectedRevision: number;
  item: WorkItem;
}>;

export type WorkItemChanges = Readonly<{
  assignee?: string | null | undefined;
  description?: string | undefined;
  priority?: number | undefined;
  title?: string | undefined;
  type?: WorkItemType | undefined;
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
    notes: "",
    priority: WorkItemPriority.from(input.priority ?? 2),
    projectId: input.projectId,
    revision: 1,
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
): WorkItemTransition | null {
  if (item.status === "closed") {
    throw new WorkItemTransitionError("Closed work must be reopened before claim");
  }
  const normalizedAssignee = assignee.trim();
  if (normalizedAssignee.length === 0) {
    throw new WorkItemValidationError("Work item assignee must not be empty");
  }
  if (item.status === "in_progress") {
    if (item.assignee === normalizedAssignee) {
      return null;
    }
    throw new WorkItemClaimConflictError(
      item.id.toString(),
      normalizedAssignee,
      item.assignee,
    );
  }
  if (item.assignee !== null && item.assignee !== normalizedAssignee) {
    throw new WorkItemClaimConflictError(
      item.id.toString(),
      normalizedAssignee,
      item.assignee,
    );
  }
  const revision = item.revision + 1;
  return {
    event: {
      createdAt: now,
      eventType: "claimed",
      payload: { assignee: normalizedAssignee, status: "in_progress" },
      revision,
    },
    expectedRevision: item.revision,
    item: {
      ...item,
      assignee: normalizedAssignee,
      claimedAt: now,
      status: "in_progress",
      updatedAt: now,
      revision,
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
  const revision = item.revision + 1;
  return {
    event: {
      createdAt: now,
      eventType: "closed",
      payload: { status: "closed" },
      revision,
    },
    expectedRevision: item.revision,
    item: {
      ...item,
      closedAt: now,
      revision,
      status: "closed",
      updatedAt: now,
    },
  };
}

export function reopenWorkItem(
  item: WorkItem,
  now: string,
): WorkItemTransition {
  if (item.status !== "closed") {
    throw new WorkItemTransitionError("Only closed work can be reopened");
  }
  const revision = item.revision + 1;
  return {
    event: {
      createdAt: now,
      eventType: "reopened",
      payload: { status: "open" },
      revision,
    },
    expectedRevision: item.revision,
    item: {
      ...item,
      closedAt: null,
      revision,
      status: "open",
      updatedAt: now,
    },
  };
}

export function updateWorkItem(
  item: WorkItem,
  changes: WorkItemChanges,
  now: string,
): WorkItemTransition {
  let updated = item;
  const payload: Record<string, string | number | null> = {};

  if (changes.title !== undefined) {
    const title = WorkItemTitle.from(changes.title);
    updated = { ...updated, title };
    payload.title = title.toString();
  }
  if (changes.description !== undefined) {
    const description = changes.description.trim();
    updated = { ...updated, description };
    payload.description = description;
  }
  if (changes.priority !== undefined) {
    const priority = WorkItemPriority.from(changes.priority);
    updated = { ...updated, priority };
    payload.priority = priority.toNumber();
  }
  if (changes.type !== undefined) {
    updated = { ...updated, type: changes.type };
    payload.type = changes.type;
  }
  if (Object.hasOwn(changes, "assignee")) {
    const assignee = changes.assignee?.trim() || null;
    updated = { ...updated, assignee };
    payload.assignee = assignee;
  }
  if (Object.keys(payload).length === 0) {
    throw new WorkItemValidationError(
      "At least one work item field must be updated",
    );
  }

  const revision = item.revision + 1;

  return {
    event: {
      createdAt: now,
      eventType: "updated",
      payload,
      revision,
    },
    expectedRevision: item.revision,
    item: { ...updated, revision, updatedAt: now },
  };
}
