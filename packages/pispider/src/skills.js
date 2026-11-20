import { copyFile, mkdir, readdir, readFile, lstat, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { homeLayout } from "./home.js";
import {
  assertSafeIdPath,
  oneLine,
  parseFrontmatter,
  removeWithBackup,
  safeRemove,
  timestampSlug,
  validateId,
} from "./util.js";

const MAX_SKILL_FILE_BYTES = 256 * 1024;
const MAX_ASSET_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 200;
const NOISE_DIRS = new Set([".git", "node_modules", "__MACOSX"]);

const DEFAULT_BODY = `# Skill

Describe the workflow this skill should trigger, the inputs it expects, and the visible checks it performs.

## Use when

## Steps

## Output
`;

export function defaultSkillText({ id, description }) {
  return `---\nname: ${id}\ndescription: ${description}\n---\n\n${DEFAULT_BODY}`;
}

async function inspectTree(root, expectedId) {
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory()) throw new Error("Skill source must be a directory");
  if (rootStat.isSymbolicLink()) throw new Error("Symbolic links are not allowed in skills");

  const skillFile = path.join(root, "SKILL.md");
  const skillStat = await lstat(skillFile);
  if (!skillStat.isFile() || skillStat.isSymbolicLink()) throw new Error("SKILL.md must be a regular file");
  if (skillStat.size > MAX_SKILL_FILE_BYTES) {
    throw new Error(`SKILL.md exceeds ${MAX_SKILL_FILE_BYTES} bytes`);
  }
  const raw = await readFile(skillFile, "utf8");
  const { data } = parseFrontmatter(raw);
  const name = String(data.name ?? "").trim();
  const description = String(data.description ?? "").trim();
  if (name !== expectedId) throw new Error(`SKILL.md name must match directory id: ${expectedId}`);
  validateId(name, "skill name");
  if (!description) throw new Error("SKILL.md description is required");
  if (description.length > 1024) throw new Error("SKILL.md description exceeds 1024 characters");

  let files = 0;
  let totalBytes = 0;
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (NOISE_DIRS.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${absolute}`);
      if (info.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!info.isFile()) throw new Error(`Unsupported filesystem entry: ${absolute}`);
      files += 1;
      if (files > MAX_FILES) throw new Error(`Skill exceeds ${MAX_FILES} files`);
      if (info.size > MAX_ASSET_FILE_BYTES) throw new Error(`Skill file exceeds ${MAX_ASSET_FILE_BYTES} bytes: ${absolute}`);
      totalBytes += info.size;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error(`Skill exceeds ${MAX_TOTAL_BYTES} bytes`);
    }
  }
  await walk(root);
  return { name, description, files, totalBytes, path: root };
}

async function copyTreeSafe(source, destination) {
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (NOISE_DIRS.has(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    const info = await lstat(from);
    if (info.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${from}`);
    if (info.isDirectory()) {
      await copyTreeSafe(from, to);
      continue;
    }
    if (!info.isFile()) throw new Error(`Unsupported filesystem entry: ${from}`);
    await copyFile(from, to);
  }
}

export async function listSkills(home) {
  const layout = homeLayout(home);
  await mkdir(layout.skills, { recursive: true });
  const entries = (await readdir(layout.skills, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  const skills = [];
  for (const entry of entries) {
    try {
      const info = await inspectTree(path.join(layout.skills, entry.name), entry.name);
      skills.push({ id: entry.name, valid: true, ...info });
    } catch (error) {
      skills.push({
        id: entry.name,
        valid: false,
        error: error.message,
        files: 0,
        totalBytes: 0,
        path: path.join(layout.skills, entry.name),
      });
    }
  }
  return skills;
}

export async function createSkill(home, { id, description = "Describe what this skill does and when to use it." }) {
  validateId(id, "skill id");
  const safeDescription = oneLine(description, 1024);
  if (!safeDescription) throw new Error("Skill description cannot be empty");
  const destination = assertSafeIdPath(homeLayout(home).skills, id);
  try {
    await stat(destination);
    throw new Error(`Skill already exists: ${id}`);
  } catch (error) {
    if (error && error.code !== "ENOENT") throw error;
  }
  await mkdir(destination, { recursive: true });
  try {
    await writeFile(path.join(destination, "SKILL.md"), defaultSkillText({ id, description: safeDescription }), "utf8");
  } catch (error) {
    await safeRemove(destination);
    throw error;
  }
  return inspectTree(destination, id);
}

export async function importSkill(home, sourcePath, expectedId = null) {
  const source = path.resolve(sourcePath);
  const id = expectedId ? validateId(expectedId, "skill id") : validateId(path.basename(source), "skill id");
  const layout = homeLayout(home);
  const destination = assertSafeIdPath(layout.skills, id);
  await inspectTree(source, id);
  await mkdir(layout.skills, { recursive: true });

  const stageRoot = path.join(layout.state, "skill-imports");
  await mkdir(stageRoot, { recursive: true });
  const stage = path.join(stageRoot, `${id}-${timestampSlug()}`);
  await safeRemove(stage);
  let backup = null;
  let destinationRemoved = false;
  try {
    await copyTreeSafe(source, stage);
    await inspectTree(stage, id);
    try {
      await stat(destination);
      backup = await removeWithBackup(destination, path.join(layout.backups, "skills"), id);
      destinationRemoved = true;
    } catch (error) {
      if (error && error.code !== "ENOENT") throw error;
    }
    await rename(stage, destination);
    return { ...(await inspectTree(destination, id)), id, backup };
  } catch (error) {
    await safeRemove(stage);
    if (destinationRemoved && backup) {
      await rename(backup, destination).catch(() => {});
    }
    throw error;
  }
}

export async function deleteSkill(home, id) {
  validateId(id, "skill id");
  const destination = assertSafeIdPath(homeLayout(home).skills, id);
  await stat(destination);
  return removeWithBackup(destination, path.join(homeLayout(home).backups, "skills"), id);
}

export function formatSkillList(skills) {
  if (skills.length === 0) return "No PiSpider skills. Create or import one with /ps skills.";
  const lines = [`PiSpider skills (${skills.length})`, ""];
  for (const skill of skills) {
    const state = skill.valid ? "" : ` [invalid: ${oneLine(skill.error, 80)}]`;
    lines.push(`- ${skill.id} — ${oneLine(skill.description || skill.id, 140)}${state}`);
    if (skill.valid) lines.push(`    ${skill.files} files, ${(skill.totalBytes / 1024).toFixed(1)} KiB`);
  }
  return lines.join("\n");
}
