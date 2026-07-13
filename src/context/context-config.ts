import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, posix, resolve, win32 } from "node:path";

export const CONTEXT_CONFIG_VERSION = 1;
export const MAX_CONTEXT_FILE_BYTES = 1_000_000;

const DEFAULT_INCLUDES = [
  "**/*.[Mm][Dd]",
  "**/*.[Mm][Dd][Xx]",
  "**/[Rr][Ee][Aa][Dd][Mm][Ee]*",
  "**/AGENTS.md",
  "**/CLAUDE.md",
  "**/GEMINI.md",
  "**/package.json",
  "**/pnpm-workspace.yaml",
  "**/turbo.json",
  "**/nx.json",
  "**/tsconfig.json",
  "**/biome.json",
  "**/Dockerfile",
  "**/Makefile",
  "**/vite.config.ts",
  "**/vite.config.js",
  "**/next.config.js",
  "**/next.config.mjs",
  "**/eslint.config.js",
  "**/eslint.config.mjs",
  "**/eslint.config.cjs",
  "**/eslint.config.ts",
  "**/vitest.config.js",
  "**/vitest.config.mjs",
  "**/vitest.config.ts",
] as const;

export type ContextSourceConfig = Readonly<{
  excludes: readonly string[];
  includes: readonly string[];
  maxFileBytes: number;
  name: string;
  rootRelativePath: string;
}>;

export type ContextConfig = Readonly<{
  sources: readonly ContextSourceConfig[];
  version: typeof CONTEXT_CONFIG_VERSION;
}>;

export type LoadedContextConfig = Readonly<{
  config: ContextConfig;
  fingerprint: string;
  path: string;
  usesDefaults: boolean;
}>;

export class ContextConfigError extends Error {
  override readonly name = "ContextConfigError";
}

export const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  sources: [
    {
      excludes: [],
      includes: DEFAULT_INCLUDES,
      maxFileBytes: MAX_CONTEXT_FILE_BYTES,
      name: "project",
      rootRelativePath: ".",
    },
  ],
  version: CONTEXT_CONFIG_VERSION,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidConfig(message: string): ContextConfigError {
  return new ContextConfigError(`Invalid Cairn context config: ${message}`);
}

export function normalizeContextRelativePath(value: string): string {
  const withPosixSeparators = value.replaceAll("\\", "/");
  if (
    withPosixSeparators.length === 0 ||
    withPosixSeparators.includes("\0") ||
    posix.isAbsolute(withPosixSeparators) ||
    win32.isAbsolute(value)
  ) {
    throw invalidConfig(`source root must be workspace-relative: ${value}`);
  }

  const normalized = posix.normalize(withPosixSeparators);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw invalidConfig(`source root escapes the workspace: ${value}`);
  }

  return normalized.endsWith("/")
    ? normalized.slice(0, -1)
    : normalized;
}

function validatePattern(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw invalidConfig(`${field} patterns must be non-empty strings`);
  }

  const normalized = value.replaceAll("\\", "/");
  if (
    posix.isAbsolute(normalized) ||
    win32.isAbsolute(value) ||
    normalized.split("/").includes("..")
  ) {
    throw invalidConfig(`${field} patterns must stay inside their source root`);
  }
  return normalized;
}

function stringPatterns(
  value: unknown,
  field: string,
  fallback: readonly string[],
): readonly string[] {
  if (value === undefined) {
    return fallback;
  }
  if (!Array.isArray(value)) {
    throw invalidConfig(`${field} must be an array of glob patterns`);
  }
  return value.map((entry) => validatePattern(entry, field));
}

function parseSource(value: unknown, index: number): ContextSourceConfig {
  if (!isRecord(value)) {
    throw invalidConfig(`sources[${index}] must be a table`);
  }

  const name = value.name;
  if (
    typeof name !== "string" ||
    !/^[a-z0-9][a-z0-9._-]*$/u.test(name)
  ) {
    throw invalidConfig(
      `sources[${index}].name must use lowercase letters, numbers, dots, dashes, or underscores`,
    );
  }

  const root = value.root ?? ".";
  if (typeof root !== "string") {
    throw invalidConfig(`sources[${index}].root must be a string`);
  }

  const maxFileBytes = value.max_file_bytes ?? MAX_CONTEXT_FILE_BYTES;
  if (
    typeof maxFileBytes !== "number" ||
    !Number.isInteger(maxFileBytes) ||
    maxFileBytes < 1 ||
    maxFileBytes > MAX_CONTEXT_FILE_BYTES
  ) {
    throw invalidConfig(
      `sources[${index}].max_file_bytes must be an integer from 1 to ${MAX_CONTEXT_FILE_BYTES}`,
    );
  }

  return {
    excludes: stringPatterns(
      value.exclude,
      `sources[${index}].exclude`,
      [],
    ),
    includes: stringPatterns(
      value.include,
      `sources[${index}].include`,
      DEFAULT_INCLUDES,
    ),
    maxFileBytes,
    name,
    rootRelativePath: normalizeContextRelativePath(root),
  };
}

function parseContextConfig(value: unknown): ContextConfig {
  if (!isRecord(value) || value.version !== CONTEXT_CONFIG_VERSION) {
    throw invalidConfig(`version must be ${CONTEXT_CONFIG_VERSION}`);
  }
  if (!Array.isArray(value.sources) || value.sources.length === 0) {
    throw invalidConfig("sources must be a non-empty array of tables");
  }

  const sources = value.sources.map(parseSource);
  if (new Set(sources.map(({ name }) => name)).size !== sources.length) {
    throw invalidConfig("source names must be unique");
  }
  return { sources, version: CONTEXT_CONFIG_VERSION };
}

export function fingerprintContextConfig(config: ContextConfig): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

export function loadContextConfig(workspacePath: string): LoadedContextConfig {
  const path = join(resolve(workspacePath), ".cairn", "context.toml");
  if (!existsSync(path)) {
    return {
      config: DEFAULT_CONTEXT_CONFIG,
      fingerprint: fingerprintContextConfig(DEFAULT_CONTEXT_CONFIG),
      path,
      usesDefaults: true,
    };
  }

  try {
    const parsed: unknown = Bun.TOML.parse(readFileSync(path, "utf8"));
    const config = parseContextConfig(parsed);
    return {
      config,
      fingerprint: fingerprintContextConfig(config),
      path,
      usesDefaults: false,
    };
  } catch (error) {
    if (error instanceof ContextConfigError) {
      throw error;
    }
    throw new ContextConfigError(`Could not read Cairn context config: ${path}`, {
      cause: error,
    });
  }
}
