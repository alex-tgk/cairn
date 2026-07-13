import { randomUUID } from "node:crypto";

import {
  type Kysely,
  type Selectable,
} from "kysely";

import {
  type CairnDatabaseSchema,
  CairnQueryDatabase,
  type ContextDocumentTable,
  type ContextIndexRunTable,
  type ContextSourceTable,
} from "../storage/query-database.ts";
import type { DiscoveredContextFile } from "./context-discovery.ts";
import type {
  ApplyContextIndexInput,
  ContextIndexRepository,
  ContextIndexRunCounts,
  ContextIndexRunRecord,
  ContextIndexStatus,
  ContextSourceRecord,
  ListContextIndexStatusInput,
  UpsertContextSourceInput,
} from "./context-index-repository.ts";

type ContextSourceRow = Selectable<ContextSourceTable>;
type ContextDocumentRow = Selectable<ContextDocumentTable>;
type ContextIndexRunRow = Selectable<ContextIndexRunTable>;

type RepositoryFactories = Readonly<{
  idFactory: () => string;
  nowFactory: () => string;
}>;

export type SqliteContextIndexRepositoryOptions = Readonly<{
  idFactory?: (() => string) | undefined;
  nowFactory?: (() => string) | undefined;
}>;

type MutableRunCounts = {
  added: number;
  discovered: number;
  errors: number;
  removed: number;
  skipped: number;
  unchanged: number;
  updated: number;
};

export class ContextIndexInputError extends Error {
  override readonly name = "ContextIndexInputError";
}

export class ContextIndexScopeError extends Error {
  override readonly name = "ContextIndexScopeError";
}

function parseStringArray(value: string, field: string): readonly string[] {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`Invalid ${field} JSON`);
  }
  return parsed;
}

function mapSource(row: ContextSourceRow): ContextSourceRecord {
  return {
    configHash: row.config_hash,
    createdAt: row.created_at,
    excludes: parseStringArray(row.exclude_json, "context source excludes"),
    id: row.id,
    includes: parseStringArray(row.include_json, "context source includes"),
    kind: row.kind,
    maxFileBytes: row.max_file_bytes,
    name: row.name,
    projectId: row.project_id,
    rootRelativePath: row.root_relative_path,
    updatedAt: row.updated_at,
  };
}

function mapRun(row: ContextIndexRunRow): ContextIndexRunRecord {
  return {
    completedAt: row.completed_at,
    counts: {
      added: row.added_count,
      discovered: row.discovered_count,
      errors: row.error_count,
      removed: row.removed_count,
      skipped: row.skipped_count,
      unchanged: row.unchanged_count,
      updated: row.updated_count,
    },
    errors: parseStringArray(row.error_json, "context index errors"),
    id: row.id,
    mode: row.mode,
    sourceId: row.source_id,
    startedAt: row.started_at,
    status: row.status,
    workspaceId: row.workspace_id,
  };
}

