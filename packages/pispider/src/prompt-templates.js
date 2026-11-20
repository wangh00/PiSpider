/**
 * Pi prompt template files: user and project Markdown templates that Pi exposes as `/name` commands.
 * Desktop management stays here so prompt files follow the same layout Pi loads at runtime.
 */

import { access, lstat, mkdir, readdir, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { homeLayout } from "./home.js";
import {
  oneLine,
  parseFrontmatter,
  renderFrontmatter,
  timestampSlug,
  validateId,
  writeTextAtomic,
} from "./util.js";

const MAX_PROMPT_TEMPLATE_BYTES = 64 * 1024;
const DEFAULT_CONTENT = "Describe the reusable prompt this template should send. Use $ARGUMENTS, $1, ${1:-default} for arguments.\n";
const DEFAULT_DESCRIPTION = "Reusable prompt template";

function promptTemplateDir(home, scope, projectRoot) {
  if (scope === "project") {
    if (!projectRoot) throw new Error("Project path is required for project prompt templates");
    return path.join(path.resolve(projectRoot), ".pi", "prompts");
  }
  if (scope !== "user") throw new Error(`Unknown prompt template scope: ${scope}`);
  return path.join(homeLayout(home).agent, "prompts");
}

function assertTemplateSize(raw) {
  if (Buffer.byteLength(raw, "utf8") > MAX_PROMPT_TEMPLATE_BYTES) {
    throw new Error(`Prompt template exceeds ${MAX_PROMPT_TEMPLATE_BYTES} bytes`);
  }
}

function promptTemplatePath(home, scope, projectRoot, id) {
  const safeId = validateId(id, "prompt template id");
  const directory = promptTemplateDir(home, scope, projectRoot);
  return path.join(directory, `${safeId}.md`);
}

function templateDescription(body) {
  const firstLine = body.split("\n").find((line) => line.trim());
  return firstLine ? firstLine.trim().slice(0, 180) : "—";
}

function parseTemplate(raw, { id, scope, filePath }) {
  const { data, body } = parseFrontmatter(raw);
  const description = typeof data.description === "string" && data.description.trim()
    ? data.description.trim()
    : templateDescription(body);
  const argumentHint = typeof data["argument-hint"] === "string" ? data["argument-hint"].trim() : "";
  const content = body.replace(/\s+$/u, "");
  if (!content.trim()) throw new Error("Template body cannot be empty");
  return {
    id,
    scope,
    description,
    argumentHint,
    content,
    filePath,
    valid: true,
  };
}

async function readTemplateFile(filePath, id, scope) {
  const info = await lstat(filePath);
  if (info.isSymbolicLink()) throw new Error("Prompt template must not be a symbolic link");
  if (!info.isFile()) throw new Error("Prompt template must be a regular file");
  if (info.size > MAX_PROMPT_TEMPLATE_BYTES) {
    throw new Error(`Prompt template exceeds ${MAX_PROMPT_TEMPLATE_BYTES} bytes`);
  }
  const raw = await readFile(filePath, "utf8");
  return {
    ...parseTemplate(raw, { id, scope, filePath }),
    raw,
    bytes: info.size,
    updatedAt: info.mtime.toISOString(),
  };
}

async function listTemplatesInDir(directory, scope) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const templates = [];
  for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".md")).sort((a, b) => a.name.localeCompare(b.name))) {
    const id = entry.name.slice(0, -3);
    try {
      validateId(id, "prompt template id");
      const template = await readTemplateFile(path.join(directory, entry.name), id, scope);
      templates.push({
        id,
        scope,
        description: template.description,
        argumentHint: template.argumentHint,
        filePath: template.filePath,
        valid: true,
        bytes: template.bytes,
        updatedAt: template.updatedAt,
      });
    } catch (error) {
      templates.push({
        id,
        scope,
        description: "—",
        argumentHint: "",
        filePath: path.join(directory, entry.name),
        valid: false,
        error: error.message,
      });
    }
  }
  return templates;
}

export async function listPromptTemplates(home, projectRoot = null) {
  const userDir = promptTemplateDir(home, "user");
  const projectDir = projectRoot ? promptTemplateDir(home, "project", projectRoot) : null;
  const [userTemplates, projectTemplates] = await Promise.all([
    listTemplatesInDir(userDir, "user"),
    projectDir ? listTemplatesInDir(projectDir, "project") : Promise.resolve([]),
  ]);
  return {
    templates: [...userTemplates, ...projectTemplates],
    dirs: { user: userDir, project: projectDir },
  };
}

export async function readPromptTemplate(home, scope, projectRoot, id) {
  const filePath = promptTemplatePath(home, scope, projectRoot, id);
  return readTemplateFile(filePath, id, scope);
}

export async function createPromptTemplate(home, scope, projectRoot, input = {}) {
  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!id) throw new Error("Prompt template id is required");
  const filePath = promptTemplatePath(home, scope, projectRoot, id);
  try {
    await access(filePath);
    throw new Error(`Prompt template already exists: ${id}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const content = String(input.content ?? DEFAULT_CONTENT).trimEnd();
  if (!content.trim()) throw new Error("Template body cannot be empty");
  const description = oneLine(input.description || DEFAULT_DESCRIPTION, 1024);
  const argumentHint = oneLine(input.argumentHint || "", 512);
  const raw = renderFrontmatter({ description, ...(argumentHint ? { "argument-hint": argumentHint } : {}) }, content);
  assertTemplateSize(raw);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeTextAtomic(filePath, raw);
  return readPromptTemplate(home, scope, projectRoot, id);
}

export async function updatePromptTemplate(home, scope, projectRoot, id, input = {}) {
  const filePath = promptTemplatePath(home, scope, projectRoot, id);
  const current = await readPromptTemplate(home, scope, projectRoot, id);
  const content = String(input.content ?? current.content).trimEnd();
  if (!content.trim()) throw new Error("Template body cannot be empty");
  const description = oneLine(input.description ?? current.description, 1024);
  const argumentHint = oneLine(input.argumentHint ?? current.argumentHint, 512);
  const raw = renderFrontmatter({ description, ...(argumentHint ? { "argument-hint": argumentHint } : {}) }, content);
  assertTemplateSize(raw);
  await writeTextAtomic(filePath, raw);
  return readPromptTemplate(home, scope, projectRoot, id);
}

export async function deletePromptTemplate(home, scope, projectRoot, id) {
  const filePath = promptTemplatePath(home, scope, projectRoot, id);
  const info = await lstat(filePath);
  if (info.isSymbolicLink()) throw new Error("Prompt template must not be a symbolic link");
  if (!info.isFile()) throw new Error("Prompt template must be a regular file");
  const backupDir = path.join(homeLayout(home).backups, "prompt-templates");
  await mkdir(backupDir, { recursive: true });
  const backup = path.join(backupDir, `${scope}-${validateId(id, "prompt template id")}-${timestampSlug()}.md`);
  await rename(filePath, backup);
  return backup;
}
