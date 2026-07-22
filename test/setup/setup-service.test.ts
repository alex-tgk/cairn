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
    expect(agentsContent).toContain("Personal vs project scope");
    expect(agentsContent).toContain("--scope personal");
    const skillContent = readFileSync(target!.skillFile.path, "utf8");
    expect(skillContent).toContain("# Cairn");
    expect(skillContent).toContain("PERSONAL VS PROJECT SCOPE");
    expect(skillContent).toContain("`preference`-type memories default to `personal`");
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

  test("upserts correctly even when the block marker is mentioned earlier in prose", () => {
    const home = createTemporaryHome();
    const config = applySetup("codex", { homeDirectory: home });
    const agentsFilePath = config.targets[0]!.agentsFile.path;
    const priorContent = readFileSync(agentsFilePath, "utf8");
    const withPriorMention =
      `- See the \`<!-- cairn:setup -->\` block below for details.\n\n${priorContent}`;
    Bun.write(agentsFilePath, withPriorMention);

    applySetup("codex", { homeDirectory: home });

    const content = readFileSync(agentsFilePath, "utf8");
    expect(content).toContain("See the `<!-- cairn:setup -->` block below");
    const startOccurrences = content.split("<!-- cairn:setup -->").length - 1;
    expect(startOccurrences).toBe(2); // one in prose, one real block marker
    const endOccurrences = content.split("<!-- /cairn:setup -->").length - 1;
    expect(endOccurrences).toBe(1);
    // the prose mention must remain intact and precede the real block
    expect(content.indexOf("See the")).toBeLessThan(
      content.indexOf("## Cairn (mandatory"),
    );
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

  test("writes a session-primer extension for copilot but not codex", () => {
    const home = createTemporaryHome();

    const result = applySetup("all", { homeDirectory: home });
    const copilot = result.targets.find((t) => t.target === "copilot");
    const codex = result.targets.find((t) => t.target === "codex");

    expect(codex?.extensionFile).toBeUndefined();
    expect(copilot?.extensionFile?.action).toBe("created");
    expect(copilot?.extensionFile?.path).toBe(
      join(home, ".copilot", "extensions", "cairn-session-primer", "extension.mjs"),
    );

    const extensionContent = readFileSync(copilot!.extensionFile!.path, "utf8");
    expect(extensionContent).toContain("@github/copilot-sdk/extension");
    expect(extensionContent).toContain("onSessionStart");
    expect(extensionContent).toContain("cairn");
    expect(extensionContent).toContain("CAIRN_BIN");
  });

  test("re-running copilot setup updates the extension in place", () => {
    const home = createTemporaryHome();

    applySetup("copilot", { homeDirectory: home });
    const second = applySetup("copilot", { homeDirectory: home });

    const copilot = second.targets.find((t) => t.target === "copilot");
    expect(copilot?.extensionFile?.action).toBe("updated");
  });
});
