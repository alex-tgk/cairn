import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  applySetup,
  isSetupTargetOption,
  SETUP_TARGETS,
} from "../../src/setup/setup-service.ts";

const temporaryDirectories: string[] = [];

function createTemporaryHome(): string {
  const directory = mkdtempSync(join(tmpdir(), "cairn-setup-home-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("setup target validation", () => {
  test("accepts all and each known target", () => {
    expect(isSetupTargetOption("all")).toBe(true);
    for (const target of SETUP_TARGETS) {
      expect(isSetupTargetOption(target)).toBe(true);
    }
  });

  test("rejects unknown targets", () => {
    expect(isSetupTargetOption("bogus")).toBe(false);
  });
});

describe("applySetup", () => {
  test("creates an agents file and a skill file for codex", () => {
    const home = createTemporaryHome();

    const result = applySetup("codex", { homeDirectory: home });

    expect(result.targets).toHaveLength(1);
    const [target] = result.targets;
    expect(target?.target).toBe("codex");
    expect(target?.agentsFile.action).toBe("created");
    expect(target?.skillFile.action).toBe("created");

    const agentsContent = readFileSync(target!.agentsFile.path, "utf8");
    expect(agentsContent).toContain("<!-- cairn:setup -->");
    expect(agentsContent).toContain("cairn work");
    const skillContent = readFileSync(target!.skillFile.path, "utf8");
    expect(skillContent).toContain("# Cairn");
  });

  test("applies both targets for 'all'", () => {
    const home = createTemporaryHome();

    const result = applySetup("all", { homeDirectory: home });

    expect(result.targets.map((target) => target.target).sort()).toEqual([
      "codex",
      "copilot",
    ]);
  });

  test("upserts the instructions block in place on re-run without duplicating", () => {
    const home = createTemporaryHome();

    applySetup("copilot", { homeDirectory: home });
    const second = applySetup("copilot", { homeDirectory: home });

    const [target] = second.targets;
    expect(target?.agentsFile.action).toBe("updated");
    const content = readFileSync(target!.agentsFile.path, "utf8");
    const occurrences = content.split("<!-- cairn:setup -->").length - 1;
    expect(occurrences).toBe(1);
  });

  test("preserves existing unrelated content in the agents file", () => {
    const home = createTemporaryHome();
    const config = applySetup("codex", { homeDirectory: home });
    const agentsFilePath = config.targets[0]!.agentsFile.path;
    const preExisting = "# My personal instructions\n\nSome content.\n";
    Bun.write(agentsFilePath, preExisting);

    applySetup("codex", { homeDirectory: home });

    const content = readFileSync(agentsFilePath, "utf8");
    expect(content).toContain("My personal instructions");
    expect(content).toContain("<!-- cairn:setup -->");
  });
});
