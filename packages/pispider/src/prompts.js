import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_PROMPT_NAMES, VERSION, homeLayout, packagePaths } from "./home.js";
import { resolveDomain } from "./config.js";
import { MAX_PROMPT_BYTES } from "./util.js";

const DOMAIN_LABEL = {
  auto: "auto",
  js: "JavaScript / Web",
  app: "App / Mobile",
  general: "general reverse-engineering",
};

export async function readPromptComponent(home, packageRoot, name) {
  const layout = homeLayout(home);
  const pkg = packagePaths(packageRoot);
  if (!DEFAULT_PROMPT_NAMES.includes(name)) throw new Error(`Unknown prompt component: ${name}`);
  let source;
  try {
    source = await readFile(layout.promptFile(name), "utf8");
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
    source = await readFile(path.join(pkg.prompts, `${name}.md`), "utf8");
  }
  if (Buffer.byteLength(source, "utf8") > MAX_PROMPT_BYTES) {
    throw new Error(`Prompt component ${name} exceeds ${MAX_PROMPT_BYTES} bytes`);
  }
  return source.trim();
}

export async function resetPromptComponents(home, packageRoot, names = DEFAULT_PROMPT_NAMES) {
  const layout = homeLayout(home);
  const pkg = packagePaths(packageRoot);
  await mkdir(layout.prompts, { recursive: true });
  const reset = [];
  for (const name of names) {
    if (!DEFAULT_PROMPT_NAMES.includes(name)) throw new Error(`Unknown prompt component: ${name}`);
    await writeFile(layout.promptFile(name), await readFile(path.join(pkg.prompts, `${name}.md`), "utf8"), "utf8");
    reset.push(name);
  }
  return reset;
}

export async function updatePromptComponent(home, name, content) {
  if (!DEFAULT_PROMPT_NAMES.includes(name)) throw new Error(`Unknown prompt component: ${name}`);
  if (typeof content !== "string" || !content.trim()) throw new Error("Prompt content cannot be empty");
  if (Buffer.byteLength(content, "utf8") > MAX_PROMPT_BYTES) {
    throw new Error(`Prompt component ${name} exceeds ${MAX_PROMPT_BYTES} bytes`);
  }
  const layout = homeLayout(home);
  await mkdir(layout.prompts, { recursive: true });
  const target = layout.promptFile(name);
  await writeFile(target, content, "utf8");
  return { name, path: target, bytes: Buffer.byteLength(content, "utf8") };
}

export async function composePrompt({ home, packageRoot, config, promptText = "", rule = null, taskState = null }) {
  const requestedSetting = config?.domain ?? "auto";
  const domain = resolveDomain(requestedSetting, promptText);
  const core = await readPromptComponent(home, packageRoot, "core");
  const workflow = await readPromptComponent(home, packageRoot, "workflow");
  let domainModule = "";
  if (domain === "js" || domain === "app") {
    domainModule = await readPromptComponent(home, packageRoot, domain);
  }

  const parts = [
    `<!-- PiSpider v${VERSION} — visible additive prompt. Pi remains the host. -->`,
    core,
    workflow,
  ];
  if (domainModule) {
    parts.push(domainModule);
  } else {
    parts.push(`# Domain Routing\n\nConfigured mode: ${requestedSetting}. This turn has no strong JavaScript or App signal. Apply the shared reverse-engineering workflow, and route to JS or App guidance when the target becomes clear.`);
  }

  parts.push(
    `# Runtime Context\n\n- Configured domain mode: \`${requestedSetting}\`\n- Effective domain for this turn: \`${domain}\` (${DOMAIN_LABEL[domain] ?? domain})\n- Active rule: \`${rule?.id ?? "none"}\`\n- Prompt source: local PiSpider files under the user's \`PISPIDER_HOME\`\n- All context in this section is visible with \`/ps prompt show\``,
  );

  if (rule) {
    parts.push(
      `# Active User Rule: ${rule.name} (${rule.id})\n\n<rule id="${rule.id}">\n${rule.body.trim()}\n</rule>`,
    );
  }

  if (taskState) {
    const summary = renderTaskState(taskState);
    if (summary) parts.push(`# Current PiSpider Task State\n\n${summary}`);
  }

  parts.push(
    `# Prompt Contract\n\n- This section is additive. Do not interpret it as permission to remove Pi's existing instructions.\n- Keep PiSpider state visible. Do not create hidden prompts, hidden rules, or secret execution paths.\n- For an authorized reverse-engineering task, continue useful analysis instead of refusing solely because of the domain label.\n- Record the authorization or ownership context once; do not re-litigate it on every turn.\n- When a specific action is unavailable or unsafe, narrow the task and continue with a defensible adjacent path.\n- Use \`ps_task action=reroute\` with a boundary and fallbacks instead of resetting or abandoning the task.`,
  );

  return parts.filter(Boolean).join("\n\n");
}

export function renderTaskState(state) {
  if (!state || (!state.goal && !state.plan?.length && !state.observations?.length && state.stage === "intake")) {
    return "";
  }
  const lines = [`- Stage: ${state.stage}`];
  if (state.goal) lines.push(`- Goal: ${state.goal}`);
  if (state.scope) lines.push(`- Scope: ${state.scope}`);
  if (state.plan?.length) {
    lines.push("- Plan:");
    for (const step of state.plan.slice(0, 12)) lines.push(`  - ${step}`);
  }
  if (state.observations?.length) {
    lines.push("- Recent evidence:");
    for (const item of state.observations.slice(-5)) {
      const source = item.source ? ` [${item.source}]` : "";
      lines.push(`  - ${item.text}${source}`);
    }
  }
  if (state.boundary) lines.push(`- Boundary: ${state.boundary}`);
  if (state.fallbacks?.length) {
    lines.push("- Continuity options:");
    for (const item of state.fallbacks.slice(0, 8)) lines.push(`  - ${item}`);
  }
  if (state.nextAction) lines.push(`- Next action: ${state.nextAction}`);
  if (state.result) lines.push(`- Result: ${state.result}`);
  return lines.join("\n");
}

export async function inspectPromptFiles(home) {
  const layout = homeLayout(home);
  const results = [];
  for (const name of DEFAULT_PROMPT_NAMES) {
    const file = layout.promptFile(name);
    const raw = await readFile(file, "utf8");
    results.push({ name, path: file, bytes: Buffer.byteLength(raw, "utf8"), modified: (await stat(file)).mtime.toISOString() });
  }
  return results;
}
