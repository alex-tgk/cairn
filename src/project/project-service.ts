import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { resolveDataDirectory } from "../platform/data-directory.ts";
import {
  getProjectWorkspaceCount,
  getWorkspaceId,
  openCairnDatabase,
  registerProjectWorkspace,
} from "../storage/database.ts";
import {
  createProjectManifest,
  findProjectManifest,
} from "./manifest.ts";
import { findWorkspaceRoot, inferProjectName } from "./workspace-root.ts";

type ProjectServiceOptions = Readonly<{
  dataDirectory?: string;
  idFactory?: () => string;
  now?: () => string;
  path: string;
}>;

export type ProjectStatus = Readonly<{
  databasePath: string;
  manifestPath: string;
  name: string;
  projectId: string;
  workspaceCount: number;
  workspaceId: string;
  workspacePath: string;
}>;

export type InitializedProject = ProjectStatus &
  Readonly<{ createdManifest: boolean }>;

export class ProjectNotFoundError extends Error {
  override readonly name = "ProjectNotFoundError";
}

function registerCurrentWorkspace(
  located: NonNullable<ReturnType<typeof findProjectManifest>>,
  options: ProjectServiceOptions,
): ProjectStatus {
  const dataDirectory = options.dataDirectory ?? resolveDataDirectory();
  const databasePath = join(dataDirectory, "cairn.db");
  const database = openCairnDatabase(databasePath);
  const now = (options.now ?? (() => new Date().toISOString()))();
  const idFactory = options.idFactory ?? randomUUID;

  try {
    const generatedWorkspaceId = idFactory();
    registerProjectWorkspace(database, {
      name: located.manifest.name,
      now,
      projectId: located.manifest.projectId,
      workspaceId: generatedWorkspaceId,
      workspacePath: located.workspacePath,
    });

    return {
      databasePath,
      manifestPath: located.path,
      name: located.manifest.name,
      projectId: located.manifest.projectId,
      workspaceCount: getProjectWorkspaceCount(
        database,
        located.manifest.projectId,
      ),
      workspaceId:
        getWorkspaceId(database, located.workspacePath) ??
        generatedWorkspaceId,
      workspacePath: located.workspacePath,
    };
  } finally {
    database.close();
  }
}

export function initializeProject(
  options: ProjectServiceOptions,
): InitializedProject {
  const existingManifest = findProjectManifest(options.path);
  if (existingManifest) {
    return {
      ...registerCurrentWorkspace(existingManifest, options),
      createdManifest: false,
    };
  }

  const workspacePath = findWorkspaceRoot(options.path);
  const idFactory = options.idFactory ?? randomUUID;
  const created = createProjectManifest(workspacePath, {
    name: inferProjectName(workspacePath),
    projectId: idFactory(),
  });
  const located = {
    manifest: created.manifest,
    path: created.path,
    workspacePath,
  };

  return {
    ...registerCurrentWorkspace(located, { ...options, idFactory }),
    createdManifest: created.created,
  };
}

export function getProjectStatus(
  options: ProjectServiceOptions,
): ProjectStatus {
  const located = findProjectManifest(options.path);
  if (!located) {
    throw new ProjectNotFoundError(
      `No Cairn project found from: ${options.path}`,
    );
  }

  return registerCurrentWorkspace(located, options);
}
