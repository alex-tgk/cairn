import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  addWorkBlocker,
  addWorkComment,
  createWork,
  listBlockedWork,
} from "../src/work/work-service.ts";

const temporaryDirectories: string[] = [];

function createEnvironment(): { dataDirectory: string; workspace: string } {
  const root = mkdtempSync(join(tmpdir(), "cairn-work-service-"));
  temporaryDirectories.push(root);
  const workspace = join(root, "workspace");
  mkdirSync(join(workspace, ".git"), { recursive: true });
  return { dataDirectory: join(root, "data"), workspace };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("stalled blocked-item signal", () => {
  test("a freshly-created blocked item is not stalled", async () => {
    const { dataDirectory, workspace } = createEnvironment();
    const blocker = await createWork({
      dataDirectory,
      now: () => "2026-07-01T00:00:00.000Z",
      path: workspace,
      title: "Blocker",
    });
    const blocked = await createWork({
      dataDirectory,
      now: () => "2026-07-01T00:00:00.000Z",
      path: workspace,
      title: "Blocked",
    });
    await addWorkBlocker({
      blocker: blocker.id,
      dataDirectory,
      id: blocked.id,
      now: () => "2026-07-01T00:00:00.000Z",
      path: workspace,
    });

    const [result] = await listBlockedWork({
      dataDirectory,
      now: () => "2026-07-02T00:00:00.000Z",
      path: workspace,
    });

    expect(result).toMatchObject({
      daysSinceLastBlockerActivity: 1,
      readiness: "blocked",
      stalled: false,
    });
  });

  test("is stalled once the blocker chain has no activity past the default threshold", async () => {
    const { dataDirectory, workspace } = createEnvironment();
    const blocker = await createWork({
      dataDirectory,
      now: () => "2026-01-01T00:00:00.000Z",
      path: workspace,
      title: "Blocker",
    });
    const blocked = await createWork({
      dataDirectory,
      now: () => "2026-01-01T00:00:00.000Z",
      path: workspace,
      title: "Blocked",
    });
    await addWorkBlocker({
      blocker: blocker.id,
      dataDirectory,
      id: blocked.id,
      now: () => "2026-01-01T00:00:00.000Z",
      path: workspace,
    });

    const [result] = await listBlockedWork({
      dataDirectory,
      now: () => "2026-02-05T00:00:00.000Z",
      path: workspace,
    });

    expect(result).toMatchObject({
      daysSinceLastBlockerActivity: 35,
      readiness: "blocked",
      stalled: true,
    });
  });

  test("daysSinceLastBlockerActivity reflects the max of item-own and blocker-chain activity", async () => {
    const { dataDirectory, workspace } = createEnvironment();
    const blocker = await createWork({
      dataDirectory,
      now: () => "2026-01-01T00:00:00.000Z",
      path: workspace,
      title: "Blocker",
    });
    const blocked = await createWork({
      dataDirectory,
      now: () => "2026-01-01T00:00:00.000Z",
      path: workspace,
      title: "Blocked",
    });
    await addWorkBlocker({
      blocker: blocker.id,
      dataDirectory,
      id: blocked.id,
      now: () => "2026-01-01T00:00:00.000Z",
      path: workspace,
    });
    // A comment on the blocker is more recent activity than the blocked
    // item's own last event, so the signal should reflect the newer date.
    await addWorkComment({
      author: "agent",
      body: "Still waiting on upstream",
      dataDirectory,
      id: blocker.id,
      now: () => "2026-01-30T00:00:00.000Z",
      path: workspace,
    });

    const [result] = await listBlockedWork({
      dataDirectory,
      now: () => "2026-02-05T00:00:00.000Z",
      path: workspace,
    });

    expect(result).toMatchObject({
      daysSinceLastBlockerActivity: 6,
      stalled: false,
    });
  });

  test("honors a custom stalledAfterDays override", async () => {
    const { dataDirectory, workspace } = createEnvironment();
    const blocker = await createWork({
      dataDirectory,
      now: () => "2026-01-01T00:00:00.000Z",
      path: workspace,
      title: "Blocker",
    });
    const blocked = await createWork({
      dataDirectory,
      now: () => "2026-01-01T00:00:00.000Z",
      path: workspace,
      title: "Blocked",
    });
    await addWorkBlocker({
      blocker: blocker.id,
      dataDirectory,
      id: blocked.id,
      now: () => "2026-01-01T00:00:00.000Z",
      path: workspace,
    });

    const defaultThresholdResults = await listBlockedWork({
      dataDirectory,
      now: () => "2026-01-11T00:00:00.000Z",
      path: workspace,
    });
    expect(defaultThresholdResults).toHaveLength(1);
    expect(defaultThresholdResults[0]?.stalled).toBe(false);

    const customThresholdResults = await listBlockedWork({
      dataDirectory,
      now: () => "2026-01-11T00:00:00.000Z",
      path: workspace,
      stalledAfterDays: 10,
    });
    expect(customThresholdResults).toHaveLength(1);
    expect(customThresholdResults[0]?.stalled).toBe(true);
  });
});
