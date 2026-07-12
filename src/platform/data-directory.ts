import { homedir } from "node:os";
import { join, win32 } from "node:path";

type Environment = Readonly<Record<string, string | undefined>>;

export type DataDirectoryOptions = Readonly<{
  environment?: Environment;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
}>;

export function resolveDataDirectory(
  options: DataDirectoryOptions = {},
): string {
  const environment = options.environment ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();
  const platform = options.platform ?? process.platform;
  const configuredDirectory = environment.CAIRN_DATA_DIR;

  if (configuredDirectory) {
    return configuredDirectory;
  }

  if (platform === "darwin") {
    return join(homeDirectory, "Library", "Application Support", "Cairn");
  }

  if (platform === "win32") {
    const localApplicationData =
      environment.LOCALAPPDATA ??
      win32.join(homeDirectory, "AppData", "Local");
    return win32.join(localApplicationData, "Cairn");
  }

  return join(environment.XDG_DATA_HOME ?? join(homeDirectory, ".local", "share"), "cairn");
}
