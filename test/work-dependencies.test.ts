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
import {
  closeWorkItem,
  createWorkItem,
  reopenWorkItem,
  WorkItemId,
} from "../src/work/work-item.ts";

const PROJECT_ID = "018f4f32-95d6-7d6d-9f54-1d6d7a6d9a0e";
const OTHER_PROJECT_ID = "018f4f32-95d6-7d6d-9f54-1d6d7a6d9a0f";
const temporaryDirectories: string[] = [];

function fixture(
  id: string,
  title: string,
  priority: number,
  now: string,
  projectId = PROJECT_ID,
) {
  return createWorkItem({
    id: WorkItemId.from(id),
    now,
    priority,
    projectId,
    title,
  });
}

function createRepository() {
  const directory = mkdtempSync(join(tmpdir(), "cairn-work-dependencies-"));
  temporaryDirectories.push(directory);
  const rawDatabase = openCairnDatabase(join(directory, "cairn.db"));
  registerProjectWorkspace(rawDatabase, {
    name: "Cairn",
    now: "2026-07-13T12:00:00.000Z",
    projectId: PROJECT_ID,
    workspaceId: "018f4f32-95d6-7d6d-9f54-1d6d7a6d9a10",
    workspacePath: "/projects/cairn",
  });
  registerProjectWorkspace(rawDatabase, {
    name: "Other",
    now: "2026-07-13T12:00:00.000Z",
    projectId: OTHER_PROJECT_ID,
    workspaceId: "018f4f32-95d6-7d6d-9f54-1d6d7a6d9a11",
    workspacePath: "/projects/other",
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

describe("work blocking dependencies", () => {
  test("adds, lists, removes, and retries blocker edges idempotently", async () => {
    const { queryDatabase, repository } = createRepository();
    const blocked = fixture(
      "10000000-0000-7000-8000-000000000001",
      "Blocked",
      1,
      "2026-07-13T13:00:00.000Z",
    );
    const blocker = fixture(
      "20000000-0000-7000-8000-000000000002",
      "Blocker",
      1,
      "2026-07-13T14:00:00.000Z",
    );
    await repository.create(blocked);
    await repository.create(blocker);

    const added = await repository.addBlocker(
      PROJECT_ID,
      blocked.id,
      blocker.id,
      1,
      "2026-07-13T15:00:00.000Z",
    );
    expect(added.revision).toBe(2);
    const repeated = await repository.addBlocker(
      PROJECT_ID,
      blocked.id,
      blocker.id,
      2,
      "2026-07-13T16:00:00.000Z",
    );
    expect(repeated.revision).toBe(2);
    expect(
      await repository.listDependencies(PROJECT_ID, blocked.id, "blockers"),
    ).toMatchObject([
      { blockedId: blocked.id, blockerId: blocker.id, relatedItem: blocker },
    ]);
    expect(
      await repository.listDependencies(PROJECT_ID, blocker.id, "dependents"),
    ).toMatchObject([
      { blockedId: blocked.id, blockerId: blocker.id, relatedItem: added },
    ]);

    const removed = await repository.removeBlocker(
      PROJECT_ID,
      blocked.id,
      blocker.id,
      2,
      "2026-07-13T17:00:00.000Z",
    );
    expect(removed.revision).toBe(3);
    const removedAgain = await repository.removeBlocker(
      PROJECT_ID,
      blocked.id,
      blocker.id,
      3,
      "2026-07-13T18:00:00.000Z",
    );
    expect(removedAgain.revision).toBe(3);
    expect(await repository.listEvents(PROJECT_ID, blocked.id)).toHaveLength(3);
    await queryDatabase.close();
  });

  test("rejects self, cross-project, and cyclic blockers", async () => {
    const { queryDatabase, repository } = createRepository();
    const first = fixture(
      "10000000-0000-7000-8000-000000000001",
      "First",
      1,
      "2026-07-13T13:00:00.000Z",
    );
    const second = fixture(
      "20000000-0000-7000-8000-000000000002",
      "Second",
      1,
      "2026-07-13T14:00:00.000Z",
    );
    const other = fixture(
      "30000000-0000-7000-8000-000000000003",
      "Other",
      1,
      "2026-07-13T15:00:00.000Z",
      OTHER_PROJECT_ID,
    );
    await repository.create(first);
    await repository.create(second);
    await repository.create(other);

    await expect(
      repository.addBlocker(
        PROJECT_ID,
        first.id,
        first.id,
        1,
        "2026-07-13T16:00:00.000Z",
      ),
    ).rejects.toMatchObject({ code: "self_dependency" });
    await expect(
      repository.addBlocker(
        PROJECT_ID,
        first.id,
        other.id,
        1,
        "2026-07-13T16:00:00.000Z",
      ),
    ).rejects.toMatchObject({ code: "cross_project_relation" });
    await repository.addBlocker(
      PROJECT_ID,
      first.id,
      second.id,
      1,
      "2026-07-13T16:00:00.000Z",
    );
    await expect(
      repository.addBlocker(
        PROJECT_ID,
        second.id,
        first.id,
        1,
        "2026-07-13T17:00:00.000Z",
      ),
    ).rejects.toMatchObject({ code: "dependency_cycle" });
    await queryDatabase.close();
  });

  test("derives ready and blocked work without treating hierarchy as blocking", async () => {
    const { queryDatabase, repository } = createRepository();
    const blocker = fixture(
      "10000000-0000-7000-8000-000000000001",
      "Blocker",
      2,
      "2026-07-13T13:00:00.000Z",
    );
    const blocked = fixture(
      "20000000-0000-7000-8000-000000000002",
      "Blocked",
      0,
      "2026-07-13T14:00:00.000Z",
    );
    const structuralChild = fixture(
      "30000000-0000-7000-8000-000000000003",
      "Structural child",
      1,
      "2026-07-13T15:00:00.000Z",
    );
    await repository.create(blocker);
    await repository.create(blocked);
    await repository.create(structuralChild, blocker.id);
    const blockedWithDependency = await repository.addBlocker(
      PROJECT_ID,
      blocked.id,
      blocker.id,
      1,
      "2026-07-13T16:00:00.000Z",
    );

    expect(
      (await repository.listReady(PROJECT_ID)).map(({ item }) => item.id.toString()),
    ).toEqual([structuralChild.id.toString(), blocker.id.toString()]);
    expect(await repository.listBlocked(PROJECT_ID)).toMatchObject([
      { item: blockedWithDependency, blockers: [blocker] },
    ]);

    await repository.applyTransition(
      closeWorkItem(structuralChild, "2026-07-13T17:00:00.000Z"),
    );
    await repository.applyTransition(
      closeWorkItem(blocker, "2026-07-13T18:00:00.000Z"),
    );
    expect(
      (await repository.listReady(PROJECT_ID)).map(({ item }) => item.id.toString()),
    ).toEqual([blocked.id.toString()]);
    expect(await repository.listBlocked(PROJECT_ID)).toEqual([]);

    const closedBlocker = await repository.findById(PROJECT_ID, blocker.id);
    if (!closedBlocker) {
      throw new Error("Expected closed blocker");
    }
    const reopenedBlocker = reopenWorkItem(
      closedBlocker,
      "2026-07-13T19:00:00.000Z",
    );
    await repository.applyTransition(reopenedBlocker);
    expect(await repository.listBlocked(PROJECT_ID)).toMatchObject([
      { item: blockedWithDependency, blockers: [reopenedBlocker.item] },
    ]);
    await queryDatabase.close();
  });
});
