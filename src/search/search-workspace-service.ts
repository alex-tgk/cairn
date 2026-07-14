import { join } from "node:path";

import { resolveDataDirectory } from "../platform/data-directory.ts";
import { getProjectStatus } from "../project/project-service.ts";
import {
  listRegisteredProjectWorkspaces,
  openCairnDatabase,
} from "../storage/database.ts";
import { CairnQueryDatabase } from "../storage/query-database.ts";
import { search, type SearchResultView } from "./search-service.ts";
import type { SearchEntityKind } from "./search-repository.ts";
import { SqliteSearchRepository } from "./sqlite-search-repository.ts";

export class SearchScopeValidationError extends Error {
  readonly code = "invalid_search_scope";
  override readonly name = "SearchScopeValidationError";
}

export type SearchWorkspaceOptions = Readonly<{
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

function assertValidScope(options: SearchWorkspaceOptions): void {
  if (options.all && options.explicitPath) {
    throw new SearchScopeValidationError(
      "Cannot combine --all with --path; --all operates across every registered project",
    );
  }
}

function resolveScope(options: SearchWorkspaceOptions): ResolvedScope {
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

  const project =
    options.dataDirectory === undefined
      ? getProjectStatus({ path: options.path })
      : getProjectStatus({
          dataDirectory: options.dataDirectory,
          path: options.path,
        });
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

export async function searchWorkspace(
  options: SearchWorkspaceOptions,
  query: string,
  kinds: readonly SearchEntityKind[] | undefined,
  limit?: number,
): Promise<SearchResultView> {
  const { databasePath, targets } = resolveScope(options);
  const database = new CairnQueryDatabase(openCairnDatabase(databasePath));
  try {
    return await search({
      kinds,
      limit,
      query,
      repository: new SqliteSearchRepository(database),
      scopes: targets.map((target) => ({
        projectId: target.projectId,
        workspaceId: target.workspaceId,
      })),
    });
  } finally {
    await database.close();
  }
}
