import { homedir } from "node:os";
import { posix, win32 } from "node:path";

type Environment = Readonly<Record<string, string | undefined>>;

export type DataDirectoryOptions = Readonly<{
  environment?: Environment;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
}>;

// Cairn is a CLI tool, not a GUI application, and its data directory must
// not require write access to OS-managed application-data locations (e.g.
// macOS's "Application Support" or Windows's AppData\Local can be
// restricted or absent in locked-down environments). A single dotfolder
// under the user's home directory works everywhere and matches the
// convention used by CLI tools like git, gh, and docker.
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

  const join = platform === "win32" ? win32.join : posix.join;
  return join(homeDirectory, ".cairn");
}
