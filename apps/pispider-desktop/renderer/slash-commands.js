/**
 * Built-in slash command registry and pure helpers for the PiSpider desktop renderer.
 *
 * Loaded as a plain browser script before app.js; it also exports through
 * module.exports so node --test can require it directly. This file references
 * no DOM, Electron, or preload APIs.
 */

const BUILTIN_COMMANDS = [
  { name: "settings", description: "打开设置窗口", source: "builtin" },
  { name: "model", description: "选择模型", argumentHint: "<provider/model>", source: "builtin" },
  { name: "tree", description: "查看会话树并切换分支", source: "builtin" },
  { name: "thinking", description: "设置思考强度", argumentHint: "<level>", source: "builtin" },
  { name: "scoped-models", description: "编辑模型循环切换范围", source: "builtin" },
  { name: "export", description: "导出会话（默认 HTML，可指定 .html/.jsonl 路径）", argumentHint: "[路径]", source: "builtin" },
  { name: "import", description: "导入 JSONL 会话", argumentHint: "[路径]", source: "builtin" },
  { name: "share", description: "分享会话到 GitHub Gist", source: "builtin" },
  { name: "bug", description: "反馈问题", argumentHint: "[描述]", source: "builtin" },
  { name: "copy", description: "复制最后一条助手回复", source: "builtin" },
  { name: "name", description: "设置会话名称", argumentHint: "<名称>", source: "builtin" },
  { name: "session", description: "查看会话信息与统计", source: "builtin" },
  { name: "changelog", description: "查看变更日志", source: "builtin" },
  { name: "hotkeys", description: "查看键盘快捷键", source: "builtin" },
  { name: "fork", description: "从历史用户消息分叉新会话", source: "builtin" },
  { name: "clone", description: "复制当前会话", source: "builtin" },
  { name: "trust", description: "设置项目信任", source: "builtin" },
  { name: "login", description: "配置模型提供商登录", argumentHint: "[provider]", source: "builtin" },
  { name: "logout", description: "退出模型提供商登录", argumentHint: "[provider]", source: "builtin" },
  { name: "new", description: "新建会话", source: "builtin" },
  { name: "compact", description: "手动压缩会话上下文", argumentHint: "[压缩说明]", source: "builtin" },
  { name: "resume", description: "切换或恢复其他会话", source: "builtin" },
  { name: "reload", description: "重载 Agent（扩展/技能/规则等）", source: "builtin" },
  { name: "quit", description: "退出 PiSpider", source: "builtin" },
];

const SOURCE_LABELS = {
  builtin: "内置",
  extension: "扩展",
  prompt: "模板",
  skill: "技能",
};

const VALID_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

const SLASH_TOKEN_RE = /^\/[A-Za-z][A-Za-z0-9_-]*$/;

