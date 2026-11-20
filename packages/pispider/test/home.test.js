import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadConfig, resolveDomain } from "../src/config.js";
import { buildAgentEnvironment, ensureLayout, homeLayout, isComputerUseEnabled, resolveAgentDir, resolveHome, resolveSessionDir } from "../src/home.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function tempHome(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pispider-home-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("resolveHome honors PISPIDER_HOME and has a cross-platform fallback", () => {
  assert.equal(resolveHome({ PISPIDER_HOME: "C:\\tmp\\sb" }), path.resolve("C:\\tmp\\sb"));
  assert.match(resolveHome({}), /\.pispider$/);
});

test("agent and session directories default under PISPIDER_HOME", async (t) => {
  const home = await tempHome(t);
  const layout = homeLayout(home);
  assert.equal(layout.agent, path.join(home, "agent"));
  assert.equal(layout.sessions, path.join(home, "agent", "sessions"));
  assert.equal(resolveAgentDir(home, {}), layout.agent);
  assert.equal(resolveSessionDir(home, {}), layout.sessions);
  await ensureLayout(home, packageRoot);
  assert.ok((await stat(layout.agent)).isDirectory());
  assert.ok((await stat(layout.sessions)).isDirectory());
});

test("buildAgentEnvironment isolates Pi data and removes inherited Pi package paths", () => {
  const home = path.resolve(path.sep, "data", "pispider");
  const env = buildAgentEnvironment(home, {
    PI_CODING_AGENT_DIR: path.join(path.sep, "legacy", ".pi", "agent"),
    PI_CODING_AGENT_SESSION_DIR: path.join(path.sep, "legacy", ".pi", "agent", "sessions"),
    PI_PACKAGE_DIR: path.join(path.sep, "legacy", ".pi", "package"),
  });
  assert.equal(env.PI_CODING_AGENT_DIR, path.join(home, "agent"));
  assert.equal(env.PI_CODING_AGENT_SESSION_DIR, path.join(home, "agent", "sessions"));
  assert.equal(env.PI_PACKAGE_DIR, undefined);
});

test("buildAgentEnvironment honors PiSpider path overrides", () => {
  const home = path.resolve(path.sep, "data", "pispider");
  const env = buildAgentEnvironment(home, {
    PISPIDER_AGENT_DIR: "C:\\data\\pispider-agent",
    PISPIDER_SESSION_DIR: "C:\\data\\pispider-sessions",
  });
  assert.equal(env.PI_CODING_AGENT_DIR, path.resolve("C:\\data\\pispider-agent"));
  assert.equal(env.PI_CODING_AGENT_SESSION_DIR, path.resolve("C:\\data\\pispider-sessions"));
});

test("buildAgentEnvironment places computer-use helpers under the PiSpider agent directory", () => {
  const home = path.resolve(path.sep, "data", "pispider");
  const env = buildAgentEnvironment(home, {});
  const helperRoot = path.join(home, "agent", "helpers", "pi-computer-use");
  assert.equal(env.PI_COMPUTER_USE_WINDOWS_HELPER_PATH, path.join(helperRoot, "windows-bridge.exe"));
  assert.equal(env.PI_COMPUTER_USE_LINUX_HELPER_PATH, path.join(helperRoot, "linux-bridge"));
  assert.equal(env.PI_CODING_AGENT_DIR, path.join(home, "agent"));
});

test("buildAgentEnvironment preserves explicit computer-use helper paths", () => {
  const home = path.resolve(path.sep, "data", "pispider");
  const env = buildAgentEnvironment(home, {
    PI_COMPUTER_USE_WINDOWS_HELPER_PATH: "C:\\tools\\windows-bridge.exe",
    PI_COMPUTER_USE_LINUX_HELPER_PATH: "/opt/tools/linux-bridge",
  });
  assert.equal(env.PI_COMPUTER_USE_WINDOWS_HELPER_PATH, "C:\\tools\\windows-bridge.exe");
  assert.equal(env.PI_COMPUTER_USE_LINUX_HELPER_PATH, "/opt/tools/linux-bridge");
});

test("isComputerUseEnabled accepts explicit truthy values only", () => {
  assert.equal(isComputerUseEnabled({}), false);
  assert.equal(isComputerUseEnabled({ PISPIDER_COMPUTER_USE: "0" }), false);
  assert.equal(isComputerUseEnabled({ PISPIDER_COMPUTER_USE: "false" }), false);
  assert.equal(isComputerUseEnabled({ PISPIDER_COMPUTER_USE: "1" }), true);
  assert.equal(isComputerUseEnabled({ PISPIDER_COMPUTER_USE: "yes" }), true);
});

test("ensureLayout copies visible prompt defaults without overwriting existing edits", async (t) => {
  const home = await tempHome(t);
  await ensureLayout(home, packageRoot);
  const layout = homeLayout(home);
  for (const name of ["core", "workflow", "js", "app"]) {
    assert.ok((await stat(layout.promptFile(name))).isFile());
  }
  const file = layout.promptFile("js");
  const original = await readFile(file, "utf8");
  assert.match(original, /JavaScript Reverse-Engineering Domain/i);
  const edited = `${original}\n\nUSER EDIT\n`;
  const { writeFile } = await import("node:fs/promises");
  await writeFile(file, edited, "utf8");
  await ensureLayout(home, packageRoot);
  assert.match(await readFile(file, "utf8"), /USER EDIT/);
});

test("config defaults are persisted and normalized", async (t) => {
  const home = await tempHome(t);
  await ensureLayout(home, packageRoot);
  const config = await loadConfig(home);
  assert.equal(config.domain, "auto");
  assert.equal(config.activeRule, null);
  assert.match(await readFile(homeLayout(home).config, "utf8"), /"domain": "auto"/);
});

test("domain inference distinguishes JS, App, and general prompts", () => {
  assert.equal(resolveDomain("auto", "analyze this webpack bundle and sourcemap"), "js");
  assert.equal(resolveDomain("auto", "check the Android APK and dex layout"), "app");
  assert.equal(resolveDomain("auto", "分析这个 app 的登录流程"), "app");
  assert.equal(resolveDomain("auto", "summarize this document"), "general");
  assert.equal(resolveDomain("js", "an Android APK is attached"), "js");
  assert.equal(resolveDomain("app", "analyze a browser bundle"), "app");
});
