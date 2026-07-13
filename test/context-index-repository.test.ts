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

const PROJECT_ID = "018f4f32-95d6-7d6d-9f54-1d6d7a6d9a0e";
const WORKSPACE_ID = "018f4f32-95d6-7d6d-9f54-1d6d7a6d9a10";
const SOURCE: ContextSourceConfig = {
  excludes: [],
  includes: ["**/*.md"],
  maxFileBytes: 1_000_000,
  name: "project",
  rootRelativePath: ".",
};
const temporaryDirectories: string[] = [];

function valuesFactory(values: readonly string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    if (value === undefined) {
      throw new Error("Deterministic test value sequence exhausted");
    }
    index += 1;
    return value;
  };
}

function loadedConfig(
  source: ContextSourceConfig = SOURCE,
  fingerprint = "config-hash-1",
): LoadedContextConfig {
  return {
    config: { sources: [source], version: 1 },
    fingerprint,
    path: "/projects/cairn/.cairn/context.toml",
    usesDefaults: true,
  };
}

function discoveredFile(
  relativePath: string,
  content: string,
  contentHash: string,
): DiscoveredContextFile {
  return {
    absolutePath: `/projects/cairn/${relativePath}`,
    byteSize: Buffer.byteLength(content),
    content,
    contentHash,
    relativePath,
  };
}

