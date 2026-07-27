import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  openCairnDatabase,
  registerProjectWorkspace,
} from "../src/storage/database.ts";
import { CairnQueryDatabase } from "../src/storage/query-database.ts";
import { createMemory, MemoryId, MemoryValidationError } from "../src/memory/memory.ts";
import { SqliteMemoryRepository } from "../src/memory/sqlite-memory-repository.ts";
import { listMemories, saveMemory, searchMemories } from "../src/memory/memory-service.ts";

const PROJECT_ID = "018f4f32-95d6-7d6d-9f54-2d6d7a6d9a0e";
const temporaryDirectories: string[] = [];

function createDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "cairn-memory-pagination-"));
  temporaryDirectories.push(directory);
  const database = openCairnDatabase(join(directory, "cairn.db"));
  registerProjectWorkspace(database, {
    name: "Cairn",
    now: "2026-07-13T12:00:00.000Z",
    projectId: PROJECT_ID,
    workspaceId: "018f4f32-95d6-7d6d-9f54-2d6d7a6d9a10",
    workspacePath: "/projects/cairn",
  });
  return database;
}

function fixture(id: string, title: string, now: string) {
  return createMemory({
    content: `${title} content`,
    id: MemoryId.from(id),
    now,
    projectId: PROJECT_ID,
    scope: "project",
    title,
    type: "discovery",
  });
}

