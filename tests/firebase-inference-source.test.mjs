import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("./firebase-inference-source.runner.ts", import.meta.url));
const result = spawnSync(process.execPath, ["--experimental-strip-types", runner], {
  encoding: "utf8",
  env: process.env,
});

if (result.status !== 0) {
  process.stderr.write(result.stdout + result.stderr);
  if (result.error) process.stderr.write(`${result.error.message}\n`);
  process.exitCode = typeof result.status === "number" ? result.status : 1;
  process.exit();
}
process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
