#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { VERSION, buildAgentEnvironment, resolveAgentDir, resolveHome, resolveSessionDir } from "../packages/pispider/src/home.js";
import { buildLaunchPlan, describeLaunch } from "./pispider-launcher.mjs";

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

if (!nodeVersionAtLeast(process.versions.node, [22, 19, 0])) {
  console.error(`PiSpider requires Node.js >= 22.19.0; current is ${process.versions.node}.`);
  process.exit(1);
}

let plan;
try {
  plan = buildLaunchPlan({ passthrough: process.argv.slice(2) });
} catch (error) {
  console.error(`Cannot start PiSpider: ${error.message}`);
  console.error("Run `npm run pispider:doctor` to check the local environment.");
  process.exit(1);
}

if (plan.mode === "install") {
  console.error(`Installing PiSpider core ${plan.spec} into ${plan.cacheRoot} ...`);
  try {
    await mkdir(plan.cacheRoot, { recursive: true });
    await writeFile(path.join(plan.cacheRoot, "npmrc"), "", "utf8");
  } catch (error) {
    console.error(`Cannot prepare the core runtime cache: ${error.message}`);
    process.exit(1);
  }

  const install = spawnSync(plan.command, plan.args, {
    stdio: "inherit",
    env: process.env,
    cwd: plan.cwd,
    shell: false,
  });
  if (install.error) {
    console.error(`PiSpider core runtime installation failed: ${install.error.message}`);
    process.exit(1);
  }
  if (install.status !== 0) {
    console.error(`PiSpider core runtime installation failed with exit code ${install.status}.`);
    process.exit(install.status ?? 1);
  }

  try {
    plan = buildLaunchPlan({ passthrough: process.argv.slice(2) });
  } catch (error) {
    console.error(`PiSpider core runtime was installed but cannot be launched: ${error.message}`);
    process.exit(1);
  }
}

const home = resolveHome();
const agentDir = resolveAgentDir(home);
const sessionDir = resolveSessionDir(home);
const runtimeEnv = buildAgentEnvironment(home);

try {
  await mkdir(agentDir, { recursive: true });
  await mkdir(sessionDir, { recursive: true });
} catch (error) {
  console.error(`Cannot prepare the PiSpider agent directory: ${error.message}`);
  process.exit(1);
}

console.error(`PiSpider ${VERSION} | ${describeLaunch(plan)} | data: ${home} | agent: ${agentDir}`);

const child = spawn(plan.command, plan.args, {
  stdio: "inherit",
  env: runtimeEnv,
  cwd: process.cwd(),
  shell: false,
});

child.on("error", (error) => {
  console.error(`Failed to launch the PiSpider core runtime: ${error.message}`);
  console.error("Run `npm run pispider:doctor` to check the local environment.");
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`PiSpider core runtime exited from signal ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