function emptyCounts(input: ApplyContextIndexInput): MutableRunCounts {
  return {
    added: 0,
    discovered: input.files.length,
    errors: 0,
    removed: 0,
    skipped: input.skippedCount,
    unchanged: 0,
    updated: 0,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertIndexInput(input: ApplyContextIndexInput): void {
  if (!Number.isInteger(input.skippedCount) || input.skippedCount < 0) {
    throw new ContextIndexInputError(
      "Context skipped count must be a non-negative integer",
    );
  }
  const paths = new Set<string>();
  for (const file of input.files) {
    if (paths.has(file.relativePath)) {
      throw new ContextIndexInputError(
        `Context discovery returned a duplicate path: ${file.relativePath}`,
      );
    }
    paths.add(file.relativePath);
  }
}

function stableFiles(
  files: readonly DiscoveredContextFile[],
): readonly DiscoveredContextFile[] {
  return [...files].sort((left, right) => {
    if (left.relativePath < right.relativePath) {
      return -1;
    }
    if (left.relativePath > right.relativePath) {
      return 1;
    }
    return 0;
  });
}

export class SqliteContextIndexRepository implements ContextIndexRepository {
  private readonly factories: RepositoryFactories;

  constructor(
    private readonly database: CairnQueryDatabase,
    options: SqliteContextIndexRepositoryOptions = {},
  ) {
    this.factories = {
      idFactory: options.idFactory ?? randomUUID,
      nowFactory: options.nowFactory ?? (() => new Date().toISOString()),
    };
  }

  async upsertSource(
    input: UpsertContextSourceInput,
  ): Promise<ContextSourceRecord> {
    return this.database.immediateTransaction(async (database) => {
      const existing = await database
        .selectFrom("context_sources")
        .selectAll()
        .where("project_id", "=", input.projectId)
        .where("name", "=", input.source.name)
        .executeTakeFirst();
      const now = this.factories.nowFactory();
      if (existing) {
        const updated = await database
          .updateTable("context_sources")
          .set({
            config_hash: input.loadedConfig.fingerprint,
            exclude_json: JSON.stringify(input.source.excludes),
            include_json: JSON.stringify(input.source.includes),
            kind: "filesystem",
            max_file_bytes: input.source.maxFileBytes,
            root_relative_path: input.source.rootRelativePath,
            updated_at: now,
          })
          .where("id", "=", existing.id)
          .returningAll()
          .executeTakeFirstOrThrow();
        return mapSource(updated);
      }

      const created = await database
        .insertInto("context_sources")
        .values({
          config_hash: input.loadedConfig.fingerprint,
          created_at: now,
          exclude_json: JSON.stringify(input.source.excludes),
          id: this.factories.idFactory(),
          include_json: JSON.stringify(input.source.includes),
          kind: "filesystem",
          max_file_bytes: input.source.maxFileBytes,
          name: input.source.name,
          project_id: input.projectId,
          root_relative_path: input.source.rootRelativePath,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return mapSource(created);
    });
  }

  async applyIndex(
    input: ApplyContextIndexInput,
  ): Promise<ContextIndexRunRecord> {
    assertIndexInput(input);
    const source = await this.requireScope(input);
    const runId = this.factories.idFactory();
    const startedAt = this.factories.nowFactory();
    await this.insertRunningRun(input, runId, startedAt);

    try {
      return await this.database.immediateTransaction(async (database) => {
        const counts = await this.reconcileDocuments(
          database,
          input,
          source,
          startedAt,
        );
        const completedAt = this.factories.nowFactory();
        const run = await this.updateSucceededRun(
          database,
          runId,
          completedAt,
          counts,
        );
        return mapRun(run);
      });
    } catch (error) {
      await this.updateFailedRun(input, runId, error);
      throw error;
    }
  }

  async listStatus(
    input: ListContextIndexStatusInput,
  ): Promise<readonly ContextIndexStatus[]> {
    await this.requireWorkspace(input.projectId, input.workspaceId);
    const sources = await this.database.queries
      .selectFrom("context_sources")
      .selectAll()
      .where("project_id", "=", input.projectId)
      .orderBy("name", "asc")
      .orderBy("id", "asc")
      .execute();
    const statuses: ContextIndexStatus[] = [];
    for (const source of sources) {
      statuses.push(await this.sourceStatus(source, input.workspaceId));
    }
    return statuses;
  }

  private async requireScope(
    input: ApplyContextIndexInput,
  ): Promise<ContextSourceRow> {
    const source = await this.database.queries
      .selectFrom("context_sources")
      .selectAll()
      .where("id", "=", input.sourceId)
      .where("project_id", "=", input.projectId)
      .executeTakeFirst();
    if (!source) {
      throw new ContextIndexScopeError(
        `Context source not found in project: ${input.sourceId}`,
      );
    }
    await this.requireWorkspace(input.projectId, input.workspaceId);
    return source;
  }

  private async requireWorkspace(
    projectId: string,
    workspaceId: string,
  ): Promise<void> {
    const workspace = await this.database.queries
      .selectFrom("workspaces")
      .select("id")
      .where("id", "=", workspaceId)
      .where("project_id", "=", projectId)
      .executeTakeFirst();
    if (!workspace) {
      throw new ContextIndexScopeError(
        `Context workspace not found in project: ${workspaceId}`,
      );
    }
  }

  private async insertRunningRun(
    input: ApplyContextIndexInput,
    runId: string,
    startedAt: string,
  ): Promise<void> {
    await this.database.queries
      .insertInto("context_index_runs")
      .values({
        added_count: 0,
        completed_at: null,
        discovered_count: input.files.length,
        error_count: 0,
        error_json: "[]",
        id: runId,
        mode: input.mode,
        removed_count: 0,
        skipped_count: input.skippedCount,
        source_id: input.sourceId,
        started_at: startedAt,
        status: "running",
        unchanged_count: 0,
        updated_count: 0,
        workspace_id: input.workspaceId,
      })
      .execute();
  }

  private async reconcileDocuments(
    database: Kysely<CairnDatabaseSchema>,
    input: ApplyContextIndexInput,
    source: ContextSourceRow,
    indexedAt: string,
  ): Promise<ContextIndexRunCounts> {
    const existing = await database
      .selectFrom("context_documents")
      .selectAll()
      .where("source_id", "=", input.sourceId)
      .where("workspace_id", "=", input.workspaceId)
      .execute();
    const byPath = new Map(existing.map((row) => [row.relative_path, row]));
    const seenPaths = new Set<string>();
    const counts = emptyCounts(input);

    for (const file of stableFiles(input.files)) {
      seenPaths.add(file.relativePath);
      const document = byPath.get(file.relativePath);
      if (!document) {
        await this.insertDocument(database, input, source, file, indexedAt);
        counts.added += 1;
        continue;
      }
      if (document.active === 1 && document.content_hash === file.contentHash) {
        await database
          .updateTable("context_documents")
          .set({ last_seen_at: indexedAt })
          .where("id", "=", document.id)
          .execute();
        counts.unchanged += 1;
        continue;
      }
      await this.updateDocument(database, input, source, document, file, indexedAt);
      counts.updated += 1;
    }

    for (const document of existing) {
      if (document.active === 0 || seenPaths.has(document.relative_path)) {
        continue;
      }
      await this.deactivateDocument(database, document.id, indexedAt);
      counts.removed += 1;
    }
    return counts;
  }

  private async insertDocument(
    database: Kysely<CairnDatabaseSchema>,
    input: ApplyContextIndexInput,
    source: ContextSourceRow,
    file: DiscoveredContextFile,
    indexedAt: string,
  ): Promise<void> {
    const documentId = this.factories.idFactory();
    const tags = [source.name];
    await database
      .insertInto("context_documents")
      .values({
        active: 1,
        byte_size: file.byteSize,
        content_hash: file.contentHash,
        first_indexed_at: indexedAt,
        id: documentId,
        kind: "file",
        last_seen_at: indexedAt,
        project_id: input.projectId,
        relative_path: file.relativePath,
        source_id: input.sourceId,
        tags_json: JSON.stringify(tags),
        title: file.relativePath,
        updated_at: indexedAt,
        workspace_id: input.workspaceId,
      })
      .execute();
    await this.insertVersion(database, documentId, file, indexedAt);
    await this.upsertProjection(
      database,
      input,
      source,
      documentId,
      file,
      indexedAt,
      indexedAt,
    );
  }

  private async updateDocument(
    database: Kysely<CairnDatabaseSchema>,
    input: ApplyContextIndexInput,
    source: ContextSourceRow,
    document: ContextDocumentRow,
    file: DiscoveredContextFile,
    indexedAt: string,
  ): Promise<void> {
    if (document.content_hash !== file.contentHash) {
      await this.insertVersion(database, document.id, file, indexedAt);
    }
    await database
      .updateTable("context_documents")
      .set({
        active: 1,
        byte_size: file.byteSize,
        content_hash: file.contentHash,
        kind: "file",
        last_seen_at: indexedAt,
        tags_json: JSON.stringify([source.name]),
        title: file.relativePath,
        updated_at: indexedAt,
      })
      .where("id", "=", document.id)
      .execute();
    await this.upsertProjection(
      database,
      input,
      source,
      document.id,
      file,
      document.first_indexed_at,
      indexedAt,
    );
  }

  private async insertVersion(
    database: Kysely<CairnDatabaseSchema>,
    documentId: string,
    file: DiscoveredContextFile,
    indexedAt: string,
  ): Promise<void> {
    await database
      .insertInto("context_document_versions")
      .values({
        byte_size: file.byteSize,
        content: file.content,
        content_hash: file.contentHash,
        document_id: documentId,
        indexed_at: indexedAt,
      })
      .onConflict((conflict) =>
        conflict.columns(["document_id", "content_hash"]).doNothing(),
      )
      .execute();
  }

  private async upsertProjection(
    database: Kysely<CairnDatabaseSchema>,
    input: ApplyContextIndexInput,
    source: ContextSourceRow,
    documentId: string,
    file: DiscoveredContextFile,
    createdAt: string,
    updatedAt: string,
  ): Promise<void> {
    await database
      .insertInto("search_entries")
      .values({
        body: file.content,
        created_at: createdAt,
        entity_id: documentId,
        entity_kind: "context_document",
        project_id: input.projectId,
        source_path: file.relativePath,
        tags: `${source.name} file`,
        title: file.relativePath,
        updated_at: updatedAt,
        workspace_id: input.workspaceId,
      })
      .onConflict((conflict) =>
        conflict.columns(["entity_kind", "entity_id"]).doUpdateSet({
          body: file.content,
          project_id: input.projectId,
          source_path: file.relativePath,
          tags: `${source.name} file`,
          title: file.relativePath,
          updated_at: updatedAt,
          workspace_id: input.workspaceId,
        }),
      )
      .execute();
  }

  private async deactivateDocument(
    database: Kysely<CairnDatabaseSchema>,
    documentId: string,
    updatedAt: string,
  ): Promise<void> {
    await database
      .updateTable("context_documents")
      .set({ active: 0, updated_at: updatedAt })
      .where("id", "=", documentId)
      .execute();
    await database
      .deleteFrom("search_entries")
      .where("entity_kind", "=", "context_document")
      .where("entity_id", "=", documentId)
      .execute();
  }

  private async updateSucceededRun(
    database: Kysely<CairnDatabaseSchema>,
    runId: string,
    completedAt: string,
    counts: ContextIndexRunCounts,
  ): Promise<ContextIndexRunRow> {
    return await database
      .updateTable("context_index_runs")
      .set({
        added_count: counts.added,
        completed_at: completedAt,
        discovered_count: counts.discovered,
        error_count: counts.errors,
        error_json: "[]",
        removed_count: counts.removed,
        skipped_count: counts.skipped,
        status: "succeeded",
        unchanged_count: counts.unchanged,
        updated_count: counts.updated,
      })
      .where("id", "=", runId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  private async updateFailedRun(
    input: ApplyContextIndexInput,
    runId: string,
    error: unknown,
  ): Promise<void> {
    const message = errorMessage(error);
    await this.database.queries
      .updateTable("context_index_runs")
      .set({
        added_count: 0,
        completed_at: this.factories.nowFactory(),
        discovered_count: input.files.length,
        error_count: 1,
        error_json: JSON.stringify([message]),
        removed_count: 0,
        skipped_count: input.skippedCount,
        status: "failed",
        unchanged_count: 0,
        updated_count: 0,
      })
      .where("id", "=", runId)
      .execute();
  }

  private async sourceStatus(
    source: ContextSourceRow,
    workspaceId: string,
  ): Promise<ContextIndexStatus> {
    const totalDocumentCount = await this.documentCount(
      source.id,
      workspaceId,
    );
    const activeDocumentCount = await this.documentCount(
      source.id,
      workspaceId,
      1,
    );
    const versionCount = await this.versionCount(source.id, workspaceId);
    const lastRun = await this.database.queries
      .selectFrom("context_index_runs")
      .selectAll()
      .where("source_id", "=", source.id)
      .where("workspace_id", "=", workspaceId)
      .orderBy("started_at", "desc")
      .orderBy("id", "desc")
      .executeTakeFirst();
    return {
      activeDocumentCount,
      lastRun: lastRun ? mapRun(lastRun) : null,
      source: mapSource(source),
      totalDocumentCount,
      versionCount,
      workspaceId,
    };
  }

  private async documentCount(
    sourceId: string,
    workspaceId: string,
    active?: 0 | 1,
  ): Promise<number> {
    let query = this.database.queries
      .selectFrom("context_documents")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("source_id", "=", sourceId)
      .where("workspace_id", "=", workspaceId);
    if (active !== undefined) {
      query = query.where("active", "=", active);
    }
    return (await query.executeTakeFirstOrThrow()).count;
  }

  private async versionCount(
    sourceId: string,
    workspaceId: string,
  ): Promise<number> {
    const row = await this.database.queries
      .selectFrom("context_document_versions as version")
      .innerJoin("context_documents as document", "document.id", "version.document_id")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("document.source_id", "=", sourceId)
      .where("document.workspace_id", "=", workspaceId)
      .executeTakeFirstOrThrow();
    return row.count;
  }
}
