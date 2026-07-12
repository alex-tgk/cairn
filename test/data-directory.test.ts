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

  test("uses the macOS application support directory", () => {
    expect(
      resolveDataDirectory({
        environment: {},
        homeDirectory: "/Users/ada",
        platform: "darwin",
      }),
    ).toBe("/Users/ada/Library/Application Support/Cairn");
  });

  test("uses XDG_DATA_HOME on Linux", () => {
    expect(
      resolveDataDirectory({
        environment: { XDG_DATA_HOME: "/data" },
        homeDirectory: "/home/ada",
        platform: "linux",
      }),
    ).toBe("/data/cairn");
  });

  test("uses LOCALAPPDATA on Windows", () => {
    expect(
      resolveDataDirectory({
        environment: { LOCALAPPDATA: "C:\\Users\\Ada\\AppData\\Local" },
        homeDirectory: "C:\\Users\\Ada",
        platform: "win32",
      }),
    ).toBe("C:\\Users\\Ada\\AppData\\Local\\Cairn");
  });
});
