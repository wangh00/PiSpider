import path from "node:path";
import { loadConfig, setActiveRule, setDomain, DOMAINS } from "./config.js";
import { homeLayout } from "./home.js";
import { composePrompt, inspectPromptFiles, resetPromptComponents } from "./prompts.js";
import { performRewind } from "./rewind.js";
import { createRule, deleteRule, formatRuleList, listRules, readRule, resetRule, updateRule } from "./rules.js";
import { createSkill, deleteSkill, formatSkillList, importSkill, listSkills } from "./skills.js";
import { createTaskState, reconstructTaskState, taskStateText } from "./task-state.js";
import { oneLine, splitArgs } from "./util.js";

const HELP = `PiSpider commands

/ps status                     Show domain, rule, prompt, skill, and task state
/ps domain [auto|js|app]       Show or set the domain mode
/ps rules list                 List rules
/ps rules use <id>             Activate a rule
/ps rules create <id> [name]   Create a visible rule
/ps rules edit <id>            Edit RULE.md in the editor
/ps rules delete <id>          Back up and remove a rule
/ps rules reset [id]           Clear active rule, or reset a rule body
/ps skills list                List PiSpider skills
/ps skills import <path> [id]  Import a safe local skill directory
/ps skills create <id> [desc]  Create a new skill
/ps skills delete <id>         Back up and remove a skill
/ps prompt show                Show the exact additive prompt
/ps prompt reset [names]       Restore core/workflow/js/app prompt defaults
/ps prompt files               Show prompt file paths and sizes
/ps rewind [once|round]        Fork to the last user turn or one round back
/ps label <entryId> <label>    Set or clear a session tree label
/ps task [status|reset]        Show or reset branch-aware task state
/ps reload                     Reload Pi resources after Skill changes
/ps help                       Show this help`;

async function showLong(ctx, title, text) {
  const content = text || "(empty)";
  if (ctx.hasUI) {
    await ctx.ui.editor(`${title} — close without saving; this view is informational`, content);
    return;
  }
  ctx.ui.notify(content, "info");
}

function requireArg(value, usage) {
  if (!value) throw new Error(`Missing argument. Usage: ${usage}`);
  return value;
}

async function loadActiveRule(runtime) {
  const config = await loadConfig(runtime.home);
  if (!config.activeRule) return { config, rule: null, ruleError: null };
  try {
    return { config, rule: await readRule(runtime.home, config.activeRule), ruleError: null };
  } catch (error) {
    return { config, rule: null, ruleError: error.message };
  }
}

export async function handlePsCommand(rawArgs, ctx, runtime, pi) {
  const parts = splitArgs(rawArgs);
  const command = parts[0] ?? "status";

  if (command === "help") {
    await showLong(ctx, "PiSpider help", HELP);
    return;
  }

  if (command === "status") {
    await statusCommand(ctx, runtime);
    return;
  }

  if (command === "domain") {
    const requested = parts[1];
    if (!requested) {
      const config = await loadConfig(runtime.home);
      ctx.ui.notify(`Domain mode: ${config.domain}${runtime.lastDomain ? `; last effective: ${runtime.lastDomain}` : ""}`, "info");
      return;
    }
    if (!DOMAINS.includes(requested)) throw new Error(`domain must be one of: ${DOMAINS.join(", ")}`);
    await setDomain(runtime.home, requested);
    runtime.config = await loadConfig(runtime.home);
    ctx.ui.notify(`Domain mode set to ${requested}. Applies from the next turn.`, "info");
    return;
  }

  if (command === "rules") {
    await rulesCommand(parts.slice(1), ctx, runtime);
    return;
  }

  if (command === "skills") {
    await skillsCommand(parts.slice(1), ctx, runtime);
    return;
  }

  if (command === "prompt") {
    await promptCommand(parts.slice(1), ctx, runtime);
    return;
  }

  if (command === "label") {
    const targetId = requireArg(parts[1], "/ps label <entryId> <label>");
    if (!ctx.sessionManager || typeof ctx.sessionManager.appendLabelChange !== "function") {
      throw new Error("当前会话不支持标签写入");
    }
    const marker = ` ${targetId}`;
    const at = rawArgs.indexOf(marker);
    let label = at >= 0 ? rawArgs.slice(at + marker.length).trim() : "";
    if (label.startsWith('"') && label.endsWith('"')) {
      try {
        label = JSON.parse(label);
      } catch {
        label = label.slice(1, -1);
      }
    }
    if (typeof label !== "string") label = "";
    ctx.sessionManager.appendLabelChange(targetId, label || undefined);
    ctx.ui.notify(label ? `已标记 ${targetId}：${label}` : `已清除 ${targetId} 的标记`, "info");
    return;
  }

  if (command === "rewind") {
    await performRewind(parts[1] ?? "once", ctx);
    return;
  }

  if (command === "task") {
    await taskCommand(parts.slice(1), ctx, runtime, pi);
    return;
  }

  if (command === "reload") {
    ctx.ui.notify("Reloading Pi resources...", "info");
    await ctx.reload();
    return;
  }

  throw new Error(`Unknown PiSpider command: ${command}. Run /ps help.`);
}

