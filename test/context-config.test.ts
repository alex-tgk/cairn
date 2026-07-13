import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  ContextConfigError,
  fingerprintContextConfig,
  loadContextConfig,
  normalizeContextRelativePath,
} from "../src/context/context-config.ts";

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "cairn-context-config-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeConfig(workspace: string, source: string): void {
  const path = join(workspace, ".cairn", "context.toml");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("context source configuration", () => {
  test("uses deterministic high-signal defaults when no config exists", () => {
    const workspace = createTemporaryDirectory();

    const loaded = loadContextConfig(workspace);

    expect(loaded.usesDefaults).toBe(true);
    expect(loaded.path).toBe(join(workspace, ".cairn", "context.toml"));
    expect(loaded.config).toMatchObject({
      version: 1,
      sources: [
        {
          excludes: [],
          maxFileBytes: 1_000_000,
          name: "project",
          rootRelativePath: ".",
        },
      ],
    });
    expect(loaded.config.sources[0]?.includes).toContain("**/*.[Mm][Dd]");
    expect(loaded.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
  });

  test("loads and normalizes versioned source configuration", () => {
    const workspace = createTemporaryDirectory();
    writeConfig(
      workspace,
      `version = 1

[[sources]]
name = "docs"
root = 'docs\\guides/'
include = ["**/*.md", "README*"]
exclude = ["generated/**"]
max_file_bytes = 2048
`,
    );

    const loaded = loadContextConfig(workspace);

    expect(loaded).toMatchObject({
      usesDefaults: false,
      config: {
        version: 1,
        sources: [
          {
            excludes: ["generated/**"],
            includes: ["**/*.md", "README*"],
            maxFileBytes: 2048,
            name: "docs",
            rootRelativePath: "docs/guides",
          },
        ],
      },
    });
    expect(loaded.fingerprint).toBe(fingerprintContextConfig(loaded.config));
  });

  test("normalizes Windows separators to portable relative paths", () => {
    expect(normalizeContextRelativePath("docs\\guides\\README.md")).toBe(
      "docs/guides/README.md",
    );
  });

  test("rejects roots that can escape the workspace", () => {
    const workspace = createTemporaryDirectory();
    writeConfig(
      workspace,
      `version = 1
[[sources]]
name = "outside"
root = "../secrets"
`,
    );

    expect(() => loadContextConfig(workspace)).toThrow(ContextConfigError);
    expect(() => normalizeContextRelativePath("C:\\secrets")).toThrow(
      ContextConfigError,
    );
  });

  test("rejects duplicate source names and unsafe file limits", () => {
    const workspace = createTemporaryDirectory();
    writeConfig(
      workspace,
      `version = 1
[[sources]]
name = "docs"
root = "."
max_file_bytes = 1000001
[[sources]]
name = "docs"
root = "docs"
`,
    );

    expect(() => loadContextConfig(workspace)).toThrow(ContextConfigError);
  });

  test("rejects malformed dynamic TOML data at the boundary", () => {
    const workspace = createTemporaryDirectory();
    writeConfig(workspace, 'version = 1\nsources = "docs"\n');

    expect(() => loadContextConfig(workspace)).toThrow(ContextConfigError);
  });
});