function createEnvironment(): { dataDirectory: string; workspace: string } {
  const root = mkdtempSync(join(tmpdir(), "cairn-memory-service-pagination-"));
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

describe("memories keyset cursor at the repository layer", () => {
  test("listByProject seeks strictly past the cursor's (created_at, id) tuple in DESC order", async () => {
    const database = createDatabase();
    const queryDatabase = new CairnQueryDatabase(database);
    const repository = new SqliteMemoryRepository(queryDatabase);
    const first = fixture(
      "10000000-0000-7000-8000-000000000001",
      "First",
      "2026-07-13T13:00:00.000Z",
    );
    const second = fixture(
      "20000000-0000-7000-8000-000000000002",
      "Second",
      "2026-07-13T14:00:00.000Z",
    );
    const third = fixture(
      "30000000-0000-7000-8000-000000000003",
      "Third",
      "2026-07-13T15:00:00.000Z",
    );
    await repository.create(first);
    await repository.create(second);
    await repository.create(third);

    const all = await repository.listByProject(PROJECT_ID);
    expect(all.map((memory) => memory.title.toString())).toEqual([
      "Third",
      "Second",
      "First",
    ]);

    const afterThird = await repository.listByProject(PROJECT_ID, {
      cursor: { createdAt: third.createdAt, id: third.id.toString() },
    });
    expect(afterThird.map((memory) => memory.title.toString())).toEqual([
      "Second",
      "First",
    ]);

    await queryDatabase.close();
  });

  test("uses the id tiebreaker for two memories sharing created_at", async () => {
    const database = createDatabase();
    const queryDatabase = new CairnQueryDatabase(database);
    const repository = new SqliteMemoryRepository(queryDatabase);
    const sameInstant = "2026-07-13T13:00:00.000Z";
    const lower = fixture(
      "10000000-0000-7000-8000-000000000001",
      "Lower id",
      sameInstant,
    );
    const higher = fixture(
      "20000000-0000-7000-8000-000000000002",
      "Higher id",
      sameInstant,
    );
    await repository.create(lower);
    await repository.create(higher);

    const all = await repository.listByProject(PROJECT_ID);
    // DESC order: higher id sorts first when created_at ties.
    expect(all.map((memory) => memory.id.toString())).toEqual([
      higher.id.toString(),
      lower.id.toString(),
    ]);

    const afterHigher = await repository.listByProject(PROJECT_ID, {
      cursor: { createdAt: higher.createdAt, id: higher.id.toString() },
    });
    expect(afterHigher.map((memory) => memory.id.toString())).toEqual([
      lower.id.toString(),
    ]);

    await queryDatabase.close();
  });
});

describe("cairn memory list cursor pagination", () => {
  test("returns a first page, seeks to the last page, and reports nextCursor null at the end", async () => {
    const { dataDirectory, workspace } = createEnvironment();
    const titles = ["Alpha", "Bravo", "Charlie", "Delta"];
    for (const [index, title] of titles.entries()) {
      const now = `2026-07-13T13:0${index}:00.000Z`;
      await saveMemory({
        content: `${title} body`,
        dataDirectory,
        now: () => now,
        path: workspace,
        title,
        type: "discovery",
      });
    }

    // listByProject orders created_at DESC, so newest first: Delta, Charlie, Bravo, Alpha.
    const firstPage = await listMemories({ dataDirectory, limit: 2, path: workspace });
    expect(firstPage.items.map((memory) => memory.title)).toEqual(["Delta", "Charlie"]);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await listMemories({
      cursor: firstPage.nextCursor ?? "",
      dataDirectory,
      limit: 2,
      path: workspace,
    });
    expect(secondPage.items.map((memory) => memory.title)).toEqual(["Bravo", "Alpha"]);
    expect(secondPage.nextCursor).toBeNull();
  });

  test("rejects a malformed memory list cursor without crashing", async () => {
    const { dataDirectory, workspace } = createEnvironment();
    await expect(
      listMemories({ cursor: "%%%not-base64%%%", dataDirectory, path: workspace }),
    ).rejects.toBeInstanceOf(MemoryValidationError);
  });

  test("is deterministic across repeated identical queries", async () => {
    const { dataDirectory, workspace } = createEnvironment();
    for (const [index, title] of ["Alpha", "Bravo", "Charlie"].entries()) {
      const now = `2026-07-13T13:0${index}:00.000Z`;
      await saveMemory({
        content: `${title} body`,
        dataDirectory,
        now: () => now,
        path: workspace,
        title,
        type: "discovery",
      });
    }

    const firstPage = await listMemories({ dataDirectory, limit: 1, path: workspace });
    const repeat1 = await listMemories({
      cursor: firstPage.nextCursor ?? "",
      dataDirectory,
      limit: 1,
      path: workspace,
    });
    const repeat2 = await listMemories({
      cursor: firstPage.nextCursor ?? "",
      dataDirectory,
      limit: 1,
      path: workspace,
    });
    expect(repeat1).toEqual(repeat2);
  });
});

describe("cairn memory search cursor pagination", () => {
  test("seeks past ties using the rank, created_at, id tuple and terminates with nextCursor null", async () => {
    const { dataDirectory, workspace } = createEnvironment();
    const titles = ["Refresh tokens overview", "Refresh tokens rotation", "Refresh tokens audit"];
    for (const [index, title] of titles.entries()) {
      const now = `2026-07-13T13:0${index}:00.000Z`;
      await saveMemory({
        content: "Discusses refresh tokens in depth.",
        dataDirectory,
        now: () => now,
        path: workspace,
        title,
        type: "discovery",
      });
    }

    const firstPage = await searchMemories({
      dataDirectory,
      limit: 2,
      path: workspace,
      query: "refresh tokens",
    });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await searchMemories({
      cursor: firstPage.nextCursor ?? "",
      dataDirectory,
      limit: 2,
      path: workspace,
      query: "refresh tokens",
    });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();

    const seenTitles = new Set([
      ...firstPage.items.map((memory) => memory.title),
      ...secondPage.items.map((memory) => memory.title),
    ]);
    expect(seenTitles.size).toBe(3);
  });

  test("rejects a malformed memory search cursor without crashing", async () => {
    const { dataDirectory, workspace } = createEnvironment();
    await saveMemory({
      content: "Discusses refresh tokens in depth.",
      dataDirectory,
      path: workspace,
      title: "Refresh tokens",
      type: "discovery",
    });
    await expect(
      searchMemories({
        cursor: "not-a-real-cursor",
        dataDirectory,
        path: workspace,
        query: "refresh",
      }),
    ).rejects.toBeInstanceOf(MemoryValidationError);
  });

  test("is deterministic: the same query, data, and cursor always return the same page", async () => {
    const { dataDirectory, workspace } = createEnvironment();
    const titles = ["Refresh tokens overview", "Refresh tokens rotation", "Refresh tokens audit"];
    for (const [index, title] of titles.entries()) {
      const now = `2026-07-13T13:0${index}:00.000Z`;
      await saveMemory({
        content: "Discusses refresh tokens in depth.",
        dataDirectory,
        now: () => now,
        path: workspace,
        title,
        type: "discovery",
      });
    }

    const firstPage = await searchMemories({
      dataDirectory,
      limit: 1,
      path: workspace,
      query: "refresh tokens",
    });
    const repeat1 = await searchMemories({
      cursor: firstPage.nextCursor ?? "",
      dataDirectory,
      limit: 1,
      path: workspace,
      query: "refresh tokens",
    });
    const repeat2 = await searchMemories({
      cursor: firstPage.nextCursor ?? "",
      dataDirectory,
      limit: 1,
      path: workspace,
      query: "refresh tokens",
    });
    expect(repeat1).toEqual(repeat2);
  });
});
