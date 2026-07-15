import { describe, expect, test } from "bun:test";

import { resolveDataDirectory } from "../src/platform/data-directory.ts";

describe("resolveDataDirectory", () => {
  test("uses CAIRN_DATA_DIR when configured", () => {
    expect(
      resolveDataDirectory({
        environment: { CAIRN_DATA_DIR: "/custom/cairn" },
        homeDirectory: "/home/ada",
        platform: "linux",
      }),
    ).toBe("/custom/cairn");
  });

  test("uses a home dotfolder on macOS", () => {
    expect(
      resolveDataDirectory({
        environment: {},
        homeDirectory: "/Users/ada",
        platform: "darwin",
      }),
    ).toBe("/Users/ada/.cairn");
  });

  test("uses a home dotfolder on Linux, ignoring XDG_DATA_HOME", () => {
    expect(
      resolveDataDirectory({
        environment: { XDG_DATA_HOME: "/data" },
        homeDirectory: "/home/ada",
        platform: "linux",
      }),
    ).toBe("/home/ada/.cairn");
  });

  test("uses a home dotfolder on Windows, ignoring LOCALAPPDATA", () => {
    expect(
      resolveDataDirectory({
        environment: { LOCALAPPDATA: "C:\\Users\\Ada\\AppData\\Local" },
        homeDirectory: "C:\\Users\\Ada",
        platform: "win32",
      }),
    ).toBe("C:\\Users\\Ada\\.cairn");
  });
});
