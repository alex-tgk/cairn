import { describe, expect, test } from "bun:test";

import {
  claimWorkItem,
  closeWorkItem,
  createWorkItem,
  reopenWorkItem,
  updateWorkItem,
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
  test("claims open work for an explicit assignee", () => {
    const transition = claimWorkItem(
      createFixture(),
      "agent-codex",
      "2026-07-12T13:00:00.000Z",
    );

    expect(transition.item).toMatchObject({
      assignee: "agent-codex",
      claimedAt: "2026-07-12T13:00:00.000Z",
      status: "in_progress",
      updatedAt: "2026-07-12T13:00:00.000Z",
    });
    expect(transition.event).toEqual({
      createdAt: "2026-07-12T13:00:00.000Z",
      eventType: "claimed",
      payload: { assignee: "agent-codex", status: "in_progress" },
    });
  });

  test("closes and reopens work without discarding its assignee", () => {
    const claimed = claimWorkItem(
      createFixture(),
      "agent-codex",
      "2026-07-12T13:00:00.000Z",
    ).item;
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
