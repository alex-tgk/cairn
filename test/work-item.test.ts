import { describe, expect, test } from "bun:test";

import {
  claimWorkItem,
  closeWorkItem,
  computeBlockedStaleness,
  createWorkItem,
  DEFAULT_STALLED_AFTER_DAYS,
  parseStalledAfterDays,
  reopenWorkItem,
  updateWorkItem,
  WorkItemClaimConflictError,
  WorkItemId,
  WorkItemTransitionError,
  WorkItemValidationError,
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

describe("blocked-item staleness signal", () => {
  function itemWithUpdatedAt(updatedAt: string) {
    return { ...createFixture(), updatedAt };
  }

  test("a freshly-created blocked item is not stalled", () => {
    const item = itemWithUpdatedAt("2026-07-12T12:00:00.000Z");
    const blocker = itemWithUpdatedAt("2026-07-12T12:00:00.000Z");

    const staleness = computeBlockedStaleness(
      item,
      [blocker],
      "2026-07-13T12:00:00.000Z",
    );

    expect(staleness).toEqual({
      daysSinceLastBlockerActivity: 1,
      stalled: false,
    });
  });

  test("is stalled once the blocker chain's last activity is old enough", () => {
    const item = itemWithUpdatedAt("2026-01-01T00:00:00.000Z");
    const blocker = itemWithUpdatedAt("2026-01-01T00:00:00.000Z");

    const staleness = computeBlockedStaleness(
      item,
      [blocker],
      "2026-02-05T00:00:00.000Z",
    );

    expect(staleness).toEqual({
      daysSinceLastBlockerActivity: 35,
      stalled: true,
    });
  });

  test("daysSinceLastBlockerActivity reflects the max of item-own and blocker-chain activity", () => {
    const staleItem = itemWithUpdatedAt("2026-01-01T00:00:00.000Z");
    const recentlyUpdatedBlocker = itemWithUpdatedAt(
      "2026-01-30T00:00:00.000Z",
    );

    const staleness = computeBlockedStaleness(
      staleItem,
      [recentlyUpdatedBlocker],
      "2026-02-05T00:00:00.000Z",
    );

    expect(staleness).toEqual({
      daysSinceLastBlockerActivity: 6,
      stalled: false,
    });

    const recentlyUpdatedItem = itemWithUpdatedAt(
      "2026-01-30T00:00:00.000Z",
    );
    const staleBlocker = itemWithUpdatedAt("2026-01-01T00:00:00.000Z");

    expect(
      computeBlockedStaleness(
        recentlyUpdatedItem,
        [staleBlocker],
        "2026-02-05T00:00:00.000Z",
      ),
    ).toEqual({ daysSinceLastBlockerActivity: 6, stalled: false });
  });

  test("uses the default 30-day threshold when none is provided", () => {
    expect(DEFAULT_STALLED_AFTER_DAYS).toBe(30);

    const item = itemWithUpdatedAt("2026-01-01T00:00:00.000Z");
    const justUnderThreshold = computeBlockedStaleness(
      item,
      [],
      "2026-01-30T00:00:00.000Z",
    );
    const atThreshold = computeBlockedStaleness(
      item,
      [],
      "2026-01-31T00:00:00.000Z",
    );

    expect(justUnderThreshold.stalled).toBe(false);
    expect(atThreshold.stalled).toBe(true);
  });

  test("honors a custom stalled-after-days override", () => {
    const item = itemWithUpdatedAt("2026-01-01T00:00:00.000Z");

    expect(
      computeBlockedStaleness(item, [], "2026-01-11T00:00:00.000Z", 10)
        .stalled,
    ).toBe(true);
    expect(
      computeBlockedStaleness(item, [], "2026-01-10T00:00:00.000Z", 10)
        .stalled,
    ).toBe(false);
  });

  test("parses a positive integer stalled-after-days override", () => {
    expect(parseStalledAfterDays("45")).toBe(45);
  });

  test("rejects a non-positive-integer stalled-after-days override", () => {
    expect(() => parseStalledAfterDays("0")).toThrow(WorkItemValidationError);
    expect(() => parseStalledAfterDays("-5")).toThrow(WorkItemValidationError);
    expect(() => parseStalledAfterDays("abc")).toThrow(WorkItemValidationError);
    expect(() => parseStalledAfterDays("3.5")).toThrow(WorkItemValidationError);
  });
});
