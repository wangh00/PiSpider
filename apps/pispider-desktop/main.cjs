/**
 * PiSpider desktop main process.
 *
 * Starts the existing PiSpider launcher in RPC mode and exposes a small,
 * typed IPC surface to the renderer. The renderer never receives raw Node
 * access; it only sees RPC records and session metadata.
 */

const { app, BrowserWindow, dialog, ipcMain, nativeTheme, screen, shell, clipboard } = require("electron");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const execFileAsync = promisify(execFile);
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const {
  MCP_CATALOG,
  findCatalogEntry,
  getCatalogDiagnostics,
  describeCatalogInputs,
  resolveCatalogInvocation,
  inspectCatalogEntry,
  installCatalogEntry,
  buildManagedMcpServer,
  isManagedCatalogServer,
  preserveManagedCatalogMetadata,
} = require("./mcp-catalog.cjs");

const { createMcpToolRuntimeTracker } = require("./mcp-tool-runtime.cjs");

const {
  validateHtmlExportPath,
  changelogCandidates,
  locateChangelog,
  readChangelogFile,
} = require("./slash-helpers.cjs");

const { redactDiagnosticText, buildDiagnosticsReport } = require("./doctor-report.cjs");

const { resolvePackagedLayout, buildNodeSpawn } = require("./packaged-runtime.cjs");

const packagedLayout = app.isPackaged ? resolvePackagedLayout(process.resourcesPath) : null;
if (packagedLayout) {
  process.env.PISPIDER_CORE_CACHE = packagedLayout.coreCacheRoot;
}
const repoRoot = process.env.PISPIDER_REPO_ROOT
  ? path.resolve(process.env.PISPIDER_REPO_ROOT)
  : packagedLayout
    ? packagedLayout.launcherRoot
    : path.resolve(__dirname, "..", "..");
const runnerPath = packagedLayout
  ? packagedLayout.runnerPath
  : path.join(repoRoot, "scripts", "run-pispider.mjs");
const nodeExecutable =
  process.env.PISPIDER_NODE ||
  process.env.npm_node_execpath ||
  (packagedLayout ? process.execPath : "node");
const mcpNodeExecutable =
  process.env.PISPIDER_MCP_NODE?.trim() || (process.versions.electron ? process.execPath : nodeExecutable);
const ghExecutable = process.env.PISPIDER_GH_BIN?.trim() || "gh";

let mainWindow = null;
let runtimePaths = null;
let agent = null;
let quitting = false;
let shareInFlight = false;
const panelWindows = new Map();
let activeOAuthLogin = null;
const mcpToolRuntime = createMcpToolRuntimeTracker();

const DIAGNOSTIC_LOG_LIMIT = 400;
const DIAGNOSTIC_LOG_MAX_CHARS = 200_000;
const DIAGNOSTIC_ENTRY_MAX_CHARS = 6_000;
const diagnosticLogEntries = [];
let diagnosticLogChars = 0;

function recordDiagnostic(level, source, message) {
  const text = redactDiagnosticText(String(message ?? "").trim()).slice(0, DIAGNOSTIC_ENTRY_MAX_CHARS);
  if (!text) return;
  diagnosticLogEntries.push({
    at: new Date().toISOString(),
    level,
    source,
    text,
  });
  diagnosticLogChars += text.length;
  while (
    diagnosticLogEntries.length > DIAGNOSTIC_LOG_LIMIT ||
    (diagnosticLogChars > DIAGNOSTIC_LOG_MAX_CHARS && diagnosticLogEntries.length > 1)
  ) {
    const removed = diagnosticLogEntries.shift();
    diagnosticLogChars -= removed?.text.length || 0;
  }
}

const OAUTH_PROVIDERS = [
  {
    id: "kimi-coding",
    name: "Kimi For Coding",
    authName: "Kimi Code（订阅）",
    flow: "device",
    description: "使用 Kimi Code 订阅登录，浏览器输入设备码完成授权。",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    authName: "OpenRouter OAuth",
    flow: "browser",
    description: "浏览器授权后生成一把 OpenRouter API Key，额度仍按账户计费。",
  },
  {
    id: "openai",
    name: "OpenAI",
    authName: "ChatGPT（订阅）",
    flow: "browser",
    description: "使用 ChatGPT 订阅登录，走 OpenAI Responses API。",
  },
];
const OAUTH_BRIDGE_PATH = path.join(__dirname, "oauth-bridge.mjs");
const OAUTH_LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
const OAUTH_RESULT_TIMEOUT_MS = 30 * 1000;


const DEFAULT_WINDOW_SIZE = { width: 1440, height: 920 };
let windowStateSaveTimer = null;
let windowStateRevision = 0;

const THEME_COLORS = {
  light: { background: "#f6f5f1", symbol: "#24241f" },
  dark: { background: "#171715", symbol: "#efeee8" },
};

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function sendToPanel(kind, channel, payload) {
  const win = panelWindows.get(kind);
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

async function runAgentBash(command, excludeFromContext) {
  const agentProcess = ensureAgent();
  if (!agentProcess.child) throw new Error("PiSpider runtime is not running");
  try {
    return await agentProcess.call(
      "bash",
      { command, excludeFromContext: Boolean(excludeFromContext) },
      120_000,
    );
  } catch (error) {
    if (!String(error.message || "").includes("Timed out waiting for bash")) throw error;
    await agentProcess.call("abort_bash", {}, 5_000).catch(() => {});
    throw new Error("命令执行超过 120 秒，已请求停止");
  }
}

function splitEditorCommand(value) {
  const parts = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of String(value || "").matchAll(pattern)) {
    parts.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return parts;
}

async function editPromptText(text) {
  const tempDir = app.getPath("temp");
  const file = path.join(tempDir, `pispider-draft-${Date.now()}.md`);
  await fsp.writeFile(file, String(text ?? ""), "utf8");
  const configured = process.env.PISPIDER_EDITOR || process.env.VISUAL || process.env.EDITOR;
  let command;
  let args;
  if (configured) {
    const parts = splitEditorCommand(configured);
    command = parts.shift();
    args = parts;
  } else if (process.platform === "win32") {
    command = "notepad.exe";
    args = [];
  } else if (process.platform === "darwin") {
    command = "open";
    args = ["-W", "-n", "-a", "TextEdit"];
  } else {
    throw new Error("没有检测到外部编辑器，请设置 EDITOR 或 VISUAL");
  }
  if (!command) throw new Error("外部编辑器命令无效，请检查 EDITOR 或 VISUAL");
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(command, [...args, file], { stdio: "ignore", windowsHide: true });
      child.on("error", reject);
      child.on("close", () => resolve());
    });
    return await fsp.readFile(file, "utf8");
  } finally {
    await fsp.rm(file, { force: true }).catch(() => {});
  }
}

function setWindowTheme(theme) {
  const palette = THEME_COLORS[theme] ?? THEME_COLORS.light;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setBackgroundColor(palette.background);
  if (process.platform === "win32") {
    mainWindow.setTitleBarOverlay({
      color: palette.background,
      symbolColor: palette.symbol,
      height: 44,
    });
  }
}

const ZOOM_MIN = 0.7;
const ZOOM_MAX = 1.4;
const ZOOM_STEP = 0.1;
let appZoomFactor = 1;

function normalizeZoomFactor(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(numeric * 10) / 10));
}

function applyZoomToWindow(win) {
  if (!win || win.isDestroyed()) return;
  win.webContents.setZoomFactor(appZoomFactor);
}

async function loadZoomFactor() {
  const settings = await readDesktopSettings().catch(() => ({}));
  appZoomFactor = normalizeZoomFactor(settings.zoomFactor);
  return appZoomFactor;
}

async function setAppZoomFactor(value) {
  appZoomFactor = normalizeZoomFactor(value);
  const settings = await readDesktopSettings().catch(() => ({}));
  settings.zoomFactor = appZoomFactor;
  await writeDesktopSettings(settings);
  for (const win of BrowserWindow.getAllWindows()) applyZoomToWindow(win);
  return appZoomFactor;
}

async function loadRuntimePaths() {
  if (runtimePaths) return runtimePaths;
  const homeModule = await import(
    pathToFileURL(path.join(repoRoot, "packages", "pispider", "src", "home.js")).href
  );
  const home = homeModule.resolveHome();
  const layout = homeModule.homeLayout(home);
  const agentDir = homeModule.resolveAgentDir(home);
  runtimePaths = {
    version: homeModule.VERSION,
    home,
    workspace: repoRoot,
    agentDir,
    packageRoot: path.join(repoRoot, "packages", "pispider"),
    sessionDir: homeModule.resolveSessionDir(home),
    configPath: layout.config,
    settingsPath: path.join(agentDir, "settings.json"),
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: path.join(agentDir, "models.json"),
    rulesDir: layout.rules,
    skillsDir: layout.skills,
    promptsDir: layout.prompts,
    promptTemplatesDir: path.join(agentDir, "prompts"),
    projectPromptTemplatesDir: path.join(repoRoot, ".pi", "prompts"),
    extensionsDir: path.join(agentDir, "extensions"),
    projectExtensionsDir: path.join(repoRoot, ".pi", "extensions"),
    userNpmDir: path.join(agentDir, "npm"),
    projectNpmDir: path.join(repoRoot, ".pi", "npm"),
    desktopSettingsPath: path.join(agentDir, "desktop.json"),
  };
  return runtimePaths;
}

