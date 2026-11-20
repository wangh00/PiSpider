import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ensureLayout } from "../src/home.js";
import { createRule, deleteRule, listRules, readRule, resetRule, updateRule } from "../src/rules.js";
import { setActiveRule, loadConfig, setDomain } from "../src/config.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function setup(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), "pispider-rules-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await ensureLayout(home, packageRoot);
  return home;
}

test("rule lifecycle is visible, editable, backed up, and configurable", async (t) => {
  const home = await setup(t);
  const created = await createRule(home, { id: "evidence-first", name: "Evidence First", description: "Record probes" });
  assert.match(created.raw, /id: evidence-first/);
  assert.match(created.raw, /Evidence First/);

  const updatedRaw = created.raw.replace("## Required checks", "## Required checks\n\n- Cite evidence");
  await updateRule(home, "evidence-first", updatedRaw);
  assert.match((await readRule(home, "evidence-first")).body, /Cite evidence/);

  await setDomain(home, "js");
  await setActiveRule(home, "evidence-first");
  const config = await loadConfig(home);
  assert.equal(config.domain, "js");
  const list = await listRules(home, config.activeRule);
  assert.equal(list.length, 1);
  assert.equal(list[0].active, true);
  assert.equal(list[0].valid, true);

  await resetRule(home, "evidence-first");
  assert.doesNotMatch((await readRule(home, "evidence-first")).body, /Cite evidence/);

  const backup = await deleteRule(home, "evidence-first");
  assert.ok((await stat(backup)).isDirectory());
  assert.equal((await listRules(home, null)).length, 0);
});

test("rule ids reject traversal and invalid shapes", async (t) => {
  const home = await setup(t);
  await assert.rejects(() => createRule(home, { id: "../escape" }), /kebab-case|escapes|id must/i);
  await assert.rejects(() => createRule(home, { id: "Bad_ID" }), /kebab-case/i);
});