async function statusCommand(ctx, runtime) {
  const config = await loadConfig(runtime.home);
  runtime.config = config;
  const rules = await listRules(runtime.home, config.activeRule);
  const skills = await listSkills(runtime.home);
  const prompts = await inspectPromptFiles(runtime.home);
  const task = reconstructTaskState(ctx.sessionManager.getBranch());
  runtime.taskState = task;
  const layout = homeLayout(runtime.home);
  const activeRule = config.activeRule ? rules.find((rule) => rule.id === config.activeRule) : null;
  const lines = [
    "PiSpider 0.1.0",
    `Home: ${layout.root}`,
    `Configured domain: ${config.domain}`,
    `Effective domain: ${runtime.lastDomain ?? "(no agent turn yet)"}`,
    `Active rule: ${config.activeRule ?? "none"}${activeRule && !activeRule.valid ? " [invalid]" : ""}`,
    `Rules: ${rules.length} (${rules.filter((rule) => rule.valid).length} valid)`,
    `Skills: ${skills.length} (${skills.filter((skill) => skill.valid).length} valid)`,
    `Prompt files: ${prompts.reduce((sum, file) => sum + file.bytes, 0)} bytes across ${prompts.length} files`,
    `Last injected prompt section: ${runtime.lastPromptChars ?? 0} chars`,
    `Task stage: ${task.stage}${task.nextAction ? ` — next: ${oneLine(task.nextAction, 100)}` : ""}`,
    `Session entries on active branch: ${ctx.sessionManager.getBranch().length}`,
  ];
  if (runtime.lastRuleIssue) lines.push(`Rule warning: ${runtime.lastRuleIssue}`);
  await showLong(ctx, "PiSpider status", lines.join("\n"));
}

async function rulesCommand(args, ctx, runtime) {
  const action = args[0] ?? "list";
  const config = await loadConfig(runtime.home);

  if (action === "list") {
    const rules = await listRules(runtime.home, config.activeRule);
    await showLong(ctx, "PiSpider rules", formatRuleList(rules, config.activeRule));
    return;
  }
  if (action === "use") {
    const id = requireArg(args[1], "/ps rules use <id>");
    await readRule(runtime.home, id);
    runtime.config = await setActiveRule(runtime.home, id);
    ctx.ui.notify(`Active rule: ${id}. Applies from the next turn.`, "info");
    return;
  }
  if (action === "create") {
    const id = requireArg(args[1], "/ps rules create <id> [name]");
    const name = args.slice(2).join(" ") || id;
    const rule = await createRule(runtime.home, { id, name });
    ctx.ui.notify(`Created rule ${rule.id} at ${rule.path}`, "info");
    return;
  }
  if (action === "edit") {
    const id = requireArg(args[1], "/ps rules edit <id>");
    if (!ctx.hasUI) throw new Error("Editing a rule requires an interactive UI");
    const rule = await readRule(runtime.home, id);
    const next = await ctx.ui.editor(`Edit PiSpider rule: ${id}`, rule.raw);
    if (next === undefined || next === null || next === rule.raw) return;
    await updateRule(runtime.home, id, next);
    ctx.ui.notify(`Updated rule ${id}. Applies from the next turn.`, "info");
    return;
  }
  if (action === "delete") {
    const id = requireArg(args[1], "/ps rules delete <id>");
    if (!ctx.hasUI) throw new Error("Deleting a rule requires confirmation in an interactive UI");
    const ok = await ctx.ui.confirm("Delete PiSpider rule?", `Rule ${id} will be moved to backups first.`);
    if (!ok) return;
    const backup = await deleteRule(runtime.home, id);
    if (config.activeRule === id) runtime.config = await setActiveRule(runtime.home, null);
    ctx.ui.notify(`Deleted rule ${id}; backup: ${backup}`, "info");
    return;
  }
  if (action === "reset") {
    const id = args[1];
    if (id) {
      const rule = await resetRule(runtime.home, id);
      ctx.ui.notify(`Reset rule body: ${rule.id}. Applies from the next turn.`, "info");
      return;
    }
    runtime.config = await setActiveRule(runtime.home, null);
    ctx.ui.notify("Active rule cleared.", "info");
    return;
  }
  throw new Error(`Unknown rules action: ${action}. Run /ps help.`);
}

