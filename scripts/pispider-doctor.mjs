#!/usr/bin/env node
import { accessSync, constants, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  VERSION,
  isComputerUseEnabled,
  resolveAgentDir,
  resolveComputerUseHelperPaths,
  resolveHome,
  resolveSessionDir,
} from "../packages/pispider/src/home.js";
import { buildLaunchPlan, computerUseExtensionPath, describeLaunch, extensionRoot, repoRoot } from "./pispider-launcher.mjs";

const jsonMode = process.argv.includes("--json");
const checks = [];

function check(name, ok, detail, required = true) {
  checks.push({ name, ok, detail, required });
}

function parseNodeVersion(value) {
  const match = String(value).match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function nodeVersionAtLeast(value, minimum) {
  const current = parseNodeVersion(value);
  if (!current) return false;
  for (let index = 0; index < minimum.length; index += 1) {
    if (current[index] > minimum[index]) return true;
    if (current[index] < minimum[index]) return false;
  }
  return true;
}

check(
  "Node.js",
  nodeVersionAtLeast(process.versions.node, [22, 19, 0]),
  `${process.versions.node} (requires >= 22.19.0)`,
);

check(
  "Platform",
  ["win32", "darwin", "linux"].includes(process.platform),
  `${process.platform} ${process.arch}`,
  false,
);

const packageRoot = extensionRoot(repoRoot);
const computerUseEnabled = isComputerUseEnabled();
check("Extension", existsSync(path.join(packageRoot, "package.json")), packageRoot);

const computerUsePath = computerUseExtensionPath(repoRoot);
check("Computer Use extension", existsSync(computerUsePath), computerUsePath, computerUseEnabled);

let plan = null;
try {
  plan = buildLaunchPlan();
  check("Core launcher", true, describeLaunch(plan));
} catch (error) {
  check("Core launcher", false, error.message);
}

const home = resolveHome();
const agentDir = resolveAgentDir(home);
const sessionDir = resolveSessionDir(home);
const computerUseHelpers = resolveComputerUseHelperPaths(agentDir);
const computerUseHelperPath =
  process.platform === "win32" ? computerUseHelpers.windows : process.platform === "linux" ? computerUseHelpers.linux : null;
const computerUseHelperExists =
  process.platform === "darwin" || (computerUseHelperPath !== null && existsSync(computerUseHelperPath));
check(
  "Computer Use helper",
  !computerUseEnabled || computerUseHelperExists,
  computerUseEnabled
    ? process.platform === "darwin"
      ? "macOS helper is installed by the extension and requires Accessibility and Screen Recording grants"
      : computerUseHelperExists
        ? `${computerUseHelperPath} (installed)`
        : `${computerUseHelperPath} (installed on first use when enabled)`
    : "disabled; helper is not required",
  false,
);
const homeParent = path.dirname(home);
try {
  accessSync(homeParent, constants.W_OK);
  check("Data directory", true, `${home} (parent is writable)`);
} catch (error) {
  check("Data directory", false, `${home}: ${error.message}`);
}

const legacyPiHome = path.join(os.homedir(), ".pi");
const agentIsUnderLegacyPi =
  agentDir === legacyPiHome || agentDir.startsWith(`${legacyPiHome}${path.sep}`);
check(
  "Pi data isolation",
  !agentIsUnderLegacyPi,
  agentIsUnderLegacyPi
    ? `${agentDir} is inside Pi's default data directory`
    : `${agentDir} is outside ${legacyPiHome}`,
);

const report = {
  product: "PiSpider",
  version: VERSION,
  node: process.versions.node,
  platform: `${process.platform} ${process.arch}`,
  home,
  agentDir,
  sessionDir,
  computerUse: {
    enabled: computerUseEnabled,
    extension: computerUsePath,
    helper: computerUseHelperPath,
  },
  launcher: plan ? { mode: plan.mode, description: describeLaunch(plan) } : null,
  checks,
  ok: checks.every((item) => item.ok || !item.required),
};

if (jsonMode) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(`PiSpider ${VERSION} environment check\n\n`);
  for (const item of checks) {
    const mark = item.ok ? "OK" : item.required ? "FAIL" : "WARN";
    process.stdout.write(`[${mark}] ${item.name}: ${item.detail}\n`);
  }
  process.stdout.write(`\nData directory: ${home}\n`);
  process.stdout.write(`Agent directory: ${agentDir}\n`);
  process.stdout.write(`Session directory: ${sessionDir}\n`);
  process.stdout.write(`Host: ${os.platform()} ${os.release()} ${os.arch()}\n`);
}

process.exitCode = report.ok ? 0 : 1;
