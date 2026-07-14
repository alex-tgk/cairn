import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { ContextConfigError } from "../src/context/context-config.ts";
import { ContextDiscoveryError } from "../src/context/context-discovery.ts";
import type {
  ApplyContextIndexInput,
  ContextIndexRepository,
  ContextIndexRunCounts,
  ContextIndexRunRecord,
  ContextIndexStatus,
  ContextSearchMatch,
  ContextSourceRecord,
  ListContextIndexStatusInput,
  UpsertContextSourceInput,
} from "../src/context/context-index-repository.ts";
import {
  getContextIndexStatus,
  indexContext,
} from "../src/context/context-service.ts";

const PROJECT_ID = "018f4f32-95d6-7d6d-9f54-1d6d7a6d9a0e";
const WORKSPACE_ID = "018f4f32-95d6-7d6d-9f54-1d6d7a6d9a0f";
const NOW = "2026-07-13T12:00:00.000Z";
const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "cairn-context-service-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeWorkspaceFile(
  workspace: string,
  relativePath: string,
  content: string | Uint8Array,
): void {
  const path = join(workspace, ...relativePath.split("/"));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function sourceRecord(
  name: string,
  overrides: Partial<ContextSourceRecord> = {},
): ContextSourceRecord {
  return {
    configHash: `hash-${name}`,
    createdAt: NOW,
    excludes: [],
    id: `source-${name}`,
    includes: ["**/*.md"],
    kind: "filesystem",
    maxFileBytes: 1_000_000,
    name,
    projectId: PROJECT_ID,
    rootRelativePath: ".",
    updatedAt: NOW,
    ...overrides,
  };
}

function runRecord(
  sourceName: string,
  counts: ContextIndexRunCounts,
  status: ContextIndexRunRecord["status"] = "succeeded",
): ContextIndexRunRecord {
  return {
    completedAt: NOW,
    counts,
    errors: status === "failed" ? ["index failed"] : [],
    id: `run-${sourceName}`,
    mode: "refresh",
    sourceId: `source-${sourceName}`,
    startedAt: NOW,
    status,
    workspaceId: WORKSPACE_ID,
  };
}

const ZERO_COUNTS: ContextIndexRunCounts = {
  added: 0,
  discovered: 0,
  errors: 0,
  removed: 0,
  skipped: 0,
  unchanged: 0,
  updated: 0,
};

class FakeContextIndexRepository implements ContextIndexRepository {
  readonly applyInputs: ApplyContextIndexInput[] = [];
  readonly events: string[] = [];
  readonly upsertInputs: UpsertContextSourceInput[] = [];
  private readonly sourceNamesById = new Map<string, string>();

  constructor(
    private readonly countsBySource: Readonly<
      Record<string, ContextIndexRunCounts>
    > = {},
    private readonly statuses: readonly ContextIndexStatus[] = [],
  ) {}

  async upsertSource(
    input: UpsertContextSourceInput,
  ): Promise<ContextSourceRecord> {
    this.events.push(`upsert:${input.source.name}`);
    this.upsertInputs.push(input);
    const record = sourceRecord(input.source.name, {
      configHash: input.loadedConfig.fingerprint,
      excludes: input.source.excludes,
      includes: input.source.includes,
      maxFileBytes: input.source.maxFileBytes,
      rootRelativePath: input.source.rootRelativePath,
    });
    this.sourceNamesById.set(record.id, record.name);
    return record;
  }

  async applyIndex(
    input: ApplyContextIndexInput,
  ): Promise<ContextIndexRunRecord> {
    const sourceName = this.sourceNamesById.get(input.sourceId) ?? input.sourceId;
    this.events.push(`apply:${sourceName}:${input.mode}`);
    this.applyInputs.push(input);
    const counts = this.countsBySource[sourceName] ?? {
      ...ZERO_COUNTS,
      added: input.files.length,
      discovered: input.files.length,
      skipped: input.skippedCount,
    };
    return {
      ...runRecord(sourceName, counts),
      mode: input.mode,
      sourceId: input.sourceId,
      workspaceId: input.workspaceId,
    };
  }

  async listStatus(
    _input: ListContextIndexStatusInput,
  ): Promise<readonly ContextIndexStatus[]> {
    return this.statuses;
  }

  async searchDocuments(): Promise<readonly ContextSearchMatch[]> {
    return [];
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("context indexing service", () => {
  test("indexes the default source and returns stable aggregate counts", async () => {
    const workspacePath = createTemporaryDirectory();
    writeWorkspaceFile(workspacePath, "README.md", "# Cairn\n");
    const repository = new FakeContextIndexRepository();

    const result = await indexContext({
      mode: "refresh",
      projectId: PROJECT_ID,
      repository,
      workspaceId: WORKSPACE_ID,
      workspacePath,
    });

    expect(repository.events).toEqual([
      "upsert:project",
      "apply:project:refresh",
    ]);
    expect(result).toMatchObject({
      counts: { added: 1, discovered: 1, skipped: 0 },
      mode: "refresh",
      projectId: PROJECT_ID,
      status: "succeeded",
      workspaceId: WORKSPACE_ID,
      workspacePath,
    });
    expect(result.sources.map(({ name }) => name)).toEqual(["project"]);
    expect(repository.applyInputs[0]?.files[0]?.relativePath).toBe("README.md");
  });

  test("processes named sources in deterministic order and preserves rebuild mode", async () => {
    const workspacePath = createTemporaryDirectory();
    writeWorkspaceFile(workspacePath, "alpha/a.md", "alpha\n");
    writeWorkspaceFile(workspacePath, "zeta/z.md", "zeta\n");
    writeWorkspaceFile(
      workspacePath,
      ".cairn/context.toml",
      `version = 1
[[sources]]
name = "zeta"
root = "zeta"
include = ["**/*.md"]
[[sources]]
name = "alpha"
root = "alpha"
include = ["**/*.md"]
`,
    );
    const repository = new FakeContextIndexRepository({
      alpha: { ...ZERO_COUNTS, added: 1, discovered: 1 },
      zeta: { ...ZERO_COUNTS, discovered: 1, updated: 1 },
    });

    const result = await indexContext({
      mode: "rebuild",
      projectId: PROJECT_ID,
      repository,
      workspaceId: WORKSPACE_ID,
      workspacePath,
    });

    expect(repository.events).toEqual([
      "upsert:alpha",
      "apply:alpha:rebuild",
      "upsert:zeta",
      "apply:zeta:rebuild",
    ]);
    expect(result.sources.map(({ name }) => name)).toEqual(["alpha", "zeta"]);
    expect(result.counts).toEqual({
      added: 1,
      discovered: 2,
      errors: 0,
      removed: 0,
      skipped: 0,
      unchanged: 0,
      updated: 1,
    });
  });

  test("passes deterministic discovery skips into the index run", async () => {
    const workspacePath = createTemporaryDirectory();
    writeWorkspaceFile(workspacePath, "visible.txt", "visible\n");
    writeWorkspaceFile(workspacePath, ".env", "TOKEN=secret\n");
    writeWorkspaceFile(workspacePath, "binary.txt", new Uint8Array([65, 0, 66]));
    writeWorkspaceFile(
      workspacePath,
      ".cairn/context.toml",
      `version = 1
[[sources]]
name = "project"
root = "."
include = ["**/*"]
`,
    );
    const repository = new FakeContextIndexRepository();

    const result = await indexContext({
      mode: "refresh",
      projectId: PROJECT_ID,
      repository,
      workspaceId: WORKSPACE_ID,
      workspacePath,
    });

    expect(repository.applyInputs[0]).toMatchObject({
      skippedCount: 2,
    });
    expect(repository.applyInputs[0]?.files.map(({ relativePath }) => relativePath)).toEqual([
      "visible.txt",
    ]);
    expect(result.counts.skipped).toBe(2);
  });

  test("discovers every source before modifying the prior index", async () => {
    const workspacePath = createTemporaryDirectory();
    writeWorkspaceFile(workspacePath, "alpha/a.md", "alpha\n");
    writeWorkspaceFile(
      workspacePath,
      ".cairn/context.toml",
      `version = 1
[[sources]]
name = "alpha"
root = "alpha"
[[sources]]
name = "missing"
root = "missing"
`,
    );
    const repository = new FakeContextIndexRepository();

    await expect(
      indexContext({
        mode: "refresh",
        projectId: PROJECT_ID,
        repository,
        workspaceId: WORKSPACE_ID,
        workspacePath,
      }),
    ).rejects.toBeInstanceOf(ContextDiscoveryError);
    expect(repository.events).toEqual([]);
  });

  test("preserves configuration errors before repository mutation", async () => {
    const workspacePath = createTemporaryDirectory();
    writeWorkspaceFile(
      workspacePath,
      ".cairn/context.toml",
      'version = 1\nsources = "invalid"\n',
    );
    const repository = new FakeContextIndexRepository();

    await expect(
      indexContext({
        mode: "refresh",
        projectId: PROJECT_ID,
        repository,
        workspaceId: WORKSPACE_ID,
        workspacePath,
      }),
    ).rejects.toBeInstanceOf(ContextConfigError);
    expect(repository.events).toEqual([]);
  });
});

describe("context index status service", () => {
  test("maps source runs without claiming filesystem freshness", async () => {
    const workspacePath = createTemporaryDirectory();
    const succeeded = runRecord("alpha", ZERO_COUNTS);
    const failed = runRecord("zeta", { ...ZERO_COUNTS, errors: 1 }, "failed");
    const repository = new FakeContextIndexRepository({}, [
      {
        activeDocumentCount: 2,
        lastRun: failed,
        source: sourceRecord("zeta"),
        totalDocumentCount: 3,
        versionCount: 4,
        workspaceId: WORKSPACE_ID,
      },
      {
        activeDocumentCount: 1,
        lastRun: succeeded,
        source: sourceRecord("alpha"),
        totalDocumentCount: 1,
        versionCount: 1,
        workspaceId: WORKSPACE_ID,
      },
    ]);

    const result = await getContextIndexStatus({
      projectId: PROJECT_ID,
      repository,
      workspaceId: WORKSPACE_ID,
      workspacePath,
    });

    expect(result).toMatchObject({
      filesystemFreshness: "unknown",
      projectId: PROJECT_ID,
      state: "refresh_required",
      workspaceId: WORKSPACE_ID,
      workspacePath,
    });
    expect(result.sources.map(({ name, state }) => ({ name, state }))).toEqual([
      { name: "alpha", state: "indexed" },
      { name: "zeta", state: "refresh_required" },
    ]);
  });

  test("reports an unindexed workspace as a successful empty status", async () => {
    const workspacePath = createTemporaryDirectory();
    const repository = new FakeContextIndexRepository();

    const result = await getContextIndexStatus({
      projectId: PROJECT_ID,
      repository,
      workspaceId: WORKSPACE_ID,
      workspacePath,
    });

    expect(result).toMatchObject({
      filesystemFreshness: "unknown",
      sources: [],
      state: "not_indexed",
    });
  });
});
