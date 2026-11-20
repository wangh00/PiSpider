import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ensureLayout } from "../src/home.js";
import {
  createPromptTemplate,
  deletePromptTemplate,
  listPromptTemplates,
  readPromptTemplate,
  updatePromptTemplate,
} from "../src/prompt-templates.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pispider-prompt-templates-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const project = path.join(root, "project");
  await Promise.all([ensureLayout(home, packageRoot), mkdir(path.join(project, ".pi", "prompts"), { recursive: true })]);
  return { root, home, project };
}

test("prompt template user and project round-trip", async (t) => {
  const { home, project } = await setup(t);
  const created = await createPromptTemplate(home, "user", project, {
    id: "review",
    description: "Review staged changes",
    argumentHint: "[focus]",
    content: "Review $ARGUMENTS with focus on ${1:-correctness}.",
  });
  assert.equal(created.id, "review");
  assert.equal(created.scope, "user");
  assert.equal(created.description, "Review staged changes");
  assert.equal(created.argumentHint, "[focus]");

  const listed = await listPromptTemplates(home, project);
  assert.equal(listed.templates.length, 1);
  assert.equal(listed.templates[0].id, "review");
  assert.equal(listed.templates[0].description, "Review staged changes");

  const updated = await updatePromptTemplate(home, "user", project, "review", {
    description: "Review all changes",
    content: "Updated $ARGUMENTS",
  });
  assert.equal(updated.description, "Review all changes");
  assert.equal(updated.argumentHint, "[focus]");
  assert.equal((await readPromptTemplate(home, "user", project, "review")).content, "Updated $ARGUMENTS");

  await createPromptTemplate(home, "project", project, {
    id: "project-check",
    description: "Project check",
    content: "Check the project.",
  });
  const both = await listPromptTemplates(home, project);
  assert.equal(both.templates.length, 2);
  assert.deepEqual(both.templates.map((item) => item.scope), ["user", "project"]);

  const backup = await deletePromptTemplate(home, "user", project, "review");
  assert.ok(backup);
  assert.ok((await access(backup), true));
  assert.equal((await listPromptTemplates(home, project)).templates.length, 1);
});

test("prompt template validation rejects unsafe names and duplicates", async (t) => {
  const { home, project } = await setup(t);
  await assert.rejects(() => createPromptTemplate(home, "user", project, { id: "../escape", content: "x" }), /kebab-case|id must/i);
  await createPromptTemplate(home, "user", project, { id: "safe-name", content: "x" });
  await assert.rejects(() => createPromptTemplate(home, "user", project, { id: "safe-name", content: "y" }), /already exists/i);
});

test("prompt template list reports invalid files without hiding the rest", async (t) => {
  const { home, project } = await setup(t);
  const dir = path.join(home, "agent", "prompts");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "broken.md"), "---\ndescription: broken\n---\n", "utf8");
  await writeFile(path.join(dir, "BadName.md"), "---\ndescription: bad name\n---\nBody\n", "utf8");
  const listed = await listPromptTemplates(home, project);
  assert.equal(listed.templates.length, 2);
  assert.equal(listed.templates.every((template) => template.valid === false), true);
  assert.match(listed.templates.find((template) => template.id === "BadName").error, /kebab-case/i);
});

test("prompt template refuses oversized content", async (t) => {
  const { home, project } = await setup(t);
  const content = "x".repeat(65 * 1024);
  await assert.rejects(
    () => createPromptTemplate(home, "user", project, { id: "too-big", content }),
    /exceeds/i,
  );
});
