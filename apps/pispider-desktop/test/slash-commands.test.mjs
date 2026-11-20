/**
 * Built-in slash command registry, parsing, merging, filtering and action
 * routing tests. These run under node --test against the pure renderer module;
 * no Electron or DOM APIs are required.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  BUILTIN_COMMANDS,
  SOURCE_LABELS,
  parseSlashInput,
  mergeCommands,
  filterCommands,
  resolveBuiltinAction,
} = require("../renderer/slash-commands.js");

const UPSTREAM_NAMES = [
  "settings",
  "model",
  "tree",
  "thinking",
  "scoped-models",
  "export",
  "import",
  "share",
  "bug",
  "copy",
  "name",
  "session",
  "changelog",
  "hotkeys",
  "fork",
  "clone",
  "trust",
  "login",
  "logout",
  "new",
  "compact",
  "resume",
  "reload",
  "quit",
];

test("registers all 24 upstream built-in commands in upstream order", () => {
  assert.equal(BUILTIN_COMMANDS.length, 24);
  assert.deepEqual(
    BUILTIN_COMMANDS.map((command) => command.name),
    UPSTREAM_NAMES,
  );
  for (const command of BUILTIN_COMMANDS) {
    assert.equal(command.source, "builtin");
    assert.ok(command.description, `${command.name} 缺少中文描述`);
  }
  assert.deepEqual(Object.keys(SOURCE_LABELS).sort(), ["builtin", "extension", "prompt", "skill"]);
});

test("parseSlashInput extracts name and args for command shapes", () => {
  assert.deepEqual(parseSlashInput("/compact 把最近上下文总结一下"), {
    name: "compact",
    args: "把最近上下文总结一下",
    raw: "/compact 把最近上下文总结一下",
  });
  assert.deepEqual(parseSlashInput("/name 我的任务"), {
    name: "name",
    args: "我的任务",
    raw: "/name 我的任务",
  });
  assert.deepEqual(parseSlashInput("/model anthropic/claude-opus-4.5"), {
    name: "model",
    args: "anthropic/claude-opus-4.5",
    raw: "/model anthropic/claude-opus-4.5",
  });
  assert.deepEqual(parseSlashInput("/thinking high"), {
    name: "thinking",
    args: "high",
    raw: "/thinking high",
  });
  assert.deepEqual(parseSlashInput("/export report.html"), {
    name: "export",
    args: "report.html",
    raw: "/export report.html",
  });
  assert.deepEqual(parseSlashInput("/scoped-models"), {
    name: "scoped-models",
    args: "",
    raw: "/scoped-models",
  });
});

test("parseSlashInput rejects paths, plain prompts, multi-line and malformed tokens", () => {
  assert.equal(parseSlashInput("/etc/hosts"), null);
  assert.equal(parseSlashInput("/model\nfoo"), null);
  assert.equal(parseSlashInput("普通提示文本"), null);
  assert.equal(parseSlashInput("/"), null);
  assert.equal(parseSlashInput("/123abc"), null);
  assert.equal(parseSlashInput("/foo.bar"), null);
  assert.equal(parseSlashInput("  /model"), null);
});

test("mergeCommands puts built-ins first, keeps built-in priority and de-duplicates", () => {
  const rpcCommands = [
    { name: "review", description: "代码审查", source: "extension" },
    { name: "summarize", description: "总结会话", source: "prompt" },
    { name: "debug", description: "排查问题", source: "skill" },
    { name: "model", description: "不应覆盖内置", source: "extension" },
  ];
  const merged = mergeCommands(BUILTIN_COMMANDS, rpcCommands);
  assert.equal(merged.length, 27);
  assert.deepEqual(
    merged.slice(0, 24).map((command) => command.name),
    UPSTREAM_NAMES,
  );
  const builtinModel = merged.find((command) => command.name === "model");
  assert.equal(builtinModel.source, "builtin");
  assert.equal(builtinModel.description, "选择模型");
  const rpcNames = merged.slice(24).map((command) => command.name);
  assert.deepEqual(rpcNames, ["review", "summarize", "debug"]);
  assert.equal(merged.slice(24).every((command) => command.source !== "builtin"), true);
});

test("mergeCommands tolerates missing or malformed RPC entries", () => {
  const merged = mergeCommands(BUILTIN_COMMANDS, [null, { name: "" }, { source: "extension" }]);
  assert.equal(merged.length, 24);
});

test("filterCommands matches name or description and caps at 30", () => {
  const commands = [
    { name: "model", description: "选择模型" },
    { name: "tree", description: "查看会话树并切换分支" },
    { name: "share", description: "分享会话到 GitHub Gist" },
  ];
  assert.deepEqual(filterCommands(commands, "模型").map((command) => command.name), ["model"]);
  assert.deepEqual(filterCommands(commands, "会话").map((command) => command.name), ["tree", "share"]);
  assert.equal(filterCommands(commands, "").length, 3);
  assert.equal(filterCommands(commands, "不存在的词").length, 0);

  const many = Array.from({ length: 35 }, (_, index) => ({ name: `cmd-${index}`, description: "" }));
  assert.equal(filterCommands(many, "").length, 30);
});

test("resolveBuiltinAction routes every built-in command to a concrete action", () => {
  for (const name of UPSTREAM_NAMES) {
    const resolved = resolveBuiltinAction(name, "");
    assert.notEqual(resolved.action, "unknown", `${name} 不应返回 unknown`);
    assert.notEqual(resolved.action, "error", `${name} 无参不应返回 error`);
    assert.ok(resolved.payload && typeof resolved.payload === "object", `${name} 缺少 payload`);
  }
});

test("resolveBuiltinAction returns unknown for non-built-in names", () => {
  const resolved = resolveBuiltinAction("not-a-command", "");
  assert.equal(resolved.action, "unknown");
  assert.equal(resolved.payload.name, "not-a-command");
});

test("model action parses provider/model and rejects malformed input", () => {
  const valid = resolveBuiltinAction("model", "anthropic/claude-opus-4.5");
  assert.equal(valid.action, "setModel");
  assert.deepEqual(valid.payload, { provider: "anthropic", modelId: "claude-opus-4.5" });
  assert.equal(resolveBuiltinAction("model", "").action, "openModelMenu");
  assert.equal(resolveBuiltinAction("model", "anthropic ").action, "error");
  assert.equal(resolveBuiltinAction("model", "/model-id").action, "error");
  assert.equal(resolveBuiltinAction("model", "provider/").action, "error");
});

test("thinking action validates the level", () => {
  const valid = resolveBuiltinAction("thinking", "HIGH");
  assert.equal(valid.action, "setThinking");
  assert.equal(valid.payload.level, "high");
  assert.equal(resolveBuiltinAction("thinking", "").action, "openThinkingMenu");
  assert.equal(resolveBuiltinAction("thinking", "brainstorm").action, "error");
});

test("export action dispatches by extension and rejects other types", () => {
  assert.equal(resolveBuiltinAction("export", "").action, "exportHtml");
  const html = resolveBuiltinAction("export", "report.html");
  assert.equal(html.action, "exportHtml");
  assert.equal(html.payload.path, "report.html");
  const jsonl = resolveBuiltinAction("export", "session.jsonl");
  assert.equal(jsonl.action, "exportJsonl");
  assert.equal(jsonl.payload.path, "session.jsonl");
  const invalid = resolveBuiltinAction("export", "archive.zip");
  assert.equal(invalid.action, "error");
});

test("import action opens the picker without args and uses a path with args", () => {
  assert.equal(resolveBuiltinAction("import", "").action, "importSession");
  const withPath = resolveBuiltinAction("import", "session.jsonl");
  assert.equal(withPath.action, "importSessionPath");
  assert.equal(withPath.payload.path, "session.jsonl");
});

test("name action renames with args and opens the session panel without args", () => {
  const withName = resolveBuiltinAction("name", "重构后的任务");
  assert.equal(withName.action, "setSessionName");
  assert.equal(withName.payload.name, "重构后的任务");
  const empty = resolveBuiltinAction("name", "");
  assert.equal(empty.action, "openPanel");
  assert.equal(empty.payload.kind, "session");
});

test("login and logout open settings with a provider-aware toast", () => {
  const login = resolveBuiltinAction("login", "anthropic");
  assert.equal(login.action, "openPanel");
  assert.equal(login.payload.kind, "settings");
  assert.equal(login.payload.provider, "anthropic");
  assert.match(login.payload.toast, /anthropic/);
  const logout = resolveBuiltinAction("logout", "");
  assert.equal(logout.action, "openPanel");
  assert.equal(logout.payload.provider, "");
  assert.match(logout.payload.toast, /提供商/);
});

test("remaining commands map to their desktop entry points", () => {
  const cases = {
    settings: ["openPanel", { kind: "settings" }],
    tree: ["openPanel", { kind: "session" }],
    scopedModels: ["openModelScopeEditor", {}],
    share: ["shareSession", {}],
    bug: ["openBugReport", { description: "崩溃了" }],
    copy: ["copyLastAssistant", {}],
    session: ["openPanel", { kind: "status" }],
    changelog: ["showChangelog", {}],
    hotkeys: ["openShortcuts", {}],
    fork: ["openPanel", { kind: "session" }],
    clone: ["cloneSession", {}],
    trust: ["openPanel", { kind: "settings" }],
    new: ["newSession", {}],
    compact: ["compact", { instructions: "保留最近十轮" }],
    resume: ["openSessionList", {}],
    reload: ["reloadAgent", {}],
    quit: ["quitApp", {}],
  };
  const compact = resolveBuiltinAction("compact", "保留最近十轮");
  assert.equal(compact.action, cases.compact[0]);
  assert.equal(compact.payload.instructions, "保留最近十轮");
  for (const [name, [action, payload]] of Object.entries(cases)) {
    if (name === "compact") continue;
    const commandName = name === "scopedModels" ? "scoped-models" : name;
    const resolved = resolveBuiltinAction(commandName, name === "bug" ? "崩溃了" : "");
    assert.equal(resolved.action, action, commandName);
    for (const [key, value] of Object.entries(payload)) {
      assert.equal(resolved.payload[key], value, `${commandName}.${key}`);
    }
  }
});
