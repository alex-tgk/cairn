import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

const MANIFEST_VERSION = 1;
const PROJECT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export type ProjectManifest = Readonly<{
  name: string;
  projectId: string;
  version: typeof MANIFEST_VERSION;
}>;

export type LocatedProjectManifest = Readonly<{
  manifest: ProjectManifest;
  path: string;
  workspacePath: string;
}>;

export class ProjectManifestError extends Error {
  override readonly name = "ProjectManifestError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseProjectManifest(value: unknown, manifestPath: string): ProjectManifest {
  if (!isRecord(value)) {
    throw new ProjectManifestError(`Invalid Cairn project manifest: ${manifestPath}`);
  }

  const version = value.version;
  const projectId = value.project_id;
  const name = value.name;

  if (
    version !== MANIFEST_VERSION ||
    typeof projectId !== "string" ||
    !PROJECT_ID_PATTERN.test(projectId) ||
    typeof name !== "string" ||
    name.trim().length === 0
  ) {
    throw new ProjectManifestError(`Invalid Cairn project manifest: ${manifestPath}`);
  }

  return { name: name.trim(), projectId, version };
}

function serializeProjectManifest(manifest: ProjectManifest): string {
  return [
    `version = ${manifest.version}`,
    `project_id = ${JSON.stringify(manifest.projectId)}`,
    `name = ${JSON.stringify(manifest.name)}`,
    "",
  ].join("\n");
}

export function readProjectManifest(manifestPath: string): ProjectManifest {
  try {
    const source = readFileSync(manifestPath, "utf8");
    return parseProjectManifest(Bun.TOML.parse(source), manifestPath);
  } catch (error) {
    if (error instanceof ProjectManifestError) {
      throw error;
    }

    throw new ProjectManifestError(
      `Could not read Cairn project manifest: ${manifestPath}`,
      { cause: error },
    );
  }
}

export function createProjectManifest(
  workspacePath: string,
  manifest: Omit<ProjectManifest, "version">,
): Readonly<{ created: boolean; manifest: ProjectManifest; path: string }> {
  const path = join(resolve(workspacePath), ".cairn", "project.toml");

  if (existsSync(path)) {
    return { created: false, manifest: readProjectManifest(path), path };
  }

  const projectManifest = parseProjectManifest(
    {
      name: manifest.name.trim(),
      project_id: manifest.projectId,
      version: MANIFEST_VERSION,
    },
    path,
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeProjectManifest(projectManifest), {
    encoding: "utf8",
    flag: "wx",
    mode: 0o644,
  });

  return { created: true, manifest: projectManifest, path };
}

export function findProjectManifest(
  startingPath: string,
): LocatedProjectManifest | undefined {
  let currentPath = resolve(startingPath);

  while (true) {
    const manifestPath = join(currentPath, ".cairn", "project.toml");
    if (existsSync(manifestPath)) {
      return {
        manifest: readProjectManifest(manifestPath),
        path: manifestPath,
        workspacePath: currentPath,
      };
    }

    const parentPath = dirname(currentPath);
    if (parentPath === currentPath || parse(currentPath).root === currentPath) {
      return undefined;
    }
    currentPath = parentPath;
  }
}
