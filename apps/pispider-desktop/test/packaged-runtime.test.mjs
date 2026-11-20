/**
 * Packaged-runtime helper tests. These cover the pure layout/spawn/npm-detection
 * logic used only by the app.isPackaged branch, plus one integration case that
 * builds the bundled launcher closure in a temporary directory and asks the
 * real launcher to resolve the cached core (pure call, no spawn, no user data).
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { copyFile, cp, mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  resolvePackagedLayout,
  buildNodeSpawn,
  detectNpmCli,
  mcpNpmUnavailableMessage,
} = require("../packaged-runtime.cjs");

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..", "..");

function existsFor(...allowed) {
  const allowedSet = new Set(allowed.map((item) => path.resolve(item)));
  return (candidate) => allowedSet.has(path.resolve(candidate));
}

test("resolvePackagedLayout maps resources to launcher closure and runtime cache", () => {
  const resourcesPath = path.join("C:", "apps", "PiSpider", "resources");
  const layout = resolvePackagedLayout(resourcesPath);
  assert.equal(layout.resourcesRoot, path.resolve(resourcesPath));
  assert.equal(layout.launcherRoot, path.join(layout.resourcesRoot, "launcher"));
  assert.equal(
    layout.runnerPath,
    path.join(layout.launcherRoot, "scripts", "run-pispider.mjs"),
  );
  assert.equal(
    layout.coreCacheRoot,
    path.join(layout.resourcesRoot, "runtime", "core-1.5.2"),
  );
  assert.equal(layout.npmCliPath, path.join(layout.resourcesRoot, "npm", "bin", "npm-cli.js"));
});

test("buildNodeSpawn runs the Electron executable as Node with the bundled cache", () => {
  const execPath = path.join("C:", "electron", "PiSpider.exe");
  const scriptPath = path.join("C:", "resources", "launcher", "scripts", "run-pispider.mjs");
  const plan = buildNodeSpawn({
    execPath,
    scriptPath,
    args: ["--mode", "rpc"],
    env: { PISPIDER_DESKTOP: "1" },
    coreCacheRoot: path.join("C:", "resources", "runtime"),
  });
  assert.equal(plan.command, execPath);
  assert.deepEqual(plan.args, [scriptPath, "--mode", "rpc"]);
  assert.equal(plan.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(plan.env.PISPIDER_CORE_CACHE, path.join("C:", "resources", "runtime"));
  assert.equal(plan.env.PISPIDER_DESKTOP, "1");
});

test("buildNodeSpawn defaults to no extra args and omits the cache override when unset", () => {
  const plan = buildNodeSpawn({ execPath: "electron.exe", scriptPath: "bridge.mjs" });
  assert.equal(plan.command, "electron.exe");
  assert.deepEqual(plan.args, ["bridge.mjs"]);
  assert.equal(plan.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(Object.prototype.hasOwnProperty.call(plan.env, "PISPIDER_CORE_CACHE"), false);
});

test("buildNodeSpawn does not mutate the caller env", () => {
  const inputEnv = { KEEP: "yes" };
  buildNodeSpawn({ execPath: "electron.exe", scriptPath: "run.mjs", env: inputEnv });
  assert.deepEqual(inputEnv, { KEEP: "yes" });
});

test("detectNpmCli prefers the explicitly bundled npm", () => {
  const execPath = path.join("C:", "electron", "PiSpider.exe");
  const bundled = path.join("C:", "resources", "npm", "bin", "npm-cli.js");
  const envNpm = path.join("C:", "tools", "npm", "bin", "npm-cli.js");
  const detected = detectNpmCli({
    env: { npm_execpath: envNpm },
    execPath,
    exists: existsFor(bundled, envNpm),
    bundledNpmCli: bundled,
  });
  assert.equal(detected, path.resolve(bundled));
});

test("detectNpmCli prefers npm_execpath when no bundled npm is passed", () => {
  const execPath = path.join("C:", "electron", "PiSpider.exe");
  const npmCli = path.join("C:", "tools", "npm", "bin", "npm-cli.js");
  const detected = detectNpmCli({
    env: { npm_execpath: npmCli },
    execPath,
    exists: existsFor(npmCli),
  });
  assert.equal(detected, path.resolve(npmCli));
});

test("detectNpmCli falls back to the node directory bundled npm layout", () => {
  const execPath = path.join("C:", "electron", "PiSpider.exe");
  const bundled = path.join(path.dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const detected = detectNpmCli({ env: {}, execPath, exists: existsFor(bundled) });
  assert.equal(detected, path.resolve(bundled));
});

test("detectNpmCli checks the POSIX lib/node_modules layout", () => {
  const execPath = path.join("C:", "tools", "node", "node.exe");
  const posix = path.join(
    path.dirname(execPath),
    "..",
    "lib",
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  const detected = detectNpmCli({ env: {}, execPath, exists: existsFor(posix) });
  assert.equal(detected, path.resolve(posix));
});

test("detectNpmCli returns null when no candidate exists", () => {
  const execPath = path.join("C:", "electron", "PiSpider.exe");
  const detected = detectNpmCli({ env: {}, execPath, exists: () => false });
  assert.equal(detected, null);
});

test("mcpNpmUnavailableMessage returns the readable Chinese fallback", () => {
  const message = mcpNpmUnavailableMessage();
  assert.ok(message.includes("npm"));
  assert.ok(message.includes("mcp.json"));
  assert.ok(message.includes("手动"));
});

test("bundled launcher closure resolves the cached core in runtime mode", async (t) => {
  const realCacheRoot = path.join(homedir(), ".pispider", "runtime", "core-1.5.2");
  const realCli = path.join(
    realCacheRoot,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "bundle",
    "cli.js",
  );
  if (!existsSync(realCli)) {
    t.skip("real core cache is not present; skipping packaged layout integration case");
    return;
  }

  const staging = await mkdtempSync(path.join(tmpdir(), "pispider-packaged-"));
  const launcherRoot = path.join(staging, "launcher");
  try {
    await mkdir(path.join(launcherRoot, "scripts"), { recursive: true });
    await mkdir(path.join(launcherRoot, "packages", "pispider"), { recursive: true });

    await copyFile(
      path.join(repoRoot, "scripts", "run-pispider.mjs"),
      path.join(launcherRoot, "scripts", "run-pispider.mjs"),
    );
    await copyFile(
      path.join(repoRoot, "scripts", "pispider-launcher.mjs"),
      path.join(launcherRoot, "scripts", "pispider-launcher.mjs"),
    );

    const pkgSource = path.join(repoRoot, "packages", "pispider");
    const pkgDest = path.join(launcherRoot, "packages", "pispider");
    await copyFile(path.join(pkgSource, "package.json"), path.join(pkgDest, "package.json"));
    for (const dir of ["src", "resources", "vendor"]) {
      await cp(path.join(pkgSource, dir), path.join(pkgDest, dir), { recursive: true });
    }

    const launcher = await import(
      pathToFileURL(path.join(launcherRoot, "scripts", "pispider-launcher.mjs")).href
    );
    const plan = launcher.buildLaunchPlan({
      root: launcherRoot,
      env: { PISPIDER_CORE_CACHE: realCacheRoot },
    });

    assert.equal(plan.mode, "runtime");
    assert.equal(plan.args[0], realCli);
    assert.deepEqual(plan.args.slice(1), ["-e", path.join(pkgDest)]);
    assert.equal(plan.cacheRoot, realCacheRoot);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
});
