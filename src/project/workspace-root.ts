import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export function findWorkspaceRoot(startingPath: string): string {
  const resolvedStartingPath = resolve(startingPath);
  let currentPath = resolvedStartingPath;

  while (true) {
    if (existsSync(join(currentPath, ".git"))) {
      return currentPath;
    }

    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) {
      return resolvedStartingPath;
    }
    currentPath = parentPath;
  }
}

export function inferProjectName(workspacePath: string): string {
  return basename(workspacePath) || "Cairn project";
}
