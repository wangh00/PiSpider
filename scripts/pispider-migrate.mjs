#!/usr/bin/env node
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { resolveAgentDir, resolveHome } from "../packages/pispider/src/home.js";

export const CORE_FILES = [
  "auth.json",
  "oauth.json",
  "models.json",
  "mcp.json",
  "keybindings.json",
  "settings.json",
  "AGENTS.md",
  "AGENTS.override.md",
  "AGENTS.MD",
  "CLAUDE.md",
  "CLAUDE.MD",
  "SYSTEM.md",
  "APPEND_SYSTEM.md",
];

export const RESOURCE_DIRS = ["themes", "prompts", "skills"];
export const EXTENSION_DIRS = ["extensions"];

export function defaultPiAgentDir(env = process.env) {
  const configured = String(env.PI_CODING_AGENT_DIR ?? "").trim();
  if (configured) return path.resolve(configured);
  return path.join(os.homedir(), ".pi", "agent");
}

export function defaultTargetAgentDir(env = process.env) {
  return resolveAgentDir(resolveHome(env), env);
}

async function isDirectory(candidate) {
  try {
    return (await lstat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

async function copyFileIfMissing(source, target, options) {
  if (existsSync(target)) {
    options.report.skipped.push(target);
    return;
  }
  options.report.copied.push(target);
  if (options.dryRun) return;
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
}

async function copyTreeIfMissing(source, target, options) {
  let entry;
  try {
    entry = await lstat(source);
  } catch {
    options.report.missing.push(source);
    return;
  }
  if (entry.isSymbolicLink()) {
    options.report.symlinks.push(source);
    return;
  }
  if (!entry.isDirectory()) {
    await copyFileIfMissing(source, target, options);
    return;
  }

  if (!options.dryRun) await mkdir(target, { recursive: true });
  for (const child of await readdir(source)) {
    await copyTreeIfMissing(path.join(source, child), path.join(target, child), options);
  }
}

async function copyConfigFileIfMissing(source, target, options) {
  if (!existsSync(source)) {
    options.report.missing.push(source);
    return;
  }
  if (existsSync(target)) {
    options.report.skipped.push(target);
    return;
  }
  options.report.copied.push(target);
  if (options.dryRun) return;
  await mkdir(path.dirname(target), { recursive: true });

  if (path.basename(source).endsWith(".json")) {
    const text = (await readFile(source, "utf8")).replace(/^\uFEFF/, "");
    try {
      const rewritten = rewriteJsonValue(JSON.parse(text), options);
      await writeFile(target, `${JSON.stringify(rewritten, null, 2)}\n`, "utf8");
      options.report.rewritten.push(target);
    } catch {
      await copyFile(source, target);
    }
    return;
  }
  await copyFile(source, target);
}

function rewritePath(value, options) {
  const normalized = value.replaceAll("\\", "/");
  const source = options.sourceDir.replaceAll("\\", "/");
  if (normalized === source || normalized.startsWith(`${source}/`)) {
    return `${options.targetDir.replaceAll("\\", "/")}${normalized.slice(source.length)}`;
  }
  const legacy = path.join(os.homedir(), ".pi", "agent").replaceAll("\\", "/");
  if (normalized === legacy || normalized.startsWith(`${legacy}/`)) {
    return `${options.targetDir.replaceAll("\\", "/")}${normalized.slice(legacy.length)}`;
  }
  const tildeLegacy = "~/.pi/agent";
  if (normalized === tildeLegacy || normalized.startsWith(`${tildeLegacy}/`)) {
    return `${options.targetDir.replaceAll("\\", "/")}${normalized.slice(tildeLegacy.length)}`;
  }
  const tildePiRoot = "~/.pi";
  if (normalized === tildePiRoot || normalized.startsWith(`${tildePiRoot}/`)) {
    return `${options.targetDir.replaceAll("\\", "/")}${normalized.slice(tildePiRoot.length)}`;
  }
  const legacyPiRoot = path.join(os.homedir(), ".pi").replaceAll("\\", "/");
  if (normalized === legacyPiRoot || normalized.startsWith(`${legacyPiRoot}/`)) {
    return `${options.targetDir.replaceAll("\\", "/")}${normalized.slice(legacyPiRoot.length)}`;
  }
  return value;
}

function rewriteJsonValue(value, options) {
  if (typeof value === "string") return rewritePath(value, options);
  if (Array.isArray(value)) return value.map((entry) => rewriteJsonValue(entry, options));
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = rewriteJsonValue(entry, options);
    }
    return result;
  }
  return value;
}

export async function migratePiConfig({
  source,
  target,
  env = process.env,
  includeResources = false,
  includeExtensions = false,
  dryRun = false,
} = {}) {
  const sourceDir = path.resolve(source ?? defaultPiAgentDir(env));
  const targetDir = path.resolve(target ?? defaultTargetAgentDir(env));
  if (sourceDir === targetDir) throw new Error("source and target are the same directory");
  if (!(await isDirectory(sourceDir))) {
    throw new Error(`Pi agent directory not found: ${sourceDir}`);
  }

  const report = {
    source: sourceDir,
    target: targetDir,
    copied: [],
    skipped: [],
    missing: [],
    symlinks: [],
    rewritten: [],
    dryRun,
  };
  const options = { sourceDir, targetDir, report, dryRun };

  if (!dryRun) {
    try {
      await mkdir(targetDir, { recursive: true });
    } catch (error) {
      throw new Error(`Cannot create target directory ${targetDir}: ${error.message}`);
    }
  }
  for (const file of CORE_FILES) {
    await copyConfigFileIfMissing(path.join(sourceDir, file), path.join(targetDir, file), options);
  }

  if (includeResources) {
    for (const dir of RESOURCE_DIRS) {
      await copyTreeIfMissing(path.join(sourceDir, dir), path.join(targetDir, dir), options);
    }
  }
  if (includeExtensions) {
    for (const dir of EXTENSION_DIRS) {
      await copyTreeIfMissing(path.join(sourceDir, dir), path.join(targetDir, dir), options);
    }
  }

  return report;
}

function usage() {
  return [
    "Import Pi user configuration into PiSpider's isolated agent directory.",
    "",
    "Usage: node scripts/pispider-migrate.mjs [options]",
    "",
    "Options:",
    "  --source <path>        Pi agent directory (default: PI_CODING_AGENT_DIR or ~/.pi/agent)",
    "  --target <path>        PiSpider agent directory (default: PISPIDER_AGENT_DIR or PISPIDER_HOME/agent)",
    "  --include-resources    Also copy themes/, prompts/, and skills/",
    "  --include-extensions   Also copy extensions/ (executable code from your Pi install)",
    "  --all                  Include resources and extensions",
    "  --dry-run              Report the plan without writing files",
    "  --optional             Exit 0 when the Pi source directory does not exist",
    "  --json                 Print the report as JSON",
    "  --help                 Show this help",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--source":
        if (argv[index + 1] === undefined) throw new Error("--source requires a path");
        options.source = argv[++index];
        break;
      case "--target":
        if (argv[index + 1] === undefined) throw new Error("--target requires a path");
        options.target = argv[++index];
        break;
      case "--include-resources":
        options.includeResources = true;
        break;
      case "--include-extensions":
        options.includeExtensions = true;
        break;
      case "--all":
        options.includeResources = true;
        options.includeExtensions = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--optional":
        options.optional = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--help":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  let report;
  try {
    report = await migratePiConfig(options);
  } catch (error) {
    if (options.optional && error.message.startsWith("Pi agent directory not found:")) {
      process.stdout.write(`No Pi configuration found; skipping import. ${error.message}\n`);
      return;
    }
    throw error;
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(`PiSpider config import\n\nSource: ${report.source}\nTarget: ${report.target}\n\n`);
  process.stdout.write(`Copied: ${report.copied.length}\n`);
  for (const file of report.copied) process.stdout.write(`  ${file}\n`);
  process.stdout.write(`Skipped existing: ${report.skipped.length}\n`);
  for (const file of report.skipped) process.stdout.write(`  ${file}\n`);
  if (report.missing.length) {
    process.stdout.write(`Missing: ${report.missing.length}\n`);
    for (const file of report.missing) process.stdout.write(`  ${file}\n`);
  }
  if (report.symlinks.length) {
    process.stdout.write(`Skipped symlinks: ${report.symlinks.length}\n`);
    for (const file of report.symlinks) process.stdout.write(`  ${file}\n`);
  }
  if (report.rewritten.length) {
    process.stdout.write(`Rewritten JSON path references: ${report.rewritten.length}\n`);
  }
  if (report.dryRun) process.stdout.write("\nDry run: no files were written.\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`PiSpider config import failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