async function readDesktopSettings() {
  const paths = await loadRuntimePaths();
  try {
    const parsed = JSON.parse(await fsp.readFile(paths.desktopSettingsPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error(`无法读取桌面设置：${error.message}`);
  }
}

async function writeDesktopSettings(settings) {
  const paths = await loadRuntimePaths();
  await writeJsonObject(paths.desktopSettingsPath, settings);
}

async function getProjectTrustState() {
  const settings = await readDesktopSettings();
  return {
    mode: settings.projectTrust === "trust" ? "trust" : "ask",
  };
}

async function setProjectTrustState(mode) {
  if (mode !== "ask" && mode !== "trust") throw new Error("项目信任模式无效");
  const settings = await readDesktopSettings();
  settings.projectTrust = mode;
  await writeDesktopSettings(settings);
  return getProjectTrustState();
}

function normalizePermissionMode(mode) {
  return mode === "readonly" || mode === "none" ? mode : "full";
}

function projectPermissionMode(settings) {
  const byProject =
    settings.projectPermissions && typeof settings.projectPermissions === "object"
      ? settings.projectPermissions[repoRoot]
      : undefined;
  const legacy = settings.permissionMode;
  return normalizePermissionMode(byProject ?? legacy);
}

function sessionPermissionMode(settings, sessionPath) {
  const target = sessionPath ? path.resolve(String(sessionPath)) : "";
  const bySession =
    target && settings.sessionPermissions && typeof settings.sessionPermissions === "object"
      ? settings.sessionPermissions[target]
      : undefined;
  return normalizePermissionMode(bySession ?? projectPermissionMode(settings));
}

function permissionModeFromSettings(settings, sessionPath = "") {
  return sessionPermissionMode(settings, sessionPath || settings.lastSessionPath || "");
}

async function rememberSessionPermission(sessionPath, mode) {
  // Session events only fill missing entries; explicit changes go through setPermissionState.
  const paths = await loadRuntimePaths();
  const sessionRoot = path.resolve(paths.sessionDir);
  const target = path.resolve(String(sessionPath || ""));
  if (!target.startsWith(`${sessionRoot}${path.sep}`) || !target.endsWith(".jsonl")) return;
  if (!fs.existsSync(target)) return;
  const settings = await readDesktopSettings();
  const sessionPermissions =
    settings.sessionPermissions && typeof settings.sessionPermissions === "object"
      ? settings.sessionPermissions
      : {};
  const normalized = normalizePermissionMode(mode);
  if (typeof sessionPermissions[target] === "string") return;
  settings.sessionPermissions = { ...sessionPermissions, [target]: normalized };
  await writeDesktopSettings(settings);
}

async function forgetSessionPermission(sessionPath) {
  const settings = await readDesktopSettings();
  if (!settings.sessionPermissions || typeof settings.sessionPermissions !== "object") return;
  const target = path.resolve(String(sessionPath || ""));
  if (!settings.sessionPermissions[target]) return;
  const next = { ...settings.sessionPermissions };
  delete next[target];
  settings.sessionPermissions = next;
  await writeDesktopSettings(settings);
}

async function getPermissionState() {
  const settings = await readDesktopSettings();
  let activeSession = "";
  try {
    const state = await agent?.call("get_state", {}, 5_000);
    if (state?.success) activeSession = String(state.data?.sessionFile || "");
  } catch {}
  const sessionFile = activeSession
    ? path.resolve(activeSession)
    : typeof settings.lastSessionPath === "string" && settings.lastSessionPath
      ? path.resolve(settings.lastSessionPath)
      : "";
  return {
    mode: normalizePermissionMode(
      agent?.runtimePermissionMode || permissionModeFromSettings(settings, sessionFile),
    ),
    scope: sessionFile ? "session" : "project",
    project: repoRoot,
    sessionFile,
  };
}

function permissionRuntimeArgs(mode) {
  if (mode === "readonly") {
    return ["--tools", "read,grep,find,ls", "--exclude-tools", "mcp__*"];
  }
  if (mode === "none") return ["--no-tools"];
  return [];
}

async function ensureRuntimePermissionForSession(agentProcess, sessionPath) {
  const settings = await readDesktopSettings();
  const targetMode = sessionPermissionMode(settings, sessionPath);
  if (agentProcess.runtimePermissionMode !== targetMode) {
    agentProcess.runtimePermissionMode = targetMode;
    await agentProcess.restart(false);
  }
  return targetMode;
}

async function restartAgentPreservingSession(notify = false, permissionMode = null) {
  const agentProcess = ensureAgent();
  if (permissionMode) agentProcess.runtimePermissionMode = normalizePermissionMode(permissionMode);
  await ensureDefaultThinkingLevels().catch(() => {});
  const current = await agentProcess
    .call("get_state", {}, 5_000)
    .catch(() => null);
  const sessionFile = current?.success ? current.data?.sessionFile : null;
  await agentProcess.restart(notify);
  if (sessionFile) {
    const response = await agentProcess.call("switch_session", { sessionPath: sessionFile }, 30_000);
    if (response?.success) await rememberLastSession(sessionFile).catch(() => {});
  }
  return { sessionFile };
}

async function setPermissionState(mode) {
  if (!["full", "readonly", "none"].includes(mode)) throw new Error("权限模式无效");
  const agentProcess = ensureAgent();
  const current = await agentProcess
    .call("get_state", {}, 5_000)
    .catch(() => null);
  const sessionFile = current?.success ? String(current.data?.sessionFile || "") : "";
  const normalized = normalizePermissionMode(mode);
  const settings = await readDesktopSettings();
  if (sessionFile) {
    const target = path.resolve(sessionFile);
    const sessionPermissions =
      settings.sessionPermissions && typeof settings.sessionPermissions === "object"
        ? settings.sessionPermissions
        : {};
    settings.sessionPermissions = { ...sessionPermissions, [target]: normalized };
  } else {
    const projectPermissions =
      settings.projectPermissions && typeof settings.projectPermissions === "object"
        ? settings.projectPermissions
        : {};
    settings.projectPermissions = { ...projectPermissions, [repoRoot]: normalized };
  }
  delete settings.permissionMode;
  await writeDesktopSettings(settings);
  await restartAgentPreservingSession(false, normalized);
  const scope = sessionFile ? "session" : "project";
  send("permission:changed", { mode: normalized, scope, project: repoRoot, sessionFile });
  return getPermissionState();
}

async function newSessionWithPermission() {
  const agentProcess = ensureAgent();
  const settings = await readDesktopSettings();
  const defaultMode = projectPermissionMode(settings);
  if (agentProcess.runtimePermissionMode !== defaultMode) {
    agentProcess.runtimePermissionMode = defaultMode;
    await agentProcess.restart(false);
  }
  const response = await agentProcess.call("new_session", {}, 30_000);
  if (response?.success) {
    const state = await agentProcess.call("get_state", {}, 5_000).catch(() => null);
    const sessionFile = state?.success ? String(state.data?.sessionFile || "") : "";
    if (sessionFile) {
      await rememberLastSession(sessionFile).catch(() => {});
      await rememberSessionPermission(sessionFile, defaultMode).catch(() => {});
    }
  }
  return response;
}

async function switchSessionWithPermission(sessionPath) {
  const agentProcess = ensureAgent();
  const settings = await readDesktopSettings();
  const targetMode = sessionPermissionMode(settings, sessionPath);
  if (agentProcess.runtimePermissionMode !== targetMode) {
    await restartAgentPreservingSession(false, targetMode);
  }
  const response = await agentProcess.call("switch_session", { sessionPath }, 30_000);
  if (response?.success) {
    await rememberLastSession(sessionPath).catch(() => {});
    await rememberSessionPermission(sessionPath, targetMode).catch(() => {});
  }
  return response;
}

function normalizeMcpScope(scope) {
  return scope === "project" ? "project" : "user";
}

async function readMcpConfig(scope = "user") {
  const normalizedScope = normalizeMcpScope(scope);
  let mcpPath;
  if (normalizedScope === "project") {
    mcpPath = path.join(repoRoot, ".pi", "mcp.json");
  } else {
    const paths = await loadRuntimePaths();
    mcpPath = path.join(paths.agentDir, "mcp.json");
  }
  let raw = {};
  try {
    raw = JSON.parse(await fsp.readFile(mcpPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`无法读取 MCP 配置：${error.message}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("MCP 配置必须是 JSON 对象");
  }
  const rawServers = raw.mcpServers;
  if (rawServers != null && (typeof rawServers !== "object" || Array.isArray(rawServers))) {
    throw new Error("MCP 配置的 mcpServers 必须是对象");
  }
  const servers = rawServers && typeof rawServers === "object" ? rawServers : {};
  return { mcpPath, raw, servers, scope: normalizedScope };
}

function summarizeMcpServer(name, server) {
  const type = server.url ? "http" : "stdio";
  return {
    name,
    type,
    command: server.command || "",
    args: Array.isArray(server.args) ? server.args : [],
    url: server.url || "",
    headers: server.headers && typeof server.headers === "object" ? server.headers : {},
    description: server.description || "",
    enabled: server.enabled !== false,
    exposure: server.exposure || "codemode",
    toolExposure: server.toolExposure || null,
    source: server.managedBy === "pispider" ? "catalog" : "user",
    managedBy: server.managedBy || "",
    catalogId: server.catalogId || "",
    packageName: server.packageName || "",
    packageVersion: server.packageVersion || "",
    installed: true,
    installedVersion: null,
    installError: null,
    configured: true,
    prerequisite: "",
    homepage: "",
  };
}

async function catalogServerSummary(entry, inspect, paths) {
  return {
    name: entry.name,
    type: entry.transport || "stdio",
    command: "",
    args: [],
    url: entry.url || "",
    headers: entry.headers || {},
    description: entry.description,
    enabled: false,
    exposure: entry.exposure || "codemode",
    toolExposure: null,
    source: "catalog",
    managedBy: "pispider",
    catalogId: entry.id,
    packageName: entry.packageName || "",
    packageVersion: entry.version || "",
    installed: inspect.installed,
    installedVersion: inspect.version || null,
    installError: inspect.error || null,
    configured: false,
    inputs: describeCatalogInputs(entry, paths),
    prerequisite: entry.prerequisite || "",
    homepage: entry.homepage || "",
  };
}

async function listMcpServers(scope = "user") {
  const { mcpPath, servers, scope: normalizedScope } = await readMcpConfig(scope);
  const summaries = Object.entries(servers).map(([name, server]) => summarizeMcpServer(name, server));
  if (normalizedScope === "user" && MCP_CATALOG.length) {
    const paths = await loadRuntimePaths();
    await Promise.all(
      MCP_CATALOG.map(async (entry) => {
        const inspect = await inspectCatalogEntry(entry, paths);
        const existing = summaries.find((server) => server.name === entry.name);
        if (!existing) {
          summaries.push(await catalogServerSummary(entry, inspect, paths));
          return;
        }
        if (!isManagedCatalogServer(existing, entry)) return;
        existing.source = "catalog";
        existing.catalogId = entry.id;
        existing.packageName = entry.packageName || "";
        existing.packageVersion = entry.version || "";
        existing.installed = entry.transport === "http" ? true : inspect.installed;
        existing.installedVersion = entry.transport === "http" ? entry.version || null : inspect.version || null;
        existing.installError = inspect.error || null;
        existing.configured = true;
        existing.url = existing.url || entry.url || "";
        existing.headers = existing.headers || entry.headers || {};
        existing.inputs = describeCatalogInputs(entry, paths);
        existing.prerequisite = entry.prerequisite || "";
        existing.homepage = entry.homepage || "";
      }),
    );
  }
  summaries.sort((a, b) => {
    if (a.source !== b.source) return a.source === "catalog" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return {
    path: mcpPath,
    scope: normalizedScope,
    servers: summaries,
    catalogErrors: getCatalogDiagnostics().errors,
    catalogPath: getCatalogDiagnostics().path,
  };
}

function normalizeMcpExposure(value, fallback = "codemode") {
  if (value == null || value === "") return fallback;
  if (!["codemode", "deferred", "direct", "hidden"].includes(value)) {
    throw new Error("MCP exposure 只能是 codemode、deferred、direct 或 hidden");
  }
  return value;
}

function normalizeMcpToolExposure(value) {
  if (value == null || value === "") return undefined;
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      throw new Error(`逐工具 exposure 解析失败：${error.message}`);
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("逐工具 exposure 必须是 JSON 对象");
  }
  const result = {};
  for (const [tool, exposure] of Object.entries(parsed)) {
    if (!tool.trim()) throw new Error("逐工具 exposure 的工具名不能为空");
    result[tool] = normalizeMcpExposure(exposure);
  }
  return Object.keys(result).length ? result : undefined;
}

function normalizeMcpServerInput(input) {
  if (!input || typeof input !== "object") throw new Error("无效的 MCP 配置");
  const name = String(input.name || "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error("MCP 名称只能包含字母、数字、_ 和 -");
  }
  if (["__proto__", "constructor", "prototype"].includes(name)) {
    throw new Error("MCP 名称不可用");
  }
  const description = String(input.description || "").trim();
  const exposure = normalizeMcpExposure(input.exposure);
  const toolExposure = normalizeMcpToolExposure(input.toolExposure);
  const type = input.type === "http" ? "http" : "stdio";
  if (type === "http") {
    const url = String(input.url || "").trim();
    if (!/^https?:\/\//.test(url)) throw new Error("HTTP MCP 需要 http(s) 地址");
    if (input.headers != null) {
      if (typeof input.headers !== "string" || !input.headers.trim()) {
        throw new Error("请求头必须是 JSON 对象");
      }
      try {
        const headers = JSON.parse(input.headers);
        if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
          throw new Error("请求头必须是 JSON 对象");
        }
        input.headers = headers;
      } catch (error) {
        throw new Error(`请求头解析失败：${error.message}`);
      }
    }
    const server = { url, description, exposure };
    if (input.headers != null) server.headers = input.headers;
    if (toolExposure) server.toolExposure = toolExposure;
    return { name, server };
  }
  const command = String(input.command || "").trim();
  if (!command) throw new Error("stdio MCP 需要命令");
  const args = Array.isArray(input.args)
    ? input.args.map((arg) => String(arg)).filter((arg) => arg.trim())
    : String(input.args || "")
        .split("\n")
        .map((arg) => arg.trim())
        .filter(Boolean);
  return { name, server: { command, args, description, exposure, ...(toolExposure ? { toolExposure } : {}) } };
}

async function saveMcpServer(input, scope = "user") {
  const { name, server } = normalizeMcpServerInput(input);
  const { mcpPath, raw, servers } = await readMcpConfig(scope);
  const previous = servers[name] || {};
  const previousCatalog = previous.managedBy === "pispider" ? findCatalogEntry(previous.catalogId || "") : null;
  const next = preserveManagedCatalogMetadata(
    {
      ...server,
      enabled: input.enabled === undefined ? previous.enabled !== false : Boolean(input.enabled),
      exposure: normalizeMcpExposure(input.exposure, previous.exposure || "codemode"),
    },
    previous,
    previousCatalog,
  );
  if (previous.env && typeof previous.env === "object") next.env = previous.env;
  if (previous.cwd) next.cwd = previous.cwd;
  if (previous.timeout != null) next.timeout = previous.timeout;
  if (previous.oauth && typeof previous.oauth === "object") next.oauth = previous.oauth;
  if (previous.headers && input.headers === undefined && !next.headers) next.headers = previous.headers;
  if (previous.toolExposure && input.toolExposure === undefined) next.toolExposure = previous.toolExposure;
  raw.mcpServers = { ...servers, [name]: next };
  await fsp.mkdir(path.dirname(mcpPath), { recursive: true });
  await fsp.writeFile(mcpPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  send("resources:changed", { kind: "mcp" });
  return listMcpServers(scope);
}

async function deleteMcpServer(name, scope = "user") {
  const normalized = String(name || "").trim();
  if (!normalized) throw new Error("缺少 MCP 名称");
  const { mcpPath, raw, servers } = await readMcpConfig(scope);
  if (!servers[normalized]) throw new Error(`MCP ${normalized} 不存在`);
  const next = { ...servers };
  delete next[normalized];
  raw.mcpServers = next;
  await fsp.writeFile(mcpPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  send("resources:changed", { kind: "mcp" });
  return listMcpServers(scope);
}

async function installCatalogMcp(id, scope = "user", inputs = {}) {
  const normalizedScope = normalizeMcpScope(scope);
  if (normalizedScope !== "user") throw new Error("预置 MCP 只能安装到用户级配置");
  const entry = findCatalogEntry(id);
  if (!entry) throw new Error(`未知预置 MCP：${id}`);
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) throw new Error("启动参数格式无效");

  const paths = await loadRuntimePaths();
  const invocation = resolveCatalogInvocation(entry, paths, inputs);
  const { mcpPath, raw, servers } = await readMcpConfig("user");
  const existing = servers[entry.name];
  if (existing && !isManagedCatalogServer(existing, entry)) {
    throw new Error(`MCP ${entry.name} 已被手动配置，请先删除或改名后再启动预置版本`);
  }
  let inspect = { installed: false, version: null, packageRoot: "", binPath: "", error: null };
  if (entry.transport !== "http") {
    inspect = await inspectCatalogEntry(entry, paths);
    if (!inspect.installed || inspect.version !== entry.version) {
      inspect = await installCatalogEntry(entry, paths, {
        nodeExecutable,
        bundledNpmCli: packagedLayout?.npmCliPath ?? "",
      });
      if (inspect.success === false) return inspect;
    }
  }

  raw.mcpServers = {
    ...servers,
    [entry.name]: buildManagedMcpServer(entry, inspect, mcpNodeExecutable, invocation),
  };
  await fsp.mkdir(path.dirname(mcpPath), { recursive: true });
  await fsp.writeFile(mcpPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  send("resources:changed", { kind: "mcp" });

  return {
    ...(await listMcpServers("user")),
    started: entry.name,
    needsReload: true,
  };
}

async function setMcpEnabled(name, enabled, scope = "user") {
  const normalized = String(name || "").trim();
  const { mcpPath, raw, servers } = await readMcpConfig(scope);
  if (!servers[normalized]) {
    const catalog = findCatalogEntry(normalized);
    if (catalog && enabled && normalizeMcpScope(scope) === "user") {
      return installCatalogMcp(catalog.id, scope);
    }
    throw new Error(`MCP ${normalized} 不存在`);
  }
  servers[normalized] = { ...servers[normalized], enabled: Boolean(enabled) };
  raw.mcpServers = servers;
  await fsp.writeFile(mcpPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  send("resources:changed", { kind: "mcp" });
  return listMcpServers(scope);
}

function probeStdioServer(name, config) {
  return new Promise((resolve) => {
    const command = String(config.command || "").trim();
    if (!command) {
      resolve({ name, state: "error", tools: [], error: "缺少 command" });
      return;
    }
    const args = Array.isArray(config.args) ? config.args.map((arg) => String(arg)) : [];
    const env = { ...process.env, ...(config.env && typeof config.env === "object" ? config.env : {}) };
    let child;
    let settled = false;
    let buffer = "";
    const finish = (report) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child?.stdin?.end();
      } catch {}
      try {
        child?.kill();
      } catch {}
      resolve({ name, ...report });
    };
    const timer = setTimeout(() => finish({ state: "error", tools: [], error: "连接超时（10 秒）" }), 10_000);
    try {
      child = spawn(command, args, {
        cwd: config.cwd ? path.resolve(repoRoot, config.cwd) : repoRoot,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      finish({ state: "error", tools: [], error: error.message });
      return;
    }
    const write = (message) => {
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      } catch (error) {
        finish({ state: "error", tools: [], error: error.message });
      }
    };
    child.on("error", (error) => finish({ state: "error", tools: [], error: error.message }));
    child.on("exit", (code, signal) => {
      if (!settled) finish({ state: "error", tools: [], error: `进程退出 ${signal || code || "unknown"}` });
    });
    child.stderr.on("data", () => {});
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 1 && message.result) {
          write({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
          write({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        } else if (message.id === 2) {
          if (message.error) {
            finish({ state: "error", tools: [], error: message.error.message || "tools/list 失败" });
          } else {
            const tools = Array.isArray(message.result?.tools)
              ? message.result.tools.map((tool) => String(tool?.name ?? "")).filter(Boolean)
              : [];
            finish({ state: "connected", tools });
          }
        } else if (message.id === 1 && message.error) {
          finish({ state: "error", tools: [], error: message.error.message || "initialize 失败" });
        }
      }
    });
    write({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "PiSpider Desktop", version: "0.1.0" },
      },
    });
  });
}

async function readMcpHttpMessage(response, expectedId) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (!text.trim()) return null;
  if (contentType.includes("text/event-stream")) {
    const events = [];
    let data = "";
    const parse = () => {
      const value = data.trim();
      data = "";
      if (!value) return;
      try {
        events.push(JSON.parse(value));
      } catch {}
    };
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("data:")) data += line.slice(5).trim();
      else if (line === "") parse();
    }
    parse();
    return events.find((message) => message.id === expectedId) || events[0] || null;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`无法解析 HTTP MCP 响应（${contentType || "未知类型"}）`);
  }
}

async function callMcpHttp(url, headers, sessionId, payload, protocolVersion, controller) {
  const requestHeaders = {
    ...headers,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) requestHeaders["Mcp-Session-Id"] = sessionId;
  if (protocolVersion) requestHeaders["MCP-Protocol-Version"] = protocolVersion;
  const response = await fetch(url, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(payload),
    signal: controller.signal,
  });
  return response;
}

async function probeHttpServer(name, config) {
  const url = String(config.url || "").trim();
  if (!/^https?:\/\//.test(url)) {
    return { name, state: "error", tools: [], error: "HTTP 地址无效" };
  }
  const headers = config.headers && typeof config.headers === "object" ? config.headers : {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const finish = (report) => {
    clearTimeout(timer);
    return { name, ...report };
  };
  try {
    const initResponse = await callMcpHttp(
      url,
      headers,
      "",
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "PiSpider Desktop", version: "0.1.0" },
        },
      },
      "",
      controller,
    );
    if (initResponse.status === 401 || initResponse.status === 403) {
      return finish({ state: "login-required", tools: [], error: `HTTP ${initResponse.status}，需要登录` });
    }
    if (!initResponse.ok) {
      return finish({ state: "error", tools: [], error: `HTTP ${initResponse.status}` });
    }
    const initMessage = await readMcpHttpMessage(initResponse, 1);
    if (initMessage?.error) {
      return finish({ state: "error", tools: [], error: initMessage.error.message || "initialize 失败" });
    }
    const sessionId = initResponse.headers.get("mcp-session-id") || "";
    const protocolVersion = initMessage?.result?.protocolVersion || "2024-11-05";
    const notifyResponse = await callMcpHttp(
      url,
      headers,
      sessionId,
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      protocolVersion,
      controller,
    );
    if (notifyResponse.status === 401 || notifyResponse.status === 403) {
      return finish({ state: "login-required", tools: [], error: `HTTP ${notifyResponse.status}，需要登录` });
    }
    const listResponse = await callMcpHttp(
      url,
      headers,
      sessionId,
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      protocolVersion,
      controller,
    );
    if (listResponse.status === 401 || listResponse.status === 403) {
      return finish({ state: "login-required", tools: [], error: `HTTP ${listResponse.status}，需要登录` });
    }
    if (!listResponse.ok) {
      return finish({ state: "error", tools: [], error: `HTTP ${listResponse.status}` });
    }
    const listMessage = await readMcpHttpMessage(listResponse, 2);
    if (listMessage?.error) {
      return finish({ state: "error", tools: [], error: listMessage.error.message || "tools/list 失败" });
    }
    const tools = Array.isArray(listMessage?.result?.tools)
      ? listMessage.result.tools.map((tool) => String(tool?.name ?? "")).filter(Boolean)
      : [];
    return finish({ state: "connected", tools });
  } catch (error) {
    if (error.name === "AbortError") {
      return finish({ state: "error", tools: [], error: "连接超时（10 秒）" });
    }
    return finish({ state: "error", tools: [], error: error.message });
  }
}

async function readLiveMcpStatus() {
  if (!agent?.child) return null;
  try {
    const response = await agent.call("mcp_status", {}, 5_000);
    if (!response?.success) return null;
    return mcpToolRuntime.decorate(response.data && typeof response.data === "object" ? response.data : null);
  } catch {
    return null;
  }
}

async function runMcpCheck(onlyName = "", scope = "user") {
  const live = await readLiveMcpStatus();
  if (live) {
    const { servers } = await readMcpConfig(scope);
    const liveByName = new Map(
      (Array.isArray(live.servers) ? live.servers : [])
        .map((server) => [String(server?.name || ""), server])
        .filter(([name]) => name),
    );
    const reports = Object.entries(servers)
      .filter(([name]) => !onlyName || name === onlyName)
      .map(([name, config]) => {
        const status = liveByName.get(name);
        if (status) return { ...status, name };
        if (config.enabled === false) return { name, state: "disabled", tools: [] };
        return {
          name,
          state: "not-loaded",
          tools: [],
          error: "配置已保存，但 Agent 未加载；请点“重载 Agent”",
        };
      });
    const extra = [...liveByName.values()]
      .filter((server) => !Object.prototype.hasOwnProperty.call(servers, server.name))
      .filter((server) => !onlyName || server.name === onlyName);
    return {
      success: true,
      live: true,
      checkedAt: new Date().toISOString(),
      servers: [...reports, ...extra],
      errors: Array.isArray(live.errors) ? live.errors : [],
    };
  }

  const { servers } = await readMcpConfig(scope);
  const selected = Object.entries(servers).filter(([name]) => !onlyName || name === onlyName);
  const reports = await Promise.all(
    selected.map(async ([name, config]) => {
      if (config.enabled === false) return { name, state: "disabled", tools: [] };
      if (config.url) return probeHttpServer(name, config);
      return probeStdioServer(name, config);
    }),
  );
  return { success: true, live: false, servers: reports, errors: [] };
}

async function runMcpServerCommand(name, action) {
  const serverName = String(name || "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(serverName)) throw new Error("MCP 服务器名称无效");
  if (!["login", "logout", "reconnect"].includes(action)) throw new Error("不支持的 MCP 操作");
  send("mcp:command-state", { name: serverName, action, state: "pending" });
  try {
    const capabilities = await ensureAgent().readCapabilities().catch(() => null);
    if (
      capabilities?.checkedAt &&
      !capabilities.commands.includes("mcp") &&
      !capabilities.commands.includes("/mcp")
    ) {
      throw new Error("当前 runtime 不支持 /mcp 命令，请升级 PiSpider core 后重载 Agent");
    }
    const response = await ensureAgent().call("prompt", { message: `/mcp ${action} ${serverName}` }, 20_000);
    if (!response?.success) throw new Error(response?.error || "MCP 命令执行失败");
    send("mcp:command-state", {
      name: serverName,
      action,
      state: "sent",
      command: `/mcp ${action} ${serverName}`,
    });
    return {
      ok: true,
      command: `/mcp ${action} ${serverName}`,
      disposition: response.data?.disposition ?? "unknown",
    };
  } catch (error) {
    send("mcp:command-state", {
      name: serverName,
      action,
      state: "error",
      error: error.message,
    });
    throw error;
  }
}

async function loadPispiderModule(name) {
  return import(pathToFileURL(path.join(repoRoot, "packages", "pispider", "src", name)).href);
}

async function listRuleData() {
  const paths = await loadRuntimePaths();
  const [rulesModule, configModule] = await Promise.all([
    loadPispiderModule("rules.js"),
    loadPispiderModule("config.js"),
  ]);
  const config = await configModule.loadConfig(paths.home);
  const rules = (await rulesModule.listRules(paths.home, config.activeRule)).map((rule) => ({
    id: rule.id,
    name: rule.name,
    description: rule.description,
    active: rule.active,
    valid: rule.valid,
    path: rule.path,
    error: rule.error,
  }));
  return { rules, activeRule: config.activeRule ?? null };
}

async function readRuleData(id) {
  const paths = await loadRuntimePaths();
  const rulesModule = await loadPispiderModule("rules.js");
  const rule = await rulesModule.readRule(paths.home, id);
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    raw: rule.raw,
    path: rule.path,
  };
}

async function resetPromptData(name) {
  const paths = await loadRuntimePaths();
  const promptsModule = await loadPispiderModule("prompts.js");
  const result = await promptsModule.resetPromptComponents(paths.home, paths.packageRoot, [name]);
  send("resources:changed", { kind: "prompts" });
  return { ok: true, reset: result };
}

async function previewPromptData(promptText) {
  const paths = await loadRuntimePaths();
  const [configModule, promptsModule, rulesModule, taskModule] = await Promise.all([
    loadPispiderModule("config.js"),
    loadPispiderModule("prompts.js"),
    loadPispiderModule("rules.js"),
    loadPispiderModule("task-state.js"),
  ]);
  const config = await configModule.loadConfig(paths.home);
  let rule = null;
  let ruleIssue = "";
  if (config.activeRule) {
    try {
      rule = await rulesModule.readRule(paths.home, config.activeRule);
    } catch (error) {
      ruleIssue = error.message;
    }
  }
  let taskState = null;
  let taskSource = "";
  try {
    const response = await ensureAgent().call("get_messages", {}, 5_000);
    if (response?.success) {
      const messages = Array.isArray(response.data?.messages) ? response.data.messages : [];
      const lastTask = [...messages]
        .reverse()
        .find((message) => message.role === "toolResult" && message.toolName === "ps_task");
      if (lastTask?.details?.pispiderTask) {
        taskState = taskModule.normalizeTaskState(lastTask.details.pispiderTask);
        taskSource = "最近一次 ps_task";
      }
    }
  } catch (error) {
    taskSource = `读取任务状态失败：${error.message}`;
  }
  const prompt = await promptsModule.composePrompt({
    home: paths.home,
    packageRoot: paths.packageRoot,
    config,
    promptText: typeof promptText === "string" ? promptText : "",
    rule,
    taskState,
  });
  return {
    prompt,
    chars: prompt.length,
    activeRule: rule?.id ?? null,
    ruleIssue,
    taskSource,
    taskUpdatedAt: taskState?.updatedAt ?? null,
  };
}

async function createRuleData(input) {
  if (!input || typeof input !== "object") throw new Error("缺少规则信息");
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!id) throw new Error("请填写规则 ID");
  const paths = await loadRuntimePaths();
  const rulesModule = await loadPispiderModule("rules.js");
  const rule = await rulesModule.createRule(paths.home, { id, name: name || id, description });
  send("resources:changed", { kind: "rules" });
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    path: rule.path,
  };
}

async function updateRuleData(id, content) {
  if (typeof id !== "string" || !id.trim()) throw new Error("缺少规则 ID");
  if (typeof content !== "string" || !content.trim()) throw new Error("规则内容不能为空");
  const paths = await loadRuntimePaths();
  const rulesModule = await loadPispiderModule("rules.js");
  const rule = await rulesModule.updateRule(paths.home, id.trim(), content);
  send("resources:changed", { kind: "rules" });
  return { id: rule.id, name: rule.name, description: rule.description, path: rule.path };
}

async function resetRuleData(id) {
  if (typeof id !== "string" || !id.trim()) throw new Error("缺少规则 ID");
  const paths = await loadRuntimePaths();
  const rulesModule = await loadPispiderModule("rules.js");
  const rule = await rulesModule.resetRule(paths.home, id.trim());
  send("resources:changed", { kind: "rules" });
  return { id: rule.id, name: rule.name, description: rule.description, path: rule.path };
}

async function deleteRuleData(id) {
  if (typeof id !== "string" || !id.trim()) throw new Error("缺少规则 ID");
  const paths = await loadRuntimePaths();
  const [rulesModule, configModule] = await Promise.all([
    loadPispiderModule("rules.js"),
    loadPispiderModule("config.js"),
  ]);
  const backup = await rulesModule.deleteRule(paths.home, id.trim());
  const config = await configModule.loadConfig(paths.home);
  if (config.activeRule === id.trim()) {
    await configModule.setActiveRule(paths.home, null);
  }
  send("resources:changed", { kind: "rules" });
  return { ok: true, backup, activeRule: config.activeRule === id.trim() ? null : config.activeRule };
}

async function activateRuleData(id) {
  const paths = await loadRuntimePaths();
  const [rulesModule, configModule] = await Promise.all([
    loadPispiderModule("rules.js"),
    loadPispiderModule("config.js"),
  ]);
  const activeRule = typeof id === "string" && id.trim() ? id.trim() : null;
  if (activeRule) await rulesModule.readRule(paths.home, activeRule);
  const config = await configModule.setActiveRule(paths.home, activeRule);
  send("resources:changed", { kind: "rules" });
  return { ok: true, activeRule: config.activeRule ?? null };
}

async function getWorkspaceConfig() {
  const paths = await loadRuntimePaths();
  const configModule = await loadPispiderModule("config.js");
  const config = await configModule.loadConfig(paths.home);
  return {
    domain: config.domain,
    activeRule: config.activeRule ?? null,
    configPath: paths.configPath,
  };
}

async function setWorkspaceDomain(domain) {
  if (!["auto", "js", "app"].includes(domain)) throw new Error("领域模式无效");
  const paths = await loadRuntimePaths();
  const configModule = await loadPispiderModule("config.js");
  const config = await configModule.setDomain(paths.home, domain);
  return { ok: true, domain: config.domain };
}


async function listSkillData() {
  const paths = await loadRuntimePaths();
  const skillsModule = await loadPispiderModule("skills.js");
  return skillsModule.listSkills(paths.home);
}

async function createSkillData(input) {
  if (!input || typeof input !== "object") throw new Error("缺少技能信息");
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!id) throw new Error("请填写技能 ID");
  if (!description) throw new Error("请填写技能描述");
  const paths = await loadRuntimePaths();
  const skillsModule = await loadPispiderModule("skills.js");
  const skill = await skillsModule.createSkill(paths.home, { id, description });
  send("resources:changed", { kind: "skills" });
  return { id, description: skill.description, files: skill.files, totalBytes: skill.totalBytes, path: skill.path };
}

async function importSkillData(sourcePath) {
  if (typeof sourcePath !== "string" || !sourcePath.trim()) throw new Error("缺少技能目录");
  const paths = await loadRuntimePaths();
  const skillsModule = await loadPispiderModule("skills.js");
  const skill = await skillsModule.importSkill(paths.home, path.resolve(sourcePath));
  send("resources:changed", { kind: "skills" });
  return {
    id: skill.id,
    description: skill.description,
    files: skill.files,
    totalBytes: skill.totalBytes,
    backup: skill.backup,
    path: skill.path,
  };
}

async function deleteSkillData(id) {
  if (typeof id !== "string" || !id.trim()) throw new Error("缺少技能 ID");
  const paths = await loadRuntimePaths();
  const skillsModule = await loadPispiderModule("skills.js");
  const backup = await skillsModule.deleteSkill(paths.home, id.trim());
  send("resources:changed", { kind: "skills" });
  return { ok: true, backup };
}

async function listPromptData() {
  const paths = await loadRuntimePaths();
  const promptsModule = await loadPispiderModule("prompts.js");
  return promptsModule.inspectPromptFiles(paths.home);
}

async function readPromptData(name) {
  const paths = await loadRuntimePaths();
  const promptsModule = await loadPispiderModule("prompts.js");
  return {
    name,
    content: await promptsModule.readPromptComponent(paths.home, paths.packageRoot, name),
  };
}

async function updatePromptData(name, content) {
  const paths = await loadRuntimePaths();
  const promptsModule = await loadPispiderModule("prompts.js");
  const result = await promptsModule.updatePromptComponent(paths.home, name, content);
  send("resources:changed", { kind: "prompts" });
  return result;
}

async function resetPromptData(name) {
  const paths = await loadRuntimePaths();
  const promptsModule = await loadPispiderModule("prompts.js");
  const result = await promptsModule.resetPromptComponents(paths.home, paths.packageRoot, [name]);
  send("resources:changed", { kind: "prompts" });
  return { reset: result };
}

async function listPromptTemplateData() {
  const paths = await loadRuntimePaths();
  const templatesModule = await loadPispiderModule("prompt-templates.js");
  return templatesModule.listPromptTemplates(paths.home, repoRoot);
}

async function readPromptTemplateData(scope, id) {
  const paths = await loadRuntimePaths();
  const templatesModule = await loadPispiderModule("prompt-templates.js");
  return templatesModule.readPromptTemplate(paths.home, scope, repoRoot, id);
}

async function createPromptTemplateData(input) {
  const paths = await loadRuntimePaths();
  const templatesModule = await loadPispiderModule("prompt-templates.js");
  const result = await templatesModule.createPromptTemplate(paths.home, input?.scope, repoRoot, input);
  send("resources:changed", { kind: "prompt-templates" });
  return result;
}

async function updatePromptTemplateData(scope, id, input) {
  const paths = await loadRuntimePaths();
  const templatesModule = await loadPispiderModule("prompt-templates.js");
  const result = await templatesModule.updatePromptTemplate(paths.home, scope, repoRoot, id, input);
  send("resources:changed", { kind: "prompt-templates" });
  return result;
}

async function deletePromptTemplateData(scope, id) {
  const paths = await loadRuntimePaths();
  const templatesModule = await loadPispiderModule("prompt-templates.js");
  const backup = await templatesModule.deletePromptTemplate(paths.home, scope, repoRoot, id);
  send("resources:changed", { kind: "prompt-templates" });
  return { ok: true, backup };
}

async function listExtensionData() {
  const paths = await loadRuntimePaths();
  const trust = await getProjectTrustState();
  const extensionsModule = await loadPispiderModule("extensions.js");
  return extensionsModule.listExtensionInventory(paths.home, repoRoot, {
    projectTrusted: trust.mode === "trust",
  });
}

async function toggleExtensionData(target, enabled) {
  const paths = await loadRuntimePaths();
  const extensionsModule = await loadPispiderModule("extensions.js");
  const result = await extensionsModule.setExtensionEnabled(paths.home, repoRoot, target, Boolean(enabled));
  send("resources:changed", { kind: "extensions" });
  return result;
}

async function resolvePackageCliPath() {
  const configured = String(process.env.PISPIDER_CORE_CLI || "").trim();
  if (configured) {
    const resolved = path.isAbsolute(configured) ? configured : path.resolve(repoRoot, configured);
    if (await pathExists(resolved)) return resolved;
    throw new Error(`PISPIDER_CORE_CLI 不存在：${resolved}`);
  }
  const launcher = await import(pathToFileURL(path.join(repoRoot, "scripts", "pispider-launcher.mjs")).href);
  const plan = launcher.buildLaunchPlan({ passthrough: [] });
  if (plan.mode === "install") {
    throw new Error("Pi 运行时尚未安装，无法执行 package 命令");
  }
  return plan.args[0];
}

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function runPiCliCommand(args) {
  try {
    const paths = await loadRuntimePaths();
    const cliPath = await resolvePackageCliPath();
    const cliEnv = {
      ...process.env,
      PI_CODING_AGENT_DIR: paths.agentDir,
      PI_CODING_AGENT_SESSION_DIR: paths.sessionDir,
      PISPIDER_DESKTOP: "1",
      NO_COLOR: "1",
    };
    let result;
    if (packagedLayout) {
      const plan = buildNodeSpawn({
        execPath: process.execPath,
        scriptPath: cliPath,
        args,
        env: cliEnv,
        coreCacheRoot: packagedLayout.coreCacheRoot,
      });
      result = await execFileAsync(plan.command, plan.args, {
        cwd: repoRoot,
        env: plan.env,
        timeout: 180_000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      });
    } else {
      result = await execFileAsync(nodeExecutable, [cliPath, ...args], {
        cwd: repoRoot,
        env: cliEnv,
        timeout: 180_000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      });
    }
    return {
      ok: true,
      exitCode: 0,
      stdout: String(result.stdout || ""),
      stderr: String(result.stderr || ""),
    };
  } catch (error) {
    return {
      ok: false,
      exitCode: typeof error?.code === "number" ? error.code : 1,
      stdout: String(error?.stdout || ""),
      stderr: String(error?.stderr || ""),
      error: error?.message || String(error),
    };
  }
}

async function resolveCoreIndexPath() {
  const configured = String(process.env.PISPIDER_CORE_INDEX || "").trim();
  if (configured) {
    const resolved = path.isAbsolute(configured) ? configured : path.resolve(repoRoot, configured);
    if (await pathExists(resolved)) return resolved;
    throw new Error(`PISPIDER_CORE_INDEX 不存在：${resolved}`);
  }
  let directory = path.dirname(await resolvePackageCliPath());
  while (directory && directory !== path.dirname(directory)) {
    const packageJsonPath = path.join(directory, "package.json");
    if (await pathExists(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(await fsp.readFile(packageJsonPath, "utf8"));
        if (packageJson?.name === "@earendil-works/pi-coding-agent") {
          const indexPath = path.join(directory, "dist", "index.js");
          if (await pathExists(indexPath)) return indexPath;
        }
      } catch {
        // Keep walking up; the next package.json may be the installed Pi package.
      }
    }
    directory = path.dirname(directory);
  }
  throw new Error("找不到 Pi 运行时入口，请检查 PiSpider 安装");
}

async function readRuntimeChangelog() {
  const launcher = await import(pathToFileURL(path.join(repoRoot, "scripts", "pispider-launcher.mjs")).href);
  const cacheRoot = launcher.resolveCoreCacheRoot({ env: process.env });
  const candidates = changelogCandidates({ cacheRoot, repoRoot });
  const changelogPath = await locateChangelog({ candidates, exists: pathExists });
  if (!changelogPath) return null;
  return readChangelogFile({
    changelogPath,
    fallbackVersion: launcher.CORE_VERSION,
    readFile: (targetPath) => fsp.readFile(targetPath, "utf8"),
    readJson: (targetPath) => fsp.readFile(targetPath, "utf8").then(JSON.parse),
  });
}

function getOAuthProvider(provider) {
  const providerId = assertProviderId(provider);
  const info = OAUTH_PROVIDERS.find((item) => item.id === providerId);
  if (!info) throw new Error(`暂不支持 ${providerId} 的账号登录`);
  return info;
}

async function getOrCreateDeviceId() {
  const paths = await loadRuntimePaths();
  const settings = await readJsonObject(paths.settingsPath, "settings.json");
  const existing = typeof settings.deviceId === "string" ? settings.deviceId.trim() : "";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(existing)) {
    return existing;
  }
  const deviceId = randomUUID();
  settings.deviceId = deviceId;
  await writeJsonObject(paths.settingsPath, settings);
  return deviceId;
}

async function spawnOAuthBridge() {
  const paths = await loadRuntimePaths();
  const coreIndex = await resolveCoreIndexPath();
  const bridgeEnv = {
    ...process.env,
    PISPIDER_CORE_INDEX: coreIndex,
    PI_CODING_AGENT_DIR: paths.agentDir,
    PI_CODING_AGENT_SESSION_DIR: paths.sessionDir,
    PISPIDER_DESKTOP: "1",
    NO_COLOR: "1",
  };
  let child;
  if (packagedLayout) {
    const plan = buildNodeSpawn({
      execPath: process.execPath,
      scriptPath: OAUTH_BRIDGE_PATH,
      args: [],
      env: bridgeEnv,
      coreCacheRoot: packagedLayout.coreCacheRoot,
    });
    child = spawn(plan.command, plan.args, {
      cwd: repoRoot,
      env: plan.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } else {
    child = spawn(nodeExecutable, [OAUTH_BRIDGE_PATH], {
      cwd: repoRoot,
      env: bridgeEnv,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }
  const state = { child, stdout: "", stderr: "" };
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    state.stdout += String(chunk);
    state.stdout = state.stdout.slice(-4_000_000);
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    state.stderr += String(chunk);
    state.stderr = state.stderr.slice(-4_000);
  });
  return Object.assign(state, { paths, coreIndex });
}

function writeOAuthBridge(child, message) {
  if (!child?.stdin || child.stdin.destroyed) throw new Error("OAuth 登录进程已结束");
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function takeOAuthBridgeLines(state) {
  const lines = state.stdout.split(/\r?\n/u);
  state.stdout = lines.pop() ?? "";
  return lines;
}

async function finishOAuthLogin(loginId, result) {
  const active = activeOAuthLogin;
  if (!active || active.loginId !== loginId) return;
  activeOAuthLogin = null;
  clearTimeout(active.timeout);
  try {
    active.child.stdin?.end();
  } catch {
    // The bridge may already have closed stdin.
  }
  setTimeout(() => {
    if (!active.child.killed) active.child.kill();
  }, 500).unref?.();

  if (result?.ok) {
    sendToPanel("settings", "auth:oauth-event", {
      loginId,
      kind: "progress",
      message: "登录成功，正在重启 Agent 并刷新模型目录…",
    });
    let warning = result.warning || "";
    try {
      await restartAgentPreservingSession(false, active.permissionMode);
    } catch (error) {
      warning = [warning, `Agent 重启失败：${error.message}`].filter(Boolean).join("；");
    }
    sendToPanel("settings", "auth:oauth-event", {
      loginId,
      kind: "result",
      ok: true,
      provider: result.provider,
      modelCount: result.modelCount,
      warning,
    });
    send("agent:reloaded", { source: "oauth" });
    return;
  }

  sendToPanel("settings", "auth:oauth-event", {
    loginId,
    kind: "result",
    ok: false,
    provider: active.provider,
    error: active.cancelled ? "登录已取消" : result?.error || active.bridge?.stderr.trim() || "登录失败",
  });
}

async function startOAuthLogin(provider) {
  const info = getOAuthProvider(provider);
  if (activeOAuthLogin) throw new Error("已有账号登录正在进行，请先取消");
  const paths = await loadRuntimePaths();
  const deviceId = await getOrCreateDeviceId();
  const permissionMode = (await getPermissionState()).mode;
  const bridge = await spawnOAuthBridge();
  const loginId = randomUUID();
  const active = {
    loginId,
    provider: info.id,
    child: bridge.child,
    bridge,
    cancelled: false,
    permissionMode,
  };
  active.timeout = setTimeout(() => {
    active.cancelled = true;
    try {
      writeOAuthBridge(active.child, { command: "cancel" });
    } catch {
      // finishOAuthLogin below records the timeout.
    }
    void finishOAuthLogin(loginId, { ok: false, error: "账号登录超时，请重试" });
  }, OAUTH_LOGIN_TIMEOUT_MS);
  activeOAuthLogin = active;

  bridge.child.on("error", (error) => {
    void finishOAuthLogin(loginId, { ok: false, error: `无法启动 OAuth 登录进程：${error.message}` });
  });
  bridge.child.on("exit", (code, signal) => {
    if (!activeOAuthLogin || activeOAuthLogin.loginId !== loginId) return;
    void finishOAuthLogin(loginId, {
      ok: false,
      error: `OAuth 登录进程已退出（${signal || code || "unknown"}）${active.bridge?.stderr ? `：${active.bridge.stderr.trim()}` : ""}`,
    });
  });
  bridge.child.stdout?.on("data", () => {
    const lines = takeOAuthBridgeLines(bridge);
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        sendToPanel("settings", "auth:oauth-event", {
          loginId,
          kind: "progress",
          message: line.trim().slice(0, 300),
        });
        continue;
      }
      if (message.kind === "result") {
        void finishOAuthLogin(loginId, message);
        continue;
      }
      if (message.loginId && message.loginId !== loginId) continue;
      sendToPanel("settings", "auth:oauth-event", { loginId, ...message });
    }
  });

  try {
    writeOAuthBridge(bridge.child, {
      command: "login",
      loginId,
      provider: info.id,
      authPath: paths.authPath,
      modelsPath: paths.modelsPath,
      deviceId,
      agentName: "PiSpider",
    });
  } catch (error) {
    void finishOAuthLogin(loginId, { ok: false, error: error.message });
    throw error;
  }
  return { ok: true, loginId, provider: info.id };
}

async function cancelOAuthLogin() {
  const active = activeOAuthLogin;
  if (!active) return { ok: true, cancelled: false };
  active.cancelled = true;
  try {
    writeOAuthBridge(active.child, { command: "cancel" });
  } catch {
    // Fall through to the forced cleanup below.
  }
  setTimeout(() => {
    if (!activeOAuthLogin || activeOAuthLogin.loginId !== active.loginId) return;
    void finishOAuthLogin(active.loginId, { ok: false, error: "登录已取消" });
    if (!active.child.killed) active.child.kill();
  }, 2_000).unref?.();
  return { ok: true, cancelled: true };
}

async function respondOAuthPrompt(promptId, value) {
  const active = activeOAuthLogin;
  if (!active) throw new Error("账号登录已结束");
  const prompt = String(promptId || "").trim();
  const answer = String(value ?? "");
  if (!prompt) throw new Error("缺少授权输入标识");
  if (answer.length > 10_000) throw new Error("授权输入过长");
  writeOAuthBridge(active.child, { command: "prompt-response", promptId: prompt, value: answer });
  return { ok: true };
}

async function runOAuthBridgeCommand(message) {
  const bridge = await spawnOAuthBridge();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        bridge.child.stdin?.end();
      } catch {
        // The bridge may already have closed stdin.
      }
      setTimeout(() => {
        if (!bridge.child.killed) bridge.child.kill();
      }, 300).unref?.();
      resolve(result);
    };
    const timeout = setTimeout(() => finish({ ok: false, error: "OAuth 操作超时" }), OAUTH_RESULT_TIMEOUT_MS);
    let buffer = "";
    bridge.child.stdout?.on("data", (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.kind === "result") finish(parsed);
        } catch {
          // Ignore non-protocol output; stderr carries the useful detail.
        }
      }
    });
    bridge.child.on("error", (error) => finish({ ok: false, error: error.message }));
    bridge.child.on("exit", (code, signal) => {
      if (!settled) {
        finish({
          ok: false,
          error: `OAuth 进程已退出（${signal || code || "unknown"}）${bridge.stderr ? `：${bridge.stderr.trim()}` : ""}`,
        });
      }
    });
    try {
      writeOAuthBridge(bridge.child, message);
    } catch (error) {
      finish({ ok: false, error: error.message });
    }
  });
}

async function logoutOAuthProvider(provider) {
  const info = getOAuthProvider(provider);
  if (activeOAuthLogin) throw new Error("请先取消正在进行的账号登录");
  const paths = await loadRuntimePaths();
  const result = await runOAuthBridgeCommand({
    command: "logout",
    loginId: randomUUID(),
    provider: info.id,
    authPath: paths.authPath,
    modelsPath: paths.modelsPath,
  });
  if (!result.ok) return { ok: false, error: result.error || "登出失败" };
  await restartAgentPreservingSession(false);
  send("agent:reloaded", { source: "oauth-logout" });
  return { ok: true, provider: info.id };
}

function validatePackageSource(input, scope) {
  const source = String(input?.source ?? "").trim();
  if (!source) throw new Error("请填写 package source");
  if (source.length > 2_048) throw new Error("package source 过长");
  if (/[\r\n\0]/u.test(source)) throw new Error("package source 包含非法字符");
  if (source.startsWith("-")) throw new Error("package source 不能以 - 开头");
  const normalizedScope = scope === "project" ? "project" : "user";
  return { source, scope: normalizedScope };
}

async function installPackageData(input) {
  const { source, scope } = validatePackageSource(input, input?.scope);
  const trust = await getProjectTrustState();
  if (scope === "project" && trust.mode !== "trust") {
    throw new Error("项目级 package 需要先在设置中信任项目");
  }
  const args = ["install", source];
  if (scope === "project") args.push("--local");
  args.push(trust.mode === "trust" ? "--approve" : "--no-approve");
  const result = await runPiCliCommand(args);
  if (!result.ok) {
    return {
      ok: false,
      error: result.stderr.trim() || result.error || "Pi package 安装失败",
      log: `${result.stdout}${result.stderr}`.trim().slice(-4_000),
    };
  }
  send("resources:changed", { kind: "extensions" });
  return { ok: true, source, scope, log: `${result.stdout}${result.stderr}`.trim().slice(-4_000) };
}

async function removePackageData(input) {
  const { source, scope } = validatePackageSource(input, input?.scope);
  const args = ["remove", source];
  if (scope === "project") args.push("--local");
  const trust = await getProjectTrustState();
  args.push(trust.mode === "trust" ? "--approve" : "--no-approve");
  const result = await runPiCliCommand(args);
  if (!result.ok) {
    return {
      ok: false,
      error: result.stderr.trim() || result.error || "Pi package 移除失败",
      log: `${result.stdout}${result.stderr}`.trim().slice(-4_000),
    };
  }
  send("resources:changed", { kind: "extensions" });
  return { ok: true, source, scope, log: `${result.stdout}${result.stderr}`.trim().slice(-4_000) };
}

async function updatePackageData(input) {
  const { source, scope } = validatePackageSource(input, input?.scope);
  const args = ["update", source];
  if (scope === "project") args.push("--local");
  const trust = await getProjectTrustState();
  args.push(trust.mode === "trust" ? "--approve" : "--no-approve");
  const result = await runPiCliCommand(args);
  if (!result.ok) {
    return {
      ok: false,
      error: result.stderr.trim() || result.error || "Pi package 更新失败",
      log: `${result.stdout}${result.stderr}`.trim().slice(-4_000),
    };
  }
  send("resources:changed", { kind: "extensions" });
  return { ok: true, source, scope, log: `${result.stdout}${result.stderr}`.trim().slice(-4_000) };
}

async function collectDiagnosticsData() {
  const paths = await loadRuntimePaths();
  const trust = await getProjectTrustState();
  let settings = {};
  let settingsError = null;
  try {
    settings = await readJsonObject(paths.settingsPath, "settings.json");
  } catch (error) {
    settingsError = error.message;
  }
  const provider = String(settings.defaultProvider || "").trim();
  const modelId = String(settings.defaultModel || "").trim();
  const modelArg = provider && modelId ? `${provider}/${modelId}` : "";
  const authArgs = provider
    ? ["auth", "check", "--provider", provider, ...(modelArg ? ["--model", modelArg] : []), "--json", "--no-refresh"]
    : null;
  const [versionResult, listResult, authResult] = await Promise.all([
    runPiCliCommand(["--version"]),
    runPiCliCommand(["list", trust.mode === "trust" ? "--approve" : "--no-approve"]),
    authArgs ? runPiCliCommand(authArgs) : Promise.resolve(null),
  ]);
  let auth = null;
  if (authResult) {
    if (authResult.ok) {
      const raw = authResult.stdout.trim();
      try {
        const jsonLine = raw.split(/\r?\n/u).find((line) => line.trim().startsWith("{"));
        const parsed = jsonLine ? JSON.parse(jsonLine) : { status: "unknown" };
        auth = { ...parsed, error: parsed.error || parsed.reason || "" };
      } catch {
        auth = { status: "unknown", raw };
      }
    } else {
      auth = { status: "error", error: authResult.stderr.trim() || authResult.error || "auth check 失败" };
    }
  }
  return {
    checkedAt: new Date().toISOString(),
    platform: process.platform,
    node: process.versions.node,
    electron: process.versions.electron,
    core: {
      ok: versionResult.ok,
      version: versionResult.ok ? versionResult.stdout.trim() : "",
      error: versionResult.ok ? "" : versionResult.stderr.trim() || versionResult.error || "无法读取 Pi 版本",
    },
    auth,
    packages: {
      ok: listResult.ok,
      text: listResult.ok ? listResult.stdout.trim() : "",
      error: listResult.ok ? "" : listResult.stderr.trim() || listResult.error || "pi list 失败",
    },
    settingsError,
    permission: await getPermissionState(),
    trust: trust.mode,
    files: {
      settings: await pathExists(paths.settingsPath),
      models: await pathExists(paths.modelsPath),
      auth: await pathExists(paths.authPath),
      projectSettings: await pathExists(path.join(repoRoot, ".pi", "settings.json")),
      projectMcp: await pathExists(path.join(repoRoot, ".pi", "mcp.json")),
    },
    paths: {
      agent: paths.agentDir,
      settings: paths.settingsPath,
      models: paths.modelsPath,
      auth: paths.authPath,
    },
  };
}

function diagnosticExportName(date = new Date()) {
  return `pispider-diagnostics-${date.toISOString().replace(/[:.]/gu, "-")}.txt`;
}

async function exportDiagnosticsReport(requestedPath) {
  let outputPath = typeof requestedPath === "string" ? requestedPath.trim() : "";
  if (outputPath) {
    outputPath = path.resolve(outputPath);
    if (!outputPath.toLowerCase().endsWith(".txt")) outputPath += ".txt";
  } else {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "导出诊断报告",
      defaultPath: path.join(app.getPath("documents"), diagnosticExportName()),
      filters: [{ name: "Text", extensions: ["txt"] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    outputPath = result.filePath;
  }
  const paths = await loadRuntimePaths();
  let diagnostics;
  try {
    diagnostics = await collectDiagnosticsData();
  } catch (error) {
    diagnostics = { error: error.message };
  }
  if (diagnostics?.auth && "raw" in diagnostics.auth) {
    const auth = { ...diagnostics.auth };
    delete auth.raw;
    diagnostics.auth = auth;
  }
  const report = {
    generatedAt: new Date().toISOString(),
    app: {
      name: "PiSpider",
      version: app.getVersion(),
      piSpiderVersion: paths.version,
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
      packaged: app.isPackaged,
      locale: app.getLocale(),
      repoRoot,
      home: paths.home,
      agentDir: paths.agentDir,
    },
    agent: {
      status: agent?.status || "not-started",
      pid: agent?.child?.pid || null,
      commandCount: agent?.capabilities?.commands?.length || 0,
    },
    diagnostics,
    logs: diagnosticLogEntries.slice(),
  };
  const text = buildDiagnosticsReport(report);
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, text, { mode: 0o600 });
  recordDiagnostic("info", "diagnostics", `report exported · ${path.basename(outputPath)}`);
  return {
    ok: true,
    path: outputPath,
    bytes: Buffer.byteLength(text),
    generatedAt: report.generatedAt,
    logEntries: report.logs.length,
  };
}

async function readJsonObject(targetPath, label) {
  let text;
  try {
    text = await fsp.readFile(targetPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new Error(`无法读取${label}：${error.message}`);
  }
  try {
    const parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("expected an object");
    }
    return parsed;
  } catch (error) {
    throw new Error(`${label}格式无效：${error.message}`);
  }
}

async function writeJsonObject(targetPath, value) {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${randomUUID()}.tmp`;
  await fsp.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    await fsp.rename(tempPath, targetPath);
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

function assertProviderId(provider) {
  if (typeof provider !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(provider)) {
    throw new Error("服务商标识无效");
  }
  return provider;
}

function assertModelId(model) {
  if (typeof model !== "string" || !model.trim() || model.length > 180) {
    throw new Error("模型 ID 不能为空");
  }
  return model.trim();
}

async function ensureDefaultThinkingLevels() {
  const paths = await loadRuntimePaths();
  const modelConfig = await readJsonObject(paths.modelsPath, "models.json");
  const providers =
    modelConfig.providers && typeof modelConfig.providers === "object" ? modelConfig.providers : null;
  if (!providers) return;
  let changed = false;
  for (const provider of Object.values(providers)) {
    if (!provider || typeof provider !== "object" || !Array.isArray(provider.models)) continue;
    const providerApi = typeof provider.api === "string" ? provider.api : "";
    for (const model of provider.models) {
      if (!model || typeof model !== "object" || model.reasoning !== true) continue;
      const thinkingMap =
        model.thinkingLevelMap &&
        typeof model.thinkingLevelMap === "object" &&
        !Array.isArray(model.thinkingLevelMap)
          ? { ...model.thinkingLevelMap }
          : {};
      if (thinkingMap.xhigh === undefined) {
        thinkingMap.xhigh = "xhigh";
        changed = true;
      }
      if (thinkingMap.max === undefined) {
        thinkingMap.max = "max";
        changed = true;
      }
      model.thinkingLevelMap = thinkingMap;
      if (providerApi === "anthropic-messages") {
        const compat =
          model.compat && typeof model.compat === "object" && !Array.isArray(model.compat)
            ? { ...model.compat }
            : {};
        if (compat.forceAdaptiveThinking !== true) {
          compat.forceAdaptiveThinking = true;
          changed = true;
        }
        model.compat = compat;
      }
    }
  }
  if (changed) await writeJsonObject(paths.modelsPath, modelConfig);
}

function normalizeEnabledModels(input) {
  if (!Array.isArray(input)) throw new Error("模型作用域必须是模型列表");
  const patterns = [...new Set(input.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean))];
  if (patterns.length > 200) throw new Error("模型作用域最多包含 200 项");
  return patterns.filter((pattern) => pattern.length <= 220);
}

const MODEL_THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const SETTINGS_TRANSPORTS = new Set(["auto", "sse", "websocket", "websocket-cached"]);
const COMPACTION_DEFAULTS = { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 };

function normalizeModelThinkingLevels(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const levels = {};
  for (const [reference, level] of Object.entries(value)) {
    if (!reference.includes("/") || reference.length > 320) continue;
    if (typeof level === "string" && MODEL_THINKING_LEVELS.has(level)) levels[reference] = level;
  }
  return levels;
}

async function setModelThinkingDefault(reference, level) {
  if (typeof reference !== "string" || !reference.includes("/") || reference.length > 320) {
    throw new Error("模型引用无效");
  }
  if (level !== null && level !== undefined && level !== "") {
    if (typeof level !== "string" || !MODEL_THINKING_LEVELS.has(level)) throw new Error("思考档位无效");
  }
  const paths = await loadRuntimePaths();
  const settings = await readJsonObject(paths.settingsPath, "settings.json");
  const levels = normalizeModelThinkingLevels(settings.modelThinkingLevels);
  if (level) levels[reference] = level;
  else delete levels[reference];
  if (Object.keys(levels).length) settings.modelThinkingLevels = levels;
  else delete settings.modelThinkingLevels;
  await writeJsonObject(paths.settingsPath, settings);
  let restarted = false;
  if (agent?.child) {
    try {
      await restartAgentPreservingSession(true);
      restarted = true;
    } catch {
      // The setting is persisted even when the runtime cannot restart.
    }
  }
  return { ok: true, levels, appliedLevel: level || null, restarted };
}

async function getModelScopeState() {
  const paths = await loadRuntimePaths();
  const settings = await readJsonObject(paths.settingsPath, "settings.json");
  return {
    ok: true,
    enabledModels: Array.isArray(settings.enabledModels) ? normalizeEnabledModels(settings.enabledModels) : [],
    modelThinkingLevels: normalizeModelThinkingLevels(settings.modelThinkingLevels),
  };
}

async function setModelScope(patterns) {
  const paths = await loadRuntimePaths();
  const settings = await readJsonObject(paths.settingsPath, "settings.json");
  const enabledModels = normalizeEnabledModels(patterns);
  if (enabledModels.length) settings.enabledModels = enabledModels;
  else delete settings.enabledModels;
  await writeJsonObject(paths.settingsPath, settings);
  if (agent?.child) await restartAgentPreservingSession(true);
  return { ok: true, enabledModels };
}

function normalizeHttpProxySetting(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") throw new Error("代理地址无效");
  const proxy = value.trim();
  if (!proxy) return "";
  if (proxy.length > 2048 || /\s/.test(proxy)) throw new Error("代理地址无效");
  let parsed;
  try {
    parsed = new URL(proxy);
  } catch {
    throw new Error("代理地址无效：需要 http:// 或 https:// 地址");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("代理仅支持 http:// 或 https:// 地址");
  }
  return proxy;
}

function normalizeShellPathSetting(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") throw new Error("Shell 路径无效");
  const shellPath = value.trim();
  if (!shellPath) return "";
  if (shellPath.length > 2048 || /[\u0000\r\n]/u.test(shellPath)) throw new Error("Shell 路径无效");
  return shellPath;
}

function normalizeDefaultToolsSetting(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("默认工具必须是列表");
  const entries = [...new Set(value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean))];
  if (entries.length > 100) throw new Error("默认工具最多包含 100 项");
  const modifiers = entries.filter((entry) => entry.startsWith("+") || entry.startsWith("-"));
  if (modifiers.length && modifiers.length !== entries.length) {
    throw new Error("工具名称不能与 +名称 / -名称 混用");
  }
  for (const entry of entries) {
    if (entry.length > 160 || /\s/u.test(entry)) throw new Error(`工具名称无效：${entry.slice(0, 40)}`);
    if (modifiers.length && entry.slice(1).includes("*")) throw new Error("+名称 / -名称 不支持通配符");
    if (modifiers.length && !entry.slice(1)) throw new Error("+名称 / -名称 不能为空");
  }
  return entries;
}

function normalizeCompactionToken(value, label, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${label} 必须是非负整数`);
  return number;
}

function normalizeCompactionSetting(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("压缩设置无效");
  const enabled = value.enabled === undefined ? COMPACTION_DEFAULTS.enabled : value.enabled;
  if (typeof enabled !== "boolean") throw new Error("自动压缩开关无效");
  return {
    enabled,
    reserveTokens: normalizeCompactionToken(value.reserveTokens, "预留 tokens", COMPACTION_DEFAULTS.reserveTokens),
    keepRecentTokens: normalizeCompactionToken(
      value.keepRecentTokens,
      "保留最近 tokens",
      COMPACTION_DEFAULTS.keepRecentTokens,
    ),
  };
}

async function getAdvancedSettingsState() {
  const paths = await loadRuntimePaths();
  const settings = await readJsonObject(paths.settingsPath, "settings.json");
  const compaction =
    settings.compaction && typeof settings.compaction === "object" && !Array.isArray(settings.compaction)
      ? settings.compaction
      : {};
  return {
    ok: true,
    settingsPath: paths.settingsPath,
    transport: SETTINGS_TRANSPORTS.has(settings.transport) ? settings.transport : "auto",
    httpProxy: typeof settings.httpProxy === "string" ? settings.httpProxy : "",
    shellPath: typeof settings.shellPath === "string" ? settings.shellPath : "",
    defaultTools: Array.isArray(settings.defaultTools)
      ? settings.defaultTools.filter((item) => typeof item === "string")
      : [],
    compaction: {
      enabled: typeof compaction.enabled === "boolean" ? compaction.enabled : COMPACTION_DEFAULTS.enabled,
      reserveTokens:
        Number.isSafeInteger(compaction.reserveTokens) && compaction.reserveTokens >= 0
          ? compaction.reserveTokens
          : COMPACTION_DEFAULTS.reserveTokens,
      keepRecentTokens:
        Number.isSafeInteger(compaction.keepRecentTokens) && compaction.keepRecentTokens >= 0
          ? compaction.keepRecentTokens
          : COMPACTION_DEFAULTS.keepRecentTokens,
      hasModelOverrides: Boolean(
        compaction.modelOverrides &&
          typeof compaction.modelOverrides === "object" &&
          !Array.isArray(compaction.modelOverrides) &&
          Object.keys(compaction.modelOverrides).length,
      ),
    },
  };
}

async function setAdvancedSettingsState(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("缺少高级设置");
  if (!SETTINGS_TRANSPORTS.has(input.transport)) throw new Error("传输协议无效");
  const httpProxy = normalizeHttpProxySetting(input.httpProxy);
  const shellPath = normalizeShellPathSetting(input.shellPath);
  const defaultTools = normalizeDefaultToolsSetting(input.defaultTools);
  const compactionInput = normalizeCompactionSetting(input.compaction);
  const paths = await loadRuntimePaths();
  const settings = await readJsonObject(paths.settingsPath, "settings.json");
  settings.transport = input.transport;
  if (httpProxy) settings.httpProxy = httpProxy;
  else delete settings.httpProxy;
  if (shellPath) settings.shellPath = shellPath;
  else delete settings.shellPath;
  if (defaultTools.length) settings.defaultTools = defaultTools;
  else delete settings.defaultTools;
  const previousCompaction =
    settings.compaction && typeof settings.compaction === "object" && !Array.isArray(settings.compaction)
      ? settings.compaction
      : {};
  settings.compaction = { ...previousCompaction, ...compactionInput };
  await writeJsonObject(paths.settingsPath, settings);
  let restarted = false;
  let restartError = null;
  if (agent?.child) {
    try {
      await restartAgentPreservingSession(true);
      restarted = true;
    } catch (error) {
      restartError = error.message || String(error);
    }
  }
  return {
    ok: true,
    transport: input.transport,
    httpProxy,
    shellPath,
    defaultTools,
    compaction: compactionInput,
    restarted,
    restartError,
  };
}

async function getModelConfigState() {
  const paths = await loadRuntimePaths();
  const [auth, settings, models] = await Promise.all([
    readJsonObject(paths.authPath, "auth.json"),
    readJsonObject(paths.settingsPath, "settings.json"),
    readJsonObject(paths.modelsPath, "models.json"),
  ]);
  let current = null;
  if (agent?.child) {
    try {
      const response = await agent.call("get_state", {}, 2_500);
      if (response?.success && response.data?.model) {
        let thinkingLevels = [];
        try {
          const levelsResponse = await agent.call("get_available_thinking_levels", {}, 2_500);
          if (levelsResponse?.success && Array.isArray(levelsResponse.data?.levels)) {
            thinkingLevels = levelsResponse.data.levels;
          }
        } catch {
          // Keep the current model metadata even if the thinking query fails.
        }
        current = {
          provider: response.data.model.provider ?? null,
          id: response.data.model.id ?? null,
          name: response.data.model.name ?? null,
          thinkingLevel: response.data.thinkingLevel ?? null,
          thinkingLevels,
        };
      }
    } catch {
      // A missing runtime is normal while the panel opens.
    }
  }
  return {
    enabledModels: Array.isArray(settings.enabledModels) ? normalizeEnabledModels(settings.enabledModels) : [],
    paths: {
      home: paths.home,
      agentDir: paths.agentDir,
      authPath: paths.authPath,
      settingsPath: paths.settingsPath,
      modelsPath: paths.modelsPath,
    },
    current,
    defaultProvider: typeof settings.defaultProvider === "string" ? settings.defaultProvider : null,
    defaultModel: typeof settings.defaultModel === "string" ? settings.defaultModel : null,
    oauthProviders: OAUTH_PROVIDERS.map((provider) => ({
      ...provider,
      credentialType:
        auth[provider.id]?.type === "oauth"
          ? "oauth"
          : auth[provider.id]?.type === "api_key"
            ? "api_key"
            : null,
    })),
    credentials: Object.entries(auth)
      .filter(([, value]) => value && typeof value === "object")
      .map(([provider, value]) => ({
        provider,
        type: value.type === "oauth" ? "oauth" : "api_key",
        hasSecret: (typeof value.key === "string" && value.key.trim().length > 0) || value.type === "oauth",
      })),
    customProviders: Object.entries(models.providers ?? {})
      .filter(([, value]) => value && typeof value === "object" && Array.isArray(value.models))
      .map(([provider, value]) => ({
        provider,
        name: value.name ?? provider,
        baseUrl: value.baseUrl ?? "",
        api: value.api ?? "openai-completions",
        models: value.models
          .filter((model) => model && typeof model.id === "string")
          .map((model) => ({
            id: model.id,
            name: model.name ?? model.id,
            reasoning: model.reasoning === true,
            contextWindow: Number.isFinite(model.contextWindow) ? model.contextWindow : null,
            maxTokens: Number.isFinite(model.maxTokens) ? model.maxTokens : null,
            input: Array.isArray(model.input) ? model.input : ["text"],
            thinkingLevelMap:
              model.thinkingLevelMap && typeof model.thinkingLevelMap === "object" && !Array.isArray(model.thinkingLevelMap)
                ? model.thinkingLevelMap
                : null,
            forceAdaptiveThinking: model.compat?.forceAdaptiveThinking === true,
          })),
      })),
  };
}

function normalizeCustomBaseUrl(api, value) {
  let baseUrl = typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
  if (api === "anthropic-messages") {
    baseUrl = baseUrl.replace(/\/v1\/messages$/i, "").replace(/\/v1$/i, "");
  }
  return baseUrl;
}

async function saveModelConfig(input) {
  if (!input || typeof input !== "object") throw new Error("缺少模型配置");
  const provider = assertProviderId(input.provider);
  const model = assertModelId(input.model);
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  const custom = Boolean(input.custom);
  const rawBaseUrl = typeof input.baseUrl === "string" ? input.baseUrl.trim() : "";
  const api = typeof input.api === "string" ? input.api.trim() : "";
  const effectiveApi = api || "openai-completions";
  const reasoningEnabled = input.reasoning === true;
  const baseUrl = normalizeCustomBaseUrl(effectiveApi, rawBaseUrl);
  const displayName = typeof input.name === "string" && input.name.trim() ? input.name.trim() : model;

  if (custom && !/^https?:\/\//i.test(baseUrl)) {
    throw new Error("自定义服务商需要有效的接口地址");
  }

  const paths = await loadRuntimePaths();
  const auth = await readJsonObject(paths.authPath, "auth.json");
  const existing = auth[provider];
  const canKeepExisting =
    existing &&
    ((existing.type === "api_key" && typeof existing.key === "string" && existing.key.trim()) ||
      existing.type === "oauth");
  if (!apiKey && !canKeepExisting) {
    throw new Error("请填写 API Key");
  }
  if (apiKey) {
    auth[provider] = { type: "api_key", key: apiKey };
    await writeJsonObject(paths.authPath, auth);
  }

  if (custom) {
    const modelConfig = await readJsonObject(paths.modelsPath, "models.json");
    const providers = modelConfig.providers && typeof modelConfig.providers === "object" ? modelConfig.providers : {};
    const previous = providers[provider] && typeof providers[provider] === "object" ? providers[provider] : {};
    const previousModels = Array.isArray(previous.models) ? previous.models : [];
    const previousModel = previousModels.find((entry) => entry?.id === model) || {};
    const contextWindow = Number(input.contextWindow);
    const maxTokens = Number(input.maxTokens);
    const modelInput = Array.isArray(input.input)
      ? input.input.filter((kind) => kind === "text" || kind === "image")
      : ["text"];
    const previousThinkingMap =
      previousModel.thinkingLevelMap &&
      typeof previousModel.thinkingLevelMap === "object" &&
      !Array.isArray(previousModel.thinkingLevelMap)
        ? { ...previousModel.thinkingLevelMap }
        : {};
    const nextThinkingMap = { ...previousThinkingMap };
    if (reasoningEnabled) {
      if (typeof nextThinkingMap.xhigh !== "string" || !nextThinkingMap.xhigh.trim()) nextThinkingMap.xhigh = "xhigh";
      if (typeof nextThinkingMap.max !== "string" || !nextThinkingMap.max.trim()) nextThinkingMap.max = "max";
    } else {
      delete nextThinkingMap.xhigh;
      delete nextThinkingMap.max;
    }
    const previousCompat =
      previousModel.compat && typeof previousModel.compat === "object" && !Array.isArray(previousModel.compat)
        ? { ...previousModel.compat }
        : {};
    const nextCompat = { ...previousCompat };
    if (reasoningEnabled && effectiveApi === "anthropic-messages") nextCompat.forceAdaptiveThinking = true;
    else delete nextCompat.forceAdaptiveThinking;
    const {
      thinkingLevelMap: _previousThinkingMap,
      compat: _previousCompat,
      ...previousModelRest
    } = previousModel;
    const modelEntry = {
      ...previousModelRest,
      id: model,
      name: displayName,
      reasoning: reasoningEnabled,
      input: modelInput.length ? modelInput : ["text"],
      ...(Number.isFinite(contextWindow) && contextWindow > 0 ? { contextWindow } : {}),
      ...(Number.isFinite(maxTokens) && maxTokens > 0 ? { maxTokens } : {}),
      ...(Object.keys(nextThinkingMap).length ? { thinkingLevelMap: nextThinkingMap } : {}),
      ...(Object.keys(nextCompat).length ? { compat: nextCompat } : {}),
    };
    const models = previousModels.some((entry) => entry?.id === model)
      ? previousModels.map((entry) => (entry?.id === model ? modelEntry : entry))
      : [...previousModels, modelEntry];
    providers[provider] = {
      ...previous,
      name: displayName,
      baseUrl,
      api: api || "openai-completions",
      models,
    };
    await writeJsonObject(paths.modelsPath, { ...modelConfig, providers });
  }

  const settings = await readJsonObject(paths.settingsPath, "settings.json");
  settings.defaultProvider = provider;
  settings.defaultModel = model;
  await writeJsonObject(paths.settingsPath, settings);

  if (agent?.child) await restartAgentPreservingSession(false);
  else await ensureAgent().start();
  send("model:changed", { provider, model, name: displayName });
  return {
    ok: true,
    provider,
    model,
    name: displayName,
  };
}

async function checkModelConfig(input) {
  const issues = [];
  let provider = "";
  let model = "";
  try {
    provider = assertProviderId(input?.provider);
  } catch (error) {
    issues.push(error.message);
  }
  try {
    model = assertModelId(input?.model);
  } catch (error) {
    issues.push(error.message);
  }
  if (!provider) return { ok: false, message: issues[0] || "缺少服务商", issues };
  if (!model) return { ok: false, message: issues[0] || "缺少模型 ID", issues };
  if (input?.custom && !/^https?:\/\//i.test(String(input.baseUrl || "").trim())) {
    issues.push("自定义服务商需要有效的接口地址");
  }
  const paths = await loadRuntimePaths();
  const auth = await readJsonObject(paths.authPath, "auth.json");
  const existing = auth[provider];
  const typedKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  const hasCredential =
    Boolean(typedKey) ||
    (existing?.type === "api_key" && typeof existing.key === "string" && existing.key.trim()) ||
    existing?.type === "oauth";
  if (!hasCredential) issues.push("缺少 API Key");
  return {
    ok: issues.length === 0,
    provider,
    model,
    hasCredential,
    message: issues.length ? issues[0] : `配置完整：${provider} / ${model}`,
  };
}

async function testModelConnection(input) {
  const provider = assertProviderId(input?.provider);
  const model = assertModelId(input?.model);
  const custom = Boolean(input?.custom);
  const api =
    !custom && provider === "anthropic"
      ? "anthropic-messages"
      : typeof input?.api === "string" && input.api.trim()
        ? input.api.trim()
        : "openai-completions";
  if (api === "google-generative-ai") {
    return { ok: false, message: "Google Generative AI 暂不支持连接测试" };
  }
  const providedBaseUrl = typeof input?.baseUrl === "string" ? input.baseUrl.trim() : "";
  const builtinBases = {
    deepseek: "https://api.deepseek.com",
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com",
    openrouter: "https://openrouter.ai/api/v1",
    "kimi-coding": "https://api.kimi.com/coding/v1",
    "moonshotai-cn": "https://api.moonshot.cn/v1",
    zai: "https://api.z.ai/api/paas/v4",
  };
  const rawBaseUrl = custom ? providedBaseUrl : builtinBases[provider] || "";
  if (!/^https?:\/\//i.test(rawBaseUrl)) {
    return { ok: false, message: custom ? "自定义服务商需要有效的接口地址" : "该服务商没有可测试的接口地址" };
  }
  const baseUrl = normalizeCustomBaseUrl(api, rawBaseUrl);
  const paths = await loadRuntimePaths();
  const auth = await readJsonObject(paths.authPath, "auth.json");
  const credential = auth[provider];
  const typedKey = typeof input?.apiKey === "string" ? input.apiKey.trim() : "";
  const apiKey = typedKey || (credential?.type === "api_key" ? String(credential.key || "").trim() : "");
  if (!apiKey) {
    if (credential?.type === "oauth") return { ok: false, message: "OAuth 凭据暂不支持连接测试" };
    return { ok: false, message: "缺少 API Key" };
  }
  const modelsUrl = api === "anthropic-messages" ? `${baseUrl}/v1/models` : `${baseUrl}/models`;
  const headers = {
    Accept: "application/json",
    ...(api === "anthropic-messages"
      ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
      : { Authorization: `Bearer ${apiKey}` }),
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response;
  try {
    response = await fetch(modelsUrl, { headers, signal: controller.signal });
  } catch (error) {
    return {
      ok: false,
      message: error?.name === "AbortError" ? "连接超时（15 秒）" : `连接失败：${error.message}`,
      url: modelsUrl,
    };
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.message || text.slice(0, 240) || response.statusText;
    return { ok: false, status: response.status, message: `HTTP ${response.status}：${detail}`, url: modelsUrl };
  }
  const entries = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
  const models = entries
    .map((entry) => {
      if (typeof entry === "string") return { id: entry, name: entry };
      if (!entry || typeof entry.id !== "string" || !entry.id) return null;
      return {
        id: entry.id,
        name: typeof entry.display_name === "string" && entry.display_name ? entry.display_name : entry.id,
      };
    })
    .filter(Boolean)
    .slice(0, 80);
  return {
    ok: true,
    status: response.status,
    url: modelsUrl,
    provider,
    model,
    count: models.length,
    models,
    message: models.length ? `连接成功，发现 ${models.length} 个模型` : "连接成功，接口没有返回模型列表",
  };
}

async function testModelInference(input) {
  const provider = assertProviderId(input?.provider);
  const model = assertModelId(input?.model);
  const custom = Boolean(input?.custom);
  const api =
    !custom && provider === "anthropic"
      ? "anthropic-messages"
      : typeof input?.api === "string" && input.api.trim()
        ? input.api.trim()
        : "openai-completions";
  if (api === "google-generative-ai") {
    return { ok: false, message: "Google Generative AI 暂不支持推理测试" };
  }
  const builtinBases = {
    deepseek: "https://api.deepseek.com",
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com",
    openrouter: "https://openrouter.ai/api/v1",
    "kimi-coding": "https://api.kimi.com/coding/v1",
    "moonshotai-cn": "https://api.moonshot.cn/v1",
    zai: "https://api.z.ai/api/paas/v4",
  };
  const providedBaseUrl = typeof input?.baseUrl === "string" ? input.baseUrl.trim() : "";
  const rawBaseUrl = custom ? providedBaseUrl : builtinBases[provider] || "";
  if (!/^https?:\/\//i.test(rawBaseUrl)) {
    return { ok: false, message: custom ? "自定义服务商需要有效的接口地址" : "该服务商没有可测试的接口地址" };
  }
  const baseUrl = normalizeCustomBaseUrl(api, rawBaseUrl);
  const paths = await loadRuntimePaths();
  const auth = await readJsonObject(paths.authPath, "auth.json");
  const credential = auth[provider];
  const typedKey = typeof input?.apiKey === "string" ? input.apiKey.trim() : "";
  const apiKey = typedKey || (credential?.type === "api_key" ? String(credential.key || "").trim() : "");
  if (!apiKey) {
    if (credential?.type === "oauth") return { ok: false, message: "OAuth 凭据暂不支持推理测试" };
    return { ok: false, message: "缺少 API Key" };
  }
  const url = api === "anthropic-messages" ? `${baseUrl}/v1/messages` : `${baseUrl}/chat/completions`;
  const headers = {
    "Content-Type": "application/json",
    ...(api === "anthropic-messages"
      ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
      : { Authorization: `Bearer ${apiKey}` }),
  };
  const body = JSON.stringify({
    model,
    max_tokens: 16,
    messages: [{ role: "user", content: "只回复两个字：正常" }],
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let response;
  try {
    response = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
  } catch (error) {
    return {
      ok: false,
      message: error?.name === "AbortError" ? "推理超时（30 秒）" : `推理失败：${error.message}`,
      url,
    };
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.message || text.slice(0, 240) || response.statusText;
    return { ok: false, status: response.status, message: `HTTP ${response.status}：${detail}`, url };
  }
  const answer =
    api === "anthropic-messages"
      ? (Array.isArray(payload?.content) ? payload.content.map((item) => item?.text).filter(Boolean).join("") : "")
      : String(payload?.choices?.[0]?.message?.content || payload?.output_text || payload?.content || "");
  if (!answer) {
    return { ok: false, status: response.status, message: "接口返回成功，但没有可读取的助手文本", url };
  }
  return {
    ok: true,
    status: response.status,
    url,
    provider,
    model,
    text: answer.slice(0, 500),
    message: "推理测试成功",
  };
}

async function clearModelCredential(provider) {
  const providerId = assertProviderId(provider);
  const paths = await loadRuntimePaths();
  const auth = await readJsonObject(paths.authPath, "auth.json");
  if (auth[providerId]) {
    delete auth[providerId];
    await writeJsonObject(paths.authPath, auth);
  }
  if (agent?.child) await restartAgentPreservingSession(false);
  else await ensureAgent().start();
  send("model:changed", { provider: providerId, model: null, name: null });
  return { ok: true, provider: providerId };
}


function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      if (block.type === "text") return block.text ?? "";
      if (block.type === "thinking") return block.thinking ?? "";
      return "";
    })
    .join("\n")
    .trim();
}

async function readProjectFile(targetPath) {
  if (typeof targetPath !== "string" || !targetPath.trim()) {
    throw new Error("缺少文件路径");
  }
  const root = path.resolve(repoRoot);
  const absolute = path.isAbsolute(targetPath)
    ? path.normalize(targetPath)
    : path.resolve(root, targetPath);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("只能查看项目根目录内的文件");
  }
  const stat = await fsp.stat(absolute);
  if (!stat.isFile()) throw new Error("目标不是文件");
  if (stat.size > 3 * 1024 * 1024) throw new Error("文件过大，暂不支持预览");
  const buffer = await fsp.readFile(absolute);
  if (buffer.includes(0)) throw new Error("二进制文件暂不支持预览");
  const text = buffer.toString("utf8");
  return {
    path: absolute,
    relative: relative.split(path.sep).join("/"),
    text,
    lines: text ? text.split("\n").length : 0,
  };
}

async function readSessionFile(filePath) {
  const stat = await fsp.stat(filePath);
  if (stat.size > 8 * 1024 * 1024) return null;

  const text = await fsp.readFile(filePath, "utf8");
  const lines = text.split("\n").filter(Boolean);
  let header = null;
  let name = "";
  let preview = "";
  let messageCount = 0;
  let lastTimestamp = "";

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!header && entry.type === "session") {
      header = entry;
      continue;
    }
    if (entry.type === "session_info" && entry.name) {
      name = entry.name;
      continue;
    }
    if (entry.type === "message" && entry.message) {
      messageCount += 1;
      if (entry.message.role === "user") {
        const textValue = contentToText(entry.message.content);
        if (textValue) preview = textValue;
      }
      if (entry.timestamp) lastTimestamp = entry.timestamp;
    }
  }

  if (!header) return null;

  const title = name || preview || `会话 ${String(header.id).slice(0, 8)}`;
  return {
    id: header.id,
    path: filePath,
    name: title,
    preview: preview.length > 160 ? `${preview.slice(0, 157)}...` : preview,
    cwd: header.cwd ?? "",
    createdAt: header.timestamp ?? stat.birthtime.toISOString(),
    updatedAt: lastTimestamp || stat.mtime.toISOString(),
    messageCount,
  };
}

const sessionSearchCache = new Map();
const SESSION_SEARCH_CACHE_LIMIT = 24;
const SESSION_SEARCH_LIMIT = 80;

function pruneSessionSearchCache() {
  while (sessionSearchCache.size > SESSION_SEARCH_CACHE_LIMIT) {
    sessionSearchCache.delete(sessionSearchCache.keys().next().value);
  }
}

async function readSessionSearchRecord(filePath) {
  const stat = await fsp.stat(filePath);
  if (stat.size > 8 * 1024 * 1024) return null;
  const key = path.resolve(filePath);
  const cached = sessionSearchCache.get(key);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    sessionSearchCache.delete(key);
    sessionSearchCache.set(key, cached);
    return cached.record;
  }

  const text = await fsp.readFile(filePath, "utf8");
  const lines = text.split("\n").filter(Boolean);
  let header = null;
  let name = "";
  let preview = "";
  let messageCount = 0;
  let lastTimestamp = "";
  const messages = [];

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!header && entry.type === "session") {
      header = entry;
      continue;
    }
    if (entry.type === "session_info" && entry.name) {
      name = entry.name;
      continue;
    }
    if (entry.type === "message" && entry.message) {
      messageCount += 1;
      const role = entry.message.role;
      if (role === "user" || role === "assistant") {
        const value = contentToText(entry.message.content);
        if (value) {
          messages.push({ role, text: value });
          if (role === "user") preview = value;
        }
      }
      if (entry.timestamp) lastTimestamp = entry.timestamp;
    }
  }

  if (!header) return null;
  const title = name || preview || `会话 ${String(header.id).slice(0, 8)}`;
  const record = {
    id: header.id,
    path: filePath,
    name: title,
    preview: preview.length > 160 ? `${preview.slice(0, 157)}...` : preview,
    cwd: header.cwd ?? "",
    createdAt: header.timestamp ?? stat.birthtime.toISOString(),
    updatedAt: lastTimestamp || stat.mtime.toISOString(),
    messageCount,
    messages,
  };
  sessionSearchCache.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, record });
  pruneSessionSearchCache();
  return record;
}

function parseSessionSearchQuery(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { mode: "empty" };
  if (/^re:/iu.test(text)) {
    const pattern = text.slice(3);
    if (!pattern.trim()) return { mode: "error", error: "正则表达式不能为空" };
    try {
      return { mode: "regex", regex: new RegExp(pattern, "i") };
    } catch (error) {
      return { mode: "error", error: `正则表达式无效：${error.message}` };
    }
  }
  const tokens = [];
  const matcher = /"([^"]+)"|(\S+)/gu;
  let match;
  while ((match = matcher.exec(text))) tokens.push(match[1] ?? match[2]);
  return { mode: "tokens", tokens };
}

function sessionSearchFields(record) {
  const fields = [
    { label: "标题", value: record.name, tier: 0 },
    { label: "ID", value: record.id, tier: 1 },
    { label: "目录", value: record.cwd, tier: 1 },
  ];
  for (const message of record.messages) {
    fields.push({ label: message.role === "user" ? "你的消息" : "助手消息", value: message.text, tier: 2 });
  }
  return fields;
}

function sessionSnippetAround(text, needle) {
  const compact = String(text ?? "").replace(/\s+/gu, " ").trim();
  if (!compact) return "";
  const index = needle ? compact.toLowerCase().indexOf(String(needle).toLowerCase()) : -1;
  if (index < 0) return compact.length > 170 ? `${compact.slice(0, 167)}...` : compact;
  const start = Math.max(0, index - 60);
  const end = Math.min(compact.length, index + String(needle).length + 100);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
}

function matchSessionSearchRecord(record, parsed) {
  const fields = sessionSearchFields(record);
  if (parsed.mode === "regex") {
    let best = null;
    for (const field of fields) {
      if (!field.value) continue;
      parsed.regex.lastIndex = 0;
      const match = parsed.regex.exec(field.value);
      if (!match) continue;
      if (!best || field.tier < best.field.tier) best = { field, needle: match[0] };
    }
    if (!best) return null;
    return {
      score: best.field.tier,
      snippet: sessionSnippetAround(best.field.value, best.needle),
      matchField: best.field.label,
    };
  }

  let score = 0;
  let messageField = null;
  let directoryField = null;
  for (const token of parsed.tokens) {
    let found = null;
    for (const field of fields) {
      if (field.value && field.value.toLowerCase().includes(token.toLowerCase())) {
        found = field;
        break;
      }
    }
    if (!found) return null;
    score += found.tier;
    if (found.tier === 2 && !messageField) messageField = found;
    if (found.label === "目录" && !directoryField) directoryField = found;
  }
  const snippetField = messageField || directoryField;
  return {
    score,
    snippet: snippetField ? sessionSnippetAround(snippetField.value, parsed.tokens[0]) : record.preview,
    matchField: snippetField?.label || "",
  };
}

async function searchSessions(rawQuery, sort = "relevance") {
  const query = String(rawQuery ?? "").trim();
  const parsed = parseSessionSearchQuery(query);
  if (parsed.mode === "empty") return { ok: true, items: [], total: 0 };
  if (parsed.mode === "error") return { ok: false, error: parsed.error, items: [], total: 0 };

  const paths = await loadRuntimePaths();
  const files = [];
  await walkSessionFiles(paths.sessionDir, files);
  const settings = await readDesktopSettings().catch(() => ({}));
  const pinned = new Set(
    Array.isArray(settings.pinnedSessions)
      ? settings.pinnedSessions
          .filter((item) => typeof item === "string" && item.trim())
          .map((item) => path.resolve(item))
      : [],
  );

  const matches = [];
  for (const file of files) {
    let record;
    try {
      record = await readSessionSearchRecord(file);
    } catch {
      continue;
    }
    if (!record) continue;
    const match = matchSessionSearchRecord(record, parsed);
    if (!match) continue;
    matches.push({
      session: {
        id: record.id,
        path: record.path,
        name: record.name,
        preview: record.preview,
        cwd: record.cwd,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        messageCount: record.messageCount,
        pinned: pinned.has(path.resolve(record.path)),
      },
      score: match.score,
      snippet: match.snippet,
      matchField: match.matchField,
    });
  }

  matches.sort((left, right) => {
    if (sort === "recent") {
      return String(right.session.updatedAt).localeCompare(String(left.session.updatedAt));
    }
    return left.score - right.score || String(right.session.updatedAt).localeCompare(String(left.session.updatedAt));
  });
  return { ok: true, items: matches.slice(0, SESSION_SEARCH_LIMIT), total: matches.length };
}

async function walkSessionFiles(root, output, depth = 0) {
  if (depth > 5) return;
  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await walkSessionFiles(fullPath, output, depth + 1);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      output.push(fullPath);
    }
  }
}

function normalizeSessionOrder(value, root) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const order = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) continue;
    const resolved = path.resolve(item);
    if (!resolved.startsWith(`${root}${path.sep}`) || seen.has(resolved)) continue;
    seen.add(resolved);
    order.push(resolved);
  }
  return order.slice(0, 500);
}

async function getSessionOrder() {
  const paths = await loadRuntimePaths();
  const settings = await readDesktopSettings();
  return { order: normalizeSessionOrder(settings.sessionOrder, path.resolve(paths.sessionDir)) };
}

async function setSessionOrder(items) {
  const paths = await loadRuntimePaths();
  const root = path.resolve(paths.sessionDir);
  const order = normalizeSessionOrder(items, root);
  const settings = await readDesktopSettings();
  if (order.length) settings.sessionOrder = order;
  else delete settings.sessionOrder;
  await writeDesktopSettings(settings);
  send("sessions:changed", { order: true });
  return { order };
}

async function listSessions(sessionDir) {
  const files = [];
  await walkSessionFiles(sessionDir, files);
  const sessions = [];
  for (const file of files) {
    try {
      const session = await readSessionFile(file);
      if (session) sessions.push(session);
    } catch {
      // Ignore files that are being written or are no longer valid.
    }
  }
  const settings = await readDesktopSettings().catch(() => ({}));
  const pinned = new Set(
    Array.isArray(settings.pinnedSessions)
      ? settings.pinnedSessions
          .filter((item) => typeof item === "string" && item.trim())
          .map((item) => path.resolve(item))
      : [],
  );
  const order = normalizeSessionOrder(settings.sessionOrder, path.resolve(sessionDir));
  const orderIndex = new Map(order.map((item, index) => [item, index]));
  for (const session of sessions) {
    session.pinned = pinned.has(path.resolve(session.path));
  }
  sessions.sort((left, right) => {
    const pinnedDelta = Number(right.pinned) - Number(left.pinned);
    if (pinnedDelta) return pinnedDelta;
    const leftOrder = orderIndex.get(path.resolve(left.path));
    const rightOrder = orderIndex.get(path.resolve(right.path));
    if (leftOrder !== undefined || rightOrder !== undefined) {
      return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER);
    }
    return String(right.updatedAt).localeCompare(String(left.updatedAt));
  });
  return sessions.slice(0, 80);
}

async function toggleSessionPin(sessionPath) {
  const paths = await loadRuntimePaths();
  const root = path.resolve(paths.sessionDir);
  const target = path.resolve(String(sessionPath || ""));
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("只能置顶会话目录内的会话");
  const settings = await readDesktopSettings();
  const pinned = new Set(
    Array.isArray(settings.pinnedSessions)
      ? settings.pinnedSessions
          .filter((item) => typeof item === "string" && item.trim())
          .map((item) => path.resolve(item))
      : [],
  );
  if (pinned.has(target)) pinned.delete(target);
  else pinned.add(target);
  settings.pinnedSessions = [...pinned];
  await writeDesktopSettings(settings);
  send("sessions:changed", { pinned: target });
  return { pinned: pinned.has(target) };
}

async function rememberLastSession(sessionPath) {
  const paths = await loadRuntimePaths();
  const root = path.resolve(paths.sessionDir);
  const target = path.resolve(String(sessionPath || ""));
  if (!target.startsWith(`${root}${path.sep}`)) return;
  if (!target.endsWith(".jsonl") || !fs.existsSync(target)) return;
  const settings = await readDesktopSettings();
  if (settings.lastSessionPath === target) return;
  settings.lastSessionPath = target;
  await writeDesktopSettings(settings);
}

async function restoreLastSession(agentProcess) {
  const paths = await loadRuntimePaths();
  const root = path.resolve(paths.sessionDir);
  const settings = await readDesktopSettings();
  let target = "";
  if (typeof settings.lastSessionPath === "string") {
    const candidate = path.resolve(settings.lastSessionPath);
    if (candidate.startsWith(`${root}${path.sep}`) && fs.existsSync(candidate)) target = candidate;
  }
  if (!target) {
    const sessions = await listSessions(paths.sessionDir);
    const mostRecent = sessions
      .slice()
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0];
    target = mostRecent?.path || "";
  }
  if (!target) return;
  await ensureRuntimePermissionForSession(agentProcess, target).catch(() => {});
  let applied = target;
  let response = await agentProcess.call("switch_session", { sessionPath: target }, 30_000).catch(() => null);
  if (!response?.success) {
    const sessions = await listSessions(paths.sessionDir);
    const mostRecent = sessions
      .slice()
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0];
    if (mostRecent?.path && path.resolve(mostRecent.path) !== path.resolve(target)) {
      applied = mostRecent.path;
      await ensureRuntimePermissionForSession(agentProcess, applied).catch(() => {});
      response = await agentProcess.call("switch_session", { sessionPath: applied }, 30_000).catch(() => null);
    }
  }
  if (response?.success) {
    await rememberLastSession(applied);
    await rememberSessionPermission(applied, agentProcess.runtimePermissionMode).catch(() => {});
  }
}

async function importSessionAtPath(sourcePath) {
  const paths = await loadRuntimePaths();
  const source = path.resolve(String(sourcePath || ""));
  if (!source || !source.endsWith(".jsonl")) throw new Error("请选择 .jsonl 会话文件");
  const session = await readSessionFile(source);
  if (!session) throw new Error("所选文件不是有效的 Pi 会话文件");
  if (path.dirname(source) === path.resolve(paths.sessionDir)) {
    return { cancelled: false, imported: false, path: source, session };
  }
  await fsp.mkdir(paths.sessionDir, { recursive: true });
  const baseName = path.basename(source);
  let target = path.join(paths.sessionDir, baseName);
  if (fs.existsSync(target)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    target = path.join(paths.sessionDir, `${path.basename(baseName, ".jsonl")}_imported-${stamp}.jsonl`);
  }
  await fsp.copyFile(source, target);
  const importedSession = await readSessionFile(target);
  if (!importedSession) throw new Error("复制后的会话文件无法读取");
  send("sessions:changed", { imported: target });
  return { cancelled: false, imported: true, path: target, session: importedSession };
}

async function importSessionFile() {
  const options = {
    title: "从其他目录恢复会话",
    properties: ["openFile"],
    filters: [{ name: "Pi 会话文件", extensions: ["jsonl"] }],
  };
  const picked =
    mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
  if (picked.canceled || !picked.filePaths?.length) return { cancelled: true };
  return importSessionAtPath(picked.filePaths[0]);
}

async function deleteSessionFile(sessionPath) {
  const paths = await loadRuntimePaths();
  const root = path.resolve(paths.sessionDir);
  const target = path.resolve(String(sessionPath || ""));
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("会话文件不在会话目录内");
  let activeFile = "";
  try {
    const response = await ensureAgent().call("get_state", {}, 5_000);
    activeFile = response?.data?.sessionFile || "";
  } catch {}
  if (activeFile && path.resolve(activeFile) === target) {
    throw new Error("不能删除当前会话，请先切换到其他会话");
  }
  await fsp.unlink(target);
  await forgetSessionPermission(target).catch(() => {});
  send("sessions:changed", { deleted: target });
  return { ok: true };
}

function assertRunner() {
  if (!fs.existsSync(runnerPath)) {
    throw new Error(
      `PiSpider launcher not found: ${runnerPath}. Set PISPIDER_REPO_ROOT to the repository root.`,
    );
  }
}

class AgentProcess {
  constructor() {
    this.child = null;
    this.stdoutBuffer = "";
    this.pending = new Map();
    this.status = "idle";
    this.ready = false;
    this.resolveReady = null;
    this.readyPromise = null;
    this.restarting = false;
    this.sessionRememberTimer = null;
    this.runtimePermissionMode = null;
    this.capabilities = { commands: [], checkedAt: null };
  }

  setStatus(status, detail = "") {
    this.status = status;
    recordDiagnostic(status === "error" ? "error" : "info", "runtime", `${status}${detail ? ` · ${detail}` : ""}`);
    send("agent:status", { state: status, detail, pid: this.child?.pid ?? null });
  }

  async readCapabilities(force = false) {
    if (!force && this.capabilities.checkedAt) return this.capabilities;
    const response = await this.call("get_commands", {}, 10_000);
    const commands = Array.isArray(response?.data?.commands)
      ? response.data.commands
          .map((command) => (typeof command === "string" ? command : command?.name))
          .filter((name) => typeof name === "string" && name)
      : [];
    this.capabilities = { commands, checkedAt: new Date().toISOString() };
    return this.capabilities;
  }

  async start() {
    if (this.child) {
      return { ok: true, pid: this.child.pid };
    }
    assertRunner();

    this.setStatus("starting", "Starting PiSpider runtime");
    mcpToolRuntime.reset();
    this.ready = false;
    this.capabilities = { commands: [], checkedAt: null };
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
    const desktopSettings = await readDesktopSettings();
    const runtimeArgs = [runnerPath, "--mode", "rpc"];
    if (desktopSettings.projectTrust === "trust") {
      runtimeArgs.push("--approve");
    } else {
      runtimeArgs.push("--no-approve");
    }
    const permissionMode = normalizePermissionMode(
      this.runtimePermissionMode || permissionModeFromSettings(desktopSettings),
    );
    this.runtimePermissionMode = permissionMode;
    runtimeArgs.push(...permissionRuntimeArgs(permissionMode));
    const runtimeEnv = {
      ...process.env,
      PISPIDER_DESKTOP: "1",
      NO_COLOR: "1",
    };
    let child;
    if (packagedLayout) {
      const plan = buildNodeSpawn({
        execPath: process.execPath,
        scriptPath: runnerPath,
        args: runtimeArgs.slice(1),
        env: runtimeEnv,
        coreCacheRoot: packagedLayout.coreCacheRoot,
      });
      child = spawn(plan.command, plan.args, {
        cwd: repoRoot,
        env: plan.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } else {
      child = spawn(nodeExecutable, runtimeArgs, {
        cwd: repoRoot,
        env: runtimeEnv,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    }
    this.child = child;
    this.stdoutBuffer = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.handleStdout(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      recordDiagnostic("warn", "agent.stderr", chunk);
      send("agent:log", { stream: "stderr", text: chunk });
    });

    child.on("error", (error) => {
      recordDiagnostic("error", "agent.error", error.message);
      this.setStatus("error", error.message);
      send("agent:log", { stream: "error", text: error.message });
      this.rejectPending(error);
    });

    child.on("exit", (code, signal) => {
      this.child = null;
      this.ready = false;
      this.capabilities = { commands: [], checkedAt: null };
      this.resolveReady?.();
      const detail = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      recordDiagnostic(code === 0 && !signal ? "info" : "error", "agent.exit", detail);
      this.setStatus(code === 0 ? "stopped" : "error", `Runtime ${detail}`);
      this.rejectPending(new Error(`PiSpider runtime stopped: ${detail}`));
      if (!quitting && !this.restarting) {
        send("agent:runtime-exit", { code, signal });
      }
    });

    // RPC mode emits an extension UI record as soon as the PiSpider extension
    // is loaded. Waiting for it avoids sending get_state before the runtime
    // has finished starting.
    await Promise.race([
      this.readyPromise,
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    this.setStatus("running", "Runtime connected");
    await this.readCapabilities().catch(() => {});
    return { ok: true, pid: child.pid };
  }

  handleStdout(chunk) {
    this.stdoutBuffer += chunk;
    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf("\n");
      if (newlineIndex < 0) break;
      const line = this.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!line.trim()) continue;
      if (!this.ready) {
        this.ready = true;
        this.resolveReady?.();
      }

      let record;
      try {
        record = JSON.parse(line);
      } catch (error) {
        send("agent:log", { stream: "protocol", text: line });
        continue;
      }

      if (record.type === "response") {
        const pending = record.id ? this.pending.get(record.id) : null;
        if (pending) {
          this.pending.delete(record.id);
          clearTimeout(pending.timer);
          pending.resolve(record);
        }
      }

      if (record.type === "session_start" || record.type === "agent_settled") {
        this.rememberCurrentSessionSoon();
      }
      const toolRuntimeChange = mcpToolRuntime.handleEvent(record);
      if (toolRuntimeChange) {
        sendToPanel("mcp", "agent:event", {
          type: "mcp_tool_runtime_changed",
          ...toolRuntimeChange,
        });
      }
      if (record.type === "agent_settled") {
        for (const change of mcpToolRuntime.settle()) {
          sendToPanel("mcp", "agent:event", {
            type: "mcp_tool_runtime_changed",
            ...change,
          });
        }
      }
      const outbound =
        record.type === "mcp_status_changed" && record.status
          ? { ...record, status: mcpToolRuntime.decorate(record.status) }
          : record;
      send("agent:event", outbound);
      // The MCP panel listens for live status changes; its window is separate from the main one.
      if (record.type === "mcp_status_changed") sendToPanel("mcp", "agent:event", outbound);
    }
  }

  rejectPending(error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  rememberCurrentSessionSoon() {
    clearTimeout(this.sessionRememberTimer);
    this.sessionRememberTimer = setTimeout(async () => {
      try {
        const state = await this.call("get_state", {}, 5_000);
        const sessionFile = state?.success ? String(state.data?.sessionFile || "") : "";
        if (sessionFile) {
          await rememberLastSession(sessionFile);
          await rememberSessionPermission(sessionFile, this.runtimePermissionMode);
        }
      } catch {}
    }, 0);
  }

  call(type, data = {}, timeoutMs = 30_000) {
    if (!this.child || !this.child.stdin.writable) {
      return Promise.reject(new Error("PiSpider runtime is not running"));
    }
    const id = randomUUID();
    const record = { id, type, ...data };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${type}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify(record)}\n`, (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  sendRecord(record) {
    if (!this.child || !this.child.stdin.writable) return false;
    this.child.stdin.write(`${JSON.stringify(record)}\n`);
    return true;
  }

  async stop() {
    clearTimeout(this.sessionRememberTimer);
    this.sessionRememberTimer = null;
    const child = this.child;
    if (!child) return;
    this.setStatus("stopping", "Closing runtime");
    try {
      child.stdin.end();
    } catch {
      // The process may already be gone.
    }
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // Ignore a process that already exited.
        }
        resolve();
      }, 2500);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async restart(notify = true) {
    this.restarting = true;
    try {
      await this.stop();
      const result = await this.start();
      if (notify) send("agent:reloaded", { ok: true });
      return result;
    } finally {
      this.restarting = false;
    }
  }
}

function ensureAgent() {
  if (!agent) agent = new AgentProcess();
  return agent;
}

function showWindowWithFade(win, duration = 200) {
  if (!win || win.isDestroyed()) return;
  try {
    win.setOpacity(0);
  } catch {
    win.show();
    return;
  }
  win.show();
  const start = Date.now();
  const frame = () => {
    if (win.isDestroyed()) return;
    const progress = Math.min(1, (Date.now() - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    win.setOpacity(eased);
    if (progress < 1) setTimeout(frame, 16);
  };
  frame();
}

function showPanelWindow(win) {
  if (!win || win.isDestroyed()) return;
  try {
    win.setOpacity(1);
  } catch {}
  win.show();
  win.focus();
}

function hasVisibleWindowBounds(bounds) {
  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return false;
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapX = Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
    const overlapY = Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y);
    return overlapX >= 120 && overlapY >= 80;
  });
}

async function loadSavedWindowState() {
  const settings = await readDesktopSettings().catch(() => ({}));
  const saved = settings?.windowState;
  if (!saved || typeof saved !== "object") return {};
  const width = Number(saved.width);
  const height = Number(saved.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1080 || height < 700) return {};
  const candidate = { x: Number(saved.x), y: Number(saved.y), width, height };
  if (!hasVisibleWindowBounds(candidate)) return { width, height, maximized: Boolean(saved.maximized) };
  return { ...candidate, maximized: Boolean(saved.maximized) };
}

async function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const revision = ++windowStateRevision;
  const maximized = mainWindow.isMaximized();
  const bounds = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  const settings = await readDesktopSettings();
  if (revision !== windowStateRevision) return;
  settings.windowState = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    maximized,
  };
  await writeDesktopSettings(settings);
}

