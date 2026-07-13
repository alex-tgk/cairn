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
import { createWorkItem, WorkItemId } from "../src/work/work-item.ts";

const PROJECT_ID = "018f4f32-95d6-7d6d-9f54-1d6d7a6d9a0e";
const temporaryDirectories: string[] = [];

function fixture(id: string, title: string, now: string) {
  return createWorkItem({
    id: WorkItemId.from(id),
    now,
    projectId: PROJECT_ID,
    title,
  });
}

function createRepository() {
  const directory = mkdtempSync(join(tmpdir(), "cairn-work-metadata-"));
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

describe("work labels", () => {
  test("adds, lists, and removes labels idempotently and trims/lowercases them", async () => {
    const { queryDatabase, repository } = createRepository();
    const item = fixture(
      "10000000-0000-7000-8000-000000000001",
      "Item",
      "2026-07-13T13:00:00.000Z",
    );
    await repository.create(item);

    const added = await repository.addLabel(
      PROJECT_ID,
      item.id,
      "  Urgent  ",
      1,
      "2026-07-13T14:00:00.000Z",
    );
    expect(added.revision).toBe(2);
    const repeated = await repository.addLabel(
      PROJECT_ID,
      item.id,
      "urgent",
      2,
      "2026-07-13T15:00:00.000Z",
    );
    expect(repeated.revision).toBe(2);
    await repository.addLabel(
      PROJECT_ID,
      item.id,
      "backend",
      2,
      "2026-07-13T16:00:00.000Z",
    );

    expect(await repository.listLabels(PROJECT_ID, item.id)).toEqual([
      "backend",
      "urgent",
    ]);

    const removed = await repository.removeLabel(
      PROJECT_ID,
      item.id,
      "urgent",
      3,
      "2026-07-13T17:00:00.000Z",
    );
    expect(removed.revision).toBe(4);
    const removedAgain = await repository.removeLabel(
      PROJECT_ID,
      item.id,
      "urgent",
      4,
      "2026-07-13T18:00:00.000Z",
    );
    expect(removedAgain.revision).toBe(4);
    expect(await repository.listLabels(PROJECT_ID, item.id)).toEqual([
      "backend",
    ]);
    expect(await repository.listEvents(PROJECT_ID, item.id)).toHaveLength(4);
    await queryDatabase.close();
  });

  test("rejects an empty label", async () => {
    const { queryDatabase, repository } = createRepository();
    const item = fixture(
      "10000000-0000-7000-8000-000000000001",
      "Item",
      "2026-07-13T13:00:00.000Z",
    );
    await repository.create(item);

    await expect(
      repository.addLabel(
        PROJECT_ID,
        item.id,
        "   ",
        1,
        "2026-07-13T14:00:00.000Z",
      ),
    ).rejects.toThrow("Work item label must not be empty");
    await queryDatabase.close();
  });

  test("includes labels in the work item's search tags", async () => {
    const { queryDatabase, repository } = createRepository();
    const item = fixture(
      "10000000-0000-7000-8000-000000000001",
      "Item",
      "2026-07-13T13:00:00.000Z",
    );
    await repository.create(item);
    await repository.addLabel(
      PROJECT_ID,
      item.id,
      "urgent",
      1,
      "2026-07-13T14:00:00.000Z",
    );

    const row = await queryDatabase.queries
      .selectFrom("search_entries")
      .select("tags")
      .where("entity_id", "=", item.id.toString())
      .executeTakeFirstOrThrow();
    expect(row.tags).toContain("urgent");
    await queryDatabase.close();
  });
});

describe("work notes", () => {
  test("appends notes in order and rejects empty text", async () => {
    const { queryDatabase, repository } = createRepository();
    const item = fixture(
      "10000000-0000-7000-8000-000000000001",
      "Item",
      "2026-07-13T13:00:00.000Z",
    );
    await repository.create(item);

    const first = await repository.appendNote(
      PROJECT_ID,
      item.id,
      "Investigated the issue",
      1,
      "2026-07-13T14:00:00.000Z",
    );
    expect(first.notes).toBe("Investigated the issue");
    const second = await repository.appendNote(
      PROJECT_ID,
      item.id,
      "  Found the root cause  ",
      2,
      "2026-07-13T15:00:00.000Z",
    );
    expect(second.notes).toBe(
      "Investigated the issue\nFound the root cause",
    );

    await expect(
      repository.appendNote(
        PROJECT_ID,
        item.id,
        "   ",
        3,
        "2026-07-13T16:00:00.000Z",
      ),
    ).rejects.toThrow("Work item note must not be empty");
    await queryDatabase.close();
  });
});

describe("work comments", () => {
  test("adds and lists comments in insertion order", async () => {
    const { queryDatabase, repository } = createRepository();
    const item = fixture(
      "10000000-0000-7000-8000-000000000001",
      "Item",
      "2026-07-13T13:00:00.000Z",
    );
    await repository.create(item);

    const afterFirst = await repository.addComment(
      PROJECT_ID,
      item.id,
      "agent-codex",
      "Looks good to me",
      1,
      "2026-07-13T14:00:00.000Z",
    );
    expect(afterFirst.revision).toBe(2);
    const afterSecond = await repository.addComment(
      PROJECT_ID,
      item.id,
      "agent-copilot",
      "Agreed, shipping it",
      2,
      "2026-07-13T15:00:00.000Z",
    );
    expect(afterSecond.revision).toBe(3);

    expect(await repository.listComments(PROJECT_ID, item.id)).toMatchObject([
      {
        author: "agent-codex",
        body: "Looks good to me",
        createdAt: "2026-07-13T14:00:00.000Z",
        revision: 2,
      },
      {
        author: "agent-copilot",
        body: "Agreed, shipping it",
        createdAt: "2026-07-13T15:00:00.000Z",
        revision: 3,
      },
    ]);
    expect(await repository.listEvents(PROJECT_ID, item.id)).toHaveLength(3);
    await queryDatabase.close();
  });

  test("rejects an empty author or body", async () => {
    const { queryDatabase, repository } = createRepository();
    const item = fixture(
      "10000000-0000-7000-8000-000000000001",
      "Item",
      "2026-07-13T13:00:00.000Z",
    );
    await repository.create(item);

    await expect(
      repository.addComment(
        PROJECT_ID,
        item.id,
        "   ",
        "Body",
        1,
        "2026-07-13T14:00:00.000Z",
      ),
    ).rejects.toThrow("Work item comment author must not be empty");
    await expect(
      repository.addComment(
        PROJECT_ID,
        item.id,
        "agent-codex",
        "   ",
        1,
        "2026-07-13T14:00:00.000Z",
      ),
    ).rejects.toThrow("Work item comment body must not be empty");
    await queryDatabase.close();
  });
});
