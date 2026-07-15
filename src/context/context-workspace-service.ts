import { join } from "node:path";

import { resolveDataDirectory } from "../platform/data-directory.ts";
import {
  ensureProjectInitialized,
  type ProjectStatus,
} from "../project/project-service.ts";
import {
  listRegisteredProjectWorkspaces,
  openCairnDatabase,
} from "../storage/database.ts";
import { CairnQueryDatabase } from "../storage/query-database.ts";
import {
  getContextIndexStatus,
  indexContext,
  primeContext,
  searchContext,
  type ContextIndexStatusSummary,
  type ContextIndexSummary,
  type ContextPrimeView,
  type ContextSearchResultView,
} from "./context-service.ts";
import type { ContextIndexMode } from "./context-index-repository.ts";
import { SqliteContextIndexRepository } from "./sqlite-context-index-repository.ts";

export class ContextScopeValidationError extends Error {
  readonly code = "invalid_context_scope";
  override readonly name = "ContextScopeValidationError";
}

export type ContextWorkspaceOptions = Readonly<{
  all?: boolean | undefined;
  dataDirectory?: string | undefined;
  explicitPath?: boolean | undefined;
  path: string;
}>;

type WorkspaceTarget = Readonly<{
  projectId: string;
  workspaceId: string;
  workspacePath: string;
}>;

type ResolvedScope = Readonly<{
  databasePath: string;
  targets: readonly WorkspaceTarget[];
}>;

function resolveProjectStatus(options: ContextWorkspaceOptions): ProjectStatus {
  if (options.dataDirectory === undefined) {
    return ensureProjectInitialized({ path: options.path });
  }
  return ensureProjectInitialized({
    dataDirectory: options.dataDirectory,
    path: options.path,
  });
}

function assertValidScope(options: ContextWorkspaceOptions): void {
  if (options.all && options.explicitPath) {
    throw new ContextScopeValidationError(
      "Cannot combine --all with --path; --all operates across every registered project",
    );
  }
}

function resolveScope(options: ContextWorkspaceOptions): ResolvedScope {
  assertValidScope(options);

  // --all never resolves or registers the ambient current-directory project;
  // it only reads projects/workspaces already registered in the shared database.
  if (options.all) {
    const dataDirectory = options.dataDirectory ?? resolveDataDirectory();
    const databasePath = join(dataDirectory, "cairn.db");
    const database = openCairnDatabase(databasePath);
    try {
      return {
        databasePath,
        targets: listRegisteredProjectWorkspaces(database),
      };
    } finally {
      database.close();
    }
  }

  const project = resolveProjectStatus(options);
  return {
    databasePath: project.databasePath,
    targets: [
      {
        projectId: project.projectId,
        workspaceId: project.workspaceId,
        workspacePath: project.workspacePath,
      },
    ],
  };
}

async function withContextRepository<Result>(
  databasePath: string,
  action: (repository: SqliteContextIndexRepository) => Promise<Result>,
): Promise<Result> {
  const database = new CairnQueryDatabase(openCairnDatabase(databasePath));
  try {
    return await action(new SqliteContextIndexRepository(database));
  } finally {
    await database.close();
  }
}

export async function runContextIndex(
  mode: ContextIndexMode,
  options: ContextWorkspaceOptions,
): Promise<readonly ContextIndexSummary[]> {
  const { databasePath, targets } = resolveScope(options);
  if (targets.length === 0) {
    return [];
  }

  return withContextRepository(databasePath, async (repository) =>
    Promise.all(
      targets.map((target) =>
        indexContext({
          mode,
          projectId: target.projectId,
          repository,
          workspaceId: target.workspaceId,
          workspacePath: target.workspacePath,
        }),
      ),
    ),
  );
}

export async function getContextStatus(
  options: ContextWorkspaceOptions,
): Promise<readonly ContextIndexStatusSummary[]> {
  const { databasePath, targets } = resolveScope(options);
  if (targets.length === 0) {
    return [];
  }

  return withContextRepository(databasePath, async (repository) =>
    Promise.all(
      targets.map((target) =>
        getContextIndexStatus({
          projectId: target.projectId,
          repository,
          workspaceId: target.workspaceId,
          workspacePath: target.workspacePath,
        }),
      ),
    ),
  );
}

export async function searchContextWorkspace(
  options: ContextWorkspaceOptions,
  query: string,
  limit?: number,
): Promise<ContextSearchResultView> {
  const { databasePath, targets } = resolveScope(options);

  return withContextRepository(databasePath, (repository) =>
    searchContext({
      limit,
      query,
      repository,
      scopes: targets.map((target) => ({
        projectId: target.projectId,
        workspaceId: target.workspaceId,
      })),
    }),
  );
}

export async function primeContextWorkspace(
  options: ContextWorkspaceOptions,
  question: string,
  limit?: number,
): Promise<ContextPrimeView> {
  if (options.all) {
    throw new ContextScopeValidationError(
      "cairn context prime does not support --all; pass --path or run from the project workspace",
    );
  }

  const project = resolveProjectStatus(options);
  return withContextRepository(project.databasePath, (repository) =>
    primeContext({
      limit,
      projectIdentity: {
        name: project.name,
        projectId: project.projectId,
        workspaceId: project.workspaceId,
        workspacePath: project.workspacePath,
      },
      question,
      repository,
    }),
  );
}