function scheduleWindowStateSave() {
  clearTimeout(windowStateSaveTimer);
  windowStateSaveTimer = setTimeout(() => {
    saveWindowState().catch(() => {});
  }, 250);
}

function saveWindowStateSync() {
  if (!runtimePaths || !mainWindow || mainWindow.isDestroyed()) return;
  windowStateRevision += 1;
  const maximized = mainWindow.isMaximized();
  const bounds = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(runtimePaths.desktopSettingsPath, "utf8"));
  } catch {
    settings = {};
  }
  settings.windowState = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    maximized,
  };
  const tempPath = `${runtimePaths.desktopSettingsPath}.${randomUUID()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(runtimePaths.desktopSettingsPath), { recursive: true });
    fs.writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tempPath, runtimePaths.desktopSettingsPath);
  } catch {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {}
  }
}

async function createWindow() {
  const isMac = process.platform === "darwin";
  const saved = await loadSavedWindowState();
  await loadZoomFactor();
  const windowOptions = {
    width: saved.width || DEFAULT_WINDOW_SIZE.width,
    height: saved.height || DEFAULT_WINDOW_SIZE.height,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: THEME_COLORS.light.background,
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    ...(process.platform === "win32"
      ? {
          titleBarOverlay: {
            color: THEME_COLORS.light.background,
            symbolColor: THEME_COLORS.light.symbol,
            height: 44,
          },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
      webviewTag: true,
    },
  };
  if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    windowOptions.x = saved.x;
    windowOptions.y = saved.y;
  }
  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  applyZoomToWindow(mainWindow);
  mainWindow.webContents.on("did-finish-load", () => applyZoomToWindow(mainWindow));
  mainWindow.once("ready-to-show", () => {
    if (saved.maximized) mainWindow.maximize();
    showWindowWithFade(mainWindow);
  });
  for (const eventName of ["resize", "move", "maximize", "unmaximize"]) {
    mainWindow.on(eventName, scheduleWindowStateSave);
  }
  mainWindow.on("close", saveWindowStateSync);
  mainWindow.on("closed", () => {
    clearTimeout(windowStateSaveTimer);
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

function openPanelWindow(kind) {
  const titles = {
    rules: "规则",
    skills: "技能",
    settings: "设置",
    mcp: "MCP",
    extensions: "扩展",
    project: "项目",
    session: "会话",
    status: "状态",
  };
  const title = titles[kind];
  if (!title) throw new Error(`Unknown panel: ${kind}`);

  const existing = panelWindows.get(kind);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    send("panel:changed", { kind });
    return { ok: true, focused: true };
  }

  for (const [otherKind, otherWindow] of panelWindows) {
    if (!otherWindow.isDestroyed()) otherWindow.destroy();
    panelWindows.delete(otherKind);
  }

  const panelSizes = {
    rules: { width: 1000, height: 700 },
    skills: { width: 1000, height: 700 },
    settings: { width: 1060, height: 820 },
    mcp: { width: 1060, height: 800 },
    extensions: { width: 1060, height: 800 },
    project: { width: 940, height: 680 },
    session: { width: 940, height: 780 },
    status: { width: 1000, height: 800 },
  };
  const requestedSize = panelSizes[kind] ?? { width: 960, height: 720 };
  const parentBounds = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;
  const workArea = parentBounds
    ? screen.getDisplayMatching(parentBounds).workArea
    : screen.getPrimaryDisplay().workArea;
  const width = Math.min(requestedSize.width, Math.max(720, workArea.width - 80));
  const height = Math.min(requestedSize.height, Math.max(560, workArea.height - 80));
  const x = Math.min(
    Math.max(
      parentBounds ? Math.round(parentBounds.x + (parentBounds.width - width) / 2) : Math.round(workArea.x + (workArea.width - width) / 2),
      workArea.x + 8,
    ),
    workArea.x + workArea.width - width - 8,
  );
  const y = Math.min(
    Math.max(
      parentBounds ? Math.round(parentBounds.y + (parentBounds.height - height) / 2) : Math.round(workArea.y + (workArea.height - height) / 2),
      workArea.y + 8,
    ),
    workArea.y + workArea.height - height - 8,
  );

  const win = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: 720,
    minHeight: 520,
    parent: mainWindow ?? undefined,
    modal: false,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: true,
    roundedCorners: true,
    autoHideMenuBar: true,
    backgroundColor: "#00000000",
    title: `PiSpider · ${title}`,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.setMenuBarVisibility(false);
  const initialTheme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
  win.loadFile(path.join(__dirname, "renderer", "panel.html"), { query: { kind, theme: initialTheme } });
  applyZoomToWindow(win);
  win.webContents.on("did-finish-load", () => applyZoomToWindow(win));
  win.once("ready-to-show", () => {
    showPanelWindow(win);
  });
  win.on("closed", () => {
    panelWindows.delete(kind);
    if (mainWindow && !mainWindow.isDestroyed()) {
      const active = [...panelWindows.entries()].find(([, window]) => !window.isDestroyed());
      send("panel:changed", active ? { kind: active[0] } : null);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  panelWindows.set(kind, win);
  send("panel:changed", { kind });
  return { ok: true, created: true };
}

ipcMain.handle("app:info", async () => {
  const paths = await loadRuntimePaths();
  return {
    ...paths,
    repoRoot,
    platform: process.platform,
    electron: process.versions.electron,
    node: process.versions.node,
  };
});

ipcMain.handle("system:diagnostics", async () => collectDiagnosticsData());
ipcMain.handle("system:export-diagnostics", async (_event, targetPath) => exportDiagnosticsReport(targetPath));

ipcMain.handle("app:copy-text", async (_event, text) => {
  clipboard.writeText(String(text ?? ""));
  return { ok: true };
});

ipcMain.handle("app:get-zoom", () => ({ factor: appZoomFactor }));
ipcMain.handle("app:set-zoom", async (_event, factor) => ({ factor: await setAppZoomFactor(factor) }));
ipcMain.handle("app:quit", async () => {
  // Ack first, then quit through the existing before-quit cleanup path.
  setImmediate(() => app.quit());
  return { success: true };
});
ipcMain.handle("app:get-changelog", async () => {
  try {
    const file = await readRuntimeChangelog();
    if (!file) return { success: false, error: "未找到 Pi 运行时变更日志" };
    return { success: true, data: file };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("sessions:list", async () => {
  const paths = await loadRuntimePaths();
  return listSessions(paths.sessionDir);
});
ipcMain.handle("sessions:order", async () => getSessionOrder());
ipcMain.handle("sessions:set-order", async (_event, items) => setSessionOrder(items));
ipcMain.handle("sessions:search", async (_event, query, sort) => searchSessions(query, sort));
ipcMain.handle("sessions:delete", async (_event, sessionPath) => deleteSessionFile(sessionPath));
ipcMain.handle("sessions:pin", async (_event, sessionPath) => toggleSessionPin(sessionPath));
ipcMain.handle("sessions:import", async () => importSessionFile());
ipcMain.handle("sessions:import-path", async (_event, sourcePath) => importSessionAtPath(sourcePath));
ipcMain.handle("resources:rules", async () => listRuleData());
ipcMain.handle("resources:rule", async (_event, id) => readRuleData(id));
ipcMain.handle("resources:create-rule", async (_event, input) => createRuleData(input));
ipcMain.handle("resources:update-rule", async (_event, id, content) => updateRuleData(id, content));
ipcMain.handle("resources:reset-rule", async (_event, id) => resetRuleData(id));
ipcMain.handle("resources:delete-rule", async (_event, id) => deleteRuleData(id));
ipcMain.handle("resources:activate-rule", async (_event, id) => activateRuleData(id));
ipcMain.handle("resources:skills", async () => listSkillData());
ipcMain.handle("resources:create-skill", async (_event, input) => createSkillData(input));
ipcMain.handle("resources:import-skill", async (_event, sourcePath) => importSkillData(sourcePath));
ipcMain.handle("resources:delete-skill", async (_event, id) => deleteSkillData(id));
ipcMain.handle("resources:mcp", async (_event, scope) => listMcpServers(scope));
ipcMain.handle("resources:mcp-start", async (_event, id, scope, inputs) => installCatalogMcp(id, scope, inputs));
ipcMain.handle("resources:mcp-save", async (_event, input, scope) => saveMcpServer(input, scope));
ipcMain.handle("resources:mcp-delete", async (_event, name, scope) => deleteMcpServer(name, scope));
ipcMain.handle("resources:mcp-toggle", async (_event, name, enabled, scope) => setMcpEnabled(name, enabled, scope));
ipcMain.handle("resources:mcp-check", async (_event, name, scope) => runMcpCheck(typeof name === "string" ? name : "", scope));
ipcMain.handle("resources:mcp-command", async (_event, name, action) => runMcpServerCommand(name, action));
ipcMain.handle("resources:prompts", async () => listPromptData());
ipcMain.handle("resources:read-prompt", async (_event, name) => readPromptData(name));
ipcMain.handle("resources:update-prompt", async (_event, name, content) => updatePromptData(name, content));
ipcMain.handle("resources:reset-prompt", async (_event, name) => resetPromptData(name));
ipcMain.handle("resources:preview-prompt", async (_event, text) => previewPromptData(text));
ipcMain.handle("resources:list-prompt-templates", async () => listPromptTemplateData());
ipcMain.handle("resources:read-prompt-template", async (_event, scope, id) => readPromptTemplateData(scope, id));
ipcMain.handle("resources:create-prompt-template", async (_event, input) => createPromptTemplateData(input));
ipcMain.handle("resources:update-prompt-template", async (_event, scope, id, input) => updatePromptTemplateData(scope, id, input));
ipcMain.handle("resources:delete-prompt-template", async (_event, scope, id) => deletePromptTemplateData(scope, id));
ipcMain.handle("resources:extensions", async () => listExtensionData());
ipcMain.handle("resources:toggle-extension", async (_event, target, enabled) => toggleExtensionData(target, enabled));
ipcMain.handle("resources:install-package", async (_event, input) => installPackageData(input));
ipcMain.handle("resources:remove-package", async (_event, input) => removePackageData(input));
ipcMain.handle("resources:update-package", async (_event, input) => updatePackageData(input));
ipcMain.handle("config:get-workspace", async () => getWorkspaceConfig());
ipcMain.handle("config:set-domain", async (_event, domain) => setWorkspaceDomain(domain));
ipcMain.handle("config:get-project-trust", async () => getProjectTrustState());
ipcMain.handle("config:set-project-trust", async (_event, mode) => setProjectTrustState(mode));
ipcMain.handle("project:read", async (_event, targetPath) => readProjectFile(targetPath));
ipcMain.handle("project:changes", async () => listProjectChanges());
ipcMain.handle("panel:open", async (_event, kind) => openPanelWindow(kind));
ipcMain.handle("panel:close", async () => {
  for (const [kind, win] of panelWindows) {
    if (!win.isDestroyed()) win.close();
    panelWindows.delete(kind);
  }
  send("panel:changed", null);
  return { ok: true };
});
ipcMain.handle("panel:window-action", (event, action) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return { ok: false };
  if (action === "minimize") win.minimize();
  else if (action === "close") win.close();
  return { ok: true };
});
ipcMain.handle("config:get-model", async () => getModelConfigState());
ipcMain.handle("config:save-model", async (_event, config) => saveModelConfig(config));
ipcMain.handle("config:check-model", async (_event, config) => checkModelConfig(config));
ipcMain.handle("config:test-model", async (_event, config) => testModelConnection(config));
ipcMain.handle("config:test-inference", async (_event, config) => testModelInference(config));
ipcMain.handle("config:clear-key", async (_event, provider) => clearModelCredential(provider));
ipcMain.handle("config:oauth-login", async (_event, provider) => startOAuthLogin(provider));
ipcMain.handle("config:oauth-cancel", async () => cancelOAuthLogin());
ipcMain.handle("config:oauth-prompt", async (_event, promptId, value) => respondOAuthPrompt(promptId, value));
ipcMain.handle("config:oauth-logout", async (_event, provider) => logoutOAuthProvider(provider));
ipcMain.handle("config:list-models", async () => {
  const response = await ensureAgent().call("get_available_models", {}, 12_000);
  return response?.data?.models ?? [];
});
ipcMain.handle("config:get-model-scope", async () => getModelScopeState());
ipcMain.handle("config:set-model-scope", async (_event, patterns) => setModelScope(patterns));
ipcMain.handle("config:get-advanced", async () => getAdvancedSettingsState());
ipcMain.handle("config:set-advanced", async (_event, input) => setAdvancedSettingsState(input));
ipcMain.handle("config:set-model-thinking-default", async (_event, reference, level) =>
  setModelThinkingDefault(reference, level),
);

ipcMain.handle("agent:start", async () => {
  await ensureDefaultThinkingLevels().catch(() => {});
  const agentProcess = ensureAgent();
  const alreadyRunning = Boolean(agentProcess.child);
  const result = await agentProcess.start();
  if (!alreadyRunning) await restoreLastSession(agentProcess).catch(() => {});
  return result;
});
ipcMain.handle("agent:stop", async () => {
  if (agent) await agent.stop();
  return { ok: true };
});
ipcMain.handle("agent:reload", async () => {
  await restartAgentPreservingSession(true);
  return { ok: true };
});
ipcMain.handle("agent:get-state", async () => ensureAgent().call("get_state", {}, 5_000));
ipcMain.handle("agent:get-messages", async () => ensureAgent().call("get_messages", {}, 5_000));
ipcMain.handle("agent:last-assistant-text", async () => {
  const response = await ensureAgent().call("get_last_assistant_text", {}, 5_000);
  if (response?.success) {
    const text = typeof response.data?.text === "string" ? response.data.text : "";
    return { ...response, data: { text } };
  }
  return response;
});
ipcMain.handle("agent:new-session", async () => newSessionWithPermission());
ipcMain.handle("agent:switch-session", async (_event, sessionPath) => {
  if (typeof sessionPath !== "string" || !sessionPath) {
    return { type: "response", command: "switch_session", success: false, error: "Missing session path" };
  }
  return switchSessionWithPermission(sessionPath);
});
ipcMain.handle("agent:set-session-name", async (_event, name) => {
  const value = String(name || "").trim();
  if (!value) {
    return { type: "response", command: "set_session_name", success: false, error: "会话名称不能为空" };
  }
  return ensureAgent().call("set_session_name", { name: value }, 10_000);
});
ipcMain.handle("agent:fork-messages", async () => ensureAgent().call("get_fork_messages", {}, 15_000));
ipcMain.handle("agent:rewind", async (_event, mode) => {
  const targetMode = mode === "round" ? "round" : "once";
  const response = await ensureAgent().call("get_fork_messages", {}, 15_000);
  const messages = response?.data?.messages ?? [];
  if (messages.length === 0) {
    return { type: "response", command: "rewind", success: false, error: "当前会话还没有可回退的用户消息" };
  }
  if (targetMode === "round" && messages.length < 2) {
    return { type: "response", command: "rewind", success: false, error: "没有更早的用户轮次可回退" };
  }
  const index = targetMode === "round" ? Math.max(0, messages.length - 2) : messages.length - 1;
  const target = messages[index];
  if (!target) {
    return { type: "response", command: "rewind", success: false, error: "没有更早的用户轮次可回退" };
  }
  const result = await ensureAgent().call("fork", { entryId: target.entryId }, 60_000);
  if (result?.success) send("sessions:changed", { reason: "rewind" });
  return result;
});
ipcMain.handle("agent:fork", async (_event, entryId) => {
  const value = String(entryId || "").trim();
  if (!value) {
    return { type: "response", command: "fork", success: false, error: "缺少消息 entryId" };
  }
  const response = await ensureAgent().call("fork", { entryId: value }, 60_000);
  if (response?.success) send("sessions:changed", { reason: "fork" });
  return response;
});
ipcMain.handle("agent:navigate-tree", async (_event, entryId) => {
  const value = String(entryId || "").trim();
  if (!value) {
    return { type: "response", command: "navigate_tree", success: false, error: "缺少树节点 entryId" };
  }
  const response = await ensureAgent().call("navigate_tree", { targetId: value }, 60_000);
  if (response?.success) {
    send("sessions:changed", { reason: "navigate" });
    const editorText = String(response.data?.editorText || "");
    if (editorText) send("composer:set-draft", { text: editorText });
  }
  return response;
});
ipcMain.handle("agent:clone", async () => {
  const response = await ensureAgent().call("clone", {}, 60_000);
  if (response?.success) send("sessions:changed", { reason: "clone" });
  return response;
});
ipcMain.handle("agent:session-tree", async () => ensureAgent().call("get_tree", {}, 15_000));
ipcMain.handle("agent:export-html", async (_event, outputPath) => {
  let requestedPath;
  try {
    requestedPath = validateHtmlExportPath(outputPath);
  } catch (error) {
    return { type: "response", command: "export_html", success: false, error: error.message };
  }
  const data = requestedPath ? { outputPath: requestedPath } : {};
  if (requestedPath) await fsp.mkdir(path.dirname(requestedPath), { recursive: true });
  const response = await ensureAgent().call("export_html", data, 60_000);
  if (response?.success) {
    const output = String(response.data?.path || "");
    if (output && !path.isAbsolute(output)) {
      response.data = { ...response.data, path: path.resolve(repoRoot, output) };
    }
    send("sessions:changed", { reason: "export" });
  }
  return response;
});
ipcMain.handle("agent:export-jsonl", async (_event, requestedPath) => {
  const state = await ensureAgent().call("get_state", {}, 5_000);
  const sessionFile = state?.success ? String(state.data?.sessionFile || "") : "";
  if (!sessionFile || !fs.existsSync(sessionFile)) {
    return {
      type: "response",
      command: "export_jsonl",
      success: false,
      error: "当前会话还没有保存，先发送一条消息再导出",
    };
  }
  let outputPath = typeof requestedPath === "string" ? requestedPath.trim() : "";
  if (outputPath) {
    outputPath = path.resolve(outputPath);
  } else {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "导出会话 JSONL",
      defaultPath: path.join(app.getPath("documents"), `session-${state.data.sessionId || "export"}.jsonl`),
      filters: [{ name: "JSONL", extensions: ["jsonl"] }],
    });
    if (result.canceled || !result.filePath) {
      return { type: "response", command: "export_jsonl", success: false, cancelled: true };
    }
    outputPath = result.filePath;
  }
  if (!outputPath.toLowerCase().endsWith(".jsonl")) outputPath += ".jsonl";
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.copyFile(sessionFile, outputPath);
  send("sessions:changed", { reason: "export" });
  return { type: "response", command: "export_jsonl", success: true, data: { path: outputPath } };
});

function shareViewerUrl(gistId) {
  const base = process.env.PI_SHARE_VIEWER_URL?.trim() || "https://pi.dev/session/";
  return `${base.replace(/\/+$/, "")}/${encodeURIComponent(gistId)}`;
}

async function assertGhReady() {
  try {
    await execFileAsync(ghExecutable, ["auth", "status"], {
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("未安装 GitHub CLI（gh）。先安装 https://cli.github.com/，再运行 gh auth login。");
    }
    const detail = String(error?.stderr || error?.stdout || error?.message || "").trim();
    throw new Error(`GitHub CLI 未登录，先运行 gh auth login。${detail ? `\n${detail}` : ""}`);
  }
}

async function createPrivateGist(filePath) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(ghExecutable, ["gist", "create", "--public=false", filePath], {
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    }));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("未安装 GitHub CLI（gh）。先安装 https://cli.github.com/，再运行 gh auth login。");
    }
    const detail = String(error?.stderr || error?.stdout || error?.message || "").trim();
    throw new Error(`创建 Gist 失败。${detail ? `\n${detail}` : ""}`);
  }
  const gistUrl = String(stdout || "").trim().split(/\s+/).pop() || "";
  const gistId = gistUrl.split("/").filter(Boolean).pop() || "";
  if (!gistId || !/^[a-f0-9]+$/i.test(gistId)) {
    throw new Error(`无法从 gh 输出解析 Gist ID：${gistUrl || "(空)"}`);
  }
  return { gistUrl, gistId, viewerUrl: shareViewerUrl(gistId) };
}

ipcMain.handle("agent:share", async () => {
  if (shareInFlight) {
    return { type: "response", command: "share", success: false, error: "已有分享任务正在进行" };
  }
  shareInFlight = true;
  let tempDir = null;
  try {
    tempDir = await fsp.mkdtemp(path.join(app.getPath("temp"), "pispider-share-"));
    const requestedHtmlPath = path.join(tempDir, "session.html");
    await assertGhReady();
    const response = await ensureAgent().call("export_html", { outputPath: requestedHtmlPath }, 60_000);
    if (!response?.success) {
      throw new Error(response?.error || "导出会话 HTML 失败");
    }
    const exportedPath = String(response.data?.path || "");
    const htmlPath = exportedPath ? path.resolve(exportedPath) : requestedHtmlPath;
    if (!fs.existsSync(htmlPath)) throw new Error(`会话 HTML 不存在：${htmlPath}`);
    const result = await createPrivateGist(htmlPath);
    return {
      type: "response",
      command: "share",
      success: true,
      data: { ...result, transport: "gist", private: true },
    };
  } catch (error) {
    return {
      type: "response",
      command: "share",
      success: false,
      error: error instanceof Error ? error.message : "分享失败",
    };
  } finally {
    shareInFlight = false;
    if (tempDir) fs.rm(tempDir, { recursive: true, force: true }, () => {});
  }
});
function normalizePromptImages(images) {
  return Array.isArray(images)
    ? images
        .filter((image) => image && typeof image.data === "string" && typeof image.mimeType === "string")
        .slice(0, 4)
        .map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType }))
    : [];
}

ipcMain.handle("agent:send-prompt", async (_event, message, streaming, images) => {
  const text = typeof message === "string" ? message.trim() : "";
  const imageList = normalizePromptImages(images);
  if (!text && !imageList.length) {
    return { type: "response", command: "prompt", success: false, error: "Empty prompt" };
  }
  const data = { message: text || "请查看这张图片。" };
  if (imageList.length) data.images = imageList;
  if (streaming) data.streamingBehavior = "followUp";
  return ensureAgent().call("prompt", data, 30_000);
});
ipcMain.handle("agent:steer", async (_event, message, images) => {
  const text = typeof message === "string" ? message.trim() : "";
  const imageList = normalizePromptImages(images);
  if (!text && !imageList.length) {
    return { type: "response", command: "steer", success: false, error: "Empty steer message" };
  }
  const data = { message: text || "请查看这张图片。" };
  if (imageList.length) data.images = imageList;
  return ensureAgent().call("steer", data, 30_000);
});
ipcMain.handle("agent:abort", async () => ensureAgent().call("abort", {}, 30_000));
ipcMain.handle("agent:set-label", async (_event, entryId, label) => {
  const targetId = String(entryId || "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(targetId)) {
    return { type: "response", command: "label", success: false, error: "节点 ID 无效" };
  }
  const text = typeof label === "string" ? label.replace(/\r?\n/g, " ") : "";
  return ensureAgent().call("prompt", { message: `/ps label ${targetId} ${JSON.stringify(text)}` }, 30_000);
});
ipcMain.handle("agent:clear-queue", async () => ensureAgent().call("clear_queue", {}, 20_000));
ipcMain.handle("agent:session-stats", async () => ensureAgent().call("get_session_stats", {}, 12_000));
ipcMain.handle("agent:reset-task", async () => ensureAgent().call("prompt", { message: "/ps task reset --yes" }, 30_000));
ipcMain.handle("agent:set-model", async (_event, provider, modelId) => {

  const providerId = String(provider || "").trim();
  const model = String(modelId || "").trim();
  if (!providerId || !model) {
    return { type: "response", command: "set_model", success: false, error: "缺少 provider 或 model" };
  }
  return ensureAgent().call("set_model", { provider: providerId, modelId: model }, 15_000);
});
ipcMain.handle("agent:thinking-levels", async () => ensureAgent().call("get_available_thinking_levels", {}, 10_000));
ipcMain.handle("agent:cycle-model", async () => ensureAgent().call("cycle_model", {}, 15_000));
ipcMain.handle("agent:available-models", async () => ensureAgent().call("get_available_models", {}, 10_000));
ipcMain.handle("agent:commands", async () => ensureAgent().call("get_commands", {}, 10_000));
ipcMain.handle("agent:capabilities", async (_event, force = false) => {
  const capabilities = await ensureAgent().readCapabilities(Boolean(force));
  return { ok: true, ...capabilities };
});
ipcMain.handle("shell:run", async (_event, command, excludeFromContext) => {
  const value = String(command || "").trim();
  if (!value) {
    return { type: "response", command: "bash", success: false, error: "命令不能为空" };
  }
  try {
    return await runAgentBash(value, excludeFromContext);
  } catch (error) {
    return { type: "response", command: "bash", success: false, error: error.message };
  }
});
ipcMain.handle("shell:abort", async () => {
  if (!agent?.child) return { ok: false, error: "没有正在执行的命令" };
  try {
    await agent.call("abort_bash", {}, 5_000);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});
ipcMain.handle("editor:edit-text", async (_event, text) => {
  try {
    const result = await editPromptText(text);
    return { type: "response", command: "edit_text", success: true, data: { text: result } };
  } catch (error) {
    return { type: "response", command: "edit_text", success: false, error: error.message };
  }
});
ipcMain.handle("config:get-permission", async () => getPermissionState());
ipcMain.handle("config:set-permission", async (_event, mode) => setPermissionState(mode));
ipcMain.handle("agent:set-thinking-level", async (_event, level) => {
  const value = String(level || "").trim();
  if (!value) {
    return { type: "response", command: "set_thinking_level", success: false, error: "缺少 thinking level" };
  }
  return ensureAgent().call("set_thinking_level", { level: value }, 10_000);
});
ipcMain.handle("agent:cycle-thinking-level", async () => ensureAgent().call("cycle_thinking_level", {}, 10_000));
ipcMain.handle("agent:set-auto-compaction", async (_event, enabled) =>
  ensureAgent().call("set_auto_compaction", { enabled: Boolean(enabled) }, 10_000),
);
ipcMain.handle("agent:auto-retry", async () => {
  const paths = await loadRuntimePaths();
  const settings = await readJsonObject(paths.settingsPath, "settings.json");
  return { enabled: settings.retry?.enabled !== false };
});
ipcMain.handle("agent:set-auto-retry", async (_event, enabled) =>
  ensureAgent().call("set_auto_retry", { enabled: Boolean(enabled) }, 10_000),
);
ipcMain.handle("agent:abort-retry", async () => ensureAgent().call("abort_retry", {}, 10_000));
ipcMain.handle("agent:compact", async (_event, customInstructions) => {
  const data = {};
  if (typeof customInstructions === "string" && customInstructions.trim()) {
    data.customInstructions = customInstructions.trim();
  }
  return ensureAgent().call("compact", data, 120_000);
});
ipcMain.handle("agent:extension-ui-response", async (_event, id, payload) => {
  if (typeof id !== "string" || !id) {
    return { ok: false, error: "Missing extension UI request id" };
  }
  const response = { type: "extension_ui_response", id };
  if (payload && typeof payload === "object") {
    if (typeof payload.value === "string") response.value = payload.value;
    if (typeof payload.confirmed === "boolean") response.confirmed = payload.confirmed;
    if (payload.cancelled === true) response.cancelled = true;
  }
  const sent = ensureAgent().sendRecord(response);
  return sent ? { ok: true } : { ok: false, error: "PiSpider runtime is not running" };
});
ipcMain.handle("theme:set", (_event, theme) => {
  const nextTheme = theme === "dark" ? "dark" : "light";
  nativeTheme.themeSource = nextTheme;
  setWindowTheme(nextTheme);
  for (const win of panelWindows.values()) {
    if (win.isDestroyed()) continue;
    win.webContents.send("theme:changed", nextTheme);
  }
  return { ok: true, theme: nextTheme };
});
ipcMain.handle("shell:open-external", async (_event, url) => {
  if (typeof url === "string" && /^https?:\/\//i.test(url)) {
    await shell.openExternal(url);
  }
});
const FILE_SEARCH_IGNORES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".cache",
  ".turbo",
  ".venv",
  "venv",
  "__pycache__",
]);

async function runGit(args) {
  try {
    const result = await execFileAsync("git", ["-C", repoRoot, ...args], {
      windowsHide: true,
      timeout: 5_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return { ok: true, stdout: String(result.stdout || ""), stderr: String(result.stderr || "") };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error?.stdout || ""),
      stderr: String(error?.stderr || error?.message || ""),
    };
  }
}

async function listRecentProjectFiles(limit = 40) {
  const files = [];
  const queue = [{ dir: repoRoot, depth: 0 }];
  let visited = 0;
  while (queue.length && visited < 5000) {
    const { dir, depth } = queue.shift();
    if (depth > 8) continue;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (visited >= 5000) break;
      if (entry.isDirectory()) {
        if (FILE_SEARCH_IGNORES.has(entry.name) || entry.name.startsWith(".")) continue;
        queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      visited += 1;
      const absolute = path.join(dir, entry.name);
      try {
        const stat = await fsp.stat(absolute);
        if (stat.size > 2 * 1024 * 1024) continue;
        files.push({ path: path.relative(repoRoot, absolute).split(path.sep).join("/"), mtimeMs: stat.mtimeMs, size: stat.size });
      } catch {}
    }
  }
  return files
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit);
}

async function listProjectChanges() {
  const status = await runGit(["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status.ok) {
    const branch = (await runGit(["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
    const files = status.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const statusCode = line.slice(0, 2);
        let filePath = line.slice(3).trim();
        const renameIndex = filePath.indexOf(" -> ");
        if (renameIndex >= 0) filePath = filePath.slice(renameIndex + 4).trim();
        return { path: filePath.replace(/^"|"$/g, ""), statusCode, status: statusCode.trim() || "M" };
      })
      .filter((file) => file.path);
    return { source: "git", branch, files };
  }
  return { source: "recent", files: await listRecentProjectFiles() };
}


async function searchProjectFiles(root, query, limit) {
  const results = [];
  const queue = [{ dir: root, depth: 0 }];
  let visited = 0;
  const normalizedQuery = String(query || "").trim().toLowerCase();
  while (queue.length && results.length < 400 && visited < 3000) {
    const { dir, depth } = queue.shift();
    if (depth > 8) continue;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (visited >= 3000) break;
      if (entry.isDirectory()) {
        if (FILE_SEARCH_IGNORES.has(entry.name) || entry.name.startsWith(".")) continue;
        queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      visited += 1;
      const relativePath = path.relative(root, path.join(dir, entry.name)).split(path.sep).join("/");
      if (!normalizedQuery || relativePath.toLowerCase().includes(normalizedQuery)) {
        results.push(relativePath);
      }
      if (results.length >= 400) break;
    }
  }
  return results
    .sort((a, b) => {
      const aBase = path.posix.basename(a).toLowerCase();
      const bBase = path.posix.basename(b).toLowerCase();
      const aBaseHit = normalizedQuery && aBase.includes(normalizedQuery) ? 0 : 1;
      const bBaseHit = normalizedQuery && bBase.includes(normalizedQuery) ? 0 : 1;
      const aBaseStart = normalizedQuery && aBase.startsWith(normalizedQuery) ? 0 : 1;
      const bBaseStart = normalizedQuery && bBase.startsWith(normalizedQuery) ? 0 : 1;
      return aBaseStart - bBaseStart || aBaseHit - bBaseHit || a.length - b.length || a.localeCompare(b);
    })
    .slice(0, limit);
}

ipcMain.handle("files:search", async (_event, query, cwd) => {
  const requestedRoot = typeof cwd === "string" && path.isAbsolute(cwd) ? cwd : repoRoot;
  let root = requestedRoot;
  try {
    const stat = await fsp.stat(root);
    if (!stat.isDirectory()) root = repoRoot;
  } catch {
    root = repoRoot;
  }
  const files = await searchProjectFiles(root, query, 30);
  return { root, files };
});
ipcMain.handle("files:read-images", async (_event, paths) => {
  const imageMime = new Map([
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".gif", "image/gif"],
    [".webp", "image/webp"],
    [".bmp", "image/bmp"],
  ]);
  const list = Array.isArray(paths) ? paths.slice(0, 4) : [];
  const images = await Promise.all(
    list.map(async (filePath) => {
      if (typeof filePath !== "string") return null;
      const mimeType = imageMime.get(path.extname(filePath).toLowerCase());
      if (!mimeType) return null;
      try {
        const data = await fsp.readFile(filePath);
        if (data.length > 20 * 1024 * 1024) return null;
        return { name: path.basename(filePath), mimeType, data: data.toString("base64") };
      } catch {
        return null;
      }
    }),
  );
  return images.filter(Boolean);
});
ipcMain.handle("dialog:pick-files", async () => {
  if (!mainWindow) return [];
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择要添加的文件",
    properties: ["openFile", "multiSelections"],
  });
  return result.canceled ? [] : result.filePaths;
});
ipcMain.handle("dialog:pick-directory", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择技能目录",
    properties: ["openDirectory"],
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
});
ipcMain.handle("project:pick-file", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择代码文件",
    defaultPath: repoRoot,
    properties: ["openFile"],
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
});
ipcMain.handle("shell:open-path", async (_event, targetPath) => {
  if (typeof targetPath === "string" && targetPath) {
    const resolved = path.isAbsolute(targetPath) ? targetPath : path.resolve(repoRoot, targetPath);
    const error = await shell.openPath(resolved);
    if (error) throw new Error(error);
  }
});

app.setAppUserModelId("com.pispider.desktop");

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow().catch(() => {});
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(async () => {
  nativeTheme.themeSource = "light";
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow().catch(() => {});
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  await saveWindowState().catch(() => {});
  if (activeOAuthLogin) {
    try {
      writeOAuthBridge(activeOAuthLogin.child, { command: "cancel" });
    } catch {
      // Fall through to the forced kill.
    }
    if (!activeOAuthLogin.child.killed) activeOAuthLogin.child.kill();
    activeOAuthLogin = null;
  }
  if (agent) await agent.stop();
  app.quit();
});
