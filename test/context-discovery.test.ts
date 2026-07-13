import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

import type { ContextSourceConfig } from "../src/context/context-config.ts";
import { discoverContextFiles } from "../src/context/context-discovery.ts";

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "cairn-context-discovery-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeWorkspaceFile(
  workspace: string,
  relativePath: string,
  content: string | Uint8Array,
): string {
  const path = join(workspace, ...relativePath.split("/"));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

const DEFAULT_SOURCE: ContextSourceConfig = {
  excludes: [],
  includes: [
    "**/*.[Mm][Dd]",
    "**/*.[Mm][Dd][Xx]",
    "**/[Rr][Ee][Aa][Dd][Mm][Ee]*",
    "**/package.json",
  ],
  maxFileBytes: 1_000_000,
  name: "project",
  rootRelativePath: ".",
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("context file discovery", () => {
  test("discovers high-signal files in stable relative-path order", () => {
    const workspace = createTemporaryDirectory();
    writeWorkspaceFile(workspace, "README.md", "# Project\n");
    writeWorkspaceFile(workspace, "docs/guide.md", "Guide\n");
    writeWorkspaceFile(workspace, "packages/app/package.json", '{"name":"app"}\n');
    writeWorkspaceFile(workspace, "src/index.ts", "export {};\n");
    writeWorkspaceFile(workspace, "node_modules/pkg/README.md", "dependency\n");
    writeWorkspaceFile(workspace, "dist/README.md", "generated\n");
    writeWorkspaceFile(workspace, ".cairn/notes.md", "internal\n");

    const discovery = discoverContextFiles(workspace, DEFAULT_SOURCE);

    expect(discovery.usedGitIgnore).toBe(false);
    expect(discovery.files.map(({ relativePath }) => relativePath)).toEqual([
      "README.md",
      "docs/guide.md",
      "packages/app/package.json",
    ]);
    expect(discovery.files[0]).toMatchObject({
      byteSize: 10,
      content: "# Project\n",
      contentHash:
        "aef277fb6a70a89681a85e1b6d23f44ee2a6cc58490f9f5c95fc99db6d2d3542",
    });
  });

  test("applies configured source roots and excludes", () => {
    const workspace = createTemporaryDirectory();
    writeWorkspaceFile(workspace, "README.md", "root\n");
    writeWorkspaceFile(workspace, "docs/keep.md", "keep\n");
    writeWorkspaceFile(workspace, "docs/generated/drop.md", "drop\n");

    const discovery = discoverContextFiles(workspace, {
      ...DEFAULT_SOURCE,
      excludes: ["generated/**"],
      rootRelativePath: "docs",
    });

    expect(discovery.files.map(({ relativePath }) => relativePath)).toEqual([
      "docs/keep.md",
    ]);
  });

  test("honors Git ignore rules when Git discovery is available", () => {
    const workspace = createTemporaryDirectory();
    const initialized = spawnSync("git", ["init", "--quiet", workspace]);
    expect(initialized.status).toBe(0);
    writeWorkspaceFile(workspace, ".gitignore", "ignored.md\n");
    writeWorkspaceFile(workspace, "visible.md", "visible\n");
    writeWorkspaceFile(workspace, "ignored.md", "ignored\n");

    const discovery = discoverContextFiles(workspace, DEFAULT_SOURCE);

    expect(discovery.usedGitIgnore).toBe(true);
    expect(discovery.files.map(({ relativePath }) => relativePath)).toEqual([
      "visible.md",
    ]);
  });

  test("reports unsafe, oversized, and binary matches without reading them as text", () => {
    const workspace = createTemporaryDirectory();
    writeWorkspaceFile(workspace, "visible.txt", "visible\n");
    writeWorkspaceFile(workspace, ".env", "TOKEN=secret\n");
    writeWorkspaceFile(workspace, "private.pem", "secret\n");
    writeWorkspaceFile(workspace, "state.sqlite", "database\n");
    writeWorkspaceFile(workspace, "large.txt", "x".repeat(17));
    writeWorkspaceFile(workspace, "binary.txt", new Uint8Array([65, 0, 66]));

    const discovery = discoverContextFiles(workspace, {
      ...DEFAULT_SOURCE,
      includes: ["**/*"],
      maxFileBytes: 16,
    });

    expect(discovery.files.map(({ relativePath }) => relativePath)).toEqual([
      "visible.txt",
    ]);
    expect(discovery.skipped).toEqual([
      { reason: "sensitive", relativePath: ".env" },
      { reason: "binary", relativePath: "binary.txt" },
      { reason: "oversize", relativePath: "large.txt" },
      { reason: "sensitive", relativePath: "private.pem" },
      { reason: "sensitive", relativePath: "state.sqlite" },
    ]);
  });

  test("never follows matching symbolic links", () => {
    if (process.platform === "win32") {
      return;
    }

    const workspace = createTemporaryDirectory();
    const outside = createTemporaryDirectory();
    writeWorkspaceFile(outside, "outside.md", "outside\n");
    symlinkSync(join(outside, "outside.md"), join(workspace, "linked.md"));

    const discovery = discoverContextFiles(workspace, DEFAULT_SOURCE);

    expect(discovery.files).toEqual([]);
    expect(discovery.skipped).toEqual([
      { reason: "symlink", relativePath: "linked.md" },
    ]);
  });
});
