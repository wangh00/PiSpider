import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig, setActiveRule } from "../src/config.js";
import spiderBuddy from "../src/index.js";

function createHarness() {
  const handlers = new Map();
  const commands = new Map();
  const tools = new Map();
  const entries = [];
  const pi = {
    on(name, handler) {
      handlers.set(name, handler);
    },
    registerCommand(name, options) {
      commands.set(name, options);
    },
    registerTool(definition) {
      tools.set(definition.name, definition);
    },
    appendEntry(customType, data) {
      entries.push({ customType, data });
    },
  };
  return { pi, handlers, commands, tools, entries };
}

function createContext({ branch = [], editor = null, fork = null } = {}) {
  const uiEvents = [];
  const labelChanges = [];
  const ctx = {
    hasUI: true,
    cwd: process.cwd(),
    mode: "tui",
    sessionManager: {
      getBranch: () => branch,
      appendLabelChange(targetId, label) {
        labelChanges.push({ targetId, label });
      },
    },
    ui: {
      notify(message, level) {
        uiEvents.push({ kind: "notify", message, level });
      },
      setStatus(id, text) {
        uiEvents.push({ kind: "status", id, text });
      },
      async editor(title, value) {
        uiEvents.push({ kind: "editor", title, value });
        return editor ?? value;
      },
      async confirm() {
        return true;
      },
      async input() {
        return "";
      },
    },
    async waitForIdle() {},
    async reload() {
      uiEvents.push({ kind: "reload" });
    },
    async fork(entryId, options) {
      if (fork) fork(entryId, options);
    },
  };
  return { ctx, uiEvents, labelChanges };
}

test("extension registers commands, task tool, prompt section, and skill path", async (t) => {
  const previous = process.env.PISPIDER_HOME;
  const home = await mkdtemp(path.join(os.tmpdir(), "pispider-integration-"));
  process.env.PISPIDER_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.PISPIDER_HOME;
    else process.env.PISPIDER_HOME = previous;
    await rm(home, { recursive: true, force: true });
  });

  const { pi, handlers, commands, tools } = createHarness();
  await spiderBuddy(pi);
  assert.ok(commands.has("ps"));
  assert.ok(tools.has("ps_task"));
  assert.ok(handlers.has("before_agent_start"));
  assert.ok(handlers.has("resources_discover"));

  const discovered = await handlers.get("resources_discover")({ reason: "startup", cwd: home });
  assert.deepEqual(discovered.skillPaths, [path.join(home, "skills")]);

  const { ctx } = createContext();
  await handlers.get("session_start")({ reason: "startup" }, ctx);
  assert.equal((await loadConfig(home)).domain, "auto");

  const event = { prompt: "trace a webpack bundle and its sourcemap", systemPromptOptions: { sections: {}, promptGuidelines: [] } };
  await handlers.get("before_agent_start")(event, ctx);
  assert.match(event.systemPromptOptions.sections.pispider, /JavaScript Reverse-Engineering Domain/);
  assert.ok(event.systemPromptOptions.promptGuidelines.some((line) => line.includes("authorized")));
  assert.ok(event.systemPromptOptions.promptGuidelines.some((line) => line.includes("do not create hidden prompts")));
});

