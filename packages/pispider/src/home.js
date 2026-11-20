import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const VERSION = "0.1.0";
export const DEFAULT_PROMPT_NAMES = ["core", "workflow", "js", "app"];

export function resolveHome(env = process.env) {
  const configured = String(env.PISPIDER_HOME ?? "").trim();
  if (configured) return path.resolve(configured);
  return path.join(os.homedir(), ".pispider");
}

export function resolveAgentDir(home, env = process.env) {
  const configured = String(env.PISPIDER_AGENT_DIR ?? "").trim();
  if (configured) return path.resolve(configured);
  return homeLayout(home).agent;
}

export function resolveSessionDir(home, env = process.env) {
  const configured = String(env.PISPIDER_SESSION_DIR ?? "").trim();
  if (configured) return path.resolve(configured);
  return path.join(resolveAgentDir(home, env), "sessions");
}

export function resolveComputerUseHelperPaths(agentDir) {
  const root = path.join(path.resolve(agentDir), "helpers", "pi-computer-use");
  return {
    root,
    windows: path.join(root, "windows-bridge.exe"),
    linux: path.join(root, "linux-bridge"),
  };
}

export function isComputerUseEnabled(env = process.env) {
  const value = String(env.PISPIDER_COMPUTER_USE ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on", "enabled"].includes(value);
}

export function buildAgentEnvironment(home, env = process.env) {
  const agentDir = resolveAgentDir(home, env);
  const sessionDir = resolveSessionDir(home, env);
  const helperPaths = resolveComputerUseHelperPaths(agentDir);
  const childEnv = {
    ...env,
    PI_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_SESSION_DIR: sessionDir,
  };
  if (!childEnv.PI_COMPUTER_USE_WINDOWS_HELPER_PATH) {
    childEnv.PI_COMPUTER_USE_WINDOWS_HELPER_PATH = helperPaths.windows;
  }
  if (!childEnv.PI_COMPUTER_USE_LINUX_HELPER_PATH) {
    childEnv.PI_COMPUTER_USE_LINUX_HELPER_PATH = helperPaths.linux;
  }
  delete childEnv.PI_PACKAGE_DIR;
  return childEnv;
}

export function homeLayout(home) {
  const root = path.resolve(home);
  const agent = path.join(root, "agent");
  return {
    root,
    config: path.join(root, "config.json"),
    prompts: path.join(root, "prompts"),
    rules: path.join(root, "rules"),
    skills: path.join(root, "skills"),
    backups: path.join(root, "backups"),
    state: path.join(root, "state"),
    agent,
    sessions: path.join(agent, "sessions"),
    promptFile: (name) => path.join(root, "prompts", `${name}.md`),
    ruleDir: (id) => path.join(root, "rules", id),
    skillDir: (id) => path.join(root, "skills", id),
  };
}

export function packagePaths(packageRoot) {
  return {
    root: path.resolve(packageRoot),
    prompts: path.join(packageRoot, "resources", "prompts"),
  };
}

export async function ensureLayout(home, packageRoot, env = process.env) {
  const layout = homeLayout(home);
  const pkg = packagePaths(packageRoot);
  const agentDir = resolveAgentDir(home, env);
  const sessionDir = resolveSessionDir(home, env);
  await Promise.all([
    mkdir(layout.root, { recursive: true }),
    mkdir(layout.prompts, { recursive: true }),
    mkdir(layout.rules, { recursive: true }),
    mkdir(layout.skills, { recursive: true }),
    mkdir(layout.backups, { recursive: true }),
    mkdir(layout.state, { recursive: true }),
    mkdir(agentDir, { recursive: true }),
    mkdir(sessionDir, { recursive: true }),
  ]);

  for (const name of DEFAULT_PROMPT_NAMES) {
    const target = layout.promptFile(name);
    try {
      await stat(target);
    } catch {
      const source = path.join(pkg.prompts, `${name}.md`);
      const content = await readFile(source, "utf8");
      await writeFile(target, content, "utf8");
    }
  }

  return layout;
}
