/**
 * Pure-helper tests for the slash-command IPC channels. No Electron runtime:
 * these exercise the shared validation and changelog resolution helpers only.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  validateHtmlExportPath,
  changelogCandidates,
  locateChangelog,
  readChangelogFile,
} = require("../slash-helpers.cjs");

test("validateHtmlExportPath returns null when omitted", () => {
  assert.equal(validateHtmlExportPath(undefined), null);
  assert.equal(validateHtmlExportPath(null), null);
  assert.equal(validateHtmlExportPath(""), null);
  assert.equal(validateHtmlExportPath("   "), null);
});

test("validateHtmlExportPath rejects relative and non-html paths", () => {
  assert.throws(() => validateHtmlExportPath("relative/out.html"), /绝对路径/);
  assert.throws(() => validateHtmlExportPath(path.join(tmpdir(), "out.jsonl")), /\.html/);
  assert.throws(() => validateHtmlExportPath(path.join(tmpdir(), "out.md")), /\.html/);
});

test("validateHtmlExportPath accepts an absolute .html path and normalizes it", () => {
  const target = path.join(tmpdir(), "export", "session.html");
  const resolved = validateHtmlExportPath(target);
  assert.equal(resolved, path.resolve(target));
  const upper = path.join(tmpdir(), "export", "session.HTML");
  assert.equal(validateHtmlExportPath(upper), path.resolve(upper));
});

test("changelogCandidates orders cached runtime package before local repo copy", () => {
  const candidates = changelogCandidates({ cacheRoot: "/home/user/.pispider/runtime/core-1.5.2", repoRoot: "/repo" });
  assert.deepEqual(candidates, [
    path.join("/home/user/.pispider/runtime/core-1.5.2", "node_modules", "@earendil-works", "pi-coding-agent", "CHANGELOG.md"),
    path.join("/repo", "packages", "coding-agent", "CHANGELOG.md"),
  ]);
});

test("changelogCandidates skips missing roots", () => {
  assert.deepEqual(changelogCandidates({ cacheRoot: "", repoRoot: "/repo" }), [
    path.join("/repo", "packages", "coding-agent", "CHANGELOG.md"),
  ]);
  assert.deepEqual(changelogCandidates({}), []);
});

test("locateChangelog returns the first existing candidate, null otherwise", async () => {
  const existsMap = new Map([["/first/CHANGELOG.md", false], ["/second/CHANGELOG.md", true]]);
  const exists = async (candidate) => existsMap.get(candidate) === true;
  assert.equal(await locateChangelog({ candidates: [...existsMap.keys()], exists }), "/second/CHANGELOG.md");
  assert.equal(await locateChangelog({ candidates: ["/missing/CHANGELOG.md"], exists }), null);
});

test("readChangelogFile reads content and version from sibling package.json", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pispider-changelog-"));
  try {
    await writeFile(path.join(root, "CHANGELOG.md"), "# Changelog\n\n## Unreleased\n", "utf8");
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "1.5.2" }), "utf8");
    const result = await readChangelogFile({
      changelogPath: path.join(root, "CHANGELOG.md"),
      fallbackVersion: "0.0.0",
      readFile: (target) => readFile(target, "utf8"),
      readJson: (target) => readFile(target, "utf8").then(JSON.parse),
    });
    assert.equal(result.version, "1.5.2");
    assert.match(result.content, /## Unreleased/);
    assert.equal(result.path, path.join(root, "CHANGELOG.md"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readChangelogFile falls back to fallbackVersion without package.json", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pispider-changelog-"));
  try {
    await writeFile(path.join(root, "CHANGELOG.md"), "Notes", "utf8");
    const result = await readChangelogFile({
      changelogPath: path.join(root, "CHANGELOG.md"),
      fallbackVersion: "1.5.2",
      readFile: (target) => readFile(target, "utf8"),
      readJson: () => Promise.reject(new Error("ENOENT")),
    });
    assert.equal(result.version, "1.5.2");
    assert.equal(result.content, "Notes");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop package files include the shared helper", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(packageJson.files.includes("slash-helpers.cjs"));
});
