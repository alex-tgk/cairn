import { describe, expect, test } from "bun:test";

import {
  claimWorkItem,
  closeWorkItem,
  createWorkItem,
  reopenWorkItem,
  updateWorkItem,
  WorkItemClaimConflictError,
  WorkItemId,
  WorkItemTransitionError,
} from "../src/work/work-item.ts";

const CREATED_AT = "2026-07-12T12:00:00.000Z";

function createFixture() {
  return createWorkItem({
    id: WorkItemId.from("work-1"),
    now: CREATED_AT,
    projectId: "project-1",
    title: "Implement lifecycle commands",
  });
}

describe("work-item lifecycle", () => {
  test("starts at revision one with empty notes", () => {
    expect(createFixture()).toMatchObject({ notes: "", revision: 1 });
  });

  test("claims open work for an explicit assignee", () => {
    const transition = claimWorkItem(
      createFixture(),
      "agent-codex",
      "2026-07-12T13:00:00.000Z",
    );

    expect(transition).not.toBeNull();
    if (!transition) {
      throw new Error("Expected claim transition");
    }
    expect(transition.item).toMatchObject({
      assignee: "agent-codex",
      claimedAt: "2026-07-12T13:00:00.000Z",
      status: "in_progress",
      updatedAt: "2026-07-12T13:00:00.000Z",
      revision: 2,
    });
    expect(transition.expectedRevision).toBe(1);
    expect(transition.event).toEqual({
      createdAt: "2026-07-12T13:00:00.000Z",
      eventType: "claimed",
      payload: { assignee: "agent-codex", status: "in_progress" },
      revision: 2,
    });
  });

  test("treats a repeated claim by the same assignee as a no-op", () => {
    const first = claimWorkItem(
      createFixture(),
      "agent-codex",
      "2026-07-12T13:00:00.000Z",
    );
    if (!first) {
      throw new Error("Expected first claim transition");
    }

    expect(
      claimWorkItem(
        first.item,
        "agent-codex",
        "2026-07-12T14:00:00.000Z",
      ),
    ).toBeNull();
  });

  test("does not let another assignee overwrite a claim", () => {
    const first = claimWorkItem(
      createFixture(),
      "agent-codex",
      "2026-07-12T13:00:00.000Z",
    );
    if (!first) {
      throw new Error("Expected first claim transition");
    }

    expect(() =>
      claimWorkItem(
        first.item,
        "agent-copilot",
        "2026-07-12T14:00:00.000Z",
      ),
    ).toThrow(WorkItemClaimConflictError);
  });

  test("does not claim open work assigned to someone else", () => {
    const assigned = updateWorkItem(
      createFixture(),
      { assignee: "agent-codex" },
      "2026-07-12T13:00:00.000Z",
    ).item;

    expect(() =>
      claimWorkItem(
        assigned,
        "agent-copilot",
        "2026-07-12T14:00:00.000Z",
      ),
    ).toThrow(WorkItemClaimConflictError);
  });

  test("closes and reopens work without discarding its assignee", () => {
    const claim = claimWorkItem(
      createFixture(),
      "agent-codex",
      "2026-07-12T13:00:00.000Z",
    );
    if (!claim) {
      throw new Error("Expected claim transition");
    }
    const claimed = claim.item;
    const closed = closeWorkItem(
      claimed,
      "2026-07-12T14:00:00.000Z",
    );
    const reopened = reopenWorkItem(
      closed.item,
      "2026-07-12T15:00:00.000Z",
    );

    expect(closed.item).toMatchObject({
      assignee: "agent-codex",
      closedAt: "2026-07-12T14:00:00.000Z",
      status: "closed",
    });
    expect(reopened.item).toMatchObject({
      assignee: "agent-codex",
      closedAt: null,
      status: "open",
      updatedAt: "2026-07-12T15:00:00.000Z",
      revision: 4,
    });
    expect(reopened.event.eventType).toBe("reopened");
  });

  test("does not claim closed work", () => {
    const closed = closeWorkItem(
      createFixture(),
      "2026-07-12T14:00:00.000Z",
    ).item;

    expect(() =>
      claimWorkItem(closed, "agent-codex", "2026-07-12T15:00:00.000Z"),
    ).toThrow(WorkItemTransitionError);
  });

  test("updates metadata and describes the changed values in history", () => {
    const transition = updateWorkItem(
      createFixture(),
      {
        assignee: "agent-codex",
        priority: 1,
        title: "Implement complete lifecycle commands",
        type: "feature",
      },
      "2026-07-12T13:00:00.000Z",
    );

    expect(transition.item).toMatchObject({
      assignee: "agent-codex",
      revision: 2,
      updatedAt: "2026-07-12T13:00:00.000Z",
    });
    expect(transition.item.title.toString()).toBe(
      "Implement complete lifecycle commands",
    );
    expect(transition.item.priority.toNumber()).toBe(1);
    expect(transition.event).toEqual({
      createdAt: "2026-07-12T13:00:00.000Z",
      eventType: "updated",
      payload: {
        assignee: "agent-codex",
        priority: 1,
        title: "Implement complete lifecycle commands",
        type: "feature",
      },
      revision: 2,
    });
  });

  test("requires at least one metadata change", () => {
    expect(() =>
      updateWorkItem(
        createFixture(),
        {},
        "2026-07-12T13:00:00.000Z",
      ),
    ).toThrow("At least one work item field must be updated");
  });
});
