import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  openCairnDatabase,
  registerProjectWorkspace,
} from "../src/storage/database.ts";
import {
  claimWorkItem,
  createWorkItem,
  WorkItemId,
} from "../src/work/work-item.ts";
import { SqliteWorkItemRepository } from "../src/work/sqlite-work-item-repository.ts";

const PROJECT_ID = "018f4f32-95d6-7d6d-9f54-1d6d7a6d9a0e";
const OTHER_PROJECT_ID = "018f4f32-95d6-7d6d-9f54-1d6d7a6d9a0f";
const temporaryDirectories: string[] = [];

function createDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "cairn-work-store-"));
  temporaryDirectories.push(directory);
  const database = openCairnDatabase(join(directory, "cairn.db"));

  registerProjectWorkspace(database, {
    name: "Cairn",
    now: "2026-07-12T12:00:00.000Z",
    projectId: PROJECT_ID,
    workspaceId: "018f4f32-95d6-7d6d-9f54-1d6d7a6d9a10",
    workspacePath: "/projects/cairn",
  });
  registerProjectWorkspace(database, {
    name: "Other",
    now: "2026-07-12T12:00:00.000Z",
    projectId: OTHER_PROJECT_ID,
    workspaceId: "018f4f32-95d6-7d6d-9f54-1d6d7a6d9a11",
    workspacePath: "/projects/other",
  });

  return database;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("SQLite work-item repository", () => {
  test("creates a work item with an audit event and search projection", () => {
    const database = createDatabase();
    const repository = new SqliteWorkItemRepository(database);
    const item = createWorkItem({
      description: "Build the first usable work command.",
      id: WorkItemId.from("018f4f32-95d6-7d6d-9f54-1d6d7a6d9a20"),
      now: "2026-07-12T13:00:00.000Z",
      priority: 1,
      projectId: PROJECT_ID,
      title: "Create work tracking",
      type: "feature",
    });

    repository.create(item);

    expect(repository.findById(PROJECT_ID, item.id)).toEqual(item);
    expect(
      database
        .query<{ event_type: string }, []>(
          "SELECT event_type FROM work_item_events",
        )
        .get(),
    ).toEqual({ event_type: "created" });
    expect(
      database
        .query<{ title: string }, []>(
          "SELECT title FROM search_entries WHERE entity_kind = 'work_item'",
        )
        .get(),
    ).toEqual({ title: "Create work tracking" });
    expect(
      database
        .query<{ title: string }, []>(
          "SELECT title FROM search_entries_fts WHERE search_entries_fts MATCH 'tracking'",
        )
        .get(),
    ).toEqual({ title: "Create work tracking" });
    database.close();
  });

  test("lists one project's work by priority, creation time, and id", () => {
    const database = createDatabase();
    const repository = new SqliteWorkItemRepository(database);
    const fixtures = [
      createWorkItem({
        id: WorkItemId.from("work-b"),
        now: "2026-07-12T14:00:00.000Z",
        priority: 2,
        projectId: PROJECT_ID,
        title: "Second priority",
      }),
      createWorkItem({
        id: WorkItemId.from("work-a"),
        now: "2026-07-12T13:00:00.000Z",
        priority: 1,
        projectId: PROJECT_ID,
        title: "First priority",
      }),
      createWorkItem({
        id: WorkItemId.from("work-other"),
        now: "2026-07-12T12:00:00.000Z",
        priority: 0,
        projectId: OTHER_PROJECT_ID,
        title: "Other project",
      }),
    ];

    for (const item of fixtures) {
      repository.create(item);
    }

    expect(
      repository.listByProject(PROJECT_ID).map(({ id }) => id.toString()),
    ).toEqual(["work-a", "work-b"]);
    expect(
      repository.findById(PROJECT_ID, WorkItemId.from("work-other")),
    ).toBeNull();
    database.close();
  });

  test("persists lifecycle changes and returns their audit history", () => {
    const database = createDatabase();
    const repository = new SqliteWorkItemRepository(database);
    const item = createWorkItem({
      id: WorkItemId.from("work-lifecycle"),
      now: "2026-07-12T13:00:00.000Z",
      projectId: PROJECT_ID,
      title: "Preserve lifecycle history",
    });
    repository.create(item);
    const claimed = claimWorkItem(
      item,
      "agent-codex",
      "2026-07-12T14:00:00.000Z",
    );

    repository.applyTransition(claimed);

    expect(repository.findById(PROJECT_ID, item.id)).toMatchObject({
      assignee: "agent-codex",
      status: "in_progress",
    });
    expect(repository.listEvents(PROJECT_ID, item.id)).toEqual([
      {
        createdAt: "2026-07-12T13:00:00.000Z",
        eventType: "created",
        id: 1,
        payload: { priority: 2, status: "open", type: "task" },
        workItemId: "work-lifecycle",
      },
      {
        createdAt: "2026-07-12T14:00:00.000Z",
        eventType: "claimed",
        id: 2,
        payload: { assignee: "agent-codex", status: "in_progress" },
        workItemId: "work-lifecycle",
      },
    ]);
    expect(
      database
        .query<{ tags: string }, [string]>(
          "SELECT tags FROM search_entries WHERE entity_id = ?",
        )
        .get(item.id.toString()),
    ).toEqual({ tags: "task in_progress p2" });
    database.close();
  });
});