function createHarness(ids: readonly string[], times: readonly string[]) {
  const directory = mkdtempSync(join(tmpdir(), "cairn-context-store-"));
  temporaryDirectories.push(directory);
  const rawDatabase = openCairnDatabase(join(directory, "cairn.db"));
  registerProjectWorkspace(rawDatabase, {
    name: "Cairn",
    now: "2026-07-13T12:00:00.000Z",
    projectId: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    workspacePath: "/projects/cairn",
  });
  const database = new CairnQueryDatabase(rawDatabase);
  const repository = new SqliteContextIndexRepository(database, {
    idFactory: valuesFactory(ids),
    nowFactory: valuesFactory(times),
  });
  return { database, rawDatabase, repository };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("SQLite context index repository", () => {
  test("upserts project source configuration without changing its identity", async () => {
    const { database, rawDatabase, repository } = createHarness(
      ["source-1"],
      ["2026-07-13T13:00:00.000Z", "2026-07-13T14:00:00.000Z"],
    );
    const first = await repository.upsertSource({
      loadedConfig: loadedConfig(),
      projectId: PROJECT_ID,
      source: SOURCE,
    });
    const changedSource = { ...SOURCE, maxFileBytes: 2048 };

    const updated = await repository.upsertSource({
      loadedConfig: loadedConfig(changedSource, "config-hash-2"),
      projectId: PROJECT_ID,
      source: changedSource,
    });

    expect(first).toMatchObject({
      configHash: "config-hash-1",
      id: "source-1",
      kind: "filesystem",
    });
    expect(updated).toMatchObject({
      configHash: "config-hash-2",
      createdAt: "2026-07-13T13:00:00.000Z",
      id: "source-1",
      maxFileBytes: 2048,
      updatedAt: "2026-07-13T14:00:00.000Z",
    });
    expect(
      rawDatabase
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM context_sources",
        )
        .get(),
    ).toEqual({ count: 1 });
    await database.close();
  });

  test("lists source status in deterministic name and id order", async () => {
    const { database, repository } = createHarness(
      ["source-zeta", "source-alpha"],
      ["2026-07-13T13:00:00.000Z", "2026-07-13T14:00:00.000Z"],
    );
    const zeta = { ...SOURCE, name: "zeta" };
    const alpha = { ...SOURCE, name: "alpha" };
    await repository.upsertSource({
      loadedConfig: loadedConfig(zeta),
      projectId: PROJECT_ID,
      source: zeta,
    });
    await repository.upsertSource({
      loadedConfig: loadedConfig(alpha),
      projectId: PROJECT_ID,
      source: alpha,
    });

    const status = await repository.listStatus({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
    });

    expect(status.map(({ source }) => source.name)).toEqual(["alpha", "zeta"]);
    expect(status[0]).toMatchObject({
      activeDocumentCount: 0,
      lastRun: null,
      totalDocumentCount: 0,
      versionCount: 0,
    });
    await database.close();
  });

  test("does not version or update the search projection for an unchanged hash", async () => {
    const { database, rawDatabase, repository } = createHarness(
      ["source-1", "run-1", "document-1", "run-2"],
      [
        "2026-07-13T13:00:00.000Z",
        "2026-07-13T14:00:00.000Z",
        "2026-07-13T14:01:00.000Z",
        "2026-07-13T15:00:00.000Z",
        "2026-07-13T15:01:00.000Z",
      ],
    );
    const source = await repository.upsertSource({
      loadedConfig: loadedConfig(),
      projectId: PROJECT_ID,
      source: SOURCE,
    });
    const file = discoveredFile("README.md", "# Cairn\n", "hash-readme-1");
    await repository.applyIndex({
      files: [file],
      mode: "refresh",
      projectId: PROJECT_ID,
      skippedCount: 0,
      sourceId: source.id,
      workspaceId: WORKSPACE_ID,
    });
    const projectionBefore = rawDatabase
      .query<{ updated_at: string }, []>(
        `SELECT updated_at FROM search_entries
         WHERE entity_kind = 'context_document'`,
      )
      .get();

    const secondRun = await repository.applyIndex({
      files: [file],
      mode: "refresh",
      projectId: PROJECT_ID,
      skippedCount: 0,
      sourceId: source.id,
      workspaceId: WORKSPACE_ID,
    });

    expect(secondRun.counts).toEqual({
      added: 0,
      discovered: 1,
      errors: 0,
      removed: 0,
      skipped: 0,
      unchanged: 1,
      updated: 0,
    });
    expect(
      rawDatabase
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM context_document_versions",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      rawDatabase
        .query<{ updated_at: string }, []>(
          `SELECT updated_at FROM search_entries
           WHERE entity_kind = 'context_document'`,
        )
        .get(),
    ).toEqual(projectionBefore);
    expect(
      rawDatabase
        .query<{ source_path: string }, []>(
          `SELECT source_path FROM search_entries_fts
           WHERE search_entries_fts MATCH 'README'`,
        )
        .get(),
    ).toEqual({ source_path: "README.md" });
    await database.close();
  });

  test("versions changed and new files while deactivating absent paths", async () => {
    const { database, rawDatabase, repository } = createHarness(
      [
        "source-1",
        "run-1",
        "document-a",
        "document-b",
        "run-2",
        "document-c",
      ],
      [
        "2026-07-13T13:00:00.000Z",
        "2026-07-13T14:00:00.000Z",
        "2026-07-13T14:01:00.000Z",
        "2026-07-13T15:00:00.000Z",
        "2026-07-13T15:01:00.000Z",
      ],
    );
    const source = await repository.upsertSource({
      loadedConfig: loadedConfig(),
      projectId: PROJECT_ID,
      source: SOURCE,
    });
    await repository.applyIndex({
      files: [
        discoveredFile("a.md", "A1", "hash-a1"),
        discoveredFile("b.md", "B1", "hash-b1"),
      ],
      mode: "rebuild",
      projectId: PROJECT_ID,
      skippedCount: 1,
      sourceId: source.id,
      workspaceId: WORKSPACE_ID,
    });

    const secondRun = await repository.applyIndex({
      files: [
        discoveredFile("c.md", "C1", "hash-c1"),
        discoveredFile("a.md", "A2", "hash-a2"),
      ],
      mode: "refresh",
      projectId: PROJECT_ID,
      skippedCount: 0,
      sourceId: source.id,
      workspaceId: WORKSPACE_ID,
    });

    expect(secondRun.counts).toEqual({
      added: 1,
      discovered: 2,
      errors: 0,
      removed: 1,
      skipped: 0,
      unchanged: 0,
      updated: 1,
    });
    expect(
      rawDatabase
        .query<{ relative_path: string }, []>(
          `SELECT relative_path FROM context_documents
           WHERE active = 1 ORDER BY relative_path`,
        )
        .all(),
    ).toEqual([{ relative_path: "a.md" }, { relative_path: "c.md" }]);
    expect(
      rawDatabase
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM context_document_versions",
        )
        .get(),
    ).toEqual({ count: 4 });
    expect(
      rawDatabase
        .query<{ body: string; source_path: string }, []>(
          `SELECT body, source_path FROM search_entries
           WHERE entity_kind = 'context_document' ORDER BY source_path`,
        )
        .all(),
    ).toEqual([
      { body: "A2", source_path: "a.md" },
      { body: "C1", source_path: "c.md" },
    ]);
    await database.close();
  });

  test("keeps the prior active index and records failure status", async () => {
    const { database, rawDatabase, repository } = createHarness(
      ["source-1", "run-1", "document-1", "run-2"],
      [
        "2026-07-13T13:00:00.000Z",
        "2026-07-13T14:00:00.000Z",
        "2026-07-13T14:01:00.000Z",
        "2026-07-13T15:00:00.000Z",
        "2026-07-13T15:01:00.000Z",
      ],
    );
    const source = await repository.upsertSource({
      loadedConfig: loadedConfig(),
      projectId: PROJECT_ID,
      source: SOURCE,
    });
    await repository.applyIndex({
      files: [discoveredFile("README.md", "original", "hash-original")],
      mode: "refresh",
      projectId: PROJECT_ID,
      skippedCount: 0,
      sourceId: source.id,
      workspaceId: WORKSPACE_ID,
    });
    rawDatabase.exec(`
      CREATE TRIGGER reject_context_version
      BEFORE INSERT ON context_document_versions
      BEGIN
        SELECT RAISE(ABORT, 'forced context version failure');
      END;
    `);

    await expect(
      repository.applyIndex({
        files: [discoveredFile("README.md", "changed", "hash-changed")],
        mode: "refresh",
        projectId: PROJECT_ID,
        skippedCount: 0,
        sourceId: source.id,
        workspaceId: WORKSPACE_ID,
      }),
    ).rejects.toThrow("forced context version failure");

    expect(
      rawDatabase
        .query<{ active: number; content_hash: string }, []>(
          "SELECT active, content_hash FROM context_documents",
        )
        .get(),
    ).toEqual({ active: 1, content_hash: "hash-original" });
    expect(
      rawDatabase
        .query<{ body: string }, []>(
          `SELECT body FROM search_entries
           WHERE entity_kind = 'context_document'`,
        )
        .get(),
    ).toEqual({ body: "original" });
    const status = await repository.listStatus({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
    });
    expect(status).toHaveLength(1);
    expect(status[0]).toMatchObject({
      activeDocumentCount: 1,
      lastRun: {
        counts: { errors: 1 },
        status: "failed",
      },
      totalDocumentCount: 1,
      versionCount: 1,
    });
    await database.close();
  });
});
