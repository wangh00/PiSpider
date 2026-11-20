/**
 * Packaged-runtime helpers for the PiSpider desktop main process.
 *
 * These pure functions only apply when app.isPackaged is true. Development
 * mode keeps its existing spawn paths untouched; the main process branches
 * to these helpers exclusively inside the packaged branch.
 */

const fs = require("node:fs");
const path = require("node:path");

const LAUNCHER_DIR = "launcher";
const RUNTIME_DIR = "runtime";
// Must stay in sync with CORE_VERSION in scripts/pispider-launcher.mjs and the
// prepare-packaged-runtime.mjs staging layout.
const CORE_VERSION = "1.5.2";

/**
 * Resolve the on-disk layout expected under the Electron resources directory.
 *
 * Returns the launcher closure root (scripts/ and packages/pispider keep
 * their relative position), the runner script path, and the bundled core
 * cache root.
 */
function resolvePackagedLayout(resourcesPath) {
  const resourcesRoot = path.resolve(resourcesPath);
  const launcherRoot = path.join(resourcesRoot, LAUNCHER_DIR);
  return Object.freeze({
    resourcesRoot,
    launcherRoot,
    runnerPath: path.join(launcherRoot, "scripts", "run-pispider.mjs"),
    coreCacheRoot: path.join(resourcesRoot, RUNTIME_DIR, `core-${CORE_VERSION}`),
  });
}

/**
 * Build the child-process spawn descriptor for a Node script running under
 * the Electron executable with ELECTRON_RUN_AS_NODE enabled. The packaged
 * core cache root is forwarded so slash-helpers and the launcher resolve the
 * bundled core instead of a per-user install.
 */
function buildNodeSpawn({ execPath, scriptPath, args = [], env = {}, coreCacheRoot = "" } = {}) {
  const spawnEnv = { ...env, ELECTRON_RUN_AS_NODE: "1" };
  if (coreCacheRoot) spawnEnv.PISPIDER_CORE_CACHE = coreCacheRoot;
  return Object.freeze({
    command: execPath,
    args: [scriptPath, ...args],
    env: spawnEnv,
  });
}

/**
 * Detect an npm CLI script the bundled Electron/Node runtime can execute.
 *
 * Candidate order mirrors scripts/pispider-launcher.mjs resolveNpmCli: the
 * npm_execpath environment variable first, then the node directory's bundled
 * npm, then the POSIX-style lib/node_modules layout. Returns the resolved
 * npm-cli.js path, or null when no candidate exists.
 */
function detectNpmCli({ env = process.env, execPath = process.execPath, exists = fs.existsSync } = {}) {
  const candidates = [];
  const npmExecPath = String(env.npm_execpath ?? "").trim();
  if (npmExecPath) {
    candidates.push(
      path.isAbsolute(npmExecPath) ? npmExecPath : path.resolve(path.dirname(execPath), npmExecPath),
    );
  }

  const nodeDir = path.dirname(execPath);
  candidates.push(path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"));
  candidates.push(path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"));

  for (const candidate of candidates) {
    if (exists(candidate)) return path.resolve(candidate);
  }
  return null;
}

/**
 * Read-only Chinese fallback shown when a packaged build has no bundled npm
 * for one-click MCP catalog installation.
 */
function mcpNpmUnavailableMessage() {
  return "打包版未附带 npm，预置 MCP 一键安装不可用；手动 mcp.json 配置不受影响";
}

module.exports = {
  resolvePackagedLayout,
  buildNodeSpawn,
  detectNpmCli,
  mcpNpmUnavailableMessage,
};
