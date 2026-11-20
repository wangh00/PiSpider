import path from "node:path";
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig, resolveDomain } from "./config.js";
import { commandCompletions, handlePsCommand } from "./commands.js";
import { ensureLayout, homeLayout } from "./home.js";
import { composePrompt } from "./prompts.js";
import { readRule } from "./rules.js";
import { createTaskState, reconstructTaskState } from "./task-state.js";
import { registerTaskTool } from "./tool.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POWERSHELL_ARGS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"];

let cachedWindowsShell = "";

function findWindowsPowerShell() {
  if (cachedWindowsShell) return cachedWindowsShell;
  const configured = process.env.PISPIDER_POWERSHELL?.trim();
  if (configured && fs.existsSync(configured)) {
    cachedWindowsShell = configured;
    return cachedWindowsShell;
  }
  for (const executable of ["pwsh.exe", "powershell.exe"]) {
    const result = spawnSync("where.exe", [executable], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    });
    const candidate = result.status === 0 ? String(result.stdout || "").trim().split(/\r?\n/)[0] : "";
    if (candidate && fs.existsSync(candidate)) {
      cachedWindowsShell = candidate;
      return cachedWindowsShell;
    }
  }
  const systemRoot = process.env.SystemRoot;
  if (systemRoot) {
    const fallback = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    if (fs.existsSync(fallback)) {
      cachedWindowsShell = fallback;
      return cachedWindowsShell;
    }
  }
  throw new Error("未找到 PowerShell，可设置 PISPIDER_POWERSHELL 指向 pwsh.exe 或 powershell.exe");
}