async function skillsCommand(args, ctx, runtime) {
  const action = args[0] ?? "list";

  if (action === "list") {
    const skills = await listSkills(runtime.home);
    await showLong(ctx, "PiSpider skills", formatSkillList(skills));
    return;
  }
  if (action === "import") {
    let source = args[1];
    if (!source) {
      if (!ctx.hasUI) throw new Error("Usage: /ps skills import <path> [id]");
      source = await ctx.ui.input("Skill directory to import:", "Absolute or project-relative path");
      if (!source) return;
    }
    const id = args[2];
    const resolved = path.resolve(ctx.cwd, source);
    const result = await importSkill(runtime.home, resolved, id);
    ctx.ui.notify(
      `Imported skill ${result.id}: ${result.files} files, ${(result.totalBytes / 1024).toFixed(1)} KiB. Run /ps reload to expose it to Pi.`,
      "info",
    );
    return;
  }
  if (action === "create") {
    const id = requireArg(args[1], "/ps skills create <id> [description]");
    const description = args.slice(2).join(" ") || "Describe what this skill does and when to use it.";
    const skill = await createSkill(runtime.home, { id, description });
    ctx.ui.notify(`Created skill ${id} with ${skill.files} file(s). Run /ps reload.`, "info");
    return;
  }
  if (action === "delete") {
    const id = requireArg(args[1], "/ps skills delete <id>");
    if (!ctx.hasUI) throw new Error("Deleting a skill requires confirmation in an interactive UI");
    const ok = await ctx.ui.confirm("Delete PiSpider skill?", `Skill ${id} will be moved to backups first.`);
    if (!ok) return;
    const backup = await deleteSkill(runtime.home, id);
    ctx.ui.notify(`Deleted skill ${id}; backup: ${backup}. Run /ps reload.`, "info");
    return;
  }
  throw new Error(`Unknown skills action: ${action}. Run /ps help.`);
}

async function promptCommand(args, ctx, runtime) {
  const action = args[0] ?? "show";

  if (action === "show") {
    const { config, rule, ruleError } = await loadActiveRule(runtime);
    if (ruleError) throw new Error(`Active rule cannot be loaded: ${ruleError}`);
    const prompt = await composePrompt({
      home: runtime.home,
      packageRoot: runtime.packageRoot,
      config,
      promptText: runtime.lastUserText ?? "",
      rule,
      taskState: runtime.taskState,
    });
    await showLong(ctx, "PiSpider additive system prompt", prompt);
    return;
  }
  if (action === "path") {
    ctx.ui.notify(homeLayout(runtime.home).prompts, "info");
    return;
  }
  if (action === "files") {
    const files = await inspectPromptFiles(runtime.home);
    await showLong(
      ctx,
      "PiSpider prompt files",
      files.map((file) => `${file.name}: ${file.bytes} bytes\n  ${file.path}`).join("\n\n"),
    );
    return;
  }
  if (action === "reset") {
    if (ctx.hasUI) {
      const ok = await ctx.ui.confirm("Restore PiSpider prompt defaults?", "The selected prompt files will be overwritten.");
      if (!ok) return;
    }
    const names = args.slice(1).flatMap((name) => name.split(",")).filter(Boolean);
    const reset = await resetPromptComponents(runtime.home, runtime.packageRoot, names.length ? names : undefined);
    ctx.ui.notify(`Restored prompt defaults: ${reset.join(", ")}. Applies from the next turn.`, "info");
    return;
  }
  throw new Error(`Unknown prompt action: ${action}. Run /ps help.`);
}

async function taskCommand(args, ctx, runtime, pi) {
  const action = args[0] ?? "status";
  const current = reconstructTaskState(ctx.sessionManager.getBranch());
  runtime.taskState = current;

  if (action === "status") {
    await showLong(ctx, "PiSpider task state", taskStateText(current));
    return;
  }
  if (action === "reset") {
    const force = args.includes("--yes");
    if (ctx.hasUI && !force) {
      const ok = await ctx.ui.confirm("Reset PiSpider task state?", "Earlier task entries stay in the session tree and can be revisited.");
      if (!ok) return;
    }
    pi.appendEntry("pispider-task-reset", { at: new Date().toISOString() });
    runtime.taskState = createTaskState();
    ctx.ui.notify("Task state reset on the active branch.", "info");
    return;
  }
  throw new Error(`Unknown task action: ${action}. Run /ps help.`);
}

export const commandCompletions = {
  getArgumentCompletions(prefix) {
    const values = [
      "status",
      "domain",
      "rules",
      "skills",
      "prompt",
      "rewind",
      "task",
      "reload",
      "help",
      "rules list",
      "rules use",
      "rules create",
      "rules edit",
      "rules delete",
      "rules reset",
      "skills list",
      "skills import",
      "skills create",
      "skills delete",
      "prompt show",
      "prompt reset",
      "prompt files",
      "prompt path",
      "task status",
      "task reset",
      "rewind once",
      "rewind round",
      "domain auto",
      "domain js",
      "domain app",
    ];
    const items = values
      .filter((value) => value.startsWith(prefix))
      .map((value) => ({ value, label: value }));
    return items.length ? items : null;
  },
};
