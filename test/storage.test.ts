import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkDatabaseHealth,
  getProjectWorkspaceCount,
  openCairnDatabase,
  registerProjectWorkspace,
} from "../src/storage/database.ts";

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
      schemaVersion: 1,
    });

    database.close();
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
});
