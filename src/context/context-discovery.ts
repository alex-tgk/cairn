import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import type { ContextSourceConfig } from "./context-config.ts";

const SKIPPED_DIRECTORIES = new Set([
  ".cairn",
  ".git",
  ".next",
  ".cache",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "vendor",
]);
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

export type ContextFileSkipReason =
  | "binary"
  | "outside-source"
  | "oversize"
  | "sensitive"
  | "symlink"
  | "unreadable";

export type DiscoveredContextFile = Readonly<{
  absolutePath: string;
  byteSize: number;
  content: string;
  contentHash: string;
  relativePath: string;
}>;

export type SkippedContextFile = Readonly<{
  reason: ContextFileSkipReason;
  relativePath: string;
}>;

export type ContextDiscovery = Readonly<{
  files: readonly DiscoveredContextFile[];
  skipped: readonly SkippedContextFile[];
  usedGitIgnore: boolean;
}>;

export class ContextDiscoveryError extends Error {
  override readonly name = "ContextDiscoveryError";
}

function toPosixPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function isSkippedDirectory(name: string): boolean {
  return SKIPPED_DIRECTORIES.has(name) || name.startsWith(".venv");
}

function containsSkippedDirectory(relativePath: string): boolean {
  const parts = relativePath.split("/");
  return parts.slice(0, -1).some(isSkippedDirectory);
}

function isWithin(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" ||
    (pathFromParent !== ".." &&
      !pathFromParent.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromParent))
  );
}

function isSamePath(left: string, right: string): boolean {
  if (process.platform === "win32") {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}

function gitVisibleFiles(workspacePath: string): readonly string[] | undefined {
  const result = spawnSync(
    "git",
    [
      "-C",
      workspacePath,
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ],
    {
      encoding: "utf8",
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") {
    return undefined;
  }
  return result.stdout
    .split("\0")
    .filter((path) => path.length > 0)
    .map(toPosixPath)
    .sort();
}

function walkedFiles(workspacePath: string, sourceRoot: string): readonly string[] {
  const paths: string[] = [];

  function visit(directory: string): void {
    const entries = readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => compareText(left.name, right.name),
    );
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const relativePath = toPosixPath(relative(workspacePath, absolutePath));
      if (entry.isSymbolicLink()) {
        paths.push(relativePath);
        continue;
      }
      if (entry.isDirectory()) {
        if (!isSkippedDirectory(entry.name)) {
          visit(absolutePath);
        }
        continue;
      }
      if (entry.isFile()) {
        paths.push(relativePath);
      }
    }
  }

  visit(sourceRoot);
  return paths.sort();
}

function sourceRelativePath(
  workspaceRelativePath: string,
  rootRelativePath: string,
): string | undefined {
  if (rootRelativePath === ".") {
    return workspaceRelativePath;
  }
  if (!workspaceRelativePath.startsWith(`${rootRelativePath}/`)) {
    return undefined;
  }
  return workspaceRelativePath.slice(rootRelativePath.length + 1);
}

function matches(patterns: readonly Bun.Glob[], path: string): boolean {
  return patterns.some((pattern) => pattern.match(path));
}

function isSensitivePath(relativePath: string): boolean {
  const name = relativePath.split("/").at(-1)?.toLowerCase() ?? "";
  return (
    name === ".env" ||
    name.startsWith(".env.") ||
    ["id_dsa", "id_ecdsa", "id_ed25519", "id_rsa"].includes(name) ||
    [
      ".db",
      ".db-shm",
      ".db-wal",
      ".key",
      ".p12",
      ".pem",
      ".pfx",
      ".sqlite",
      ".sqlite3",
    ].some((suffix) => name.endsWith(suffix))
  );
}

function skipped(
  skippedFiles: SkippedContextFile[],
  relativePath: string,
  reason: ContextFileSkipReason,
): void {
  skippedFiles.push({ reason, relativePath });
}

