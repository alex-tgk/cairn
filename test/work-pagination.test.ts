import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  openCairnDatabase,
  registerProjectWorkspace,
} from "../src/storage/database.ts";
import { CairnQueryDatabase } from "../src/storage/query-database.ts";
import { SqliteWorkItemRepository } from "../src/work/sqlite-work-item-repository.ts";
import { createWork, listWork } from "../src/work/work-service.ts";
import {
  createWorkItem,
  decodeWorkItemCursor,
  WorkItemId,
  WorkItemValidationError,
} from "../src/work/work-item.ts";

const PROJECT_ID = "018f4f32-95d6-7d6d-9f54-1d6d7a6d9a0e";
const temporaryDirectories: string[] = [];

function fixture(id: string, title: string, now: string, priority: number) {
  return createWorkItem({
    id: WorkItemId.from(id),
    now,
    priority,
    projectId: PROJECT_ID,
    title,
  });
}

function createRepository() {
  const directory = mkdtempSync(join(tmpdir(), "cairn-work-pagination-"));
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

function createEnvironment(): { dataDirectory: string; workspace: string } {
  const root = mkdtempSync(join(tmpdir(), "cairn-work-service-pagination-"));
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

describe("work_items keyset cursor at the repository layer", () => {
  test("seeks strictly past the cursor's (priority, created_at, id) tuple", async () => {
    const { queryDatabase, repository } = createRepository();
    const first = fixture(
      "10000000-0000-7000-8000-000000000001",
      "First",
      "2026-07-13T13:00:00.000Z",
      1,
    );
    const second = fixture(
      "20000000-0000-7000-8000-000000000002",
      "Second",
      "2026-07-13T14:00:00.000Z",
      1,
    );
    const third = fixture(
      "30000000-0000-7000-8000-000000000003",
      "Third",
      "2026-07-13T15:00:00.000Z",
      2,
    );
    await repository.create(first);
    await repository.create(second);
    await repository.create(third);

    const afterFirst = await repository.listByProject(PROJECT_ID, {
      cursor: {
        createdAt: first.createdAt,
        id: first.id.toString(),
        priority: first.priority.toNumber(),
      },
    });
    expect(afterFirst.map((item) => item.id.toString())).toEqual([
      second.id.toString(),
      third.id.toString(),
    ]);

    const afterSecond = await repository.listByProject(PROJECT_ID, {
      cursor: {
        createdAt: second.createdAt,
        id: second.id.toString(),
        priority: second.priority.toNumber(),
      },
    });
    expect(afterSecond.map((item) => item.id.toString())).toEqual([
      third.id.toString(),
    ]);

    await queryDatabase.close();
  });

  test("uses the id tiebreaker for two items sharing priority and created_at", async () => {
    const { queryDatabase, repository } = createRepository();
    const sameInstant = "2026-07-13T13:00:00.000Z";
    const lower = fixture(
      "10000000-0000-7000-8000-000000000001",
      "Lower id",
      sameInstant,
      1,
    );
    const higher = fixture(
      "20000000-0000-7000-8000-000000000002",
      "Higher id",
      sameInstant,
      1,
    );
    // Insert in reverse id order to prove ordering is driven by the id
    // tiebreaker, not insertion order.
    await repository.create(higher);
    await repository.create(lower);

    const all = await repository.listByProject(PROJECT_ID, {});
    expect(all.map((item) => item.id.toString())).toEqual([
      lower.id.toString(),
      higher.id.toString(),
    ]);

    const afterLower = await repository.listByProject(PROJECT_ID, {
      cursor: {
        createdAt: lower.createdAt,
        id: lower.id.toString(),
        priority: lower.priority.toNumber(),
      },
    });
    expect(afterLower.map((item) => item.id.toString())).toEqual([
      higher.id.toString(),
    ]);

    await queryDatabase.close();
  });
});

describe("cairn work list cursor pagination", () => {
  test("returns a first page with limit and a stable nextCursor", async () => {
    const { dataDirectory, workspace } = createEnvironment();
    const titles = ["Alpha", "Bravo", "Charlie"];
    for (const [index, title] of titles.entries()) {
      const now = `2026-07-13T13:0${index}:00.000Z`;
      await createWork({ dataDirectory, now: () => now, path: workspace, title });
    }

    const firstPage = await listWork({ dataDirectory, limit: 2, path: workspace });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();
    expect(firstPage.items.map((item) => item.title)).toEqual(["Alpha", "Bravo"]);
  });

  test("seeks to the middle and last page via the returned cursor", async () => {
    const { dataDirectory, workspace } = createEnvironment();
    const titles = ["Alpha", "Bravo", "Charlie", "Delta"];
    for (const [index, title] of titles.entries()) {
      const now = `2026-07-13T13:0${index}:00.000Z`;
      await createWork({ dataDirectory, now: () => now, path: workspace, title });
    }

    const firstPage = await listWork({ dataDirectory, limit: 2, path: workspace });
    expect(firstPage.items.map((item) => item.title)).toEqual(["Alpha", "Bravo"]);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await listWork({
      cursor: firstPage.nextCursor ?? "",
      dataDirectory,
      limit: 2,
      path: workspace,
    });
    expect(secondPage.items.map((item) => item.title)).toEqual(["Charlie", "Delta"]);
    expect(secondPage.nextCursor).toBeNull();
  });

  test("returns items unchanged and nextCursor null when a page is not full", async () => {
    const { dataDirectory, workspace } = createEnvironment();
    const now = "2026-07-13T13:00:00.000Z";
    await createWork({ dataDirectory, now: () => now, path: workspace, title: "Solo" });

    const page = await listWork({ dataDirectory, limit: 10, path: workspace });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  test("rejects a malformed cursor without crashing", async () => {
    const { dataDirectory, workspace } = createEnvironment();
    await expect(
      listWork({ cursor: "not-a-valid-cursor!!", dataDirectory, path: workspace }),
    ).rejects.toBeInstanceOf(WorkItemValidationError);
  });

  test("rejects a well-formed but structurally invalid cursor payload", async () => {
    const { dataDirectory, workspace } = createEnvironment();
    const badPayload = Buffer.from(
      JSON.stringify({ createdAt: "not-empty", priority: "not-a-number" }),
      "utf8",
    ).toString("base64url");
    await expect(
      listWork({ cursor: badPayload, dataDirectory, path: workspace }),
    ).rejects.toBeInstanceOf(WorkItemValidationError);
  });

  test("produces a cursor token that decodes back to the expected sort key", async () => {
    const { dataDirectory, workspace } = createEnvironment();
    const firstNow = "2026-07-13T13:00:00.000Z";
    await createWork({ dataDirectory, now: () => firstNow, path: workspace, title: "Alpha" });
    await createWork({
      dataDirectory,
      now: () => "2026-07-13T13:01:00.000Z",
      path: workspace,
      title: "Bravo",
    });

    const page = await listWork({ dataDirectory, limit: 1, path: workspace });
    const cursor = page.nextCursor;
    expect(cursor).not.toBeNull();
    const decoded = decodeWorkItemCursor(cursor ?? "");
    expect(decoded).toMatchObject({ createdAt: firstNow, priority: 2 });
  });

  test("is deterministic: the same cursor and data always return the same page", async () => {
    const { dataDirectory, workspace } = createEnvironment();
    const now = "2026-07-13T13:00:00.000Z";
    for (const title of ["Alpha", "Bravo", "Charlie"]) {
      await createWork({ dataDirectory, now: () => now, path: workspace, title });
    }

    const firstPage = await listWork({ dataDirectory, limit: 1, path: workspace });
    const repeat1 = await listWork({
      cursor: firstPage.nextCursor ?? "",
      dataDirectory,
      limit: 1,
      path: workspace,
    });
    const repeat2 = await listWork({
      cursor: firstPage.nextCursor ?? "",
      dataDirectory,
      limit: 1,
      path: workspace,
    });
    expect(repeat1).toEqual(repeat2);
  });
});
