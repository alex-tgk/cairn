import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  openCairnDatabase,
  registerProjectWorkspace,
} from "../src/storage/database.ts";
import { CairnQueryDatabase } from "../src/storage/query-database.ts";
import { SqliteSearchRepository } from "../src/search/sqlite-search-repository.ts";

const PROJECT_ID = "018f4f32-95d6-7d6d-9f54-2d6d7a6d9a0e";
const WORKSPACE_ID = "018f4f32-95d6-7d6d-9f54-2d6d7a6d9a10";
const OTHER_PROJECT_ID = "018f4f32-95d6-7d6d-9f54-3d6d7a6d9a0e";
const temporaryDirectories: string[] = [];

function createHarness() {
  const directory = mkdtempSync(join(tmpdir(), "cairn-search-store-"));
  temporaryDirectories.push(directory);
  const rawDatabase = openCairnDatabase(join(directory, "cairn.db"));
  registerProjectWorkspace(rawDatabase, {
    name: "Cairn",
    now: "2026-07-14T12:00:00.000Z",
    projectId: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    workspacePath: "/projects/cairn",
  });
  registerProjectWorkspace(rawDatabase, {
    name: "Other",
    now: "2026-07-14T12:00:00.000Z",
    projectId: OTHER_PROJECT_ID,
    workspaceId: "018f4f32-95d6-7d6d-9f54-4d6d7a6d9a10",
    workspacePath: "/projects/other",
  });
  const database = new CairnQueryDatabase(rawDatabase);
  const repository = new SqliteSearchRepository(database);

  function insertEntry(entry: {
    body: string;
    entityId: string;
    entityKind: "context_document" | "memory" | "work_item";
    projectId?: string;
    sourcePath?: string | null;
    tags?: string;
    title: string;
    workspaceId?: string | null;
  }): void {
    rawDatabase
      .query<
        void,
        [string, string, string, string | null, string, string, string, string | null, string, string]
      >(
        `INSERT INTO search_entries(
           entity_kind, entity_id, project_id, workspace_id, title, body,
           tags, source_path, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.entityKind,
        entry.entityId,
        entry.projectId ?? PROJECT_ID,
        entry.workspaceId === undefined ? null : entry.workspaceId,
        entry.title,
        entry.body,
        entry.tags ?? "",
        entry.sourcePath === undefined ? null : entry.sourcePath,
        "2026-07-14T12:00:00.000Z",
        "2026-07-14T12:00:00.000Z",
      );
  }

  return { database, insertEntry, rawDatabase, repository };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("SQLite unified search repository", () => {
  test("ranks and returns matches across work, memory, and context entity kinds", async () => {
    const { database, insertEntry, repository } = createHarness();
    insertEntry({
      body: "Fix the auth flow regression in login.",
      entityId: "work-1",
      entityKind: "work_item",
      tags: "bug open",
      title: "Fix auth flow bug",
    });
    insertEntry({
      body: "We rotate refresh tokens on every login for the auth flow.",
      entityId: "memory-1",
      entityKind: "memory",
      tags: "decision project",
      title: "Auth decision",
    });
    insertEntry({
      body: "The auth flow uses refresh tokens.",
      entityId: "doc-1",
      entityKind: "context_document",
      sourcePath: "docs/auth.md",
      tags: "project file",
      title: "docs/auth.md",
      workspaceId: WORKSPACE_ID,
    });
    insertEntry({
      body: "Deployment uses GitLab CI.",
      entityId: "doc-2",
      entityKind: "context_document",
      sourcePath: "docs/deploy.md",
      tags: "project file",
      title: "docs/deploy.md",
      workspaceId: WORKSPACE_ID,
    });

    const matches = await repository.search({
      ftsQuery: '"auth" OR "flow"',
      kinds: undefined,
      limit: 20,
      scopes: [{ projectId: PROJECT_ID, workspaceId: WORKSPACE_ID }],
      terms: ["auth", "flow"],
    });

    expect(matches).toHaveLength(3);
    expect(matches.map((match) => match.entityKind).sort()).toEqual([
      "context_document",
      "memory",
      "work_item",
    ]);
    const workMatch = matches.find((match) => match.entityKind === "work_item");
    expect(workMatch).toMatchObject({
      entityId: "work-1",
      matchedTerms: ["auth", "flow"],
      sourcePath: null,
      workspaceId: null,
    });
    const contextMatch = matches.find(
      (match) => match.entityKind === "context_document",
    );
    expect(contextMatch).toMatchObject({
      entityId: "doc-1",
      sourcePath: "docs/auth.md",
      workspaceId: WORKSPACE_ID,
    });

    await database.close();
  });

  test("filters by entity kind, limit, and scope", async () => {
    const { database, insertEntry, repository } = createHarness();
    insertEntry({
      body: "auth flow work item",
      entityId: "work-1",
      entityKind: "work_item",
      title: "Work item",
    });
    insertEntry({
      body: "auth flow memory",
      entityId: "memory-1",
      entityKind: "memory",
      title: "Memory",
    });
    insertEntry({
      body: "auth flow in another project",
      entityId: "work-2",
      entityKind: "work_item",
      projectId: OTHER_PROJECT_ID,
      title: "Other project work item",
      workspaceId: null,
    });

    const kindFiltered = await repository.search({
      ftsQuery: '"auth"',
      kinds: ["work_item"],
      limit: 20,
      scopes: [{ projectId: PROJECT_ID, workspaceId: WORKSPACE_ID }],
      terms: ["auth"],
    });
    expect(kindFiltered).toHaveLength(1);
    expect(kindFiltered[0]?.entityKind).toBe("work_item");

    const limited = await repository.search({
      ftsQuery: '"auth"',
      kinds: undefined,
      limit: 1,
      scopes: [{ projectId: PROJECT_ID, workspaceId: WORKSPACE_ID }],
      terms: ["auth"],
    });
    expect(limited).toHaveLength(1);

    const outOfScope = await repository.search({
      ftsQuery: '"auth"',
      kinds: undefined,
      limit: 20,
      scopes: [{ projectId: OTHER_PROJECT_ID, workspaceId: "unknown-workspace" }],
      terms: ["auth"],
    });
    expect(outOfScope).toHaveLength(1);
    expect(outOfScope[0]?.entityId).toBe("work-2");

    const emptyScopes = await repository.search({
      ftsQuery: '"auth"',
      kinds: undefined,
      limit: 20,
      scopes: [],
      terms: ["auth"],
    });
    expect(emptyScopes).toHaveLength(0);

    await database.close();
  });
});
