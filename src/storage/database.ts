import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { MIGRATIONS } from "./migrations.ts";

type ProjectWorkspaceRegistration = Readonly<{
  name: string;
  now: string;
  projectId: string;
  workspaceId: string;
  workspacePath: string;
}>;

type WorkspaceRow = Readonly<{
  id: string;
  project_id: string;
}>;

export type DatabaseHealth = Readonly<{
  foreignKeys: boolean;
  fts5: boolean;
  integrity: string;
  schemaVersion: number;
}>;

export class WorkspaceProjectConflictError extends Error {
  override readonly name = "WorkspaceProjectConflictError";
}

function applyMigrations(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const appliedVersions = new Set(
    database
      .query<{ version: number }, []>(
        "SELECT version FROM schema_migrations ORDER BY version",
      )
      .all()
      .map(({ version }) => version),
  );

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      database
        .query<void, [number, string]>(
          `INSERT INTO schema_migrations(version, name, applied_at)
           VALUES (?, ?, datetime('now'))`,
        )
        .run(migration.version, migration.name);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

export function openCairnDatabase(databasePath: string): Database {
  mkdirSync(dirname(databasePath), { mode: 0o700, recursive: true });
  const database = new Database(databasePath, { create: true, strict: true });
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  applyMigrations(database);
  if (process.platform !== "win32") {
    chmodSync(databasePath, 0o600);
  }
  return database;
}

export function registerProjectWorkspace(
  database: Database,
  registration: ProjectWorkspaceRegistration,
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .query<void, [string, string, string, string]>(
        `INSERT INTO projects(id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           updated_at = excluded.updated_at`,
      )
      .run(
        registration.projectId,
        registration.name,
        registration.now,
        registration.now,
      );

    const existingWorkspace = database
      .query<WorkspaceRow, [string]>(
        "SELECT id, project_id FROM workspaces WHERE path = ?",
      )
      .get(registration.workspacePath);

    if (
      existingWorkspace &&
      existingWorkspace.project_id !== registration.projectId
    ) {
      throw new WorkspaceProjectConflictError(
        `Workspace is already attached to another project: ${registration.workspacePath}`,
      );
    }

    if (existingWorkspace) {
      database
        .query<void, [string, string]>(
          "UPDATE workspaces SET last_seen_at = ? WHERE path = ?",
        )
        .run(registration.now, registration.workspacePath);
    } else {
      database
        .query<void, [string, string, string, string, string]>(
          `INSERT INTO workspaces(
             id, project_id, path, first_seen_at, last_seen_at
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          registration.workspaceId,
          registration.projectId,
          registration.workspacePath,
          registration.now,
          registration.now,
        );
    }

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function getProjectWorkspaceCount(
  database: Database,
  projectId: string,
): number {
  return (
    database
      .query<{ count: number }, [string]>(
        "SELECT COUNT(*) AS count FROM workspaces WHERE project_id = ?",
      )
      .get(projectId)?.count ?? 0
  );
}

export function getWorkspaceId(
  database: Database,
  workspacePath: string,
): string | null {
  return (
    database
      .query<{ id: string }, [string]>(
        "SELECT id FROM workspaces WHERE path = ?",
      )
      .get(workspacePath)?.id ?? null
  );
}

export type RegisteredProjectWorkspace = Readonly<{
  name: string;
  projectId: string;
  workspaceId: string;
  workspacePath: string;
}>;

type RegisteredWorkspaceRow = Readonly<{
  last_seen_at: string;
  name: string;
  project_id: string;
  workspace_id: string;
  workspace_path: string;
}>;

export function listRegisteredProjectWorkspaces(
  database: Database,
): readonly RegisteredProjectWorkspace[] {
  const rows = database
    .query<RegisteredWorkspaceRow, []>(
      `SELECT p.id AS project_id, p.name AS name,
              w.id AS workspace_id, w.path AS workspace_path,
              w.last_seen_at AS last_seen_at
       FROM projects p
       JOIN workspaces w ON w.project_id = p.id`,
    )
    .all();

  const latestByProject = new Map<string, RegisteredWorkspaceRow>();
  for (const row of rows) {
    const current = latestByProject.get(row.project_id);
    if (
      current === undefined ||
      row.last_seen_at > current.last_seen_at ||
      (row.last_seen_at === current.last_seen_at &&
        row.workspace_id < current.workspace_id)
    ) {
      latestByProject.set(row.project_id, row);
    }
  }

  return [...latestByProject.values()]
    .map((row) => ({
      name: row.name,
      projectId: row.project_id,
      workspaceId: row.workspace_id,
      workspacePath: row.workspace_path,
    }))
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        (left.projectId < right.projectId ? -1 : 1),
    );
}

export function checkDatabaseHealth(database: Database): DatabaseHealth {
  const foreignKeys =
    database
      .query<{ foreign_keys: number }, []>("PRAGMA foreign_keys")
      .get()?.foreign_keys === 1;
  const integrity =
    database
      .query<{ integrity_check: string }, []>("PRAGMA integrity_check")
      .get()?.integrity_check ?? "unknown";
  const schemaVersion =
    database
      .query<{ version: number | null }, []>(
        "SELECT MAX(version) AS version FROM schema_migrations",
      )
      .get()?.version ?? 0;

  let fts5 = false;
  try {
    database
      .query<{ count: number }, []>(
        `SELECT COUNT(*) AS count
         FROM search_entries_fts
         WHERE search_entries_fts MATCH 'cairn'`,
      )
      .get();
    fts5 = true;
  } catch {
    fts5 = false;
  }

  return { foreignKeys, fts5, integrity, schemaVersion };
}
