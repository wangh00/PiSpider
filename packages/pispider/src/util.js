import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_RULE_BYTES = 8 * 1024;
export const MAX_PROMPT_BYTES = 16 * 1024;

export function validateId(value, label = "id") {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 64) {
    throw new Error(`${label} must be kebab-case (lowercase letters, numbers, hyphens), max 64 characters`);
  }
  return value;
}

export function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export async function writeTextAtomic(target, content) {
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, target);
}

export async function writeJsonAtomic(target, value) {
  await writeTextAtomic(target, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJson(target, fallback = null) {
  try {
    return JSON.parse(await readFile(target, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return fallback;
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${target}: ${error.message}`);
    }
    throw error;
  }
}

export function assertSafeIdPath(root, id) {
  const safeId = validateId(id);
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, safeId);
  if (candidate === resolvedRoot || !candidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Path escapes root: ${id}`);
  }
  return candidate;
}

export function parseFrontmatter(text) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return { data: {}, body: normalized };
  const end = normalized.indexOf("\n---", 4);
  if (end === -1) throw new Error("Unclosed frontmatter");
  const raw = normalized.slice(4, end).trim();
  const body = normalized.slice(end + 4).replace(/^\n+/, "");
  const data = {};
  for (const line of raw.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) throw new Error(`Invalid frontmatter line: ${line}`);
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else if (value === "true") value = true;
    else if (value === "false") value = false;
    else if (/^-?\d+(?:\.\d+)?$/.test(value)) value = Number(value);
    data[key] = value;
  }
  return { data, body };
}

export function renderFrontmatter(data, body) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    lines.push(`${key}: ${String(value)}`);
  }
  lines.push("---", "", String(body ?? "").replace(/\s+$/u, ""), "");
  return lines.join("\n");
}

export function truncateText(text, max = MAX_PROMPT_BYTES) {
  const value = String(text ?? "");
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 40))}\n\n[PiSpider truncated ${value.length - max + 40} characters]`;
}

export function oneLine(text, max = 180) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

export function splitArgs(input) {
  const args = [];
  let current = "";
  let quote = null;
  for (const char of String(input ?? "")) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) args.push(current);
  return args;
}

export async function removeWithBackup(source, backupRoot, label) {
  await mkdir(backupRoot, { recursive: true });
  const destination = path.join(backupRoot, `${label}-${timestampSlug()}`);
  await rename(source, destination);
  return destination;
}

export async function safeRemove(target) {
  await rm(target, { recursive: true, force: true });
}
