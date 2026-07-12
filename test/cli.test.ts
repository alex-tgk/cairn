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
      schemaVersion: 1,
    });
  });

  test("returns a non-zero result outside a Cairn project", () => {
    const dataDirectory = createTemporaryDirectory("cairn-cli-data-");
    const workspace = createTemporaryDirectory("cairn-cli-workspace-");

    const result = runCli(["status", workspace], dataDirectory);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No Cairn project found");
  });
});
