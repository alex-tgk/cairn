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
  const directory = mkdtempSync(join(tmpdir(), "cairn-work-hierarchy-"));
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
  registerProjectWorkspace(rawDatabase, {
    name: "Other",
    now: "2026-07-13T12:00:00.000Z",
    projectId: OTHER_PROJECT_ID,
    workspaceId: "018f4f32-95d6-7d6d-9f54-1d6d7a6d9a11",
    workspacePath: "/projects/other",
  });
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

describe("work hierarchy", () => {
  test("returns arbitrary-depth deterministic preorder", async () => {
    const { queryDatabase, repository } = createRepository();
    const root = fixture(
      "10000000-0000-7000-8000-000000000001",
      "Root",
      2,
      "2026-07-13T13:00:00.000Z",
    );
    const laterChild = fixture(
      "20000000-0000-7000-8000-000000000002",
      "Later child",
      2,
      "2026-07-13T15:00:00.000Z",
    );
    const firstChild = fixture(
      "30000000-0000-7000-8000-000000000003",
      "First child",
      1,
      "2026-07-13T14:00:00.000Z",
    );
    const grandchild = fixture(
      "40000000-0000-7000-8000-000000000004",
      "Grandchild",
      0,
      "2026-07-13T16:00:00.000Z",
    );
    await repository.create(root);
    await repository.create(laterChild, root.id);
    await repository.create(firstChild, root.id);
    await repository.create(grandchild, firstChild.id);

    expect(
      (await repository.listTree(PROJECT_ID, root.id)).map(
        ({ depth, item, parentId }) => ({
          depth,
          id: item.id.toString(),
          parentId: parentId?.toString() ?? null,
        }),
      ),
    ).toEqual([
      { depth: 0, id: root.id.toString(), parentId: null },
      { depth: 1, id: firstChild.id.toString(), parentId: root.id.toString() },
      {
        depth: 2,
        id: grandchild.id.toString(),
        parentId: firstChild.id.toString(),
      },
      { depth: 1, id: laterChild.id.toString(), parentId: root.id.toString() },
    ]);
    await queryDatabase.close();
  });

  test("reparents, clears, and makes repeated operations no-ops", async () => {
    const { queryDatabase, repository } = createRepository();
    const firstRoot = fixture(
      "10000000-0000-7000-8000-000000000001",
      "First root",
      1,
      "2026-07-13T13:00:00.000Z",
    );
    const secondRoot = fixture(
      "20000000-0000-7000-8000-000000000002",
      "Second root",
      1,
      "2026-07-13T14:00:00.000Z",
    );
    const child = fixture(
      "30000000-0000-7000-8000-000000000003",
      "Child",
      1,
      "2026-07-13T15:00:00.000Z",
    );
    await repository.create(firstRoot);
    await repository.create(secondRoot);
    await repository.create(child, firstRoot.id);

    const reparented = await repository.setParent(
      PROJECT_ID,
      child.id,
      secondRoot.id,
      1,
      "2026-07-13T16:00:00.000Z",
    );
    expect(reparented.revision).toBe(2);
    const repeated = await repository.setParent(
      PROJECT_ID,
      child.id,
      secondRoot.id,
      2,
      "2026-07-13T17:00:00.000Z",
    );
    expect(repeated.revision).toBe(2);
    const cleared = await repository.clearParent(
      PROJECT_ID,
      child.id,
      2,
      "2026-07-13T18:00:00.000Z",
    );
    expect(cleared.revision).toBe(3);
    const clearedAgain = await repository.clearParent(
      PROJECT_ID,
      child.id,
      3,
      "2026-07-13T19:00:00.000Z",
    );
    expect(clearedAgain.revision).toBe(3);
    expect(await repository.listEvents(PROJECT_ID, child.id)).toHaveLength(3);
    await queryDatabase.close();
  });

  test("rejects self, cross-project, and cyclic parents", async () => {
    const { queryDatabase, repository } = createRepository();
    const root = fixture(
      "10000000-0000-7000-8000-000000000001",
      "Root",
      1,
      "2026-07-13T13:00:00.000Z",
    );
    const child = fixture(
      "20000000-0000-7000-8000-000000000002",
      "Child",
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
    await repository.create(root);
    await repository.create(child, root.id);
    await repository.create(other);

    await expect(
      repository.setParent(
        PROJECT_ID,
        root.id,
        root.id,
        1,
        "2026-07-13T16:00:00.000Z",
      ),
    ).rejects.toMatchObject({ code: "self_parent" });
    await expect(
      repository.setParent(
        PROJECT_ID,
        root.id,
        other.id,
        1,
        "2026-07-13T16:00:00.000Z",
      ),
    ).rejects.toMatchObject({
      code: "cross_project_relation",
    });
    await expect(
      repository.setParent(
        PROJECT_ID,
        root.id,
        child.id,
        1,
        "2026-07-13T16:00:00.000Z",
      ),
    ).rejects.toMatchObject({
      code: "hierarchy_cycle",
    });
    await queryDatabase.close();
  });

  test("rejects closing a parent until every descendant is closed", async () => {
    const { queryDatabase, repository } = createRepository();
    const root = fixture(
      "10000000-0000-7000-8000-000000000001",
      "Root",
      1,
      "2026-07-13T13:00:00.000Z",
    );
    const child = fixture(
      "20000000-0000-7000-8000-000000000002",
      "Child",
      1,
      "2026-07-13T14:00:00.000Z",
    );
    await repository.create(root);
    await repository.create(child, root.id);

    await expect(
      repository.applyTransition(
        closeWorkItem(root, "2026-07-13T15:00:00.000Z"),
      ),
    ).rejects.toMatchObject({
      code: "open_descendants",
      descendantIds: [child.id.toString()],
    });
    await repository.applyTransition(
      closeWorkItem(child, "2026-07-13T16:00:00.000Z"),
    );
    await repository.applyTransition(
      closeWorkItem(root, "2026-07-13T17:00:00.000Z"),
    );
    expect(await repository.findById(PROJECT_ID, root.id)).toMatchObject({
      status: "closed",
    });
    await queryDatabase.close();
  });
});
