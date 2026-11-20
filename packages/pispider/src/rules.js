import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { homeLayout } from "./home.js";
import {
  MAX_RULE_BYTES,
  assertSafeIdPath,
  oneLine,
  parseFrontmatter,
  removeWithBackup,
  renderFrontmatter,
  safeRemove,
  validateId,
  writeJsonAtomic,
  writeTextAtomic,
} from "./util.js";

const DEFAULT_RULE_BODY = `# Rule

Describe the reusable constraints, checks, and output conventions for this PiSpider rule.

## When to apply

## Required checks

## Evidence and output
`;

export function defaultRuleText({ id, name, description }) {
  return renderFrontmatter(
    {
      id,
      name,
      description,
      version: 1,
    },
    DEFAULT_RULE_BODY,
  );
}

export async function listRules(home, activeRuleId = null) {
  const layout = homeLayout(home);
  await mkdir(layout.rules, { recursive: true });
  const dirs = (await readdir(layout.rules, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  const rules = [];
  for (const entry of dirs) {
    let id;
    try {
      id = validateId(entry.name, "rule id");
    } catch (error) {
      rules.push({ id: entry.name, name: entry.name, description: "", active: false, valid: false, error: error.message });
      continue;
    }
    try {
      const rule = await readRule(home, id);
      rules.push({ ...rule, active: id === activeRuleId, valid: true });
    } catch (error) {
      rules.push({ id, name: id, description: "", active: id === activeRuleId, valid: false, error: error.message });
    }
  }
  return rules;
}

export async function readRule(home, id) {
  validateId(id, "rule id");
  const file = path.join(assertSafeIdPath(homeLayout(home).rules, id), "RULE.md");
  const raw = await readFile(file, "utf8");
  if (Buffer.byteLength(raw, "utf8") > MAX_RULE_BYTES) {
    throw new Error(`Rule ${id} exceeds ${MAX_RULE_BYTES} bytes`);
  }
  const { data, body } = parseFrontmatter(raw);
  if (data.id && data.id !== id) throw new Error(`Rule ${id} declares a different id: ${data.id}`);
  if (!body.trim()) throw new Error(`Rule ${id} is empty`);
  return {
    id,
    name: String(data.name ?? id),
    description: String(data.description ?? ""),
    version: Number.isFinite(data.version) ? data.version : 1,
    body,
    raw,
    path: file,
  };
}

export async function createRule(home, { id, name, description = "" }) {
  validateId(id, "rule id");
  const dir = assertSafeIdPath(homeLayout(home).rules, id);
  try {
    await stat(dir);
    throw new Error(`Rule already exists: ${id}`);
  } catch (error) {
    if (error && error.code !== "ENOENT") throw error;
  }
  await mkdir(dir, { recursive: true });
  try {
    const content = defaultRuleText({
      id,
      name: oneLine(name || id, 80),
      description: oneLine(description, 1024),
    });
    await writeTextAtomic(path.join(dir, "RULE.md"), content);
    await writeJsonAtomic(path.join(dir, "meta.json"), {
      id,
      name: oneLine(name || id, 80),
      description: oneLine(description, 1024),
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    await safeRemove(dir);
    throw error;
  }
  return readRule(home, id);
}

export async function updateRule(home, id, content) {
  validateId(id, "rule id");
  const file = path.join(assertSafeIdPath(homeLayout(home).rules, id), "RULE.md");
  await stat(file);
  if (Buffer.byteLength(content, "utf8") > MAX_RULE_BYTES) {
    throw new Error(`Rule ${id} exceeds ${MAX_RULE_BYTES} bytes`);
  }
  const { data, body } = parseFrontmatter(content);
  if (data.id && data.id !== id) throw new Error(`Rule ${id} declares a different id: ${data.id}`);
  if (!body.trim()) throw new Error("Rule body cannot be empty");
  await writeTextAtomic(file, content);
  return readRule(home, id);
}

export async function resetRule(home, id) {
  const rule = await readRule(home, id);
  return updateRule(
    home,
    id,
    defaultRuleText({ id, name: rule.name, description: rule.description }),
  );
}

export async function deleteRule(home, id) {
  validateId(id, "rule id");
  const dir = assertSafeIdPath(homeLayout(home).rules, id);
  await stat(dir);
  return removeWithBackup(dir, path.join(homeLayout(home).backups, "rules"), id);
}

export function formatRuleList(rules, activeRuleId) {
  if (rules.length === 0) return "No rules. Create one with /ps rules create <id> [name].";
  const lines = [`PiSpider rules (${rules.length})`, ""];
  for (const rule of rules) {
    const marker = rule.active ? "*" : " ";
    const state = rule.valid ? "" : ` [invalid: ${oneLine(rule.error, 80)}]`;
    lines.push(`${marker} ${rule.id} — ${rule.name || rule.id}${state}`);
    if (rule.description) lines.push(`    ${oneLine(rule.description)}`);
  }
  if (activeRuleId) lines.push("", `Active: ${activeRuleId}`);
  return lines.join("\n");
}
