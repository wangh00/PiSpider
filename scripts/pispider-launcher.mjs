import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isComputerUseEnabled, resolveHome } from "../packages/pispider/src/home.js";

export const CORE_VERSION = "1.5.2";
export const CORE_SPEC = `@earendil-works/pi-coding-agent@${CORE_VERSION}`;
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function extensionRoot(root = repoRoot) {
  return path.join(root, "packages", "pispider");
}

export function computerUseExtensionPath(root = repoRoot) {
  return path.join(extensionRoot(root), "vendor", "pi-computer-use", "extensions", "computer-use.ts");
}

export function resolveCoreSpec(env = process.env) {
  return String(env.PISPIDER_CORE_SPEC ?? "").trim() || CORE_SPEC;
}

export function resolveCoreCacheRoot({ env = process.env } = {}) {
  const configured = String(env.PISPIDER_CORE_CACHE ?? "").trim();
  if (configured) return path.resolve(configured);
  const spec = resolveCoreSpec(env);
  if (spec === CORE_SPEC) return path.join(resolveHome(env), "runtime", `core-${CORE_VERSION}`);
  const slug = spec.replace(/^@/, "").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 96);
  return path.join(resolveHome(env), "runtime", `custom-${slug}`);
}

export function coreCliPath(cacheRoot) {
  return path.join(cacheRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");
}

export function resolveNpmCli({
  root = repoRoot,
  env = process.env,
  exists = existsSync,
  nodePath = process.execPath,
} = {}) {
  const candidates = [];
  const npmExecPath = String(env.npm_execpath ?? "").trim();
  if (npmExecPath) candidates.push(path.isAbsolute(npmExecPath) ? npmExecPath : path.resolve(root, npmExecPath));

  const nodeDir = path.dirname(nodePath);
  candidates.push(path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"));
  candidates.push(path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"));

  for (const candidate of candidates) {
    if (exists(candidate)) return path.resolve(candidate);
  }
  return null;
}

function resolvePath(root, value) {
  return path.isAbsolute(value) ? value : path.resolve(root, value);
}

function installPlan({ cacheRoot, npmCli, nodePath, spec }) {
  return {
    mode: "install",
    command: nodePath,
    args: [
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
      spec,
    ],
    cwd: cacheRoot,
    shell: false,
    cacheRoot,
    spec,
  };
}

export function buildLaunchPlan({
  root = repoRoot,
  env = process.env,
  exists = existsSync,
  nodePath = process.execPath,
  passthrough = [],
} = {}) {
  const packageRoot = extensionRoot(root);
  if (!exists(path.join(packageRoot, "package.json"))) {
    throw new Error(`PiSpider package is incomplete: ${packageRoot}`);
  }

  const computerUse = isComputerUseEnabled(env);
  const computerUsePath = computerUseExtensionPath(root);
  if (computerUse && !exists(computerUsePath)) {
    throw new Error(`Computer Use is enabled but its vendored extension is missing: ${computerUsePath}`);
  }

  const extensionArgs = ["-e", packageRoot];
  if (computerUse) extensionArgs.push("-e", computerUsePath);

  const configuredCli = String(env.PISPIDER_CORE_CLI ?? "").trim();
  if (configuredCli) {
    const cliPath = resolvePath(root, configuredCli);
    if (!exists(cliPath)) throw new Error(`PISPIDER_CORE_CLI does not exist: ${cliPath}`);
    return {
      mode: "custom",
      command: nodePath,
      args: [cliPath, ...extensionArgs, ...passthrough],
      shell: false,
      computerUse,
    };
  }

  const localCli = path.join(root, "packages", "coding-agent", "dist", "bundle", "cli.js");
  if (exists(localCli)) {
    return {
      mode: "local",
      command: nodePath,
      args: [localCli, ...extensionArgs, ...passthrough],
      shell: false,
      computerUse,
    };
  }

  const cacheRoot = resolveCoreCacheRoot({ env });
  const cachedCli = coreCliPath(cacheRoot);
  if (exists(cachedCli)) {
    return {
      mode: "runtime",
      command: nodePath,
      args: [cachedCli, ...extensionArgs, ...passthrough],
      shell: false,
      cacheRoot,
      computerUse,
    };
  }

  const npmCli = resolveNpmCli({ root, env, exists, nodePath });
  if (!npmCli) {
    throw new Error(
      "npm CLI was not found. Install Node.js with npm, or set PISPIDER_CORE_CLI to a core CLI file and retry.",
    );
  }

  const spec = resolveCoreSpec(env);
  return installPlan({ cacheRoot, npmCli, nodePath, spec });
}

export function describeLaunch(plan) {
  let description;
  switch (plan.mode) {
    case "local":
      description = "local core build";
      break;
    case "custom":
      description = "PISPIDER_CORE_CLI override";
      break;
    case "runtime":
      description = `cached core ${CORE_VERSION}`;
      break;
    case "install":
      description = `install core ${plan.spec} on first run`;
      break;
    default:
      description = plan.mode;
  }
  return plan.computerUse ? `${description} + computer-use` : description;
}
