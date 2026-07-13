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
      schemaVersion: 4,
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

  test("updates work metadata and records the changed fields", () => {
    const dataDirectory = createTemporaryDirectory("cairn-cli-data-");
    const workspace = createTemporaryDirectory("cairn-cli-workspace-");
    mkdirSync(join(workspace, ".git"));
    runCli(["init", workspace, "--json"], dataDirectory);
    const created = runCli(
      ["work", "create", "Draft title", "--path", workspace, "--json"],
      dataDirectory,
    );
    const id = (JSON.parse(created.stdout) as { id: string }).id;

    const updated = runCli(
      [
        "work",
        "update",
        id,
        "--title",
        "Final title",
        "--description",
        "Ready for dependencies",
        "--priority",
        "1",
        "--type",
        "feature",
        "--assignee",
        "agent-codex",
        "--path",
        workspace,
        "--json",
      ],
      dataDirectory,
    );
    const history = runCli(
      ["work", "history", id, "--path", workspace, "--json"],
      dataDirectory,
    );

    expect(JSON.parse(updated.stdout)).toMatchObject({
      assignee: "agent-codex",
      description: "Ready for dependencies",
      priority: 1,
      title: "Final title",
      type: "feature",
    });
    expect(
      (JSON.parse(history.stdout) as readonly {
        eventType: string;
        payload: object;
      }[]).at(-1),
    ).toMatchObject({
      eventType: "updated",
      payload: {
        assignee: "agent-codex",
        description: "Ready for dependencies",
        priority: 1,
        title: "Final title",
        type: "feature",
      },
    });

    const unassigned = runCli(
      [
        "work",
        "update",
        id,
        "--clear-assignee",
        "--path",
        workspace,
        "--json",
      ],
      dataDirectory,
    );
    expect(JSON.parse(unassigned.stdout)).toMatchObject({ assignee: null });
  });

  test("resolves short references and protects explicit revisions", () => {
    const dataDirectory = createTemporaryDirectory("cairn-cli-data-");
    const workspace = createTemporaryDirectory("cairn-cli-workspace-");
    mkdirSync(join(workspace, ".git"));
    runCli(["init", workspace, "--json"], dataDirectory);
    const created = runCli(
      ["work", "create", "Versioned work", "--path", workspace, "--json"],
      dataDirectory,
    );
    const item = JSON.parse(created.stdout) as {
      id: string;
      notes: string;
      revision: number;
      shortId: string;
    };

    expect(item).toMatchObject({ notes: "", revision: 1 });
    expect(item.shortId).toHaveLength(8);
    const shown = runCli(
      ["work", "show", item.shortId, "--path", workspace, "--json"],
      dataDirectory,
    );
    expect(JSON.parse(shown.stdout)).toMatchObject({ id: item.id, revision: 1 });

    const updated = runCli(
      [
        "work",
        "update",
        item.shortId,
        "--title",
        "Updated once",
        "--if-revision",
        "1",
        "--path",
        workspace,
        "--json",
      ],
      dataDirectory,
    );
    expect(JSON.parse(updated.stdout)).toMatchObject({ revision: 2 });

    const stale = runCli(
      [
        "work",
        "close",
        item.shortId,
        "--if-revision",
        "1",
        "--path",
        workspace,
        "--json",
      ],
      dataDirectory,
    );
    expect(stale.exitCode).toBe(1);
    expect(JSON.parse(stale.stderr)).toMatchObject({
      error: {
        code: "work_conflict",
        details: { actualRevision: 2, expectedRevision: 1, id: item.id },
      },
    });
  });

  test("makes same-assignee claims idempotent and rejects claim stealing", () => {
    const dataDirectory = createTemporaryDirectory("cairn-cli-data-");
    const workspace = createTemporaryDirectory("cairn-cli-workspace-");
    mkdirSync(join(workspace, ".git"));
    runCli(["init", workspace, "--json"], dataDirectory);
    const created = runCli(
      ["work", "create", "Claim once", "--path", workspace, "--json"],
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
    const retried = runCli(
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
    const stolen = runCli(
      [
        "work",
        "claim",
        id,
        "--assignee",
        "agent-copilot",
        "--path",
        workspace,
        "--json",
      ],
      dataDirectory,
    );
    const history = runCli(
      ["work", "history", id, "--path", workspace, "--json"],
      dataDirectory,
    );

    expect(JSON.parse(claimed.stdout)).toMatchObject({ revision: 2 });
    expect(JSON.parse(retried.stdout)).toMatchObject({ revision: 2 });
    expect(JSON.parse(history.stdout)).toHaveLength(2);
    expect(stolen.exitCode).toBe(1);
    expect(JSON.parse(stolen.stderr)).toMatchObject({
      error: {
        code: "claim_conflict",
        details: {
          currentAssignee: "agent-codex",
          requestedAssignee: "agent-copilot",
        },
      },
    });
  });

  test("creates and updates hierarchy with deterministic tree output", () => {
    const dataDirectory = createTemporaryDirectory("cairn-cli-data-");
    const workspace = createTemporaryDirectory("cairn-cli-workspace-");
    mkdirSync(join(workspace, ".git"));
    runCli(["init", workspace, "--json"], dataDirectory);
    const root = JSON.parse(
      runCli(
        ["work", "create", "Root", "--path", workspace, "--json"],
        dataDirectory,
      ).stdout,
    ) as { id: string; shortId: string };
    const child = JSON.parse(
      runCli(
        [
          "work",
          "create",
          "Child",
          "--parent",
          root.shortId,
          "--path",
          workspace,
          "--json",
        ],
        dataDirectory,
      ).stdout,
    ) as { id: string; shortId: string };

    const tree = runCli(
      ["work", "tree", root.shortId, "--path", workspace, "--json"],
      dataDirectory,
    );
    expect(JSON.parse(tree.stdout)).toMatchObject([
      { depth: 0, id: root.id, parentId: null },
      { depth: 1, id: child.id, parentId: root.id },
    ]);

    const cleared = runCli(
      [
        "work",
        "update",
        child.shortId,
        "--clear-parent",
        "--path",
        workspace,
        "--json",
      ],
      dataDirectory,
    );
    expect(JSON.parse(cleared.stdout)).toMatchObject({ revision: 2 });
    expect(
      JSON.parse(
        runCli(
          ["work", "tree", root.shortId, "--path", workspace, "--json"],
          dataDirectory,
        ).stdout,
      ),
    ).toHaveLength(1);

    runCli(
      [
        "work",
        "update",
        child.shortId,
        "--parent",
        root.shortId,
        "--path",
        workspace,
        "--json",
      ],
      dataDirectory,
    );
    const closeRoot = runCli(
      ["work", "close", root.shortId, "--path", workspace, "--json"],
      dataDirectory,
    );
    expect(closeRoot.exitCode).toBe(1);
    expect(JSON.parse(closeRoot.stderr)).toMatchObject({
      error: {
        code: "open_descendants",
        details: { descendants: [child.id] },
      },
    });
  });

  test("manages blockers and explains ready and blocked work", () => {
    const dataDirectory = createTemporaryDirectory("cairn-cli-data-");
    const workspace = createTemporaryDirectory("cairn-cli-workspace-");
    mkdirSync(join(workspace, ".git"));
    runCli(["init", workspace, "--json"], dataDirectory);
    const blocker = JSON.parse(
      runCli(
        ["work", "create", "Blocker", "--path", workspace, "--json"],
        dataDirectory,
      ).stdout,
    ) as { id: string; shortId: string };
    const blocked = JSON.parse(
      runCli(
        ["work", "create", "Blocked", "--path", workspace, "--json"],
        dataDirectory,
      ).stdout,
    ) as { id: string; shortId: string };

    const added = runCli(
      [
        "work",
        "dep",
        "add",
        blocked.shortId,
        blocker.shortId,
        "--path",
        workspace,
        "--json",
      ],
      dataDirectory,
    );
    expect(JSON.parse(added.stdout)).toMatchObject({ id: blocked.id, revision: 2 });
    expect(
      JSON.parse(
        runCli(
          [
            "work",
            "dep",
            "list",
            blocked.shortId,
            "--direction",
            "blockers",
            "--path",
            workspace,
            "--json",
          ],
          dataDirectory,
        ).stdout,
      ),
    ).toMatchObject([{ blockedId: blocked.id, blockerId: blocker.id }]);
    expect(
      JSON.parse(
        runCli(
          ["work", "blocked", "--path", workspace, "--json"],
          dataDirectory,
        ).stdout,
      ),
    ).toMatchObject([
      {
        blockers: [{ id: blocker.id, status: "open" }],
        id: blocked.id,
        readiness: "blocked",
      },
    ]);

    runCli(
      ["work", "close", blocker.shortId, "--path", workspace, "--json"],
      dataDirectory,
    );
    expect(
      JSON.parse(
        runCli(
          ["work", "ready", "--explain", "--path", workspace, "--json"],
          dataDirectory,
        ).stdout,
      ),
    ).toMatchObject([
      { blockers: [], id: blocked.id, readiness: "ready" },
    ]);
  });

  test("manages labels, notes, and comments", () => {
    const dataDirectory = createTemporaryDirectory("cairn-cli-data-");
    const workspace = createTemporaryDirectory("cairn-cli-workspace-");
    mkdirSync(join(workspace, ".git"));
    runCli(["init", workspace, "--json"], dataDirectory);
    const item = JSON.parse(
      runCli(
        ["work", "create", "Investigate outage", "--path", workspace, "--json"],
        dataDirectory,
      ).stdout,
    ) as { id: string; shortId: string };

    const added = runCli(
      ["work", "label", "add", item.shortId, "Urgent", "--path", workspace, "--json"],
      dataDirectory,
    );
    expect(JSON.parse(added.stdout)).toMatchObject({ id: item.id, revision: 2 });
    runCli(
      ["work", "label", "add", item.shortId, "backend", "--path", workspace, "--json"],
      dataDirectory,
    );
    expect(
      JSON.parse(
        runCli(
          ["work", "label", "list", item.shortId, "--path", workspace, "--json"],
          dataDirectory,
        ).stdout,
      ),
    ).toEqual(["backend", "urgent"]);
    runCli(
      ["work", "label", "remove", item.shortId, "urgent", "--path", workspace, "--json"],
      dataDirectory,
    );
    expect(
      JSON.parse(
        runCli(
          ["work", "label", "list", item.shortId, "--path", workspace, "--json"],
          dataDirectory,
        ).stdout,
      ),
    ).toEqual(["backend"]);

    const noted = runCli(
      [
        "work",
        "note",
        "append",
        item.shortId,
        "Root cause identified",
        "--path",
        workspace,
        "--json",
      ],
      dataDirectory,
    );
    expect(JSON.parse(noted.stdout)).toMatchObject({
      notes: "Root cause identified",
    });

    runCli(
      [
        "work",
        "comment",
        "add",
        item.shortId,
        "agent-codex",
        "Looks good to me",
        "--path",
        workspace,
        "--json",
      ],
      dataDirectory,
    );
    expect(
      JSON.parse(
        runCli(
          ["work", "comment", "list", item.shortId, "--path", workspace, "--json"],
          dataDirectory,
        ).stdout,
      ),
    ).toMatchObject([{ author: "agent-codex", body: "Looks good to me" }]);
  });

  test("filters work list, ready, and blocked results", () => {
    const dataDirectory = createTemporaryDirectory("cairn-cli-data-");
    const workspace = createTemporaryDirectory("cairn-cli-workspace-");
    mkdirSync(join(workspace, ".git"));
    runCli(["init", workspace, "--json"], dataDirectory);
    const bug = JSON.parse(
      runCli(
        [
          "work",
          "create",
          "Fix crash",
          "--type",
          "bug",
          "--assignee",
          "agent-codex",
          "--path",
          workspace,
          "--json",
        ],
        dataDirectory,
      ).stdout,
    ) as { id: string; shortId: string };
    const feature = JSON.parse(
      runCli(
        [
          "work",
          "create",
          "Ship feature",
          "--type",
          "feature",
          "--path",
          workspace,
          "--json",
        ],
        dataDirectory,
      ).stdout,
    ) as { id: string; shortId: string };
    runCli(
      [
        "work",
        "label",
        "add",
        feature.shortId,
        "urgent",
        "--path",
        workspace,
        "--json",
      ],
      dataDirectory,
    );
    runCli(
      [
        "work",
        "dep",
        "add",
        feature.shortId,
        bug.shortId,
        "--path",
        workspace,
        "--json",
      ],
      dataDirectory,
    );

    expect(
      JSON.parse(
        runCli(
          ["work", "list", "--type", "bug", "--path", workspace, "--json"],
          dataDirectory,
        ).stdout,
      ),
    ).toMatchObject([{ id: bug.id }]);
    expect(
      JSON.parse(
        runCli(
          [
            "work",
            "list",
            "--assignee",
            "agent-codex",
            "--path",
            workspace,
            "--json",
          ],
          dataDirectory,
        ).stdout,
      ),
    ).toMatchObject([{ id: bug.id }]);
    expect(
      JSON.parse(
        runCli(
          [
            "work",
            "list",
            "--label",
            "urgent",
            "--path",
            workspace,
            "--json",
          ],
          dataDirectory,
        ).stdout,
      ),
    ).toMatchObject([{ id: feature.id }]);
    expect(
      JSON.parse(
        runCli(
          ["work", "ready", "--type", "bug", "--path", workspace, "--json"],
          dataDirectory,
        ).stdout,
      ),
    ).toMatchObject([{ id: bug.id }]);
    expect(
      JSON.parse(
        runCli(
          [
            "work",
            "blocked",
            "--type",
            "feature",
            "--path",
            workspace,
            "--json",
          ],
          dataDirectory,
        ).stdout,
      ),
    ).toMatchObject([{ id: feature.id }]);
    expect(
      JSON.parse(
        runCli(
          ["work", "list", "--limit", "1", "--path", workspace, "--json"],
          dataDirectory,
        ).stdout,
      ),
    ).toHaveLength(1);
  });

  test("returns a non-zero result outside a Cairn project", () => {
    const dataDirectory = createTemporaryDirectory("cairn-cli-data-");
    const workspace = createTemporaryDirectory("cairn-cli-workspace-");

    const result = runCli(["status", workspace], dataDirectory);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No Cairn project found");
  });
});