function normalizeCommandName(value) {
  return String(value || "").replace(/^\//, "").trim().toLowerCase();
}

function commandExtension(pathValue) {
  const base = String(pathValue || "").split(/[\\/]/).pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot < 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Parse a composer input as a slash command.
 * Returns null for non-command shapes (plain prompt, paths like /etc/hosts,
 * multi-line text). Otherwise returns { name, args, raw }.
 */
function parseSlashInput(text) {
  const value = String(text ?? "");
  if (!value.startsWith("/")) return null;
  if (value.includes("\n")) return null;
  const spaceIndex = value.search(/\s/);
  const token = spaceIndex === -1 ? value : value.slice(0, spaceIndex);
  const args = spaceIndex === -1 ? "" : value.slice(spaceIndex + 1).trim();
  if (!SLASH_TOKEN_RE.test(token)) return null;
  return { name: token.slice(1), args, raw: value };
}

/**
 * Merge built-in commands with RPC-provided commands. Built-ins come first and
 * keep priority on name collisions; the remaining RPC commands are de-duplicated.
 */
function mergeCommands(builtin, rpcCommands) {
  const builtinList = Array.isArray(builtin) ? builtin : [];
  const rpcList = Array.isArray(rpcCommands) ? rpcCommands : [];
  const seen = new Set(builtinList.map((command) => normalizeCommandName(command.name)));
  const merged = builtinList.map((command) => ({ ...command }));
  for (const command of rpcList) {
    const name = normalizeCommandName(command?.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const source = ["extension", "prompt", "skill"].includes(command.source) ? command.source : "extension";
    merged.push({
      name,
      description: command.description || "",
      source,
      argumentHint: command.argumentHint,
      sourceInfo: command.sourceInfo,
    });
  }
  return merged;
}

/** Filter commands by name/description substring; capped at 30 entries. */
function filterCommands(commands, query) {
  const q = String(query || "").trim().toLowerCase();
  const list = Array.isArray(commands) ? commands : [];
  const matched = q
    ? list.filter(
        (command) =>
          String(command.name || "").toLowerCase().includes(q) ||
          String(command.description || "").toLowerCase().includes(q),
      )
    : list.slice();
  return matched.slice(0, 30);
}

/**
 * Resolve a built-in command name to a pure action descriptor. The renderer
 * maps each action to a real UI call or preload channel. Unknown names return
 * an "unknown" action; invalid arguments return an "error" action.
 */
function resolveBuiltinAction(name, rawArgs) {
  const commandName = normalizeCommandName(name);
  const args = String(rawArgs || "").trim();

  switch (commandName) {
    case "settings":
      return { action: "openPanel", payload: { kind: "settings" } };
    case "model": {
      if (!args) return { action: "openModelMenu", payload: {} };
      const slashIndex = args.indexOf("/");
      if (slashIndex <= 0 || slashIndex === args.length - 1 || /\s/.test(args)) {
        return {
          action: "error",
          payload: { message: "模型格式应为 <provider/model>，例如 /model anthropic/claude-opus-4.5" },
        };
      }
      return {
        action: "setModel",
        payload: { provider: args.slice(0, slashIndex), modelId: args.slice(slashIndex + 1) },
      };
    }
    case "tree":
      return { action: "openPanel", payload: { kind: "session", toast: "会话树在会话窗口中查看并切换分支" } };
    case "thinking": {
      if (!args) return { action: "openThinkingMenu", payload: {} };
      const level = args.toLowerCase();
      if (!VALID_THINKING_LEVELS.includes(level)) {
        return {
          action: "error",
          payload: { message: `思考强度非法，可选：${VALID_THINKING_LEVELS.join(" / ")}` },
        };
      }
      return { action: "setThinking", payload: { level } };
    }
    case "scoped-models":
      return { action: "openModelScopeEditor", payload: {} };
    case "export": {
      if (!args) return { action: "exportHtml", payload: {} };
      const ext = commandExtension(args);
      if (ext === "jsonl") return { action: "exportJsonl", payload: { path: args } };
      if (ext === "html") return { action: "exportHtml", payload: { path: args } };
      return { action: "error", payload: { message: "导出路径仅支持 .html 或 .jsonl 结尾" } };
    }
    case "import":
      return args
        ? { action: "importSessionPath", payload: { path: args } }
        : { action: "importSession", payload: {} };
    case "share":
      return { action: "shareSession", payload: {} };
    case "bug":
      return { action: "openBugReport", payload: { description: args } };
    case "copy":
      return { action: "copyLastAssistant", payload: {} };
    case "name":
      return args
        ? { action: "setSessionName", payload: { name: args } }
        : { action: "openPanel", payload: { kind: "session", toast: "在会话窗口中重命名当前会话" } };
    case "session":
      return { action: "openPanel", payload: { kind: "status" } };
    case "changelog":
      return { action: "showChangelog", payload: {} };
    case "hotkeys":
      return { action: "openShortcuts", payload: {} };
    case "fork":
      return {
        action: "openPanel",
        payload: { kind: "session", toast: "分叉入口在会话窗口中，选择历史用户消息创建新分叉" },
      };
    case "clone":
      return { action: "cloneSession", payload: {} };
    case "trust":
      return { action: "openPanel", payload: { kind: "settings", toast: "项目信任决策在设置窗口中保存" } };
    case "login":
      return {
        action: "openPanel",
        payload: {
          kind: "settings",
          provider: args,
          toast: args ? `在设置窗口中配置 ${args} 提供商登录` : "在设置窗口中配置模型提供商登录",
        },
      };
    case "logout":
      return {
        action: "openPanel",
        payload: {
          kind: "settings",
          provider: args,
          toast: args ? `在设置窗口中退出 ${args} 提供商登录（不会直接删除认证）` : "在设置窗口中退出模型提供商登录",
        },
      };
    case "new":
      return { action: "newSession", payload: {} };
    case "compact":
      return { action: "compact", payload: { instructions: args } };
    case "resume":
      return { action: "openSessionList", payload: {} };
    case "reload":
      return { action: "reloadAgent", payload: {} };
    case "quit":
      return { action: "quitApp", payload: {} };
    default:
      return { action: "unknown", payload: { name: commandName } };
  }
}

const PiSpiderSlash = {
  BUILTIN_COMMANDS,
  SOURCE_LABELS,
  VALID_THINKING_LEVELS,
  parseSlashInput,
  mergeCommands,
  filterCommands,
  resolveBuiltinAction,
};

if (typeof globalThis !== "undefined") globalThis.PiSpiderSlash = PiSpiderSlash;
if (typeof module !== "undefined" && module.exports) module.exports = PiSpiderSlash;
