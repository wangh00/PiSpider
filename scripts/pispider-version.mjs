/**
 * Keep the bundled Pi core version in sync across the launcher, the packaged
 * runtime stager, and the Electron main process.
 *
 * Usage:
 *   node scripts/pispider-version.mjs --check
 *   node scripts/pispider-version.mjs --set 1.5.3
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const CORE_VERSION_FILES = [
  "scripts/pispider-launcher.mjs",
  "apps/pispider-desktop/scripts/prepare-packaged-runtime.mjs",
  "apps/pispider-desktop/packaged-runtime.cjs",
];

const CORE_VERSION_PATTERN = /((?:export\s+)?const CORE_VERSION\s*=\s*)"([^"]+)";/u;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

async function readVersions() {
  const versions = [];
  for (const file of CORE_VERSION_FILES) {
    const source = await readFile(path.join(repoRoot, file), "utf8");
    const match = source.match(CORE_VERSION_PATTERN);
    if (!match) throw new Error(`${file} 缺少 const CORE_VERSION = "x.y.z";`);
    versions.push({ file, version: match[2] });
  }
  return versions;
}

async function checkVersions() {
  const versions = await readVersions();
  const unique = new Set(versions.map((item) => item.version));
  if (unique.size !== 1) {
    const detail = versions.map((item) => `  ${item.version}  ${item.file}`).join("\n");
    throw new Error(`CORE_VERSION 三处不一致：\n${detail}`);
  }
  const version = versions[0].version;
  console.log(`CORE_VERSION ${version} 三处一致（${CORE_VERSION_FILES.length} 个文件）`);
  return version;
}

async function setVersion(version) {
  if (!VERSION_PATTERN.test(version)) throw new Error(`版本号无效：${version}（需要 x.y.z）`);
  const sources = [];
  for (const file of CORE_VERSION_FILES) {
    const target = path.join(repoRoot, file);
    const source = await readFile(target, "utf8");
    if (!CORE_VERSION_PATTERN.test(source)) throw new Error(`${file} 缺少 const CORE_VERSION = "x.y.z";`);
    sources.push({ file, target, source });
  }
  for (const { file, target, source } of sources) {
    const updated = source.replace(CORE_VERSION_PATTERN, `$1"${version}";`);
    await writeFile(target, updated);
    console.log(`updated ${file}`);
  }
  console.log(`CORE_VERSION 已设为 ${version}`);
  console.log("下一步：运行 npm run check:core-version，再重建打包 runtime。");
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (command === "--check") {
    await checkVersions();
    return;
  }
  if (command === "--set") {
    const version = String(args[1] || "").trim();
    if (!version) throw new Error("缺少版本号：npm run pispider:core-version -- 1.5.3");
    await setVersion(version);
    return;
  }
  throw new Error("用法：node scripts/pispider-version.mjs --check | --set <x.y.z>");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
