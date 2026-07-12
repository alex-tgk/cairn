import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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

describe("Cairn CLI", () => {
  test("prints its version", () => {
    const result = runCli(
      ["--version"],
      createTemporaryDirectory("cairn-cli-data-"),
    );

    expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "0.1.0\n" });
  });

  test("initializes a project and reports JSON status", () => {
    const dataDirectory = createTemporaryDirectory("cairn-cli-data-");
    const workspace = createTemporaryDirectory("cairn-cli-workspace-");
    mkdirSync(join(workspace, ".git"));

    const initialized = runCli(["init", workspace, "--json"], dataDirectory);
    const status = runCli(["status", workspace, "--json"], dataDirectory);

    expect(initialized.exitCode).toBe(0);
    expect(status.exitCode).toBe(0);
    const initializedProject = JSON.parse(initialized.stdout) as {
      projectId: string;
    };
    const projectStatus = JSON.parse(status.stdout) as {
      projectId: string;
      workspaceCount: number;
    };
    expect(projectStatus).toMatchObject({
      projectId: initializedProject.projectId,
      workspaceCount: 1,
    });
  });

  test("reports database health as JSON", () => {
    const dataDirectory = createTemporaryDirectory("cairn-cli-data-");

    const result = runCli(["doctor", "--json"], dataDirectory);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      foreignKeys: true,
      fts5: true,
      integrity: "ok",
      schemaVersion: 2,
    });
  });

  test("creates, shows, and lists work in the current project", () => {
    const dataDirectory = createTemporaryDirectory("cairn-cli-data-");
    const workspace = createTemporaryDirectory("cairn-cli-workspace-");
    mkdirSync(join(workspace, ".git"));
    runCli(["init", workspace, "--json"], dataDirectory);

    const created = runCli(
      [
        "work",
        "create",
        "Implement work tracking",
        "--description",
        "Ship the first usable work commands",
        "--priority",
        "1",
        "--type",
        "feature",
        "--path",
        workspace,
        "--json",
      ],
      dataDirectory,
    );

    expect(created.exitCode).toBe(0);
    const item = JSON.parse(created.stdout) as {
      id: string;
      priority: number;
      status: string;
      title: string;
      type: string;
    };
    expect(item).toMatchObject({
      priority: 1,
      status: "open",
      title: "Implement work tracking",
      type: "feature",
    });

    const shown = runCli(
      ["work", "show", item.id, "--path", workspace, "--json"],
      dataDirectory,
    );
    const listed = runCli(
      ["work", "list", "--path", workspace, "--json"],
      dataDirectory,
    );

    expect(JSON.parse(shown.stdout)).toEqual(JSON.parse(created.stdout));
    expect(JSON.parse(listed.stdout)).toEqual([JSON.parse(created.stdout)]);
  });

  test("rejects an invalid work priority", () => {
    const dataDirectory = createTemporaryDirectory("cairn-cli-data-");
    const workspace = createTemporaryDirectory("cairn-cli-workspace-");
    mkdirSync(join(workspace, ".git"));
    runCli(["init", workspace, "--json"], dataDirectory);

    const result = runCli(
      [
        "work",
        "create",
        "Invalid priority",
        "--priority",
        "urgent",
        "--path",
        workspace,
      ],
      dataDirectory,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Work item priority must be an integer from 0 to 4",
    );
  });

  test("claims, closes, reopens, and reports work history", () => {
    const dataDirectory = createTemporaryDirectory("cairn-cli-data-");
    const workspace = createTemporaryDirectory("cairn-cli-workspace-");
    mkdirSync(join(workspace, ".git"));
    runCli(["init", workspace, "--json"], dataDirectory);
    const created = runCli(
      ["work", "create", "Lifecycle work", "--path", workspace, "--json"],
      dataDirectory,
    );
    const id = (JSON.parse(created.stdout) as { id: string }).id;

    const claimed = runCli(
      [
        "work",
        "claim",
        id,
        "--assignee",
        "agent-codex",
        "--path",
        workspace,
        "--json",
      ],
      dataDirectory,
    );
    const closed = runCli(
      ["work", "close", id, "--path", workspace, "--json"],
      dataDirectory,
    );
    const reopened = runCli(
      ["work", "reopen", id, "--path", workspace, "--json"],
      dataDirectory,
    );
    const history = runCli(
      ["work", "history", id, "--path", workspace, "--json"],
      dataDirectory,
    );

    expect(JSON.parse(claimed.stdout)).toMatchObject({
      assignee: "agent-codex",
      status: "in_progress",
    });
    expect(JSON.parse(closed.stdout)).toMatchObject({ status: "closed" });
    expect(JSON.parse(reopened.stdout)).toMatchObject({
      assignee: "agent-codex",
      closedAt: null,
      status: "open",
    });
    expect(
      (JSON.parse(history.stdout) as readonly { eventType: string }[]).map(
        ({ eventType }) => eventType,
      ),
    ).toEqual(["created", "claimed", "closed", "reopened"]);
  });

  test("returns a non-zero result outside a Cairn project", () => {
    const dataDirectory = createTemporaryDirectory("cairn-cli-data-");
    const workspace = createTemporaryDirectory("cairn-cli-workspace-");

    const result = runCli(["status", workspace], dataDirectory);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No Cairn project found");
  });
});