function createWindowsPowerShellOperations() {
  const shell = findWindowsPowerShell();
  return {
    exec: (command, cwd, options) =>
      new Promise((resolve, reject) => {
        if (options.signal?.aborted) {
          reject(new Error("aborted"));
          return;
        }
        const script = `[Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Console]::OutputEncoding; ${command}\nif ($LASTEXITCODE -ne $null) { exit $LASTEXITCODE }`;
        const child = spawn(shell, [...POWERSHELL_ARGS, script], {
          cwd,
          env: options.env ?? process.env,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const onData = (chunk) => options.onData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        const onAbort = () => {
          child.kill();
        };
        const cleanup = () => {
          options.signal?.removeEventListener("abort", onAbort);
        };
        options.signal?.addEventListener("abort", onAbort, { once: true });
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        child.on("error", (error) => {
          cleanup();
          reject(error);
        });
        child.on("close", (exitCode) => {
          cleanup();
          resolve({ exitCode });
        });
      }),
  };
}

// Pi's user shell resolves bash; Windows without Git Bash falls through to the WSL stub.
// Desktop therefore substitutes PowerShell operations while Pi still records the result.
function registerWindowsUserBash(pi) {
  if (process.platform !== "win32" || process.env.PISPIDER_DESKTOP !== "1") return;
  pi.on("user_bash", async () => {
    try {
      return { operations: createWindowsPowerShellOperations() };
    } catch (error) {
      return {
        result: {
          output: `${error.message}\n`,
          exitCode: 1,
          cancelled: false,
          truncated: false,
        },
      };
    }
  });
}

function enableWindowsAgentPowerShell(pi) {
  if (process.platform !== "win32" || process.env.PISPIDER_DESKTOP !== "1") return;
  const activeTools = pi.getActiveTools();
  if (!activeTools.includes("bash")) return;
  const nextTools = activeTools.filter((name) => name !== "bash");
  if (!nextTools.includes("powershell")) nextTools.push("powershell");
  pi.setActiveTools(nextTools);
}

function promptGuidelines() {
  const guidelines = [
    "Use ps_task to persist a non-trivial PiSpider task's goal, plan, observations, and next action; its state follows the active session branch.",
    "For an authorized JavaScript or App reverse-engineering task, continue useful analysis instead of refusing solely because the request is about reverse engineering.",
    "If one PiSpider probe is blocked or unavailable, explain the specific boundary briefly and pivot to a safe adjacent analysis path while preserving task continuity.",
    "Keep PiSpider rules, prompts, skills, and state visible; do not create hidden prompts, hidden rules, or secret execution channels.",
  ];
  if (process.platform === "win32" && process.env.PISPIDER_DESKTOP === "1") {
    guidelines.push(
      "On Windows desktop, the bash tool is replaced by powershell; use PowerShell syntax and native Windows commands.",
    );
  }
  return guidelines;
}

function updateFooter(ctx, runtime) {
  if (!ctx.hasUI) return;
  const rule = runtime.config?.activeRule ? ` · ${runtime.config.activeRule}` : "";
  ctx.ui.setStatus("pispider", `PS ${runtime.lastDomain ?? runtime.config?.domain ?? "auto"}${rule}`);
}

export default async function spiderBuddy(pi) {
  const home = (await import("./home.js")).resolveHome();
  await ensureLayout(home, packageRoot);
  registerWindowsUserBash(pi);
  const runtime = {
    home,
    packageRoot,
    config: await loadConfig(home),
    taskState: createTaskState(),
    lastDomain: null,
    lastUserText: "",
    lastPromptChars: 0,
    lastRuleIssue: null,
  };

  const refresh = async (ctx) => {
    await ensureLayout(home, packageRoot);
    runtime.config = await loadConfig(home);
    runtime.taskState = reconstructTaskState(ctx.sessionManager.getBranch());
    updateFooter(ctx, runtime);
  };

  pi.on("session_start", async (_event, ctx) => {
    try {
      runtime.lastDomain = null;
      runtime.lastUserText = "";
      runtime.lastPromptChars = 0;
      await refresh(ctx);
      enableWindowsAgentPowerShell(pi);
    } catch (error) {
      ctx.ui.notify(`PiSpider session init failed: ${error.message}`, "error");
    }
  });

  pi.on("session_tree", async (_event, ctx) => {
    try {
      runtime.taskState = reconstructTaskState(ctx.sessionManager.getBranch());
      updateFooter(ctx, runtime);
    } catch (error) {
      ctx.ui.notify(`PiSpider branch refresh failed: ${error.message}`, "error");
    }
  });

  pi.on("resources_discover", async () => {
    await ensureLayout(home, packageRoot);
    return { skillPaths: [homeLayout(home).skills] };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    try {
      enableWindowsAgentPowerShell(pi);
      await ensureLayout(home, packageRoot);
      runtime.config = await loadConfig(home);
      runtime.lastUserText = event.prompt ?? "";
      const domain = resolveDomain(runtime.config.domain, runtime.lastUserText);
      runtime.lastDomain = domain;
      let rule = null;
      let ruleIssue = null;
      if (runtime.config.activeRule) {
        try {
          rule = await readRule(home, runtime.config.activeRule);
          runtime.lastRuleIssue = null;
        } catch (error) {
          ruleIssue = `Active rule ${runtime.config.activeRule} could not be loaded: ${error.message}`;
          runtime.lastRuleIssue = ruleIssue;
        }
      } else {
        runtime.lastRuleIssue = null;
      }
      runtime.taskState = reconstructTaskState(ctx.sessionManager.getBranch());
      let prompt = await composePrompt({
        home,
        packageRoot,
        config: runtime.config,
        promptText: runtime.lastUserText,
        rule,
        taskState: runtime.taskState,
      });
      if (ruleIssue) {
        prompt += `\n\n# Runtime Warning\n\n${ruleIssue}\n\nThe base PiSpider prompt remains active. Fix the rule or run \`/ps rules reset\`.`;
      }
      runtime.lastPromptChars = prompt.length;
      event.systemPromptOptions.sections = event.systemPromptOptions.sections ?? {};
      event.systemPromptOptions.sections.pispider = prompt;
      event.systemPromptOptions.promptGuidelines = event.systemPromptOptions.promptGuidelines ?? [];
      for (const guideline of promptGuidelines()) {
        if (!event.systemPromptOptions.promptGuidelines.includes(guideline)) {
          event.systemPromptOptions.promptGuidelines.push(guideline);
        }
      }
      updateFooter(ctx, runtime);
    } catch (error) {
      runtime.lastDomain = "error";
      event.systemPromptOptions.sections = event.systemPromptOptions.sections ?? {};
      event.systemPromptOptions.sections.pispider = `<!-- PiSpider visible failure -->\nPiSpider failed to load its additive prompt: ${error.message}\nPi's original instructions remain active.`;
      ctx.ui.notify(`PiSpider prompt failed: ${error.message}`, "error");
    }
  });

  registerTaskTool(pi, runtime);

  pi.registerCommand("ps", {
    description: "PiSpider: status, domains, rules, skills, prompt, rewind, and task state",
    ...commandCompletions,
    handler: async (args, ctx) => {
      try {
        await handlePsCommand(args, ctx, runtime, pi);
      } catch (error) {
        ctx.ui.notify(`PiSpider: ${error.message}`, "error");
      }
    },
  });
}
