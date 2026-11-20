import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Pi package manifest points at a real JavaScript extension", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(manifest.type, "module");
  assert.deepEqual(manifest.pi.extensions, ["./src/index.js"]);
  await access(path.join(root, "src", "index.js"));
});

test("PiSpider is a workspace package in the integrated monorepo", async () => {
  const repoRoot = path.resolve(root, "..", "..");
  assert.equal(path.basename(root), "pispider");
  assert.equal(path.basename(path.dirname(root)), "packages");
  const workspace = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  assert.ok(workspace.workspaces.includes("packages/*"));
  await access(path.join(repoRoot, "packages", "coding-agent", "package.json"));
});
