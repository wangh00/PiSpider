import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ensureLayout } from "../src/home.js";
import { composePrompt, inspectPromptFiles, resetPromptComponents, updatePromptComponent } from "../src/prompts.js";
import { createRule } from "../src/rules.js";
import { applyTaskAction, createTaskState } from "../src/task-state.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function setup(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), "pispider-prompt-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await ensureLayout(home, packageRoot);
  return home;
}

test("JS prompt composition adds domain, rule, task, and continuity contract", async (t) => {
  const home = await setup(t);
  const rule = await createRule(home, { id: "my-rule", name: "My Rule", description: "Visible rule" });
  const task = applyTaskAction(createTaskState(), {
    action: "plan",
    goal: "Map request signing",
    scope: "Owned demo app",
    steps: ["Capture request", "Find signer"],
    nextAction: "Capture one request",
  });
  const prompt = await composePrompt({
    home,
    packageRoot,
    config: { domain: "js", activeRule: "my-rule" },
    promptText: "trace this webpack bundle",
    rule,
    taskState: task,
  });

  assert.match(prompt, /PiSpider Core/);
  assert.match(prompt, /JavaScript Reverse-Engineering Domain/);
  assert.match(prompt, /Active User Rule: My Rule/);
  assert.match(prompt, /Map request signing/);
  assert.match(prompt, /additive/);
  assert.match(prompt, /Do not interpret it as permission to remove Pi's existing instructions/);
  assert.match(prompt, /ps_task action=reroute/);
  assert.match(prompt, /Record the authorization or ownership context once/);
});

test("auto mode without a domain signal stays general and does not inject app guidance", async (t) => {
  const home = await setup(t);
  const prompt = await composePrompt({
    home,
    packageRoot,
    config: { domain: "auto", activeRule: null },
    promptText: "Explain the task workflow",
    rule: null,
    taskState: null,
  });
  assert.match(prompt, /Domain Routing/);
  assert.doesNotMatch(prompt, /# App Reverse-Engineering Domain/);
  assert.doesNotMatch(prompt, /# JavaScript Reverse-Engineering Domain/);
});

test("prompt components can be reset and inspected", async (t) => {
  const home = await setup(t);
  const file = path.join(home, "prompts", "js.md");
  await writeFile(file, "custom", "utf8");
  const reset = await resetPromptComponents(home, packageRoot, ["js"]);
  assert.deepEqual(reset, ["js"]);
  assert.match((await inspectPromptFiles(home)).find((entry) => entry.name === "js").path, /js\.md$/);
});

test("prompt components can be updated with a size limit", async (t) => {
  const home = await setup(t);
  const updated = await updatePromptComponent(home, "workflow", "Visible workflow override");
  assert.equal(updated.name, "workflow");
  assert.match((await inspectPromptFiles(home)).find((entry) => entry.name === "workflow").path, /workflow\.md$/);
  await assert.rejects(() => updatePromptComponent(home, "workflow", ""), /cannot be empty/);
  await assert.rejects(() => updatePromptComponent(home, "workflow", "x".repeat(17 * 1024)), /exceeds/);
  await assert.rejects(() => updatePromptComponent(home, "missing", "x"), /Unknown prompt component/);
});
