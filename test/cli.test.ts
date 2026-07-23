import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import packageJson from "../package.json";

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

    expect(result).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: `${packageJson.version}\n`,
    });
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
      schemaVersion: 8,
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

  test("saves, upserts by topic, lists, and searches memories", () => {
    const dataDirectory = createTemporaryDirectory("cairn-cli-data-");
    const workspace = createTemporaryDirectory("cairn-cli-workspace-");
    mkdirSync(join(workspace, ".git"));
    runCli(["init", workspace, "--json"], dataDirectory);

    const saved = JSON.parse(
      runCli(
        [
          "memory",
          "save",
          "Auth model",
          "The auth model uses refresh tokens.",
          "--type",
          "architecture",
          "--topic",
          "architecture/auth-model",
          "--path",
          workspace,
          "--json",
        ],
        dataDirectory,
      ).stdout,
    ) as { id: string; revision: number };
    expect(saved.revision).toBe(1);

    const upserted = JSON.parse(
      runCli(
        [
          "memory",
          "save",
          "Auth model v2",
          "The auth model now rotates refresh tokens.",
          "--type",
          "architecture",
          "--topic",
          "architecture/auth-model",
          "--path",
          workspace,
          "--json",
        ],
        dataDirectory,
      ).stdout,
    ) as { id: string; revision: number; title: string };
    expect(upserted.id).toBe(saved.id);
    expect(upserted.revision).toBe(2);
    expect(upserted.title).toBe("Auth model v2");

    runCli(
      [
        "memory",
        "save",
        "Prefers concise commits",
        "The user wants short, regular commits.",
        "--type",
        "preference",
        "--scope",
        "personal",
        "--path",
        workspace,
        "--json",
      ],
      dataDirectory,
    );

    const shown = JSON.parse(
      runCli(["memory", "show", saved.id, "--path", workspace, "--json"], dataDirectory)
        .stdout,
    ) as { title: string };
    expect(shown.title).toBe("Auth model v2");

    const listed = JSON.parse(
      runCli(["memory", "list", "--path", workspace, "--json"], dataDirectory)
        .stdout,
    ) as readonly { title: string }[];
    expect(listed.map((memory) => memory.title)).toContain("Auth model v2");
    expect(listed.map((memory) => memory.title)).toContain(
      "Prefers concise commits",
    );

    const filtered = JSON.parse(
      runCli(
        ["memory", "list", "--scope", "personal", "--path", workspace, "--json"],
        dataDirectory,
      ).stdout,
    ) as readonly { title: string }[];
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.title).toBe("Prefers concise commits");

    const searched = JSON.parse(
      runCli(
        ["memory", "search", "refresh tokens", "--path", workspace, "--json"],
        dataDirectory,
      ).stdout,
    ) as readonly { title: string }[];
    expect(searched).toHaveLength(1);
    expect(searched[0]?.title).toBe("Auth model v2");
  });

  test("defaults a preference to personal scope and other types to project", () => {
    const dataDirectory = createTemporaryDirectory("cairn-cli-data-");
    const workspace = createTemporaryDirectory("cairn-cli-workspace-");
    mkdirSync(join(workspace, ".git"));
    runCli(["init", workspace, "--json"], dataDirectory);

    const preference = JSON.parse(
      runCli(
        [
          "memory",
          "save",
          "Prefers tmux",
          "The user runs everything inside tmux.",
          "--type",
          "preference",
          "--path",
          workspace,
          "--json",
        ],
        dataDirectory,
      ).stdout,
    ) as { projectId: string | null; scope: string };
    expect(preference.scope).toBe("personal");
    expect(preference.projectId).toBeNull();

    const discovery = JSON.parse(
      runCli(
        [
          "memory",
          "save",
          "Build entrypoint",
          "The build starts from scripts/build.ts.",
          "--type",
          "discovery",
          "--path",
          workspace,
          "--json",
        ],
        dataDirectory,
      ).stdout,
    ) as { projectId: string | null; scope: string };
    expect(discovery.scope).toBe("project");
    expect(discovery.projectId).not.toBeNull();

    const overridden = JSON.parse(
      runCli(
        [
          "memory",
          "save",
          "Project-specific style preference",
          "This repo prefers 100-column lines.",
          "--type",
          "preference",
          "--scope",
          "project",
          "--path",
          workspace,
          "--json",
        ],
        dataDirectory,
      ).stdout,
    ) as { projectId: string | null; scope: string };
    expect(overridden.scope).toBe("project");
    expect(overridden.projectId).not.toBeNull();
  });

  test("relates memories, lists relations from both sides, unrelates, and shows a timeline", () => {
    const dataDirectory = createTemporaryDirectory("cairn-cli-data-");
    const workspace = createTemporaryDirectory("cairn-cli-workspace-");
    mkdirSync(join(workspace, ".git"));
    runCli(["init", workspace, "--json"], dataDirectory);

    const first = JSON.parse(
      runCli(
        [
          "memory",
          "save",
          "First",
          "First memory content.",
          "--type",
          "discovery",
          "--path",
          workspace,
          "--json",
        ],
        dataDirectory,
      ).stdout,
    ) as { id: string };
    const second = JSON.parse(
      runCli(
        [
          "memory",
          "save",
          "Second",
          "Second memory content.",
          "--type",
          "discovery",
          "--path",
          workspace,
          "--json",
        ],
        dataDirectory,
      ).stdout,
    ) as { id: string };

    runCli(
      ["memory", "relate", first.id, second.id, "--path", workspace, "--json"],
      dataDirectory,
    );

    const relationsFromFirst = JSON.parse(
      runCli(
        ["memory", "relations", first.id, "--path", workspace, "--json"],
        dataDirectory,
      ).stdout,
    ) as readonly { title: string }[];
    expect(relationsFromFirst.map((memory) => memory.title)).toEqual(["Second"]);

    const relationsFromSecond = JSON.parse(
      runCli(
        ["memory", "relations", second.id, "--path", workspace, "--json"],
        dataDirectory,
      ).stdout,
    ) as readonly { title: string }[];
    expect(relationsFromSecond.map((memory) => memory.title)).toEqual(["First"]);

    runCli(
      ["memory", "unrelate", first.id, second.id, "--path", workspace, "--json"],
      dataDirectory,
    );
    expect(
      JSON.parse(
        runCli(
          ["memory", "relations", first.id, "--path", workspace, "--json"],
          dataDirectory,
        ).stdout,
      ),
    ).toHaveLength(0);

    const timeline = JSON.parse(
      runCli(
        ["memory", "timeline", first.id, "--path", workspace, "--json"],
        dataDirectory,
      ).stdout,
    ) as {
      after: readonly { title: string }[];
      target: { title: string };
    };
    expect(timeline.target.title).toBe("First");
    expect(timeline.after.map((memory) => memory.title)).toEqual(["Second"]);
  });

  test("pins, unpins, archives, and unarchives a memory", () => {
    const dataDirectory = createTemporaryDirectory("cairn-cli-data-");
    const workspace = createTemporaryDirectory("cairn-cli-workspace-");
    mkdirSync(join(workspace, ".git"));
    runCli(["init", workspace, "--json"], dataDirectory);

    const saved = JSON.parse(
      runCli(
        [
          "memory",
          "save",
          "Important decision",
          "Should be pinned.",
          "--type",
          "decision",
          "--path",
          workspace,
          "--json",
        ],
        dataDirectory,
      ).stdout,
    ) as { id: string };

    const pinned = JSON.parse(
      runCli(["memory", "pin", saved.id, "--path", workspace, "--json"], dataDirectory)
        .stdout,
    ) as { pinned: boolean; revision: number };
    expect(pinned.pinned).toBe(true);
    expect(pinned.revision).toBe(2);

    const unpinned = JSON.parse(
      runCli(["memory", "unpin", saved.id, "--path", workspace, "--json"], dataDirectory)
        .stdout,
    ) as { pinned: boolean };
    expect(unpinned.pinned).toBe(false);

    const archived = JSON.parse(
      runCli(
        ["memory", "archive", saved.id, "--path", workspace, "--json"],
        dataDirectory,
      ).stdout,
    ) as { archived: boolean };
    expect(archived.archived).toBe(true);

    const listedWithoutArchived = JSON.parse(
      runCli(["memory", "list", "--path", workspace, "--json"], dataDirectory)
        .stdout,
    ) as readonly { title: string }[];
    expect(listedWithoutArchived).toHaveLength(0);

    const listedWithArchived = JSON.parse(
      runCli(
        ["memory", "list", "--include-archived", "--path", workspace, "--json"],
        dataDirectory,
      ).stdout,
    ) as readonly { title: string }[];
    expect(listedWithArchived).toHaveLength(1);

    const unarchived = JSON.parse(
      runCli(
        ["memory", "unarchive", saved.id, "--path", workspace, "--json"],
        dataDirectory,
      ).stdout,
    ) as { archived: boolean };
    expect(unarchived.archived).toBe(false);

    expect(
      JSON.parse(
        runCli(["memory", "list", "--path", workspace, "--json"], dataDirectory)
          .stdout,
      ),
    ).toHaveLength(1);
  });

  test("lists session summaries and builds a context primer", () => {
    const dataDirectory = createTemporaryDirectory("cairn-cli-data-");
    const workspace = createTemporaryDirectory("cairn-cli-workspace-");
    mkdirSync(join(workspace, ".git"));
    runCli(["init", workspace, "--json"], dataDirectory);

    const decision = JSON.parse(
      runCli(
        [
          "memory",
          "save",
          "Chose SQLite",
          "Deterministic local storage.",
          "--type",
          "decision",
          "--path",
          workspace,
          "--json",
        ],
        dataDirectory,
      ).stdout,
    ) as { id: string };
    runCli(["memory", "pin", decision.id, "--path", workspace, "--json"], dataDirectory);

    runCli(
      [
        "memory",
        "save",
        "Session summary: cairn",
        "Goal: ship memory lifecycle. Accomplished: pin/archive/context.",
        "--type",
        "session_summary",
        "--path",
        workspace,
        "--json",
      ],
      dataDirectory,
    );

    const sessions = JSON.parse(
      runCli(["memory", "sessions", "--path", workspace, "--json"], dataDirectory)
        .stdout,
    ) as readonly { title: string; type: string }[];
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.type).toBe("session_summary");

    const primer = JSON.parse(
      runCli(["memory", "context", "--path", workspace, "--json"], dataDirectory)
        .stdout,
    ) as {
      pinnedMemories: readonly { title: string }[];
      recentMemories: readonly { title: string }[];
      recentSessionSummary: { title: string } | null;
    };
    expect(primer.pinnedMemories.map((memory) => memory.title)).toEqual([
      "Chose SQLite",
    ]);
    expect(primer.recentSessionSummary?.title).toBe("Session summary: cairn");
    expect(
      primer.recentMemories.some((memory) => memory.title === "Chose SQLite"),
    ).toBe(true);
    expect(
      primer.recentMemories.some(
        (memory) => memory.title === "Session summary: cairn",
      ),
    ).toBe(false);
  });

  test("returns a non-zero result outside a Cairn project", () => {
    const dataDirectory = createTemporaryDirectory("cairn-cli-data-");
    const workspace = createTemporaryDirectory("cairn-cli-workspace-");

    const result = runCli(["status", workspace], dataDirectory);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No Cairn project found");
  });

  test("implicitly initializes a project on first use of work, memory, or context, without a prior 'init'", () => {
    const dataDirectory = createTemporaryDirectory("cairn-cli-data-");
    const workspace = createTemporaryDirectory("cairn-cli-workspace-");
    mkdirSync(join(workspace, ".git"));

    const created = runCli(
      ["work", "create", "First item", "--path", workspace, "--json"],
      dataDirectory,
    );
    expect(created.exitCode).toBe(0);

    const status = runCli(["status", workspace, "--json"], dataDirectory);
    expect(status.exitCode).toBe(0);
    const parsedStatus = JSON.parse(status.stdout) as { workspaceCount: number };
    expect(parsedStatus.workspaceCount).toBe(1);
  });

  test("refreshes, rebuilds, and reports context index status", () => {
    const dataDirectory = createTemporaryDirectory("cairn-cli-data-");
    const workspace = createTemporaryDirectory("cairn-cli-workspace-");
    mkdirSync(join(workspace, ".git"));
    mkdirSync(join(workspace, "docs"));
    writeFileSync(join(workspace, "docs", "notes.md"), "# Notes\n");

    runCli(["init", workspace, "--json"], dataDirectory);

    const notIndexed = JSON.parse(
      runCli(["context", "status", "--path", workspace, "--json"], dataDirectory)
        .stdout,
    ) as readonly { state: string }[];
    expect(notIndexed).toHaveLength(1);
    expect(notIndexed[0]?.state).toBe("not_indexed");

    const refreshed = JSON.parse(
      runCli(["context", "refresh", "--path", workspace, "--json"], dataDirectory)
        .stdout,
    ) as readonly {
      counts: { added: number };
      mode: string;
      status: string;
    }[];
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]?.mode).toBe("refresh");
    expect(refreshed[0]?.status).toBe("succeeded");
    expect(refreshed[0]?.counts.added).toBe(1);

    const indexed = JSON.parse(
      runCli(["context", "status", "--path", workspace, "--json"], dataDirectory)
        .stdout,
    ) as readonly { sources: readonly { activeDocumentCount: number }[]; state: string }[];
    expect(indexed[0]?.state).toBe("indexed");
    expect(indexed[0]?.sources[0]?.activeDocumentCount).toBe(1);

    const rebuilt = JSON.parse(
      runCli(["context", "rebuild", "--path", workspace, "--json"], dataDirectory)
        .stdout,
    ) as readonly { mode: string }[];
    expect(rebuilt[0]?.mode).toBe("rebuild");

    const all = JSON.parse(
      runCli(["context", "status", "--all", "--json"], dataDirectory).stdout,
    ) as readonly { state: string }[];
    expect(all).toHaveLength(1);
    expect(all[0]?.state).toBe("indexed");

    const invalidScope = runCli(
      ["context", "status", "--all", "--path", workspace, "--json"],
      dataDirectory,
    );
    expect(invalidScope.exitCode).toBe(2);

    const unknownAction = runCli(
      ["context", "bogus", "--path", workspace],
      dataDirectory,
    );
    expect(unknownAction.exitCode).toBe(2);
  });

  test("searches context documents and builds a project primer", () => {
    const dataDirectory = createTemporaryDirectory("cairn-cli-data-");
    const workspace = createTemporaryDirectory("cairn-cli-workspace-");
    mkdirSync(join(workspace, ".git"));
    mkdirSync(join(workspace, "docs"));
    writeFileSync(
      join(workspace, "docs", "notes.md"),
      "# Auth Notes\n\nThe auth flow uses refresh tokens rotated on every login.\n",
    );
    writeFileSync(
      join(workspace, "docs", "deploy.md"),
      "# Deploy Notes\n\nDeployment uses GitLab CI with manual gates.\n",
    );

    runCli(["init", workspace, "--json"], dataDirectory);

    const notIndexedPrimer = JSON.parse(
      runCli(
        ["context", "prime", "how does auth work", "--path", workspace, "--json"],
        dataDirectory,
      ).stdout,
    ) as {
      indexStatus: { state: string };
      recommendedCommand: string | null;
      results: readonly unknown[];
      warnings: readonly string[];
    };
    expect(notIndexedPrimer.indexStatus.state).toBe("not_indexed");
    expect(notIndexedPrimer.recommendedCommand).toBe("cairn context refresh");
    expect(notIndexedPrimer.warnings).toHaveLength(1);
    expect(notIndexedPrimer.results).toHaveLength(0);

    runCli(["context", "refresh", "--path", workspace, "--json"], dataDirectory);

    const searchResult = JSON.parse(
      runCli(
        ["context", "search", "auth flow", "--path", workspace, "--json"],
        dataDirectory,
      ).stdout,
    ) as {
      matches: readonly { relativePath: string; snippet: string }[];
      query: string;
      termCount: number;
    };
    expect(searchResult.termCount).toBe(2);
    expect(searchResult.matches).toHaveLength(1);
    expect(searchResult.matches[0]?.relativePath).toBe("docs/notes.md");
    expect(searchResult.matches[0]?.snippet).toContain("»");

    const noMatches = JSON.parse(
      runCli(
        ["context", "search", "nonexistentterm", "--path", workspace, "--json"],
        dataDirectory,
      ).stdout,
    ) as { matches: readonly unknown[] };
    expect(noMatches.matches).toHaveLength(0);

    const invalidQuery = runCli(
      ["context", "search", "!!!", "--path", workspace, "--json"],
      dataDirectory,
    );
    expect(invalidQuery.exitCode).toBe(2);

    const invalidLimit = runCli(
      ["context", "search", "auth", "--path", workspace, "--limit", "0", "--json"],
      dataDirectory,
    );
    expect(invalidLimit.exitCode).toBe(2);

    const indexedPrimer = JSON.parse(
      runCli(
        ["context", "prime", "how does auth work", "--path", workspace, "--json"],
        dataDirectory,
      ).stdout,
    ) as {
      indexStatus: { state: string };
      recommendedCommand: string | null;
      results: readonly { relativePath: string }[];
      warnings: readonly string[];
    };
    expect(indexedPrimer.indexStatus.state).toBe("indexed");
    expect(indexedPrimer.recommendedCommand).toBeNull();
    expect(indexedPrimer.warnings).toHaveLength(0);
    expect(indexedPrimer.results[0]?.relativePath).toBe("docs/notes.md");

    const primeAllRejected = runCli(
      ["context", "prime", "auth", "--all", "--json"],
      dataDirectory,
    );
    expect(primeAllRejected.exitCode).toBe(2);
  });

  test("searches across work, memory, and context in one unified query", () => {
    const dataDirectory = createTemporaryDirectory("cairn-cli-data-");
    const workspace = createTemporaryDirectory("cairn-cli-workspace-");
    mkdirSync(join(workspace, ".git"));
    mkdirSync(join(workspace, "docs"));
    writeFileSync(
      join(workspace, "docs", "auth.md"),
      "# Auth\n\nThe auth flow uses refresh tokens.\n",
    );
    runCli(["init", workspace, "--json"], dataDirectory);
    runCli(
      ["work", "create", "Fix auth flow bug", "--path", workspace, "--json"],
      dataDirectory,
    );
    runCli(
      [
        "memory",
        "save",
        "Auth decision",
        "We rotate refresh tokens for the auth flow.",
        "--type",
        "decision",
        "--path",
        workspace,
        "--json",
      ],
      dataDirectory,
    );
    runCli(["context", "refresh", "--path", workspace, "--json"], dataDirectory);

    const result = JSON.parse(
      runCli(["search", "auth flow", "--path", workspace, "--json"], dataDirectory)
        .stdout,
    ) as { matches: readonly { entityKind: string }[]; termCount: number };
    expect(result.termCount).toBe(2);
    expect(result.matches.map((match) => match.entityKind).sort()).toEqual([
      "context_document",
      "memory",
      "work_item",
    ]);

    const kindFiltered = JSON.parse(
      runCli(
        ["search", "auth", "--kind", "work", "--path", workspace, "--json"],
        dataDirectory,
      ).stdout,
    ) as { matches: readonly { entityKind: string }[] };
    expect(kindFiltered.matches).toHaveLength(1);
    expect(kindFiltered.matches[0]?.entityKind).toBe("work_item");

    const invalidKind = runCli(
      ["search", "auth", "--kind", "bogus", "--path", workspace],
      dataDirectory,
    );
    expect(invalidKind.exitCode).toBe(2);

    const invalidQuery = runCli(
      ["search", "!!!", "--path", workspace],
      dataDirectory,
    );
    expect(invalidQuery.exitCode).toBe(2);

    const invalidLimit = runCli(
      ["search", "auth", "--path", workspace, "--limit", "0"],
      dataDirectory,
    );
    expect(invalidLimit.exitCode).toBe(2);

    const noMatches = JSON.parse(
      runCli(["search", "nonexistentterm", "--path", workspace, "--json"], dataDirectory)
        .stdout,
    ) as { matches: readonly unknown[] };
    expect(noMatches.matches).toHaveLength(0);

    const allProjects = JSON.parse(
      runCli(["search", "auth", "--all", "--json"], dataDirectory).stdout,
    ) as { matches: readonly unknown[] };
    expect(allProjects.matches.length).toBeGreaterThan(0);
  });
});
