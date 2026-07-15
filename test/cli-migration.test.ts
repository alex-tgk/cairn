import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const projectRoot = join(import.meta.dir, "..");
const cliPath = join(projectRoot, "src", "cli.ts");
const temporaryDirectories: string[] = [];

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function runCli(
  arguments_: readonly string[],
  dataDirectory: string,
): Readonly<{ exitCode: number; stderr: string; stdout: string }> {
  const result = Bun.spawnSync({
    cmd: [process.execPath, cliPath, ...arguments_],
    env: { ...process.env, CAIRN_DATA_DIR: dataDirectory },
    stderr: "pipe",
    stdout: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("Cairn CLI import", () => {
  test("imports work items idempotently and applies dependency edges", () => {
    const dataDirectory = createTemporaryDirectory("cairn-import-data-");
    const workspace = createTemporaryDirectory("cairn-import-workspace-");
    runCli(["init", workspace], dataDirectory);

    const issuesFile = join(workspace, "issues.jsonl");
    writeFileSync(
      issuesFile,
      [
        JSON.stringify({
          _type: "issue",
          id: "ext-1",
          issue_type: "feature",
          priority: 1,
          status: "open",
          title: "Parent issue",
        }),
        JSON.stringify({
          _type: "issue",
          id: "ext-2",
          issue_type: "task",
          priority: 2,
          status: "closed",
          close_reason: "done",
          title: "Child issue",
        }),
      ].join("\n"),
    );
    const depsFile = join(workspace, "deps.json");
    writeFileSync(
      depsFile,
      JSON.stringify([
        { depends_on_id: "ext-1", issue_id: "ext-2", type: "parent-child" },
      ]),
    );

    const first = runCli(
      [
        "import",
        "work-items",
        issuesFile,
        "--deps",
        depsFile,
        "--path",
        workspace,
        "--json",
      ],
      dataDirectory,
    );
    expect(first.exitCode).toBe(0);
    const firstResult = JSON.parse(first.stdout) as {
      createdCount: number;
      skippedCount: number;
      edgesAppliedCount: number;
    };
    expect(firstResult.createdCount).toBe(2);
    expect(firstResult.skippedCount).toBe(0);
    expect(firstResult.edgesAppliedCount).toBe(1);

    const tree = runCli(["work", "tree", "--path", workspace, "--json"], dataDirectory);
    expect(tree.exitCode).toBe(0);
    const treeItems = JSON.parse(tree.stdout) as { title: string; depth: number }[];
    const child = treeItems.find((item) => item.title === "Child issue");
    expect(child?.depth).toBe(1);

    const second = runCli(
      ["import", "work-items", issuesFile, "--path", workspace, "--json"],
      dataDirectory,
    );
    const secondResult = JSON.parse(second.stdout) as {
      createdCount: number;
      skippedCount: number;
    };
    expect(secondResult.createdCount).toBe(0);
    expect(secondResult.skippedCount).toBe(2);
  });

  test("imports memories filtered by project and upserts on re-run", () => {
    const dataDirectory = createTemporaryDirectory("cairn-import-data-");
    const workspace = createTemporaryDirectory("cairn-import-workspace-");
    runCli(["init", workspace], dataDirectory);

    const exportFile = join(workspace, "memories.json");
    writeFileSync(
      exportFile,
      JSON.stringify({
        observations: [
          {
            id: 1,
            content: "Body one",
            project: "cairn",
            scope: "project",
            sync_id: "sync-1",
            title: "Observation one",
            type: "refactor",
          },
          {
            id: 2,
            content: "Body two",
            project: "other-project",
            scope: "project",
            sync_id: "sync-2",
            title: "Observation two",
            type: "pattern",
          },
        ],
      }),
    );

    const result = runCli(
      [
        "import",
        "memories",
        exportFile,
        "--project",
        "cairn",
        "--path",
        workspace,
        "--json",
      ],
      dataDirectory,
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      importedCount: number;
      totalObservations: number;
    };
    expect(parsed.importedCount).toBe(1);
    expect(parsed.totalObservations).toBe(2);

    const rerun = runCli(
      [
        "import",
        "memories",
        exportFile,
        "--project",
        "cairn",
        "--path",
        workspace,
        "--json",
      ],
      dataDirectory,
    );
    const rerunParsed = JSON.parse(rerun.stdout) as { importedCount: number };
    expect(rerunParsed.importedCount).toBe(1);

    const list = runCli(["memory", "list", "--path", workspace, "--json"], dataDirectory);
    const memories = JSON.parse(list.stdout) as { title: string }[];
    expect(memories).toHaveLength(1);
    expect(memories[0]?.title).toBe("Observation one");
  });

  test("imports context rows from a source SQLite index", () => {
    const dataDirectory = createTemporaryDirectory("cairn-import-data-");
    const workspace = createTemporaryDirectory("cairn-import-workspace-");
    runCli(["init", workspace], dataDirectory);

    const sourceDatabasePath = join(workspace, "context-index.sqlite");
    const database = new Database(sourceDatabasePath);
    database.run(
      "CREATE TABLE documents (id INTEGER PRIMARY KEY, source TEXT, kind TEXT, title TEXT, path TEXT, project TEXT, tags TEXT, content TEXT)",
    );
    database.run(
      "INSERT INTO documents (id, source, kind, title, path, project, tags, content) VALUES (1, 'rag', 'file', 'Doc one', '/a.md', 'cairn', 'tag1', 'Content one')",
    );
    database.run(
      "INSERT INTO documents (id, source, kind, title, path, project, tags, content) VALUES (2, 'rag', 'file', 'Doc two', '/b.md', 'other-project', 'tag2', 'Content two')",
    );
    database.close();

    const result = runCli(
      [
        "import",
        "context",
        sourceDatabasePath,
        "--project",
        "cairn",
        "--path",
        workspace,
        "--json",
      ],
      dataDirectory,
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { importedCount: number };
    expect(parsed.importedCount).toBe(1);

    const list = runCli(["memory", "list", "--path", workspace, "--json"], dataDirectory);
    const memories = JSON.parse(list.stdout) as { title: string }[];
    expect(memories[0]?.title).toBe("Doc one");
  });
});

describe("Cairn CLI setup", () => {
  test("generates skill and instructions files for each target under --home", () => {
    const dataDirectory = createTemporaryDirectory("cairn-setup-data-");
    const home = createTemporaryDirectory("cairn-setup-home-");

    const result = runCli(["setup", "all", "--home", home, "--json"], dataDirectory);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      targets: { target: string; agentsFile: { path: string }; skillFile: { path: string } }[];
    };
    expect(parsed.targets.map((target) => target.target).sort()).toEqual([
      "codex",
      "copilot",
    ]);
  });

  test("rejects an unknown setup target", () => {
    const dataDirectory = createTemporaryDirectory("cairn-setup-data-");
    const home = createTemporaryDirectory("cairn-setup-home-");

    const result = runCli(["setup", "bogus", "--home", home], dataDirectory);
    expect(result.exitCode).toBe(2);
  });
});
