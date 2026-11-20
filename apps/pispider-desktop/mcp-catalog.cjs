/**
 * MCP catalog manifest loader and lazy-install helpers.
 *
 * catalog/catalog.json is the source of truth for preloaded MCP entries. Entries
 * are shown in the MCP window before they are configured; they stay out of
 * mcp.json until the user starts them. Starting an entry installs the pinned
 * package under the PiSpider home directory. Skills bundled with an MCP package
 * stay inside that package; they are never copied into the user skills directory.
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const { detectNpmCli, mcpNpmUnavailableMessage } = require("./packaged-runtime.cjs");

const CATALOG_PATH = path.join(__dirname, "catalog", "catalog.json");
const CATALOG_VERSION = 1;
const MCP_TRANSPORTS = new Set(["stdio", "http"]);
const MCP_EXPOSURES = new Set(["codemode", "deferred", "direct", "hidden"]);
const INPUT_KINDS = new Set(["text", "directory"]);
const PACKAGE_NAME_PATTERN = /^(@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/;
const VERSION_PATTERN = /^[0-9A-Za-z.+_-]+$/;
const PLACEHOLDER_PATTERN = /\$\{([A-Za-z0-9_.-]+)\}/g;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value, field) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${field} 必须是非空字符串`);
  return text;
}

function requiredPackageName(value, field) {
  const text = requiredString(value, field);
  if (text.length > 214 || !PACKAGE_NAME_PATTERN.test(text)) {
    throw new Error(`${field} 不是合法的 npm 包名`);
  }
  return text;
}

function requiredVersion(value, field) {
  const text = requiredString(value, field);
  if (!VERSION_PATTERN.test(text)) throw new Error(`${field} 不是合法的版本号`);
  return text;
}

function optionalString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function stringArray(value, field) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${field} 必须是字符串数组`);
  return value.map((item, index) => requiredString(item, `${field}[${index}]`));
}

function stringRecord(value, field) {
  if (value == null) return {};
  if (!isRecord(value)) throw new Error(`${field} 必须是对象`);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      requiredString(key, `${field}.key`),
      requiredString(item, `${field}.${key}`),
    ]),
  );
}

function normalizeInput(raw, mcpIndex, inputIndex) {
  const field = `mcp[${mcpIndex}].inputs[${inputIndex}]`;
  if (!isRecord(raw)) throw new Error(`${field} 必须是对象`);
  const id = requiredString(raw.id, `${field}.id`);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`${field}.id 只能包含字母、数字、_ 和 -`);
  const kind = optionalString(raw.kind, "text");
  if (!INPUT_KINDS.has(kind)) throw new Error(`${field}.kind 只能是 text 或 directory`);
  return Object.freeze({
    id,
    label: requiredString(raw.label, `${field}.label`),
    description: optionalString(raw.description),
    kind,
    default: optionalString(raw.default),
    placeholder: optionalString(raw.placeholder),
    required: raw.required == null ? true : raw.required === true,
  });
}

function normalizeMcpEntry(raw, index) {
  if (!isRecord(raw)) throw new Error(`mcp[${index}] 必须是对象`);
  const id = requiredString(raw.id, `mcp[${index}].id`);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`mcp[${index}].id 只能包含字母、数字、_ 和 -`);
  const name = requiredString(raw.name || id, `mcp[${index}].name`);
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`mcp[${index}].name 只能包含字母、数字、_ 和 -`);
  const transport = optionalString(raw.transport) || (raw.url ? "http" : "stdio");
  if (!MCP_TRANSPORTS.has(transport)) throw new Error(`mcp[${index}].transport 只能是 stdio 或 http`);
  let packageName = "";
  let version = "";
  let binName = "";
  let url = "";
  let headers = {};
  if (transport === "http") {
    if (raw.package != null) throw new Error(`mcp[${index}] 是 HTTP 预置，不应声明 package`);
    url = requiredString(raw.url, `mcp[${index}].url`);
    if (!/^https?:\/\//.test(url)) throw new Error(`mcp[${index}].url 必须是 http(s) 地址`);
    headers = stringRecord(raw.headers, `mcp[${index}].headers`);
  } else {
    if (raw.url != null) throw new Error(`mcp[${index}] 是 stdio 预置，不应声明 url`);
    if (!isRecord(raw.package)) throw new Error(`mcp[${index}].package 必须是对象`);
    packageName = requiredPackageName(raw.package.name, `mcp[${index}].package.name`);
    version = requiredVersion(raw.package.version, `mcp[${index}].package.version`);
    binName = optionalString(raw.package.bin) || packageName;
  }
  const exposure = optionalString(raw.exposure, "codemode");
  if (!MCP_EXPOSURES.has(exposure)) {
    throw new Error(`mcp[${index}].exposure 只能是 codemode、deferred、direct 或 hidden`);
  }
  const env = raw.env == null ? {} : raw.env;
  if (!isRecord(env)) throw new Error(`mcp[${index}].env 必须是对象`);
  const envEntries = Object.entries(env).map(([key, value]) => [
    requiredString(key, `mcp[${index}].env.key`),
    requiredString(value, `mcp[${index}].env.${key}`),
  ]);
  if (raw.skills != null) {
    throw new Error(`mcp[${index}].skills 已移除：MCP 自带 Skill 保留在包内，不复制到用户技能目录`);
  }
  const inputsRaw = raw.inputs == null ? [] : raw.inputs;
  if (!Array.isArray(inputsRaw)) throw new Error(`mcp[${index}].inputs 必须是数组`);
  const inputs = inputsRaw.map((input, inputIndex) => normalizeInput(input, index, inputIndex));
  return Object.freeze({
    id,
    name,
    label: optionalString(raw.label) || name,
    transport,
    packageName,
    version,
    binName,
    url,
    headers: Object.freeze(headers),
    description: optionalString(raw.description),
    homepage: optionalString(raw.homepage),
    exposure,
    mcpArgs: stringArray(raw.args, `mcp[${index}].args`),
    env: Object.freeze(Object.fromEntries(envEntries)),
    inputs: Object.freeze(inputs),
    prerequisite: optionalString(raw.prerequisite),
  });
}

function loadCatalog(filePath = CATALOG_PATH) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return Object.freeze({
      version: CATALOG_VERSION,
      path: filePath,
      mcp: Object.freeze([]),
      errors: Object.freeze([`读取 catalog.json 失败：${error.message}`]),
    });
  }
  const errors = [];
  if (!isRecord(raw)) {
    return Object.freeze({
      version: CATALOG_VERSION,
      path: filePath,
      mcp: Object.freeze([]),
      errors: Object.freeze(["catalog.json 顶层必须是对象"]),
    });
  }
  if (raw.version !== CATALOG_VERSION) errors.push(`catalog.json version 必须是 ${CATALOG_VERSION}`);
  const mcp = [];
  const ids = new Set();
  const names = new Set();
  const mcpRaw = raw.mcp == null ? [] : raw.mcp;
  if (!Array.isArray(mcpRaw)) {
    errors.push("catalog.json.mcp 必须是数组");
  } else {
    for (const [index, entry] of mcpRaw.entries()) {
      try {
        const normalized = normalizeMcpEntry(entry, index);
        if (ids.has(normalized.id)) throw new Error(`mcp id 重复：${normalized.id}`);
        if (names.has(normalized.name)) throw new Error(`mcp name 重复：${normalized.name}`);
        ids.add(normalized.id);
        names.add(normalized.name);
        mcp.push(normalized);
      } catch (error) {
        errors.push(error.message);
      }
    }
  }
  if (raw.skills != null) {
    errors.push("catalog.json.skills 已移除：MCP 自带 Skill 保留在包内，不复制到用户技能目录");
  }
  return Object.freeze({
    version: CATALOG_VERSION,
    path: filePath,
    mcp: Object.freeze(mcp),
    errors: Object.freeze(errors),
  });
}

const CATALOG = loadCatalog();
const MCP_CATALOG = CATALOG.mcp;

function getCatalogDiagnostics() {
  return { path: CATALOG.path, version: CATALOG.version, errors: CATALOG.errors };
}

function findCatalogEntry(idOrName) {
  const value = String(idOrName || "").trim();
  return MCP_CATALOG.find((entry) => entry.id === value || entry.name === value) || null;
}

function catalogContext(paths, inputs = {}) {
  return {
    PISPIDER_HOME: paths.home,
    PISPIDER_AGENT_DIR: paths.agentDir || path.join(paths.home, "agent"),
    WORKSPACE: paths.workspace || process.cwd(),
    HOME: os.homedir(),
    PATH_SEP: path.sep,
    inputs,
  };
}

function resolvePlaceholder(token, context) {
  if (token.startsWith("input.")) {
    const id = token.slice("input.".length);
    const value = context.inputs?.[id];
    if (value == null || value === "") throw new Error(`缺少启动参数：${id}`);
    return value;
  }
  const value = context[token];
  if (value == null || value === "") throw new Error(`未知占位符：${token}`);
  return value;
}

function resolveTemplate(value, context) {
  return String(value).replace(PLACEHOLDER_PATTERN, (_match, token) => resolvePlaceholder(token, context));
}

function expandHome(value) {
  const text = value.trim();
  if (text === "~") return os.homedir();
  if (text.startsWith("~/") || text.startsWith("~\\")) return path.join(os.homedir(), text.slice(2));
  return text;
}

function resolveDirectoryInput(value, paths, label) {
  const expanded = expandHome(value);
  const absolute = path.isAbsolute(expanded) ? expanded : path.resolve(paths.workspace || process.cwd(), expanded);
  let info;
  try {
    info = fs.statSync(absolute);
  } catch {
    throw new Error(`${label} 不存在：${absolute}`);
  }
  if (!info.isDirectory()) throw new Error(`${label} 不是目录：${absolute}`);
  return absolute;
}

function describeCatalogInputs(entry, paths) {
  const context = catalogContext(paths);
  return entry.inputs.map((input) => ({
    ...input,
    default: input.default ? resolveTemplate(input.default, context) : "",
  }));
}

function resolveCatalogInputs(entry, paths, provided = {}) {
  const context = catalogContext(paths);
  const values = {};
  for (const input of entry.inputs) {
    const raw = provided[input.id] != null ? String(provided[input.id]).trim() : input.default;
    if (!raw) {
      if (input.required) throw new Error(`请填写${input.label}`);
      values[input.id] = "";
      continue;
    }
    const value = resolveTemplate(raw, context);
    values[input.id] = input.kind === "directory" ? resolveDirectoryInput(value, paths, input.label) : value;
  }
  return values;
}

function resolveCatalogInvocation(entry, paths, providedInputs = {}) {
  const inputs = resolveCatalogInputs(entry, paths, providedInputs);
  const context = catalogContext(paths, inputs);
  const args = entry.mcpArgs.map((value) => resolveTemplate(value, context));
  const env = Object.fromEntries(Object.entries(entry.env).map(([key, value]) => [key, resolveTemplate(value, context)]));
  const url = entry.url ? resolveTemplate(entry.url, context) : "";
  const headers = Object.fromEntries(
    Object.entries(entry.headers || {}).map(([key, value]) => [key, resolveTemplate(value, context)]),
  );
  return { inputs, args, env, url, headers };
}

function catalogInstallDir(paths, entry) {
  return path.join(paths.agentDir, "mcp-packages", entry.id);
}

function catalogPackageRoot(paths, entry) {
  return path.join(catalogInstallDir(paths, entry), "node_modules", entry.packageName);
}

function resolvePackageBin(pkg, entry) {
  const bin = pkg?.bin;
  if (typeof bin === "string" && bin.trim()) return bin;
  if (bin && typeof bin === "object") {
    return bin[entry.binName] || bin[entry.packageName] || Object.values(bin).find((item) => typeof item === "string");
  }
  return null;
}

async function inspectCatalogEntry(entry, paths) {
  if (entry.transport === "http") {
    return { installed: false, version: null, binPath: "", packageRoot: "", error: null };
  }
  const packageRoot = catalogPackageRoot(paths, entry);
  const packageJsonPath = path.join(packageRoot, "package.json");
  try {
    const pkg = JSON.parse(await fsp.readFile(packageJsonPath, "utf8"));
    const bin = resolvePackageBin(pkg, entry);
    if (!bin) {
      return { installed: false, version: pkg.version || null, error: "未找到可执行入口" };
    }
    const binPath = path.resolve(packageRoot, bin);
    if (!fs.existsSync(binPath)) {
      return { installed: false, version: pkg.version || null, error: "可执行入口不存在" };
    }
    return {
      installed: true,
      version: typeof pkg.version === "string" ? pkg.version : entry.version,
      binPath,
      packageRoot,
    };
  } catch (error) {
    if (error.code === "ENOENT") return { installed: false, version: null, error: null };
    return { installed: false, version: null, error: error.message };
  }
}

async function findNpmCli(nodeExecutable) {
  const npmExecPath = process.env.npm_execpath?.trim();
  if (npmExecPath && npmExecPath.endsWith(".js") && fs.existsSync(npmExecPath)) return npmExecPath;

  let nodePath = process.env.PISPIDER_NODE?.trim() || process.env.npm_node_execpath?.trim() || nodeExecutable;
  if (nodePath && !path.isAbsolute(nodePath)) {
    try {
      const probe = await execFileAsync(nodePath, ["-p", "process.execPath"], {
        timeout: 10_000,
        windowsHide: true,
      });
      nodePath = probe.stdout.trim();
    } catch {
      nodePath = "";
    }
  }
  if (!nodePath || !path.isAbsolute(nodePath)) return null;

  const nodeDir = path.dirname(nodePath);
  const candidates = [
    path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function npmInvocation(args, nodeExecutable) {
  const npmCli = await findNpmCli(nodeExecutable);
  if (npmCli) return { command: nodeExecutable, args: [npmCli, ...args] };
  if (process.platform === "win32") {
    return { command: "npm", args, shell: true };
  }
  return { command: "npm", args };
}

function npmErrorText(error) {
  const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
  const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";
  const detail = stderr || stdout;
  return detail ? `${error.message}\n${detail.slice(-1200)}` : error.message;
}

async function installCatalogEntry(entry, paths, { nodeExecutable = "node", packaged = false } = {}) {
  if (entry.transport === "http") throw new Error(`HTTP 预置 ${entry.id} 不需要安装 npm 包`);
  if (packaged) {
    const npmCli = detectNpmCli({ env: process.env, execPath: nodeExecutable, exists: fs.existsSync });
    if (!npmCli) {
      return {
        success: false,
        installed: false,
        version: null,
        packageRoot: "",
        binPath: "",
        error: mcpNpmUnavailableMessage(),
      };
    }
  }
  const installDir = catalogInstallDir(paths, entry);
  await fsp.mkdir(installDir, { recursive: true });
  const invocation = await npmInvocation(
    [
      "install",
      "--prefix",
      installDir,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--loglevel=error",
      `${entry.packageName}@${entry.version}`,
    ],
    nodeExecutable,
  );
  try {
    await execFileAsync(invocation.command, invocation.args, {
      cwd: installDir,
      env: {
        ...process.env,
        npm_config_update_notifier: "false",
      },
      timeout: 240_000,
      maxBuffer: 12 * 1024 * 1024,
      windowsHide: true,
      shell: invocation.shell === true,
    });
  } catch (error) {
    throw new Error(`安装 ${entry.packageName}@${entry.version} 失败：${npmErrorText(error)}`);
  }
  const inspect = await inspectCatalogEntry(entry, paths);
  if (!inspect.installed) {
    throw new Error(`安装 ${entry.packageName} 后未找到可执行入口${inspect.error ? `：${inspect.error}` : ""}`);
  }
  return inspect;
}

function buildManagedMcpServer(entry, inspect, nodeExecutable, invocation = null) {
  if (entry.transport === "http") {
    const headers = invocation?.headers ?? entry.headers ?? {};
    return {
      url: invocation?.url ?? entry.url,
      ...(Object.keys(headers).length ? { headers } : {}),
      description: entry.description,
      exposure: entry.exposure || "codemode",
      enabled: true,
      managedBy: "pispider",
      catalogId: entry.id,
    };
  }
  const args = invocation?.args ?? entry.mcpArgs ?? [];
  const env = invocation?.env ?? entry.env ?? {};
  const runtimeEnv = { ...env };
  if (process.versions.electron && nodeExecutable && path.resolve(nodeExecutable) === path.resolve(process.execPath)) {
    runtimeEnv.ELECTRON_RUN_AS_NODE = "1";
  }
  return {
    command: nodeExecutable || "node",
    args: [inspect.binPath, ...args],
    description: entry.description,
    exposure: entry.exposure || "codemode",
    enabled: true,
    managedBy: "pispider",
    catalogId: entry.id,
    packageName: entry.packageName,
    packageVersion: entry.version,
    env: runtimeEnv,
  };
}

function isManagedCatalogServer(server, entry) {
  return Boolean(server && entry && server.managedBy === "pispider" && server.catalogId === entry.id);
}

function preserveManagedCatalogMetadata(next, previous, entry) {
  if (!isManagedCatalogServer(previous, entry)) return next;
  return {
    ...next,
    managedBy: "pispider",
    catalogId: entry.id,
    ...(previous.packageName ? { packageName: previous.packageName } : {}),
    ...(previous.packageVersion ? { packageVersion: previous.packageVersion } : {}),
  };
}

module.exports = {
  MCP_CATALOG,
  findCatalogEntry,
  getCatalogDiagnostics,
  loadCatalog,
  describeCatalogInputs,
  resolveCatalogInvocation,
  catalogInstallDir,
  catalogPackageRoot,
  inspectCatalogEntry,
  installCatalogEntry,
  buildManagedMcpServer,
  isManagedCatalogServer,
  preserveManagedCatalogMetadata,
};
