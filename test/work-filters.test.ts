import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  openCairnDatabase,
  registerProjectWorkspace,
} from "../src/storage/database.ts";
import { CairnQueryDatabase } from "../src/storage/query-database.ts";
import { SqliteWorkItemRepository } from "../src/work/sqlite-work-item-repository.ts";
import { createWorkItem, closeWorkItem, WorkItemId } from "../src/work/work-item.ts";

const PROJECT_ID = "018f4f32-95d6-7d6d-9f54-1d6d7a6d9a0e";
const temporaryDirectories: string[] = [];

function fixture(
  id: string,
  title: string,
  now: string,
  overrides: Partial<
    Parameters<typeof createWorkItem>[0]
  > = {},
) {
  return createWorkItem({
    id: WorkItemId.from(id),
    now,
    projectId: PROJECT_ID,
    title,
    ...overrides,
  });
}

function createRepository() {
  const directory = mkdtempSync(join(tmpdir(), "cairn-work-filters-"));
  temporaryDirectories.push(directory);
  const rawDatabase = openCairnDatabase(join(directory, "cairn.db"));
  registerProjectWorkspace(rawDatabase, {
    name: "Cairn",
    now: "2026-07-13T12:00:00.000Z",
    projectId: PROJECT_ID,
    workspaceId: "018f4f32-95d6-7d6d-9f54-1d6d7a6d9a10",
    workspacePath: "/projects/cairn",
  });
  const queryDatabase = new CairnQueryDatabase(rawDatabase);
  return {
    queryDatabase,
    repository: new SqliteWorkItemRepository(queryDatabase),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("work list filtering", () => {
  test("filters by status, priority, type, and assignee", async () => {
    const { queryDatabase, repository } = createRepository();
    const bug = fixture(
      "10000000-0000-7000-8000-000000000001",
      "Bug",
      "2026-07-13T13:00:00.000Z",
      { assignee: "agent-codex", priority: 0, type: "bug" },
    );
    const feature = fixture(
      "20000000-0000-7000-8000-000000000002",
      "Feature",
      "2026-07-13T14:00:00.000Z",
      { priority: 2, type: "feature" },
    );
    await repository.create(bug);
    await repository.create(feature);
    await repository.applyTransition(
      closeWorkItem(feature, "2026-07-13T15:00:00.000Z"),
    );

    expect(
      (await repository.listByProject(PROJECT_ID, { status: "open" })).map(
        (item) => item.id.toString(),
      ),
    ).toEqual([bug.id.toString()]);
    expect(
      (await repository.listByProject(PROJECT_ID, { priority: 2 })).map(
        (item) => item.id.toString(),
      ),
    ).toEqual([feature.id.toString()]);
    expect(
      (await repository.listByProject(PROJECT_ID, { type: "bug" })).map(
        (item) => item.id.toString(),
      ),
    ).toEqual([bug.id.toString()]);
    expect(
      (
        await repository.listByProject(PROJECT_ID, {
          assignee: "agent-codex",
        })
      ).map((item) => item.id.toString()),
    ).toEqual([bug.id.toString()]);
    expect(
      (await repository.listByProject(PROJECT_ID, { assignee: null })).map(
        (item) => item.id.toString(),
      ),
    ).toEqual([feature.id.toString()]);
    await queryDatabase.close();
  });

  test("filters by labels with AND semantics", async () => {
    const { queryDatabase, repository } = createRepository();
    const both = fixture(
      "10000000-0000-7000-8000-000000000001",
      "Both labels",
      "2026-07-13T13:00:00.000Z",
    );
    const onlyUrgent = fixture(
      "20000000-0000-7000-8000-000000000002",
      "Only urgent",
      "2026-07-13T14:00:00.000Z",
    );
    await repository.create(both);
    await repository.create(onlyUrgent);
    await repository.addLabel(
      PROJECT_ID,
      both.id,
      "urgent",
      1,
      "2026-07-13T15:00:00.000Z",
    );
    await repository.addLabel(
      PROJECT_ID,
      both.id,
      "backend",
      2,
      "2026-07-13T16:00:00.000Z",
    );
    await repository.addLabel(
      PROJECT_ID,
      onlyUrgent.id,
      "urgent",
      1,
      "2026-07-13T15:00:00.000Z",
    );

    expect(
      (
        await repository.listByProject(PROJECT_ID, { labels: ["urgent"] })
      ).map((item) => item.id.toString()),
    ).toEqual([both.id.toString(), onlyUrgent.id.toString()]);
    expect(
      (
        await repository.listByProject(PROJECT_ID, {
          labels: ["urgent", "backend"],
        })
      ).map((item) => item.id.toString()),
    ).toEqual([both.id.toString()]);
    await queryDatabase.close();
  });

  test("filters by parent, roots, and applies a result limit", async () => {
    const { queryDatabase, repository } = createRepository();
    const parent = fixture(
      "10000000-0000-7000-8000-000000000001",
      "Parent",
      "2026-07-13T13:00:00.000Z",
    );
    const child = fixture(
      "20000000-0000-7000-8000-000000000002",
      "Child",
      "2026-07-13T14:00:00.000Z",
    );
    const otherRoot = fixture(
      "30000000-0000-7000-8000-000000000003",
      "Other root",
      "2026-07-13T15:00:00.000Z",
    );
    await repository.create(parent);
    await repository.create(child, parent.id);
    await repository.create(otherRoot);

    expect(
      (
        await repository.listByProject(PROJECT_ID, { parentId: parent.id })
      ).map((item) => item.id.toString()),
    ).toEqual([child.id.toString()]);
    expect(
      (await repository.listByProject(PROJECT_ID, { parentId: null })).map(
        (item) => item.id.toString(),
      ),
    ).toEqual([parent.id.toString(), otherRoot.id.toString()]);
    expect(
      (await repository.listByProject(PROJECT_ID, { limit: 1 })).map(
        (item) => item.id.toString(),
      ),
    ).toEqual([parent.id.toString()]);
    await queryDatabase.close();
  });

  test("applies filters to ready and blocked queries", async () => {
    const { queryDatabase, repository } = createRepository();
    const blocker = fixture(
      "10000000-0000-7000-8000-000000000001",
      "Blocker",
      "2026-07-13T13:00:00.000Z",
      { type: "bug" },
    );
    const blocked = fixture(
      "20000000-0000-7000-8000-000000000002",
      "Blocked",
      "2026-07-13T14:00:00.000Z",
      { type: "feature" },
    );
    const readyBug = fixture(
      "30000000-0000-7000-8000-000000000003",
      "Ready bug",
      "2026-07-13T15:00:00.000Z",
      { type: "bug" },
    );
    await repository.create(blocker);
    await repository.create(blocked);
    await repository.create(readyBug);
    await repository.addBlocker(
      PROJECT_ID,
      blocked.id,
      blocker.id,
      1,
      "2026-07-13T16:00:00.000Z",
    );

    expect(
      (await repository.listReady(PROJECT_ID, { type: "bug" })).map(
        ({ item }) => item.id.toString(),
      ),
    ).toEqual([blocker.id.toString(), readyBug.id.toString()]);
    expect(
      (await repository.listBlocked(PROJECT_ID, { type: "feature" })).map(
        ({ item }) => item.id.toString(),
      ),
    ).toEqual([blocked.id.toString()]);
    expect(
      await repository.listBlocked(PROJECT_ID, { type: "bug" }),
    ).toEqual([]);
    await queryDatabase.close();
  });
});
