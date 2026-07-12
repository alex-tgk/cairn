import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const temporaryBuildArtifactPattern = /^\..+\.bun-build$/u;

function removeTemporaryBuildArtifacts(): void {
  for (const entry of readdirSync(process.cwd())) {
    if (temporaryBuildArtifactPattern.test(entry)) {
      rmSync(join(process.cwd(), entry), { force: true });
    }
  }
}

removeTemporaryBuildArtifacts();
const result = Bun.spawnSync({
  cmd: [
    process.execPath,
    "build",
    "--compile",
    "./src/cli.ts",
    "--outfile",
    "./dist/cairn",
  ],
  stderr: "inherit",
  stdout: "inherit",
});
removeTemporaryBuildArtifacts();

if (result.exitCode !== 0) {
  process.exit(result.exitCode);
}
