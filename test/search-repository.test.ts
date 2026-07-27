import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  ContextSourceConfig,
  LoadedContextConfig,
} from "../src/context/context-config.ts";
import type { DiscoveredContextFile } from "../src/context/context-discovery.ts";
import { SqliteContextIndexRepository } from "../src/context/sqlite-context-index-repository.ts";
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

  test("surfaces indexedAt/contentHash for context rows and omits them for work/memory rows", async () => {
    const { database, insertEntry, rawDatabase, repository } = createHarness();

    const contextRepository = new SqliteContextIndexRepository(
      new CairnQueryDatabase(rawDatabase),
      {
        idFactory: (() => {
          const ids = ["source-1", "run-1", "document-a"];
          let index = 0;
          return () => {
            const id = ids[index];
            index += 1;
            if (id === undefined) {
              throw new Error("Deterministic id sequence exhausted");
            }
            return id;
          };
        })(),
        nowFactory: (() => {
          const times = [
            "2026-07-14T13:00:00.000Z",
            "2026-07-14T14:00:00.000Z",
            "2026-07-14T14:01:00.000Z",
          ];
          let index = 0;
          return () => {
            const value = times[index];
            index += 1;
            if (value === undefined) {
              throw new Error("Deterministic time sequence exhausted");
            }
            return value;
          };
        })(),
      },
    );
    const source: ContextSourceConfig = {
      excludes: [],
      includes: ["**/*.md"],
      maxFileBytes: 1_000_000,
      name: "project",
      rootRelativePath: ".",
    };
    const loadedConfig: LoadedContextConfig = {
      config: { sources: [source], version: 1 },
      fingerprint: "config-hash-1",
      path: "/projects/cairn/.cairn/context.toml",
      usesDefaults: true,
    };
    const upsertedSource = await contextRepository.upsertSource({
      loadedConfig,
      projectId: PROJECT_ID,
      source,
    });
    const file: DiscoveredContextFile = {
      absolutePath: "/projects/cairn/auth.md",
      byteSize: Buffer.byteLength("The auth flow uses refresh tokens."),
      content: "The auth flow uses refresh tokens.",
      contentHash: "hash-auth",
      relativePath: "auth.md",
    };
    await contextRepository.applyIndex({
      files: [file],
      mode: "rebuild",
      projectId: PROJECT_ID,
      skippedCount: 0,
      sourceId: upsertedSource.id,
      workspaceId: WORKSPACE_ID,
    });

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

    const matches = await repository.search({
      ftsQuery: '"auth" OR "flow"',
      kinds: undefined,
      limit: 20,
      scopes: [{ projectId: PROJECT_ID, workspaceId: WORKSPACE_ID }],
      terms: ["auth", "flow"],
    });

    expect(matches).toHaveLength(3);
    const contextMatch = matches.find(
      (match) => match.entityKind === "context_document",
    );
    expect(contextMatch).toMatchObject({
      contentHash: "hash-auth",
      indexedAt: "2026-07-14T14:00:00.000Z",
    });

    const workMatch = matches.find((match) => match.entityKind === "work_item");
    const memoryMatch = matches.find((match) => match.entityKind === "memory");
    expect(workMatch?.contentHash).toBeUndefined();
    expect(workMatch?.indexedAt).toBeUndefined();
    expect(memoryMatch?.contentHash).toBeUndefined();
    expect(memoryMatch?.indexedAt).toBeUndefined();

    await database.close();
  });
});