test("commands update config, render status, persist task reset, and invoke fork rewind", async (t) => {
  const previous = process.env.PISPIDER_HOME;
  const home = await mkdtemp(path.join(os.tmpdir(), "pispider-command-"));
  process.env.PISPIDER_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.PISPIDER_HOME;
    else process.env.PISPIDER_HOME = previous;
    await rm(home, { recursive: true, force: true });
  });

  const { pi, handlers, commands, tools, entries } = createHarness();
  await spiderBuddy(pi);
  const { ctx, uiEvents } = createContext();

  await commands.get("ps").handler("domain js", ctx);
  assert.equal((await loadConfig(home)).domain, "js");

  await commands.get("ps").handler("status", ctx);
  const editor = uiEvents.find((entry) => entry.kind === "editor");
  assert.match(editor.value, /Configured domain: js/);
  assert.match(editor.value, /Rules: 0/);

  const taskTool = tools.get("ps_task");
  const plan = await taskTool.execute("call-1", { action: "plan", goal: "Map signer", scope: "Owned demo", steps: ["Capture", "Locate"] }, null, null, ctx);
  assert.equal(plan.details.pispiderTask.stage, "plan");
  assert.match(plan.content[0].text, /Map signer/);

  const reroute = await taskTool.execute(
    "call-2",
    { action: "reroute", boundary: "Endpoint requires a tenant we do not own", fallbacks: ["Trace call sites"], nextAction: "Trace callers" },
    null,
    null,
    ctx,
  );
  assert.equal(reroute.details.pispiderTask.stage, "execute");
  assert.match(reroute.content[0].text, /Boundary: Endpoint requires/);

  await commands.get("ps").handler("task reset", ctx);
  assert.equal(entries.at(-1).customType, "pispider-task-reset");

  let forkTarget = null;
  const branch = [
    { id: "u1", type: "message", timestamp: "t1", message: { role: "user", content: "first" } },
    { id: "a1", type: "message", timestamp: "t2", message: { role: "assistant", content: [] } },
    { id: "u2", type: "message", timestamp: "t3", message: { role: "user", content: "second" } },
  ];
  const rewindContext = createContext({ branch, fork: (id, options) => (forkTarget = { id, options }) }).ctx;
  await commands.get("ps").handler("rewind once", rewindContext);
  assert.equal(forkTarget.id, "u2");
  assert.equal(forkTarget.options.position, "before");

  await commands.get("ps").handler("rewind round", rewindContext);
  assert.equal(forkTarget.id, "u1");

  const labelCtxState = createContext();
  await commands.get("ps").handler('label u1 "first node"', labelCtxState.ctx);
  assert.deepEqual(labelCtxState.labelChanges, [{ targetId: "u1", label: "first node" }]);
  await commands.get("ps").handler('label u1 ""', labelCtxState.ctx);
  assert.deepEqual(labelCtxState.labelChanges.at(-1), { targetId: "u1", label: undefined });
});

test("prompt injection keeps the existing Pi sections intact", async (t) => {
  const previous = process.env.PISPIDER_HOME;
  const home = await mkdtemp(path.join(os.tmpdir(), "pispider-sections-"));
  process.env.PISPIDER_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.PISPIDER_HOME;
    else process.env.PISPIDER_HOME = previous;
    await rm(home, { recursive: true, force: true });
  });

  const { pi, handlers } = createHarness();
  await spiderBuddy(pi);
  const { ctx } = createContext();
  const event = {
    prompt: "android apk analysis",
    systemPromptOptions: {
      sections: { preamble: "PI ORIGINAL", rules: "<rules>keep me</rules>" },
      promptGuidelines: ["Existing guideline"],
    },
  };
  await handlers.get("before_agent_start")(event, ctx);
  assert.equal(event.systemPromptOptions.sections.preamble, "PI ORIGINAL");
  assert.equal(event.systemPromptOptions.sections.rules, "<rules>keep me</rules>");
  assert.match(event.systemPromptOptions.sections.pispider, /App Reverse-Engineering Domain/);
  assert.equal(event.systemPromptOptions.promptGuidelines[0], "Existing guideline");
});

test("a broken active rule degrades visibly without replacing the base prompt", async (t) => {
  const previous = process.env.PISPIDER_HOME;
  const home = await mkdtemp(path.join(os.tmpdir(), "pispider-broken-rule-"));
  process.env.PISPIDER_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.PISPIDER_HOME;
    else process.env.PISPIDER_HOME = previous;
    await rm(home, { recursive: true, force: true });
  });

  const { pi, handlers } = createHarness();
  await spiderBuddy(pi);
  await setActiveRule(home, "missing-rule");
  const { ctx } = createContext();
  const event = { prompt: "trace a browser bundle", systemPromptOptions: { sections: {}, promptGuidelines: [] } };
  await handlers.get("before_agent_start")(event, ctx);
  assert.match(event.systemPromptOptions.sections.pispider, /PiSpider Core/);
  assert.match(event.systemPromptOptions.sections.pispider, /Runtime Warning/);
  assert.match(event.systemPromptOptions.sections.pispider, /missing-rule/);
  assert.doesNotMatch(event.systemPromptOptions.sections.pispider, /failed to load its additive prompt/i);
});
