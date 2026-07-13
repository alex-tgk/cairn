import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  openCairnDatabase,
  registerProjectWorkspace,
} from "../src/storage/database.ts";
import { CairnQueryDatabase } from "../src/storage/query-database.ts";
import {
  createMemory,
  upsertMemory,
  MemoryConflictError,
  MemoryId,
} from "../src/memory/memory.ts";
import { SqliteMemoryRepository } from "../src/memory/sqlite-memory-repository.ts";

const PROJECT_ID = "018f4f32-95d6-7d6d-9f54-2d6d7a6d9a0e";
const OTHER_PROJECT_ID = "018f4f32-95d6-7d6d-9f54-2d6d7a6d9a0f";
const temporaryDirectories: string[] = [];

function createDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "cairn-memory-store-"));
  temporaryDirectories.push(directory);
  const database = openCairnDatabase(join(directory, "cairn.db"));

  registerProjectWorkspace(database, {
    name: "Cairn",
    now: "2026-07-13T12:00:00.000Z",
    projectId: PROJECT_ID,
    workspaceId: "018f4f32-95d6-7d6d-9f54-2d6d7a6d9a10",
    workspacePath: "/projects/cairn",
  });
  registerProjectWorkspace(database, {
    name: "Other",
    now: "2026-07-13T12:00:00.000Z",
    projectId: OTHER_PROJECT_ID,
    workspaceId: "018f4f32-95d6-7d6d-9f54-2d6d7a6d9a11",
    workspacePath: "/projects/other",
  });

  return database;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("SQLite memory repository", () => {
  test("creates a memory with an audit event and search projection", async () => {
    const database = createDatabase();
    const queryDatabase = new CairnQueryDatabase(database);
    const repository = new SqliteMemoryRepository(queryDatabase);
    const memory = createMemory({
      content: "Chose SQLite as the deterministic Phase 1 store.",
      id: MemoryId.from("018f4f32-95d6-7d6d-9f54-2d6d7a6d9a20"),
      now: "2026-07-13T12:05:00.000Z",
      projectId: PROJECT_ID,
      scope: "project",
      title: "Chose SQLite over Dolt",
      topic: "architecture/storage",
      type: "decision",
    });

    await repository.create(memory);

    const found = await repository.findById(memory.id);
    expect(found?.title.toString()).toBe("Chose SQLite over Dolt");
    expect(found?.revision).toBe(1);

    const projection = await database
      .query<{ body: string; entity_kind: string; tags: string }, [string]>(
        "SELECT entity_kind, body, tags FROM search_entries WHERE entity_id = ?",
      )
      .get(memory.id.toString());
    expect(projection?.entity_kind).toBe("memory");
    expect(projection?.body).toContain("deterministic Phase 1 store");
    expect(projection?.tags).toBe("decision project architecture/storage");

    await queryDatabase.close();
  });

  test("upserts an existing topic in place instead of creating a duplicate", async () => {
    const database = createDatabase();
    const queryDatabase = new CairnQueryDatabase(database);
    const repository = new SqliteMemoryRepository(queryDatabase);
    const memory = createMemory({
      content: "First pass.",
      id: MemoryId.from("018f4f32-95d6-7d6d-9f54-2d6d7a6d9a21"),
      now: "2026-07-13T12:10:00.000Z",
      projectId: PROJECT_ID,
      scope: "project",
      title: "Auth model",
      topic: "architecture/auth-model",
      type: "architecture",
    });
    await repository.create(memory);

    const existing = await repository.findByTopic(
      "project",
      PROJECT_ID,
      "architecture/auth-model",
    );
    expect(existing).not.toBeNull();

    const transition = upsertMemory(
      existing!,
      {
        content: "Second pass with refresh tokens.",
        title: "Auth model v2",
        type: "architecture",
      },
      "2026-07-13T12:20:00.000Z",
    );
    await repository.applyUpsert(transition);

    const all = await repository.listByProject(PROJECT_ID);
    expect(all).toHaveLength(1);
    expect(all[0]?.title.toString()).toBe("Auth model v2");
    expect(all[0]?.revision).toBe(2);

    await queryDatabase.close();
  });

  test("rejects an upsert against a stale revision", async () => {
    const database = createDatabase();
    const queryDatabase = new CairnQueryDatabase(database);
    const repository = new SqliteMemoryRepository(queryDatabase);
    const memory = createMemory({
      content: "Initial content.",
      id: MemoryId.from("018f4f32-95d6-7d6d-9f54-2d6d7a6d9a22"),
      now: "2026-07-13T12:00:00.000Z",
      projectId: PROJECT_ID,
      scope: "project",
      title: "Initial",
      topic: "pattern/naming",
      type: "pattern",
    });
    await repository.create(memory);

    const transition = upsertMemory(
      memory,
      { content: "Updated once.", title: "Updated", type: "pattern" },
      "2026-07-13T12:01:00.000Z",
    );
    await repository.applyUpsert(transition);

    const staleTransition = upsertMemory(
      memory,
      { content: "Conflicting update.", title: "Conflict", type: "pattern" },
      "2026-07-13T12:02:00.000Z",
    );
    await expect(repository.applyUpsert(staleTransition)).rejects.toBeInstanceOf(
      MemoryConflictError,
    );

    await queryDatabase.close();
  });

  test("isolates project-scoped memories from other projects but shares personal memories", async () => {
    const database = createDatabase();
    const queryDatabase = new CairnQueryDatabase(database);
    const repository = new SqliteMemoryRepository(queryDatabase);

    const projectMemory = createMemory({
      content: "Only visible in this project.",
      id: MemoryId.from("018f4f32-95d6-7d6d-9f54-2d6d7a6d9a23"),
      now: "2026-07-13T12:00:00.000Z",
      projectId: PROJECT_ID,
      scope: "project",
      title: "Project memory",
      type: "discovery",
    });
    const otherProjectMemory = createMemory({
      content: "Belongs to the other project.",
      id: MemoryId.from("018f4f32-95d6-7d6d-9f54-2d6d7a6d9a24"),
      now: "2026-07-13T12:00:00.000Z",
      projectId: OTHER_PROJECT_ID,
      scope: "project",
      title: "Other project memory",
      type: "discovery",
    });
    const personalMemory = createMemory({
      content: "Visible from any project.",
      id: MemoryId.from("018f4f32-95d6-7d6d-9f54-2d6d7a6d9a25"),
      now: "2026-07-13T12:00:00.000Z",
      projectId: null,
      scope: "personal",
      title: "Personal memory",
      type: "preference",
    });

    await repository.create(projectMemory);
    await repository.create(otherProjectMemory);
    await repository.create(personalMemory);

    const visibleFromProject = await repository.listByProject(PROJECT_ID);
    const titles = visibleFromProject.map((memory) => memory.title.toString());
    expect(titles).toContain("Project memory");
    expect(titles).toContain("Personal memory");
    expect(titles).not.toContain("Other project memory");
  });

  test("filters listed memories by type, scope, and topic", async () => {
    const database = createDatabase();
    const queryDatabase = new CairnQueryDatabase(database);
    const repository = new SqliteMemoryRepository(queryDatabase);

    await repository.create(
      createMemory({
        content: "A bug fix.",
        id: MemoryId.from("018f4f32-95d6-7d6d-9f54-2d6d7a6d9a26"),
        now: "2026-07-13T12:00:00.000Z",
        projectId: PROJECT_ID,
        scope: "project",
        title: "Fixed a race",
        topic: "bugs/race",
        type: "bugfix",
      }),
    );
    await repository.create(
      createMemory({
        content: "A preference.",
        id: MemoryId.from("018f4f32-95d6-7d6d-9f54-2d6d7a6d9a27"),
        now: "2026-07-13T12:00:00.000Z",
        projectId: null,
        scope: "personal",
        title: "Prefers concise commits",
        type: "preference",
      }),
    );

    const bugfixes = await repository.listByProject(PROJECT_ID, {
      type: "bugfix",
    });
    expect(bugfixes).toHaveLength(1);
    expect(bugfixes[0]?.title.toString()).toBe("Fixed a race");

    const personalOnly = await repository.listByProject(PROJECT_ID, {
      scope: "personal",
    });
    expect(personalOnly).toHaveLength(1);
    expect(personalOnly[0]?.title.toString()).toBe("Prefers concise commits");

    const byTopic = await repository.listByProject(PROJECT_ID, {
      topic: "bugs/race",
    });
    expect(byTopic).toHaveLength(1);
    expect(byTopic[0]?.topic).toBe("bugs/race");

    await queryDatabase.close();
  });

  test("searches memory title and content deterministically", async () => {
    const database = createDatabase();
    const queryDatabase = new CairnQueryDatabase(database);
    const repository = new SqliteMemoryRepository(queryDatabase);

    await repository.create(
      createMemory({
        content: "The auth model uses refresh tokens.",
        id: MemoryId.from("018f4f32-95d6-7d6d-9f54-2d6d7a6d9a28"),
        now: "2026-07-13T12:00:00.000Z",
        projectId: PROJECT_ID,
        scope: "project",
        title: "Auth model",
        type: "architecture",
      }),
    );
    await repository.create(
      createMemory({
        content: "Unrelated content about deployment.",
        id: MemoryId.from("018f4f32-95d6-7d6d-9f54-2d6d7a6d9a29"),
        now: "2026-07-13T12:00:00.000Z",
        projectId: PROJECT_ID,
        scope: "project",
        title: "Deployment",
        type: "config",
      }),
    );

    const results = await repository.search(PROJECT_ID, "refresh tokens");
    expect(results).toHaveLength(1);
    expect(results[0]?.title.toString()).toBe("Auth model");

    await queryDatabase.close();
  });
});
