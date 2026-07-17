import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkDatabaseHealth,
  getProjectWorkspaceCount,
  openCairnDatabase,
  registerProjectWorkspace,
} from "../src/storage/database.ts";
import { MIGRATIONS } from "../src/storage/migrations.ts";

const PROJECT_ID = "018f4f32-95d6-7d6d-9f54-1d6d7a6d9a0e";
const NOW = "2026-07-12T12:00:00.000Z";
const temporaryDirectories: string[] = [];

function createDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "cairn-storage-"));
  temporaryDirectories.push(directory);
  return join(directory, "cairn.db");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("Cairn SQLite storage", () => {
  test("applies migrations and verifies SQLite health", () => {
    const database = openCairnDatabase(createDatabasePath());

    expect(checkDatabaseHealth(database)).toEqual({
      foreignKeys: true,
      fts5: true,
      integrity: "ok",
      schemaVersion: 8,
    });

    database.close();
  });

  test("upgrades an existing version 1 database without rebuilding it", () => {
    const databasePath = createDatabasePath();
    const versionOne = MIGRATIONS[0];
    if (!versionOne) {
      throw new Error("Cairn migration 1 is missing");
    }
    const originalDatabase = new Database(databasePath, {
      create: true,
      strict: true,
    });
    originalDatabase.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    originalDatabase.exec(versionOne.sql);
    originalDatabase
      .query<void, [number, string]>(
        `INSERT INTO schema_migrations(version, name, applied_at)
         VALUES (?, ?, '2026-07-12T12:00:00.000Z')`,
      )
      .run(versionOne.version, versionOne.name);
    originalDatabase.close();

    const upgradedDatabase = openCairnDatabase(databasePath);

    expect(checkDatabaseHealth(upgradedDatabase).schemaVersion).toBe(8);
    expect(
      upgradedDatabase
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'work_items'",
        )
        .get(),
    ).toEqual({ name: "work_items" });
    upgradedDatabase.close();
  });

  test("upgrades version 2 work history and allocates the complete work schema", () => {
    const databasePath = createDatabasePath();
    const versionOne = MIGRATIONS[0];
    const versionTwo = MIGRATIONS[1];
    if (!versionOne || !versionTwo) {
      throw new Error("Cairn work migrations are missing");
    }
    const originalDatabase = new Database(databasePath, {
      create: true,
      strict: true,
    });
    originalDatabase.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    originalDatabase.exec(versionOne.sql);
    originalDatabase.exec(versionTwo.sql);
    originalDatabase
      .query<void, [number, string, number, string]>(
        `INSERT INTO schema_migrations(version, name, applied_at)
         VALUES (?, ?, '${NOW}'), (?, ?, '${NOW}')`,
      )
      .run(
        versionOne.version,
        versionOne.name,
        versionTwo.version,
        versionTwo.name,
      );
    originalDatabase
      .query<void, [string, string, string, string]>(
        `INSERT INTO projects(id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(PROJECT_ID, "Cairn", NOW, NOW);
    originalDatabase
      .query<void, [string, string, string, string, string]>(
        `INSERT INTO work_items(
           id, project_id, title, status, assignee, created_at, updated_at,
           claimed_at
         ) VALUES ('018f4f32-95d6-7d6d-9f54-1d6d7a6d9a20', ?, ?,
                   'in_progress', 'agent-codex', ?, ?, ?)`,
      )
      .run(PROJECT_ID, "Existing work", NOW, NOW, NOW);
    originalDatabase.exec(`
      INSERT INTO work_item_events(
        work_item_id, event_type, payload_json, created_at
      ) VALUES
        ('018f4f32-95d6-7d6d-9f54-1d6d7a6d9a20', 'created', '{}', '${NOW}'),
        ('018f4f32-95d6-7d6d-9f54-1d6d7a6d9a20', 'claimed', '{}',
         '2026-07-12T13:00:00.000Z');
    `);
    originalDatabase.close();

    const upgradedDatabase = openCairnDatabase(databasePath);

    expect(checkDatabaseHealth(upgradedDatabase).schemaVersion).toBe(8);
    expect(
      upgradedDatabase
        .query<{ notes: string; revision: number }, []>(
          "SELECT notes, revision FROM work_items",
        )
        .get(),
    ).toEqual({ notes: "", revision: 2 });
    expect(
      upgradedDatabase
        .query<{ revision: number }, []>(
          "SELECT revision FROM work_item_events ORDER BY id",
        )
        .all(),
    ).toEqual([{ revision: 1 }, { revision: 2 }]);
    expect(
      upgradedDatabase
        .query<{ name: string }, []>(
          `SELECT name FROM sqlite_schema
           WHERE type = 'table'
             AND name IN (
               'work_item_hierarchy', 'work_item_dependencies',
               'work_item_labels', 'work_item_comments'
             )
           ORDER BY name`,
        )
        .all()
        .map(({ name }) => name),
    ).toEqual([
      "work_item_comments",
      "work_item_dependencies",
      "work_item_hierarchy",
      "work_item_labels",
    ]);
    upgradedDatabase.close();
  });

  test("upgrades context storage and preserves existing FTS projections", () => {
    const databasePath = createDatabasePath();
    const originalDatabase = new Database(databasePath, {
      create: true,
      strict: true,
    });
    originalDatabase.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    for (const migration of MIGRATIONS.filter(({ version }) => version <= 2)) {
      originalDatabase.exec(migration.sql);
      originalDatabase
        .query<void, [number, string]>(
          `INSERT INTO schema_migrations(version, name, applied_at)
           VALUES (?, ?, '2026-07-12T12:00:00.000Z')`,
        )
        .run(migration.version, migration.name);
    }
    originalDatabase
      .query<void, [string, string]>(
        `INSERT INTO projects(id, name, created_at, updated_at)
         VALUES (?, ?, '2026-07-12T12:00:00.000Z', '2026-07-12T12:00:00.000Z')`,
      )
      .run(PROJECT_ID, "Cairn");
    originalDatabase
      .query<void, [string, string, string, string, string]>(
        `INSERT INTO search_entries(
           entity_kind, entity_id, project_id, title, body, tags,
           created_at, updated_at
         ) VALUES ('work_item', ?, ?, ?, ?, ?,
                   '2026-07-12T12:00:00.000Z', '2026-07-12T12:00:00.000Z')`,
      )
      .run(
        "work-existing",
        PROJECT_ID,
        "Existing work projection",
        "Preserve this searchable body",
        "task open p2",
      );
    originalDatabase.close();

    const upgradedDatabase = openCairnDatabase(databasePath);

    expect(checkDatabaseHealth(upgradedDatabase).schemaVersion).toBe(8);
    expect(
      upgradedDatabase
        .query<{ name: string }, []>(
          `SELECT name FROM sqlite_schema
           WHERE type = 'table' AND name = 'context_document_versions'`,
        )
        .get(),
    ).toEqual({ name: "context_document_versions" });
    expect(
      upgradedDatabase
        .query<{ title: string }, []>(
          `SELECT title FROM search_entries_fts
           WHERE search_entries_fts MATCH 'searchable'`,
        )
        .get(),
    ).toEqual({ title: "Existing work projection" });
    expect(
      upgradedDatabase
        .query<{ name: string }, []>("PRAGMA table_info(search_entries_fts)")
        .all()
        .map(({ name }) => name),
    ).toEqual(["title", "body", "tags", "source_path"]);
    upgradedDatabase.close();
  });

  test("registers one logical project across multiple workspace paths", () => {
    const database = openCairnDatabase(createDatabasePath());

    registerProjectWorkspace(database, {
      name: "Cairn",
      now: NOW,
      projectId: PROJECT_ID,
      workspaceId: "018f4f32-95d6-7d6d-9f54-1d6d7a6d9a10",
      workspacePath: "/projects/brainstorm",
    });
    registerProjectWorkspace(database, {
      name: "Cairn",
      now: NOW,
      projectId: PROJECT_ID,
      workspaceId: "018f4f32-95d6-7d6d-9f54-1d6d7a6d9a11",
      workspacePath: "/projects/cairn",
    });

    expect(getProjectWorkspaceCount(database, PROJECT_ID)).toBe(2);
    database.close();
  });

  test("updates an existing workspace instead of duplicating it", () => {
    const database = openCairnDatabase(createDatabasePath());
    const workspace = {
      name: "Cairn",
      now: NOW,
      projectId: PROJECT_ID,
      workspaceId: "018f4f32-95d6-7d6d-9f54-1d6d7a6d9a10",
      workspacePath: "/projects/cairn",
    } as const;

    registerProjectWorkspace(database, workspace);
    registerProjectWorkspace(database, {
      ...workspace,
      now: "2026-07-12T13:00:00.000Z",
    });

    expect(getProjectWorkspaceCount(database, PROJECT_ID)).toBe(1);
    database.close();
  });

  test("migration 8 reclassifies project-scoped preferences to personal and preserves the projection", () => {
    const databasePath = createDatabasePath();
    const seed = new Database(databasePath, { create: true, strict: true });
    seed.exec("PRAGMA foreign_keys = ON");
    seed.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    for (const migration of MIGRATIONS.filter(({ version }) => version <= 7)) {
      seed.exec(migration.sql);
      seed
        .query<void, [number, string]>(
          `INSERT INTO schema_migrations(version, name, applied_at)
           VALUES (?, ?, '${NOW}')`,
        )
        .run(migration.version, migration.name);
    }
    seed
      .query<void, [string, string]>(
        `INSERT INTO projects(id, name, created_at, updated_at)
         VALUES (?, ?, '${NOW}', '${NOW}')`,
      )
      .run(PROJECT_ID, "Cairn");

    // A project-scoped preference that should be reclassified.
    seed.exec(`
      INSERT INTO memories(id, scope, project_id, type, topic, title, content,
        revision, created_at, updated_at)
      VALUES ('mem-proj-pref', 'project', '${PROJECT_ID}', 'preference',
        'workflow/tmux', 'Prefers tmux', 'Runs everything in tmux', 1,
        '${NOW}', '${NOW}');
      INSERT INTO memory_events(memory_id, event_type, payload_json, revision, created_at)
      VALUES ('mem-proj-pref', 'created', '{}', 1, '${NOW}');
      INSERT INTO search_entries(entity_kind, entity_id, project_id, title, body,
        tags, created_at, updated_at)
      VALUES ('memory', 'mem-proj-pref', '${PROJECT_ID}', 'Prefers tmux',
        'Runs everything in tmux', 'preference project workflow/tmux',
        '${NOW}', '${NOW}');
    `);

    // An already-personal preference that must be left untouched.
    seed.exec(`
      INSERT INTO memories(id, scope, project_id, type, topic, title, content,
        revision, created_at, updated_at)
      VALUES ('mem-personal-pref', 'personal', NULL, 'preference',
        'style/verbose', 'Prefers verbose logs', 'Wants verbose logging', 1,
        '${NOW}', '${NOW}');
      INSERT INTO memory_events(memory_id, event_type, payload_json, revision, created_at)
      VALUES ('mem-personal-pref', 'created', '{}', 1, '${NOW}');
      INSERT INTO search_entries(entity_kind, entity_id, project_id, title, body,
        tags, created_at, updated_at)
      VALUES ('memory', 'mem-personal-pref', NULL, 'Prefers verbose logs',
        'Wants verbose logging', 'preference personal style/verbose',
        '${NOW}', '${NOW}');
    `);

    // A project-scoped decision that must NOT be reclassified.
    seed.exec(`
      INSERT INTO memories(id, scope, project_id, type, topic, title, content,
        revision, created_at, updated_at)
      VALUES ('mem-decision', 'project', '${PROJECT_ID}', 'decision', NULL,
        'Chose SQLite', 'SQLite is the store', 1, '${NOW}', '${NOW}');
      INSERT INTO memory_events(memory_id, event_type, payload_json, revision, created_at)
      VALUES ('mem-decision', 'created', '{}', 1, '${NOW}');
      INSERT INTO search_entries(entity_kind, entity_id, project_id, title, body,
        tags, created_at, updated_at)
      VALUES ('memory', 'mem-decision', '${PROJECT_ID}', 'Chose SQLite',
        'SQLite is the store', 'decision project', '${NOW}', '${NOW}');
    `);
    seed.close();

    const upgraded = openCairnDatabase(databasePath);
    expect(checkDatabaseHealth(upgraded).schemaVersion).toBe(8);

    const reclassified = upgraded
      .query<
        { project_id: string | null; revision: number; scope: string },
        []
      >("SELECT scope, project_id, revision FROM memories WHERE id = 'mem-proj-pref'")
      .get();
    expect(reclassified).toEqual({ project_id: null, revision: 2, scope: "personal" });

    const reclassifiedEvents = upgraded
      .query<{ event_type: string; revision: number }, []>(
        "SELECT event_type, revision FROM memory_events WHERE memory_id = 'mem-proj-pref' ORDER BY revision",
      )
      .all();
    expect(reclassifiedEvents).toEqual([
      { event_type: "created", revision: 1 },
      { event_type: "updated", revision: 2 },
    ]);

    const reclassifiedProjection = upgraded
      .query<{ project_id: string | null; tags: string }, []>(
        "SELECT project_id, tags FROM search_entries WHERE entity_id = 'mem-proj-pref'",
      )
      .get();
    expect(reclassifiedProjection).toEqual({
      project_id: null,
      tags: "preference personal workflow/tmux",
    });

    // Untouched already-personal preference.
    const personal = upgraded
      .query<{ revision: number; scope: string }, []>(
        "SELECT scope, revision FROM memories WHERE id = 'mem-personal-pref'",
      )
      .get();
    expect(personal).toEqual({ revision: 1, scope: "personal" });
    expect(
      upgraded
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM memory_events WHERE memory_id = 'mem-personal-pref'",
        )
        .get()?.count,
    ).toBe(1);
    expect(
      upgraded
        .query<{ tags: string }, []>(
          "SELECT tags FROM search_entries WHERE entity_id = 'mem-personal-pref'",
        )
        .get()?.tags,
    ).toBe("preference personal style/verbose");

    // Untouched non-preference project memory.
    const decision = upgraded
      .query<
        { project_id: string | null; revision: number; scope: string },
        []
      >("SELECT scope, project_id, revision FROM memories WHERE id = 'mem-decision'")
      .get();
    expect(decision).toEqual({
      project_id: PROJECT_ID,
      revision: 1,
      scope: "project",
    });

    upgraded.close();
  });
});
