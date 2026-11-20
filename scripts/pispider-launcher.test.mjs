import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  buildLaunchPlan,
  CORE_SPEC,
  computerUseExtensionPath,
  coreCliPath,
  describeLaunch,
  extensionRoot,
  resolveCoreCacheRoot,
  resolveNpmCli,
} from "./pispider-launcher.mjs";

const root = path.resolve(path.sep, "repo");

function existsFor(...paths) {
  const allowed = new Set(paths.map((item) => path.resolve(item)));
  return (candidate) => allowed.has(path.resolve(candidate));
}

test("local core build is used when it exists", () => {
  const packageRoot = extensionRoot(root);
  const localCli = path.join(root, "packages", "coding-agent", "dist", "bundle", "cli.js");
  const plan = buildLaunchPlan({
    root,
    nodePath: "node",
    exists: existsFor(path.join(packageRoot, "package.json"), localCli),
  });
  assert.equal(plan.mode, "local");
  assert.deepEqual(plan.args, [localCli, "-e", packageRoot]);
  assert.equal(describeLaunch(plan), "local core build");
});

test("PISPIDER_CORE_CLI overrides the local and cached launch paths", () => {
  const packageRoot = extensionRoot(root);
  const custom = path.join(root, "custom", "cli.js");
  const plan = buildLaunchPlan({
    root,
    env: { PISPIDER_CORE_CLI: custom },
    nodePath: "node",
    exists: existsFor(path.join(packageRoot, "package.json"), custom),
  });
  assert.equal(plan.mode, "custom");
  assert.deepEqual(plan.args, [custom, "-e", packageRoot]);
});

test("computer-use is opt-in and adds a second extension path when enabled", () => {
  const packageRoot = extensionRoot(root);
  const localCli = path.join(root, "packages", "coding-agent", "dist", "bundle", "cli.js");
  const computerUse = computerUseExtensionPath(root);
  const plan = buildLaunchPlan({
    root,
    env: { PISPIDER_COMPUTER_USE: "1" },
    nodePath: "node",
    exists: existsFor(path.join(packageRoot, "package.json"), localCli, computerUse),
  });
  assert.equal(plan.mode, "local");
  assert.equal(plan.computerUse, true);
  assert.deepEqual(plan.args, [localCli, "-e", packageRoot, "-e", computerUse]);
  assert.equal(describeLaunch(plan), "local core build + computer-use");
});

test("enabling computer-use fails when the vendored extension is absent", () => {
  assert.throws(
    () =>
      buildLaunchPlan({
        root,
        env: { PISPIDER_COMPUTER_USE: "1" },
        exists: existsFor(path.join(extensionRoot(root), "package.json")),
      }),
    /Computer Use is enabled but its vendored extension is missing/,
  );
});

test("cached core runtime is reused", () => {
  const packageRoot = extensionRoot(root);
  const cacheRoot = path.join(root, "cache");
  const cachedCli = coreCliPath(cacheRoot);
  const plan = buildLaunchPlan({
    root,
    env: { PISPIDER_CORE_CACHE: cacheRoot },
    nodePath: "node",
    exists: existsFor(path.join(packageRoot, "package.json"), cachedCli),
  });
  assert.equal(plan.mode, "runtime");
  assert.deepEqual(plan.args, [cachedCli, "-e", packageRoot]);
  assert.equal(plan.cacheRoot, cacheRoot);
  assert.match(describeLaunch(plan), /cached core 1\.5\.2/);
});

test("missing runtime creates an npm install plan outside the workspace", () => {
  const packageRoot = extensionRoot(root);
  const cacheRoot = path.join(root, "cache");
  const npmCli = path.join(root, "npm", "bin", "npm-cli.js");
  const plan = buildLaunchPlan({
    root,
    env: { PISPIDER_CORE_CACHE: cacheRoot, npm_execpath: npmCli },
    nodePath: "node",
    exists: existsFor(path.join(packageRoot, "package.json"), npmCli),
  });
  assert.equal(plan.mode, "install");
  assert.equal(plan.cwd, cacheRoot);
  assert.deepEqual(plan.args, [
    npmCli,
    "install",
    "--prefix",
    cacheRoot,
    "--no-save",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--userconfig",
    path.join(cacheRoot, "npmrc"),
    CORE_SPEC,
  ]);
});

test("npm_execpath is preferred when resolving npm", () => {
  const npmCli = path.join(root, "node_modules", "npm", "bin", "npm-cli.js");
  assert.equal(
    resolveNpmCli({
      root,
      env: { npm_execpath: npmCli },
      exists: existsFor(npmCli),
    }),
    path.resolve(npmCli),
  );
});

test("cache root honors PISPIDER_CORE_CACHE", () => {
  const cacheRoot = path.join(root, "custom-cache");
  assert.equal(resolveCoreCacheRoot({ env: { PISPIDER_CORE_CACHE: cacheRoot } }), cacheRoot);
});

test("cache root is separated when a custom core spec is used", () => {
  const cacheRoot = resolveCoreCacheRoot({
    env: { PISPIDER_HOME: path.join(root, "home"), PISPIDER_CORE_SPEC: "@scope/pi@9.9.9" },
  });
  assert.match(cacheRoot, /runtime[\\/]custom-scope-pi-9\.9\.9$/);
});

test("an incomplete package fails before spawning the core", () => {
  assert.throws(
    () => buildLaunchPlan({ root, exists: () => false }),
    /PiSpider package is incomplete/,
  );
});