export function discoverContextFiles(
  workspacePath: string,
  source: ContextSourceConfig,
): ContextDiscovery {
  let resolvedWorkspace: string;
  let sourceRoot: string;
  try {
    resolvedWorkspace = realpathSync(resolve(workspacePath));
    const requestedSourceRoot = resolve(
      resolvedWorkspace,
      ...source.rootRelativePath.split("/"),
    );
    sourceRoot = realpathSync(requestedSourceRoot);
    if (
      !isSamePath(sourceRoot, requestedSourceRoot) ||
      !isWithin(resolvedWorkspace, sourceRoot) ||
      !lstatSync(sourceRoot).isDirectory()
    ) {
      throw new ContextDiscoveryError(
        `Context source root must be a real directory inside its workspace: ${source.rootRelativePath}`,
      );
    }
  } catch (error) {
    if (error instanceof ContextDiscoveryError) {
      throw error;
    }
    throw new ContextDiscoveryError(
      `Could not resolve context source root: ${source.rootRelativePath}`,
      { cause: error },
    );
  }

  const gitFiles = gitVisibleFiles(resolvedWorkspace);
  let candidates: readonly string[];
  try {
    candidates = gitFiles ?? walkedFiles(resolvedWorkspace, sourceRoot);
  } catch (error) {
    throw new ContextDiscoveryError(
      `Could not discover files in context source: ${source.name}`,
      { cause: error },
    );
  }
  const includeGlobs = source.includes.map((pattern) => new Bun.Glob(pattern));
  const excludeGlobs = source.excludes.map((pattern) => new Bun.Glob(pattern));
  const files: DiscoveredContextFile[] = [];
  const skippedFiles: SkippedContextFile[] = [];

  for (const workspaceRelativePath of [...new Set(candidates)].sort()) {
    if (containsSkippedDirectory(workspaceRelativePath)) {
      continue;
    }
    const sourceRelative = sourceRelativePath(
      workspaceRelativePath,
      source.rootRelativePath,
    );
    if (
      sourceRelative === undefined ||
      matches(excludeGlobs, sourceRelative) ||
      !matches(includeGlobs, sourceRelative)
    ) {
      continue;
    }
    if (isSensitivePath(sourceRelative)) {
      skipped(skippedFiles, workspaceRelativePath, "sensitive");
      continue;
    }

    const absolutePath = resolve(
      resolvedWorkspace,
      ...workspaceRelativePath.split("/"),
    );
    if (!isWithin(sourceRoot, absolutePath)) {
      skipped(skippedFiles, workspaceRelativePath, "outside-source");
      continue;
    }

    let metadata: ReturnType<typeof lstatSync>;
    try {
      metadata = lstatSync(absolutePath);
    } catch {
      skipped(skippedFiles, workspaceRelativePath, "unreadable");
      continue;
    }
    if (metadata.isSymbolicLink()) {
      skipped(skippedFiles, workspaceRelativePath, "symlink");
      continue;
    }
    if (!metadata.isFile()) {
      continue;
    }
    if (metadata.size > source.maxFileBytes) {
      skipped(skippedFiles, workspaceRelativePath, "oversize");
      continue;
    }

    let body: Buffer;
    try {
      if (!isWithin(sourceRoot, realpathSync(absolutePath))) {
        skipped(skippedFiles, workspaceRelativePath, "outside-source");
        continue;
      }
      body = readFileSync(absolutePath);
    } catch {
      skipped(skippedFiles, workspaceRelativePath, "unreadable");
      continue;
    }
    if (body.includes(0)) {
      skipped(skippedFiles, workspaceRelativePath, "binary");
      continue;
    }

    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch {
      skipped(skippedFiles, workspaceRelativePath, "binary");
      continue;
    }
    files.push({
      absolutePath,
      byteSize: body.byteLength,
      content,
      contentHash: createHash("sha256").update(body).digest("hex"),
      relativePath: workspaceRelativePath,
    });
  }

  return {
    files: files.sort((left, right) =>
      compareText(left.relativePath, right.relativePath),
    ),
    skipped: skippedFiles.sort(
      (left, right) =>
        compareText(left.relativePath, right.relativePath) ||
        compareText(left.reason, right.reason),
    ),
    usedGitIgnore: gitFiles !== undefined,
  };
}
