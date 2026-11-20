import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ensureLayout } from "../src/home.js";
import { createSkill, deleteSkill, importSkill, listSkills } from "../src/skills.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pispider-skills-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  await ensureLayout(home, packageRoot);
  return { root, home };
}

async function makeSkill(root, id, description = "Use when testing a skill") {
  const source = path.join(root, id);
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, "SKILL.md"), `---\nname: ${id}\ndescription: ${description}\n---\n\n# Test\n`, "utf8");
  return source;
}

test("skill import, replacement backup, list, and delete round-trip", async (t) => {
  const { root, home } = await setup(t);
  const source = await makeSkill(root, "js-trace");
  await writeFile(path.join(source, "notes.txt"), "safe asset", "utf8");
  const imported = await importSkill(home, source);
  assert.equal(imported.id, "js-trace");
  assert.equal(imported.files, 2);
  assert.equal(await readFile(path.join(home, "skills", "js-trace", "notes.txt"), "utf8"), "safe asset");

  const replacement = await makeSkill(root, "js-trace", "Updated description");
  const replaced = await importSkill(home, replacement);
  assert.ok(replaced.backup);
  assert.ok((await access(replaced.backup), true));
  const skills = await listSkills(home);
  assert.equal(skills.length, 1);
  assert.equal(skills[0].valid, true);
  assert.match(skills[0].description, /Updated/);

  const backup = await deleteSkill(home, "js-trace");
  assert.ok(backup);
  assert.equal((await listSkills(home)).length, 0);
});

test("skill creation and id validation are safe", async (t) => {
  const { home } = await setup(t);
  const created = await createSkill(home, { id: "new-skill", description: "A new skill" });
  assert.equal(created.name, "new-skill");
  await assert.rejects(() => createSkill(home, { id: "../escape" }), /kebab-case|id must/i);
});

test("skill import rejects mismatched names and non-directories", async (t) => {
  const { root, home } = await setup(t);
  const source = path.join(root, "folder-name");
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, "SKILL.md"), "---\nname: different-name\ndescription: test\n---\n# X\n", "utf8");
  await assert.rejects(() => importSkill(home, source), /match directory id/);
  await assert.rejects(() => importSkill(home, path.join(root, "does-not-exist")), /ENOENT|directory/i);
});

test("skill import rejects symlinks when the platform permits creating one", async (t) => {
  const { root, home } = await setup(t);
  const source = await makeSkill(root, "linked-skill");
  try {
    await symlink(path.join(source, "SKILL.md"), path.join(source, "alias.md"), "file");
  } catch {
    t.skip("symbolic link creation is unavailable");
    return;
  }
  await assert.rejects(() => importSkill(home, source), /symbolic links/i);
});

test("skill import skips .git and node_modules noise", async (t) => {
  const { root, home } = await setup(t);
  const source = await makeSkill(root, "noise-skill");
  await mkdir(path.join(source, ".git"), { recursive: true });
  await writeFile(path.join(source, ".git", "config"), "hidden", "utf8");
  await mkdir(path.join(source, "node_modules", "pkg"), { recursive: true });
  await writeFile(path.join(source, "node_modules", "pkg", "index.js"), "x", "utf8");
  const imported = await importSkill(home, source);
  assert.equal(imported.files, 1);
  await assert.rejects(() => access(path.join(home, "skills", "noise-skill", ".git")), /ENOENT/);
  await assert.rejects(() => access(path.join(home, "skills", "noise-skill", "node_modules")), /ENOENT/);
});

test("invalid skills keep their directory path for the UI", async (t) => {
  const { home } = await setup(t);
  const broken = path.join(home, "skills", "broken-skill");
  await mkdir(broken, { recursive: true });
  const skills = await listSkills(home);
  assert.equal(skills.length, 1);
  assert.equal(skills[0].valid, false);
  assert.equal(skills[0].path, broken);
  assert.match(skills[0].error, /SKILL.md|ENOENT/i);
});
