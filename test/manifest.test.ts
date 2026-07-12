import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  createProjectManifest,
  findProjectManifest,
  ProjectManifestError,
  readProjectManifest,
} from "../src/project/manifest.ts";

const PROJECT_ID = "018f4f32-95d6-7d6d-9f54-1d6d7a6d9a0e";
const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "cairn-manifest-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("project manifests", () => {
  test("creates and reads a stable project manifest", () => {
    const workspace = createTemporaryDirectory();

    const created = createProjectManifest(workspace, {
      name: "Cairn",
      projectId: PROJECT_ID,
    });

    expect(created.created).toBe(true);
    expect(created.manifest).toEqual({
      name: "Cairn",
      projectId: PROJECT_ID,
      version: 1,
    });
    expect(readProjectManifest(created.path)).toEqual(created.manifest);
  });

  test("finds the nearest manifest from a nested directory", () => {
    const workspace = createTemporaryDirectory();
    const nested = join(workspace, "src", "feature");
    mkdirSync(nested, { recursive: true });
    const created = createProjectManifest(workspace, {
      name: "Cairn",
      projectId: PROJECT_ID,
    });

    expect(findProjectManifest(nested)).toEqual({
      manifest: created.manifest,
      path: created.path,
      workspacePath: workspace,
    });
  });

  test("does not replace an existing project identity", () => {
    const workspace = createTemporaryDirectory();
    const first = createProjectManifest(workspace, {
      name: "Cairn",
      projectId: PROJECT_ID,
    });

    const second = createProjectManifest(workspace, {
      name: "Different",
      projectId: "018f4f32-95d6-7d6d-9f54-1d6d7a6d9a0f",
    });

    expect(second.created).toBe(false);
    expect(second.manifest).toEqual(first.manifest);
  });

  test("rejects malformed external manifest data", () => {
    const workspace = createTemporaryDirectory();
    const manifestPath = join(workspace, ".cairn", "project.toml");
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, 'version = 1\nproject_id = "not-a-uuid"\nname = "Cairn"\n');

    expect(() => readProjectManifest(manifestPath)).toThrow(ProjectManifestError);
  });

  test("rejects an invalid generated project identity", () => {
    const workspace = createTemporaryDirectory();

    expect(() =>
      createProjectManifest(workspace, {
        name: "Cairn",
        projectId: "not-a-uuid",
      }),
    ).toThrow(ProjectManifestError);
  });
});
