import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getProjectStatus,
  initializeProject,
  ProjectNotFoundError,
} from "../src/project/project-service.ts";

const PROJECT_ID = "018f4f32-95d6-7d6d-9f54-1d6d7a6d9a0e";
const WORKSPACE_IDS = [
  "018f4f32-95d6-7d6d-9f54-1d6d7a6d9a10",
  "018f4f32-95d6-7d6d-9f54-1d6d7a6d9a11",
];
const temporaryDirectories: string[] = [];

function createEnvironment(): { dataDirectory: string; workspace: string } {
  const root = mkdtempSync(join(tmpdir(), "cairn-service-"));
  temporaryDirectories.push(root);
  const workspace = join(root, "workspace");
  mkdirSync(join(workspace, ".git"), { recursive: true });
  return { dataDirectory: join(root, "data"), workspace };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("project service", () => {
  test("initializes a project from a nested Git workspace", () => {
    const environment = createEnvironment();
    const nested = join(environment.workspace, "src", "feature");
    mkdirSync(nested, { recursive: true });
    const ids = [PROJECT_ID, WORKSPACE_IDS[0]];

    const initialized = initializeProject({
      dataDirectory: environment.dataDirectory,
      idFactory: () => ids.shift() ?? "unexpected-id",
      now: () => "2026-07-12T12:00:00.000Z",
      path: nested,
    });

    expect(initialized).toMatchObject({
      createdManifest: true,
      name: "workspace",
      projectId: PROJECT_ID,
      workspacePath: environment.workspace,
    });
    expect(existsSync(join(environment.workspace, ".cairn", "project.toml"))).toBe(true);
    expect(existsSync(join(environment.dataDirectory, "cairn.db"))).toBe(true);
  });

  test("keeps project identity after the workspace directory moves", () => {
    const environment = createEnvironment();
    const ids = [PROJECT_ID, ...WORKSPACE_IDS];
    const services = {
      dataDirectory: environment.dataDirectory,
      idFactory: () => ids.shift() ?? "unexpected-id",
      now: () => "2026-07-12T12:00:00.000Z",
    };
    initializeProject({ ...services, path: environment.workspace });
    const movedWorkspace = join(
      environment.workspace,
      "..",
      "renamed-workspace",
    );
    renameSync(environment.workspace, movedWorkspace);

    const status = getProjectStatus({ ...services, path: movedWorkspace });

    expect(status.projectId).toBe(PROJECT_ID);
    expect(status.workspacePath).toBe(movedWorkspace);
    expect(status.workspaceCount).toBe(2);
  });

  test("reports when the current directory is not attached to Cairn", () => {
    const environment = createEnvironment();

    expect(() =>
      getProjectStatus({
        dataDirectory: environment.dataDirectory,
        idFactory: () => PROJECT_ID,
        now: () => "2026-07-12T12:00:00.000Z",
        path: environment.workspace,
      }),
    ).toThrow(ProjectNotFoundError);
  });
});
