/**
 * Secondary panel renderer for the small PiSpider management windows.
 *
 * The main window never shows Rules, Skills, Settings or session details in the
 * right-hand workspace panel. Those surfaces open here instead, so the right
 * panel can stay focused on browser and code changes.
 */

const $ = (id) => document.getElementById(id);
const API = window.pispider;
const params = new URLSearchParams(window.location.search);
const kind = params.get("kind") || "rules";
const initialTheme = params.get("theme") === "dark" ? "dark" : "light";
let customTheme = null;

function applyPanelTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = nextTheme;
  window.PiSpiderTheme?.apply(customTheme, nextTheme);
}

applyPanelTheme(initialTheme);
API.onTheme((theme) => {
  applyPanelTheme(theme);
});
API.onCustomTheme((theme) => {
  customTheme = theme || null;
  applyPanelTheme(document.documentElement.dataset.theme);
});
API.getTheme?.()
  .then((response) => {
    customTheme = response?.customTheme || null;
    applyPanelTheme(document.documentElement.dataset.theme);
  })
  .catch(() => {});
API.onResourcesChanged((payload) => {
  if (payload?.kind === "mcp" && kind === "mcp") {
    load().catch((error) => showMessage(error.message, true));
    return;
  }
  if (
    (payload?.kind === "rules" ||
      payload?.kind === "prompts" ||
      payload?.kind === "prompt-templates" ||
      payload?.kind === "extensions") &&
    (kind === "settings" || kind === "extensions")
  ) {
    if (kind === "extensions") renderExtensions().catch((error) => showMessage(error.message, true));
    else renderSettings().catch((error) => showMessage(error.message, true));
  }
});
API.onOAuthEvent((payload) => {
  if (kind !== "settings" || !oauthDialogState) return;
  handleOAuthEvent(payload).catch((error) => {
    if (oauthDialogState) renderOAuthDialog(error.message, "", true);
    else showMessage(error.message, true);
  });
});

const PANEL_META = {
  rules: { title: "规则", directory: "rulesDir" },
  skills: { title: "技能", directory: "skillsDir" },
  mcp: { title: "MCP", directory: "agentDir" },
  extensions: { title: "扩展", directory: "extensionsDir" },
  status: { title: "状态", directory: "home" },
  settings: { title: "设置", directory: "home" },
  project: { title: "项目", directory: "repoRoot" },
  session: { title: "会话", directory: "sessionDir" },
};

let mcpScope = "user";
let mcpDialogScope = "user";
let mcpStatus = null;
let mcpStatusScope = null;
let mcpData = null;

const PROVIDER_PRESETS = [  {
    id: "deepseek",
    label: "DeepSeek",
    name: "DeepSeek",
    custom: false,
    models: [
      { id: "deepseek-flash", name: "DeepSeek V4.1 Flash" },
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
      { id: "deepseek-chat", name: "DeepSeek Chat" },
      { id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    name: "OpenAI",
    custom: false,
    models: [
      { id: "gpt-5.2", name: "GPT-5.2" },
      { id: "gpt-5.1", name: "GPT-5.1" },
      { id: "gpt-5-mini", name: "GPT-5 Mini" },
      { id: "gpt-4.1", name: "GPT-4.1" },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    name: "Anthropic",
    custom: false,
    models: [
      { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
      { id: "claude-opus-4-5", name: "Claude Opus 4.5" },
      { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    name: "OpenRouter",
    custom: false,
    models: [
      { id: "openai/gpt-5.2", name: "GPT-5.2" },
      { id: "anthropic/claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
      { id: "deepseek/deepseek-chat", name: "DeepSeek Chat" },
    ],
  },
  {
    id: "moonshotai-cn",
    label: "Moonshot / Kimi",
    name: "Moonshot AI CN",
    custom: false,
    models: [
      { id: "kimi-k2-0905-preview", name: "Kimi K2" },
      { id: "moonshot-v1-8k", name: "Moonshot V1 8K" },
    ],
  },
  {
    id: "zai",
    label: "Z.AI",
    name: "Z.AI",
    custom: false,
    models: [
      { id: "glm-4.6", name: "GLM 4.6" },
      { id: "glm-4.5", name: "GLM 4.5" },
    ],
  },
  {
    id: "kimi-coding",
    label: "Kimi For Coding",
    name: "Kimi For Coding",
    custom: false,
    models: [
      { id: "k3", name: "Kimi K3" },
      { id: "k3.1-pro", name: "Kimi K3.1 Pro" },
      { id: "kimi-for-coding", name: "Kimi For Coding" },
      { id: "kimi-for-coding-highspeed", name: "Kimi For Coding HighSpeed" },
    ],
  },
  {
    id: "pispider-custom",
    label: "兼容端点",
    name: "兼容模型",
    custom: true,
    api: "openai-completions",
    models: [],
  },
];

const MODEL_APIS = [
  ["openai-completions", "OpenAI Chat Completions"],
  ["openai-responses", "OpenAI Responses"],
  ["anthropic-messages", "Anthropic Messages"],
  ["google-generative-ai", "Google Generative AI"],
];

const THINKING_LABELS = {
  off: "关闭",
  minimal: "最小",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最高",
};

const DESKTOP_THINKING_LEVELS = ["off", "low", "medium", "high", "xhigh", "max"];

function thinkingLabel(level) {
  return THINKING_LABELS[level] || level || "—";
}

function thinkingLevelsText(levels) {
  const list = (Array.isArray(levels) ? levels : []).filter((level) =>
    DESKTOP_THINKING_LEVELS.includes(level),
  );
  return list.length ? list.map(thinkingLabel).join(" / ") : "未获取";
}

function modelDisplayName(model) {
  const name = String(model?.name || "").trim();
  if (name && !name.startsWith("自定义") && name !== "未知模型" && name !== "unknown") return name;
  return String(model?.id || "").trim() || name || "未配置模型";
}

let runtimeInfo = null;
let messageTimer = 0;
let modelConfigState = null;
let ruleDialogState = null;
let shareDialogState = null;
let oauthDialogState = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function agentErrorMessage(message, fallback = "操作失败") {
  const text = String(message || "");
  if (/Nothing to export yet/i.test(text)) return "还没有可导出的对话，先发送一条消息";
  if (/This session has not been saved yet/i.test(text)) return "当前会话还没有保存，先发送一条消息再复制或回退";
  if (/Nothing to compact/i.test(text)) return "当前上下文还不需要压缩";
  if (/Wait for the current response to finish/i.test(text)) return "当前回复还没结束，结束后再切换节点";
  if (/Wait for the current compaction or tree navigation/i.test(text)) {
    return "当前压缩或树切换还没结束，稍后再试";
  }
  if (/Entry .* not found/i.test(text)) return "树节点不存在，刷新会话树后重试";
  return text || fallback;
}

function showMessage(text, error = false) {
  const node = $("panelMessage");
  node.textContent = text;
  node.classList.toggle("error", error);
  node.classList.add("visible");
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => node.classList.remove("visible"), 3600);
}

async function openPath(targetPath) {
  if (!targetPath) return;
  try {
    await API.openPath(targetPath);
  } catch (error) {
    showMessage(error.message, true);
  }
}

function setHeader(title, subtitle) {
  $("panelTitle").textContent = title;
  const meta = $("panelMeta");
  meta.textContent = subtitle || "";
  meta.hidden = !subtitle;
  document.title = `PiSpider · ${title}`;
}

function bindOpenButtons() {
  document.querySelectorAll("[data-open-path]").forEach((button) => {
    button.addEventListener("click", () => openPath(button.dataset.openPath));
  });
}

function renderRules(data) {
  const rules = data?.rules ?? [];
  const active = data?.activeRule;
  const invalidCount = rules.filter((rule) => !rule.valid).length;
  setHeader("规则", `${rules.length} 条规则${active ? ` · 当前 ${active}` : " · 未启用"}`);
  const ruleHero = panelHeroHtml({
    ready: Boolean(active),
    stateLabel: active ? `当前 ${active}` : rules.length ? "未启用规则" : "暂无规则",
    chips: invalidCount ? [`${invalidCount} 条无效`] : [],
  });

  if (rules.length === 0) {
    $("createButton").hidden = true;
    $("panelBody").innerHTML = `
      <div class="panel-page">${ruleHero}
        <div class="panel-empty-card">
          <div class="panel-empty-mark">RULE</div>
          <h3>还没有规则</h3>
          <p>创建规则后，在这里启用、编辑和查看正文。</p>
          <button class="panel-action primary" id="emptyCreateRule" type="button">新建规则</button>
        </div>
      </div>`;
    $("emptyCreateRule").addEventListener("click", openRuleCreate);
    return;
  }

  $("panelBody").innerHTML = `<div class="panel-page">${ruleHero}<div class="panel-list-head"><span>全部规则</span><span>${rules.length} 条</span></div><div class="panel-rule-list">${rules
    .map(
      (rule) => `
        <div class="resource-row rule-row${rule.active ? " active" : ""}">
          <div class="resource-main">
            <div class="resource-name">${escapeHtml(rule.name || rule.id)} <span class="resource-id">${escapeHtml(rule.id)}</span></div>
            ${
              rule.valid
                ? rule.description
                  ? `<div class="resource-description">${escapeHtml(rule.description)}</div>`
                  : ""
                : `<div class="resource-description">${escapeHtml(rule.error || "无效规则")}</div>`
            }
            <div class="resource-actions">
              <button class="text-button" data-rule-action="toggle" data-rule-id="${escapeHtml(rule.id)}" type="button" ${rule.valid ? "" : "disabled"}>${rule.active ? "停用" : "启用"}</button>
              <button class="text-button" data-rule-action="edit" data-rule-id="${escapeHtml(rule.id)}" type="button" ${rule.valid ? "" : "disabled"}>编辑</button>
              <button class="text-button" data-rule-action="reset" data-rule-id="${escapeHtml(rule.id)}" type="button" ${rule.valid ? "" : "disabled"}>重置</button>
              <button class="text-button danger" data-rule-action="delete" data-rule-id="${escapeHtml(rule.id)}" type="button">删除</button>
              <button class="text-button" data-open-path="${escapeHtml(rule.path)}" type="button">打开文件</button>
            </div>
          </div>
          <div class="resource-meta">
            ${rule.active ? '<span class="badge active">已启用</span>' : ""}
            ${rule.valid ? "" : '<span class="badge invalid">无效</span>'}
          </div>
        </div>
      `,
    )
    .join("")}</div></div>`;
  bindOpenButtons();
  bindRuleActions(rules);
}

function bindRuleActions(rules) {
  document.querySelectorAll("[data-rule-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.ruleAction;
      const id = button.dataset.ruleId;
      const rule = rules.find((item) => item.id === id);
      if (!rule) return;
      if (action === "toggle") {
        button.disabled = true;
        try {
          const next = rule.active ? null : id;
          const result = await API.activateRule(next);
          await load();
          showMessage(result.activeRule ? `已启用规则 ${result.activeRule}，下一条消息生效` : "已停用当前规则");
        } catch (error) {
          showMessage(error.message, true);
        } finally {
          button.disabled = false;
        }
        return;
      }
      if (action === "edit") {
        try {
          openRuleEditor(await API.getRule(id));
        } catch (error) {
          showMessage(error.message, true);
        }
        return;
      }
      if (action === "delete") {
        openRuleDelete(rule);
      }
      if (action === "reset") {
        openRuleReset(rule);
      }
    });
  });
}

function setDialogMessage(text, error = false) {
  const node = $("ruleDialogMessage");
  node.textContent = text;
  node.classList.toggle("error", error);
}

function setRuleDialogMode({ mode, id = null, scope = null, record = null, title, body, submit = "保存", danger = false, hideCancel = false }) {
  ruleDialogState = { mode, id, scope, record };
  $("ruleDialogTitle").textContent = title;
  $("ruleDialogBody").innerHTML = body;
  $("ruleDialogSubmit").textContent = submit;
  $("ruleDialogSubmit").classList.toggle("danger", danger);
  $("ruleDialogCancel").hidden = hideCancel;
  setDialogMessage("");
  $("ruleDialog").showModal();
  const firstInput = $("ruleDialogBody").querySelector("input, textarea");
  firstInput?.focus();
}

function openRuleCreate() {
  setRuleDialogMode({
    mode: "rule-create",
    title: "新建规则",
    submit: "创建",
    body: `
      <div class="dialog-grid">
        <label class="dialog-field">
          <span>规则 ID</span>
          <input id="ruleIdInput" class="dialog-input" placeholder="例如 js-sourcemap" autocomplete="off" spellcheck="false" />
        </label>
        <label class="dialog-field">
          <span>名称</span>
          <input id="ruleNameInput" class="dialog-input" placeholder="例如 SourceMap 证据检查" autocomplete="off" />
        </label>
        <label class="dialog-field dialog-field-wide">
          <span>描述</span>
          <input id="ruleDescriptionInput" class="dialog-input" placeholder="这条规则约束什么" autocomplete="off" />
        </label>
      </div>`,
  });
}

function openRuleEditor(rule) {
  setRuleDialogMode({
    mode: "rule-edit",
    id: rule.id,
    title: `编辑 ${rule.name || rule.id}`,
    body: `
      <label class="dialog-field">
        <span>RULE.md</span>
        <textarea id="ruleContentInput" class="dialog-textarea" spellcheck="false">${escapeHtml(rule.raw)}</textarea>
      </label>`,
  });
}

function openRuleDelete(rule) {
  setRuleDialogMode({
    mode: "rule-delete",
    id: rule.id,
    title: "删除规则",
    submit: "删除",
    danger: true,
    body: `<p class="dialog-copy">规则 <strong>${escapeHtml(rule.name || rule.id)}</strong>（${escapeHtml(rule.id)}）会先移动到备份目录，再删除。此操作不可撤销。</p>`,
  });
}

function openRuleReset(rule) {
  setRuleDialogMode({
    mode: "rule-reset",
    id: rule.id,
    title: "恢复默认规则",
    submit: "恢复默认",
    body: `<p class="dialog-copy">规则 <strong>${escapeHtml(rule.name || rule.id)}</strong>（${escapeHtml(rule.id)}）的正文会恢复为内置模板，名称和描述保留。此操作不可撤销。</p>`,
  });
}

function openTaskReset() {
  setRuleDialogMode({
    mode: "task-reset",
    title: "重置任务",
    submit: "重置",
    body: `<p class="dialog-copy">会清空当前分支的 PiSpider 任务状态，包括目标、计划、观察、边界和下一步；对话记录不会删除。</p>`,
  });
}

function openCompactDialog() {
  setRuleDialogMode({
    mode: "compact-session",
    title: "压缩上下文",
    submit: "开始压缩",
    body: `
      <label class="dialog-field">
        <span>压缩说明（可选）</span>
        <textarea id="compactInstructionsInput" class="dialog-textarea" placeholder="例如：保留最近的命令输出、文件路径和未完成事项，省略重复的探索过程。"></textarea>
      </label>
      <p class="dialog-copy">留空时使用 Pi 默认压缩策略。压缩会生成新的摘要并缩短后续请求的上下文。</p>`,
  });
}

function openSkillCreate() {
  setRuleDialogMode({
    mode: "skill-create",
    title: "新建技能",
    submit: "创建",
    body: `
      <div class="dialog-grid">
        <label class="dialog-field">
          <span>技能 ID</span>
          <input id="skillIdInput" class="dialog-input" placeholder="例如 js-bundle" autocomplete="off" spellcheck="false" />
        </label>
        <label class="dialog-field dialog-field-wide">
          <span>描述</span>
          <input id="skillDescriptionInput" class="dialog-input" placeholder="这个技能解决什么问题，什么时候使用" autocomplete="off" />
        </label>
      </div>`,
  });
}

function openSkillDelete(skill) {
  setRuleDialogMode({
    mode: "skill-delete",
    id: skill.id,
    title: "删除技能",
    submit: "删除",
    danger: true,
    body: `<p class="dialog-copy">技能 <strong>${escapeHtml(skill.id)}</strong> 会先移动到备份目录，再删除。此操作不可撤销。</p>`,
  });
}

async function submitRuleDialog(event) {
  event.preventDefault();
  if (!ruleDialogState) return;
  const { mode, id, scope, record } = ruleDialogState;
  if (mode === "oauth-login") {
    await submitOAuthDialog();
    return;
  }
  if (mode === "mcp-info") {
    $("ruleDialog").close();
    return;
  }
  const submit = $("ruleDialogSubmit");
  submit.disabled = true;
  const readValue = (inputId) => $(inputId)?.value.trim() ?? "";
  try {
    if (mode === "mcp-start") {
      const values = {};
      for (const input of record.inputs) {
        const field = $("ruleDialogBody").querySelector(`[data-mcp-input="${input.id}"]`);
        const value = field?.value.trim() ?? "";
        if (input.required && !value) throw new Error(`请填写${input.label}`);
        values[input.id] = value;
      }
      const result = await API.startMcpCatalog(record.catalogId, "user", values);
      if (!result?.started) throw new Error(result?.error || "预置 MCP 启动失败");
      $("ruleDialog").close();
      await finishCatalogStart(result);
    } else if (mode === "rule-create") {
      const ruleId = readValue("ruleIdInput");
      const name = readValue("ruleNameInput");
      const description = readValue("ruleDescriptionInput");
      if (!ruleId) throw new Error("请填写规则 ID");
      await API.createRule({ id: ruleId, name, description });
      $("ruleDialog").close();
      await load();
      showMessage(`已创建规则 ${ruleId}，下一条消息生效`);
    } else if (mode === "rule-edit") {
      await API.updateRule(id, $("ruleContentInput").value);
      $("ruleDialog").close();
      await load();
      showMessage(`已更新规则 ${id}，下一条消息生效`);
    } else if (mode === "rule-reset") {
      await API.resetRule(id);
      $("ruleDialog").close();
      await load();
      showMessage(`已恢复规则 ${id} 的默认正文，下一条消息生效`);
    } else if (mode === "rule-delete") {
      const result = await API.deleteRule(id);
      $("ruleDialog").close();
      await load();
      showMessage(result.activeRule ? `已删除规则 ${id}` : `已删除规则 ${id}，当前规则已清空`);
    } else if (mode === "skill-create") {
      const skillId = readValue("skillIdInput");
      const description = readValue("skillDescriptionInput");
      if (!skillId) throw new Error("请填写技能 ID");
      if (!description) throw new Error("请填写技能描述");
      await API.createSkill({ id: skillId, description });
      $("ruleDialog").close();
      await load();
      showMessage(`已创建技能 ${skillId}，点击“重载 Agent”后生效`);
    } else if (mode === "skill-delete") {
      await API.deleteSkill(id);
      $("ruleDialog").close();
      await load();
      showMessage(`已删除技能 ${id}，点击“重载 Agent”后生效`);
    } else if (mode === "task-reset") {
      await API.resetTask();
      await new Promise((resolve) => setTimeout(resolve, 500));
      $("ruleDialog").close();
      await load();
      showMessage("任务状态已重置");
    } else if (mode === "mcp-create" || mode === "mcp-edit") {
      const name = readValue("mcpNameInput");
      if (!name) throw new Error("请填写 MCP 名称");
      if (mode === "mcp-edit" && name !== id) throw new Error("编辑时不能修改名称，请新建一个服务器");
      const type = readValue("mcpTypeInput");
      const input = {
        name,
        type,
        command: readValue("mcpCommandInput"),
        args: $("mcpArgsInput")?.value ?? "",
        url: readValue("mcpUrlInput"),
        headers: $("mcpHeadersInput")?.value.trim() || null,
        description: readValue("mcpDescriptionInput"),
        exposure: readValue("mcpExposureInput"),
        toolExposure: collectMcpToolExposure(),
      };
      await API.saveMcp(input, mcpDialogScope);
      $("ruleDialog").close();
      await load();
      showMessage(`已保存 MCP ${name}，点击“重载 Agent”后生效`);
    } else if (mode === "mcp-delete") {
      await API.deleteMcp(id, mcpDialogScope);
      $("ruleDialog").close();
      await load();
      showMessage(`已删除 MCP ${id}，点击“重载 Agent”后生效`);
    } else if (mode === "prompt-edit") {
      await API.updatePrompt(id, $("promptContentInput").value);
      $("ruleDialog").close();
      await renderSettings();
      showMessage(`已保存提示词 ${id}，点击“重载 Agent”后生效`);
    } else if (mode === "prompt-reset") {
      await API.resetPrompt(id);
      $("ruleDialog").close();
      await renderSettings();
      showMessage(`已恢复提示词 ${id}，点击“重载 Agent”后生效`);
    } else if (mode === "prompt-template-create") {
      const templateId = readValue("promptTemplateIdInput");
      const templateScope = readValue("promptTemplateScopeInput") || "user";
      if (!templateId) throw new Error("请填写模板 ID");
      await API.createPromptTemplate({
        scope: templateScope,
        id: templateId,
        description: readValue("promptTemplateDescriptionInput"),
        argumentHint: readValue("promptTemplateHintInput"),
        content: $("promptTemplateContentInput").value,
      });
      $("ruleDialog").close();
      await renderSettings();
      showMessage(`已创建提示模板 /${templateId}，重载 Agent 后出现在命令面板`);
    } else if (mode === "prompt-template-edit") {
      await API.updatePromptTemplate(scope, id, {
        description: readValue("promptTemplateDescriptionInput"),
        argumentHint: readValue("promptTemplateHintInput"),
        content: $("promptTemplateContentInput").value,
      });
      $("ruleDialog").close();
      await renderSettings();
      showMessage(`已保存提示模板 /${id}，重载 Agent 后生效`);
    } else if (mode === "prompt-template-delete") {
      await API.deletePromptTemplate(scope, id);
      $("ruleDialog").close();
      await renderSettings();
      showMessage(`已删除提示模板 /${id}，重载 Agent 后从命令面板移除`);
    } else if (mode === "package-install") {
      const source = readValue("packageSourceInput");
      const packageScope = readValue("packageScopeInput") || "user";
      if (!source) throw new Error("请填写 package source");
      setDialogMessage("正在调用 Pi package 命令…");
      const result = await API.installPackage({ source, scope: packageScope });
      if (!result?.ok) throw new Error(packageCommandError(result));
      $("ruleDialog").close();
      await renderExtensions();
      showMessage(`已安装 ${source}，重载 Agent 后加载 package 资源`);
    } else if (mode === "package-remove") {
      if (!record?.source) throw new Error("缺少 package source");
      setDialogMessage("正在移除 package…");
      const packageSource = record.removeSource || record.source;
      const result = await API.removePackage({ source: packageSource, scope: record.scope });
      if (!result?.ok) throw new Error(packageCommandError(result));
      $("ruleDialog").close();
      await renderExtensions();
      showMessage(`已移除 ${record.source}，重载 Agent 后清理资源`);
    } else if (mode === "package-update") {
      if (!record?.source) throw new Error("缺少 package source");
      setDialogMessage("正在更新 package…");
      const packageSource = record.removeSource || record.source;
      const result = await API.updatePackage({ source: packageSource, scope: record.scope });
      if (!result?.ok) throw new Error(packageCommandError(result));
      $("ruleDialog").close();
      await renderExtensions();
      showMessage(`已更新 ${record.source}，重载 Agent 后生效`);
    } else if (mode === "prompt-preview") {
      $("ruleDialog").close();
    } else if (mode === "tree-label") {
      const label = readValue("treeLabelInput").trim();
      const response = await API.setTreeLabel(id, label);
      if (!response?.success) throw new Error(response?.error || "保存标记失败");
      $("ruleDialog").close();
      await load();
      showMessage(label ? "已保存标记" : "已清除标记");
    } else if (mode === "session-rename") {
      const name = readValue("sessionNameInput");
      if (!name) throw new Error("请填写会话名称");
      const response = await API.setSessionName(name);
      if (!response?.success) throw new Error(response?.error || "重命名失败");
      $("ruleDialog").close();
      await load();
      showMessage("会话已重命名");
    } else if (mode === "session-rewind") {
      const response = await API.rewindSession(id);
      if (!response?.success) throw new Error(response?.error || "回退失败");
      $("ruleDialog").close();
      showMessage(response.data?.cancelled ? "扩展取消了这次回退" : "已创建回退分支，原分支仍保留");
      await load();
    } else if (mode === "session-fork") {
      const selected = document.querySelector('input[name="forkEntry"]:checked');
      if (!selected) throw new Error("请选择要回退的消息");
      const response = await API.forkSession(selected.value);
      if (!response?.success) throw new Error(response?.error || "回退失败");
      $("ruleDialog").close();
      showMessage(response.data?.cancelled ? "扩展取消了这次回退" : "已创建会话分支");
      await load();
    } else if (mode === "session-tree") {
      $("ruleDialog").close();
    } else if (mode === "compact-session") {
      const customInstructions = $("compactInstructionsInput").value.trim();
      $("ruleDialog").close();
      await compactSession(customInstructions);
    }
  } catch (error) {
    setDialogMessage(error.message, true);
  } finally {
    submit.disabled = false;
  }
}

function renderSkills(skills) {
  const invalidCount = skills.filter((skill) => !skill.valid).length;
  setHeader("技能", `${skills.length} 个技能`);
  const skillHero = panelHeroHtml({
    ready: skills.length > 0,
    stateLabel: skills.length ? "技能已加载" : "暂无技能",
    chips: [invalidCount ? `${invalidCount} 个无效` : ""].filter(Boolean),
  });

  if (skills.length === 0) {
    $("createButton").hidden = true;
    $("importSkillButton").hidden = true;
    $("panelBody").innerHTML = `
      <div class="panel-page">${skillHero}
        <div class="panel-empty-card">
          <div class="panel-empty-mark">SKILL</div>
          <h3>还没有技能</h3>
          <p>新建技能，或从已有目录导入。</p>
          <div class="empty-actions">
            <button class="panel-action primary" id="emptyCreateSkill" type="button">新建技能</button>
            <button class="panel-action" id="emptyImportSkill" type="button">导入技能</button>
          </div>
        </div>
      </div>`;
    $("emptyCreateSkill").addEventListener("click", openSkillCreate);
    $("emptyImportSkill").addEventListener("click", importSkill);
    return;
  }

  $("panelBody").innerHTML = `<div class="panel-page">${skillHero}<div class="panel-list-head"><span>全部技能</span><span>${skills.length} 个</span></div><div class="panel-resource-list">${skills
    .map(
      (skill) => `
        <div class="resource-row skill-row">
          <div class="resource-main">
            <div class="resource-name">${escapeHtml(skill.id)}</div>
            ${
              skill.valid
                ? skill.description
                  ? `<div class="resource-description">${escapeHtml(skill.description)}</div>`
                  : ""
                : `<div class="resource-description">${escapeHtml(skill.error || "无效技能")}</div>`
            }
            <div class="resource-actions">
              <button class="text-button danger" data-skill-action="delete" data-skill-id="${escapeHtml(skill.id)}" type="button">删除</button>
              <button class="text-button" data-open-path="${escapeHtml(skill.path)}" type="button">打开目录</button>
            </div>
          </div>
          <div class="resource-meta">
            ${skill.valid ? "" : '<span class="badge invalid">无效</span>'}
          </div>
        </div>
      `,
    )
    .join("")}</div></div>`;
  bindOpenButtons();
  bindSkillActions(skills);
}

function bindSkillActions(skills) {
  document.querySelectorAll("[data-skill-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.skillId;
      const skill = skills.find((item) => item.id === id);
      if (skill) openSkillDelete(skill);
    });
  });
}

async function importSkill() {
  const button = $("importSkillButton");
  if (button) button.disabled = true;
  try {
    const sourcePath = await API.pickDirectory();
    if (!sourcePath) return;
    const result = await API.importSkill(sourcePath);
    await load();
    showMessage(`已导入技能 ${result.id}，点击“重载 Agent”后生效`);
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function reloadAgent(notify = true) {
  const button = $("reloadAgentButton");
  if (button) button.disabled = true;
  try {
    await API.reloadAgent();
    if (kind === "mcp") {
      await checkAllMcp(notify);
    } else if (notify) {
      showMessage("Agent 已重新加载");
    }
    return true;
  } catch (error) {
    if (notify) showMessage(error.message, true);
    return false;
  } finally {
    if (button) button.disabled = false;
  }
}

function settingRowsHtml(rows) {
  return rows
    .map(
      (row) => `
        <div class="setting-row">
          <span class="setting-label">${escapeHtml(row.label)}</span>
          <span class="setting-value">${escapeHtml(row.value ?? "—")}</span>
          ${row.open && row.value ? `<button class="text-button" data-open-path="${escapeHtml(row.value)}" type="button">打开</button>` : ""}
        </div>
      `,
    )
    .join("");
}

function mcpStateLabel(servers, status) {
  const enabledCount = servers.filter((server) => server.enabled).length;
  const catalogCount = servers.filter((server) => server.source === "catalog").length;
  const connectedCount = status?.servers?.filter((server) => server.state === "connected").length ?? 0;
  if (servers.length === 0) return "未配置";
  if (status) {
    if (enabledCount) return `${connectedCount} / ${enabledCount} 已连接`;
    return catalogCount ? `${catalogCount} 个预置可选` : "无启用服务器";
  }
  if (enabledCount) return `${enabledCount} 个启用`;
  return catalogCount ? `${catalogCount} 个预置可选` : "全部停用";
}

function mcpStatusHtml(server, status) {
  const report = status?.servers?.find((item) => item.name === server.name);
  if (!report) {
    if (!server.enabled) return "";
    return `<div class="mcp-status warn" data-mcp-status="${escapeHtml(server.name)}">需重载 Agent</div>`;
  }
  const state =
    report.state === "connected"
      ? `已连接 · ${report.tools?.length ?? 0} 个工具`
      : report.state === "needs-auth" || report.state === "login-required"
        ? "需要登录"
        : report.state === "disabled"
          ? "已停用"
          : report.state === "not-loaded"
            ? "需重载 Agent"
            : report.state === "starting"
              ? "正在启动"
              : report.state === "connecting"
                ? "连接中"
                : report.state === "disconnected"
                  ? "已断开"
                  : report.state === "failed"
                    ? "连接失败"
                    : report.state === "closed"
                      ? "已关闭"
                      : report.state === "unknown"
                        ? "未检查"
                        : report.state || "未连接";
  const detail = report.error ? `<div class="mcp-error">${escapeHtml(report.error)}</div>` : "";
  const toolRuntime = report.toolRuntime && typeof report.toolRuntime === "object" ? report.toolRuntime : {};
  const tools = report.tools?.length
    ? (() => {
        const shown = report.tools.slice(0, 10);
        const hiddenCount = report.tools.length - shown.length;
        return `<div class="mcp-tools">${shown
          .map((tool) => {
            const runtime = toolRuntime[tool];
            const runtimeLabel =
              runtime?.state === "running"
                ? "运行中"
                : runtime?.state === "error"
                  ? "失败"
                  : runtime?.state === "success"
                    ? "成功"
                    : "";
            const title = [
              tool,
              runtime?.calls ? `调用 ${runtime.calls} 次` : "",
              runtime?.lastDurationMs !== null && runtime?.lastDurationMs !== undefined
                ? `最近 ${formatMcpDuration(runtime.lastDurationMs)}`
                : "",
              runtime?.lastError || "",
            ]
              .filter(Boolean)
              .join(" · ");
            return `<span class="mcp-tool ${escapeHtml(runtime?.state || "")}" title="${escapeHtml(title)}">${escapeHtml(tool)}${
              runtimeLabel ? `<span class="mcp-tool-state">${runtimeLabel}</span>` : ""
            }</span>`;
          })
          .join("")}${hiddenCount ? `<span class="mcp-tool more">+${hiddenCount}</span>` : ""}</div>`;
      })()
    : "";
  const runtimeValues = Object.values(toolRuntime);
  const runtimeCalls = runtimeValues.reduce((total, runtime) => total + (runtime?.calls || 0), 0);
  const runtimeFailures = runtimeValues.filter((runtime) => runtime?.state === "error").length;
  const runtimeRunning = runtimeValues.filter((runtime) => runtime?.state === "running").length;
  const runtimeNote = runtimeCalls
    ? `<div class="mcp-tool-runtime">本次运行：${runtimeCalls} 次调用${
        runtimeFailures ? ` · ${runtimeFailures} 个失败` : ""
      }${runtimeRunning ? ` · ${runtimeRunning} 个运行中` : ""}</div>`
    : "";
  const tone =
    report.state === "connected" ? "ok" : report.state === "starting" || report.state === "connecting" ? "idle" : "warn";
  return `<div class="mcp-status ${tone}" data-mcp-status="${escapeHtml(server.name)}">${escapeHtml(state)}${detail}${tools}${runtimeNote}</div>`;
}

function formatMcpDuration(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}

function updateMcpToolRuntime(change) {
  if (kind !== "mcp" || !mcpStatus || !change?.server || !change?.tool) return;
  const report = mcpStatus.servers?.find((server) => server.name === change.server);
  if (!report) return;
  report.toolRuntime = {
    ...(report.toolRuntime && typeof report.toolRuntime === "object" ? report.toolRuntime : {}),
    [change.tool]: {
      server: change.server,
      tool: change.tool,
      state: change.state,
      calls: change.calls,
      lastStartedAt: change.lastStartedAt,
      lastFinishedAt: change.lastFinishedAt,
      lastDurationMs: change.lastDurationMs,
      lastError: change.lastError,
    },
  };
  updateMcpLiveStatus(mcpStatus);
}

function mcpRuntimeActionsHtml(server, status) {
  const headers = server.headers && typeof server.headers === "object" ? server.headers : {};
  const hasAuthorization = Object.keys(headers).some((name) => name.toLowerCase() === "authorization");
  const usesOAuth = server.type === "http" && !hasAuthorization;
  const report = status?.servers?.find((item) => item.name === server.name);
  const connected = report?.state === "connected";
  return `
    ${usesOAuth && !connected ? `<button class="text-button" data-mcp-action="login" data-mcp-name="${escapeHtml(server.name)}" type="button">登录</button>` : ""}
    ${usesOAuth && connected ? `<button class="text-button" data-mcp-action="logout" data-mcp-name="${escapeHtml(server.name)}" type="button">登出</button>` : ""}
    ${server.enabled ? `<button class="text-button" data-mcp-action="reconnect" data-mcp-name="${escapeHtml(server.name)}" type="button">重连</button>` : ""}
  `;
}

function mcpServerStateLabel(server) {
  const hasConfig = Boolean(server.configured);
  if (server.enabled) return server.source === "catalog" ? "已启用" : "启用";
  if (server.source === "catalog") return hasConfig ? "已停用" : server.installed ? "已安装" : "未启动";
  return "停用";
}

function mcpServerMetaText(server) {
  if (server.source === "catalog" && server.packageName) {
    return `${server.packageName}@${server.packageVersion} · ${server.installed ? "已安装" : "首次启动安装"}`;
  }
  if (server.type === "http") return server.url;
  return [server.command, ...(server.args || [])].join(" ");
}

function mcpInfoBodyHtml(server) {
  const isHttp = server.type === "http";
  const packageLabel = server.packageName ? `${server.packageName}@${server.packageVersion}` : "";
  const rows = [
    packageLabel
      ? `<div class="mcp-info-row"><dt>包</dt><dd><code>${escapeHtml(packageLabel)}</code></dd></div>`
      : "",
    isHttp && server.url
      ? `<div class="mcp-info-row"><dt>接口</dt><dd><code>${escapeHtml(server.url)}</code></dd></div>`
      : "",
    server.prerequisite
      ? `<div class="mcp-info-row"><dt>运行要求</dt><dd>${escapeHtml(server.prerequisite)}</dd></div>`
      : "",
    server.inputs?.length
      ? `<div class="mcp-info-row"><dt>启动参数</dt><dd>${server.inputs.map((input) => escapeHtml(input.label)).join("、")}</dd></div>`
      : "",
  ].filter(Boolean).join("");
  return `
    <div class="mcp-info-dialog">
      ${server.description ? `<p class="mcp-info-lead">${escapeHtml(server.description)}</p>` : ""}
      ${rows ? `<dl class="mcp-info-list">${rows}</dl>` : ""}
      <p class="mcp-info-foot">${
        isHttp
          ? "远程 MCP，启动时写入配置，无需本地安装。"
          : server.installed
            ? "已安装到本地，启动时复用当前版本。"
            : "首次点击“准备并启动”时安装到本地，之后复用。"
      }</p>
    </div>`;
}

function openMcpInfo(server) {
  setRuleDialogMode({
    mode: "mcp-info",
    title: `${server.name} 说明`,
    body: mcpInfoBodyHtml(server),
    submit: "关闭",
    hideCancel: true,
  });
}

function openMcpStart(server) {
  const fields = server.inputs
    .map(
      (input) => `
        <label class="dialog-field dialog-field-wide">
          <span>${escapeHtml(input.label)}</span>
          <input class="dialog-input" data-mcp-input="${escapeHtml(input.id)}" value="${escapeHtml(input.default || "")}"
            placeholder="${escapeHtml(input.placeholder || "请填写")}" autocomplete="off" spellcheck="false"
            ${input.required ? "required" : ""} />
          ${input.description ? `<span class="dialog-hint">${escapeHtml(input.description)}</span>` : ""}
        </label>`,
    )
    .join("");
  setRuleDialogMode({
    mode: "mcp-start",
    id: server.catalogId,
    record: server,
    title: `启动 ${server.name}`,
    submit: server.installed ? "启动" : "准备并启动",
    body: `
      <p class="dialog-copy">启动参数会写入 MCP 配置，之后可在“编辑”里修改。</p>
      <div class="dialog-grid">${fields}</div>`,
  });
}

async function startCatalogFromPanel(server, inputs = {}) {
  const result = await API.startMcpCatalog(server.catalogId, "user", inputs);
  if (!result?.started) throw new Error(result?.error || "预置 MCP 启动失败");
  await finishCatalogStart(result);
}

async function finishCatalogStart(result) {
  renderMcp(result);
  let state = null;
  try {
    state = await API.getState();
  } catch {}
  if (!state?.success) {
    showMessage(`已安装并启用 ${result.started}；请点顶部“重载 Agent”加载`);
    return;
  }
  if (state.data?.isStreaming) {
    showMessage(`已安装并启用 ${result.started}；Agent 正在工作，结束后点顶部“重载 Agent”加载`);
    return;
  }
  showMessage(`已安装并启用 ${result.started}；正在重载 Agent`);
  const reloaded = await reloadAgent(false);
  showMessage(
    reloaded
      ? `已安装并启用 ${result.started}；Agent 已重载，等待 MCP 连接状态`
      : `已安装并启用 ${result.started}；自动重载失败，请点顶部“重载 Agent”`,
    !reloaded,
  );
}

function mcpServerActionsHtml(server, status) {
  const isCatalog = server.source === "catalog";
  const hasConfig = Boolean(server.configured);
  const canStart = isCatalog && (!server.installed || !server.enabled);
  const startLabel = server.installed ? "启动" : "准备并启动";
  return `
    ${canStart ? `<button class="text-button mcp-start" data-mcp-start="${escapeHtml(server.catalogId)}" type="button">${startLabel}</button>` : ""}
    ${!canStart && server.enabled ? `<button class="text-button" data-mcp-toggle="${escapeHtml(server.name)}" data-enabled="true" type="button">停用</button>` : ""}
    ${!isCatalog && !server.enabled ? `<button class="text-button" data-mcp-toggle="${escapeHtml(server.name)}" data-enabled="false" type="button">启用</button>` : ""}
    ${isCatalog ? `<button class="text-button mcp-info-button" data-mcp-info="${escapeHtml(server.name)}" type="button" title="查看预置 MCP 说明">说明</button>` : ""}
    ${hasConfig ? `<button class="text-button" data-mcp-check="${escapeHtml(server.name)}" type="button">检查</button>` : ""}
    ${hasConfig ? `<button class="text-button" data-mcp-edit="${escapeHtml(server.name)}" type="button">编辑</button>` : ""}
    ${hasConfig ? `<button class="text-button danger" data-mcp-delete="${escapeHtml(server.name)}" type="button">删除</button>` : ""}
    ${server.enabled && hasConfig ? mcpRuntimeActionsHtml(server, status ?? mcpStatus) : ""}
  `;
}

function setMcpCardStatus(server, label, tone = "idle") {
  const item = [...document.querySelectorAll(".mcp-item[data-mcp-server]")].find(
    (entry) => entry.dataset.mcpServer === server.name,
  );
  if (!item) return;
  item.querySelector("[data-mcp-status]")?.remove();
  item.insertAdjacentHTML(
    "beforeend",
    `<div class="mcp-status ${tone}" data-mcp-status="${escapeHtml(server.name)}">${escapeHtml(label)}</div>`,
  );
}

function updateMcpLiveAuthAction(item, server, status) {
  const button = item.querySelector('[data-mcp-action="login"], [data-mcp-action="logout"]');
  if (!button) return;
  const headers = server.headers && typeof server.headers === "object" ? server.headers : {};
  const hasAuthorization = Object.keys(headers).some((name) => name.toLowerCase() === "authorization");
  if (server.type !== "http" || hasAuthorization) return;
  const connected = status.servers?.some((entry) => entry.name === server.name && entry.state === "connected");
  button.dataset.mcpAction = connected ? "logout" : "login";
  button.textContent = connected ? "登出" : "登录";
}

function updateMcpLiveStatus(status) {
  if (kind !== "mcp" || !status || !mcpData) return;
  const servers = mcpData.servers ?? [];
  mcpStatus = status;
  mcpStatusScope = mcpScope;
  const connectedCount = status.servers?.filter((server) => server.state === "connected").length ?? 0;
  const summary = document.querySelector(".panel-summary");
  if (summary) {
    summary.outerHTML = panelHeroHtml({
      ready: connectedCount > 0,
      stateLabel: mcpStateLabel(servers, status),
      chips: [mcpScope === "project" ? "项目级" : "用户级", status.live === false ? "离线检查" : "Agent 实时"],
    });
  }
  const connectedStat = [...document.querySelectorAll(".panel-stat")].find(
    (stat) => stat.querySelector(".panel-stat-label")?.textContent === "已连接",
  );
  if (connectedStat) connectedStat.querySelector(".panel-stat-value").textContent = String(connectedCount);

  const items = [...document.querySelectorAll(".mcp-item[data-mcp-server]")];
  for (const item of items) item.querySelector("[data-mcp-status]")?.remove();
  for (const item of items) {
    const server = servers.find((entry) => entry.name === item.dataset.mcpServer);
    if (!server) continue;
    const report = status.servers?.some((entry) => entry.name === server.name);
    if (!report && !server.enabled) continue;
    item.insertAdjacentHTML("beforeend", mcpStatusHtml(server, status));
    updateMcpLiveAuthAction(item, server, status);
  }
}

function renderMcp(data, status = null) {
  const servers = data?.servers ?? [];
  mcpData = data;
  const nextScope = data?.scope === "project" ? "project" : "user";
  if (status) {
    mcpStatus = status;
    mcpStatusScope = nextScope;
  } else if (mcpStatusScope && mcpStatusScope !== nextScope) {
    mcpStatus = null;
    mcpStatusScope = null;
  }
  mcpScope = nextScope;
  const scopeLabel = mcpScope === "project" ? "项目级" : "用户级";
  const enabledCount = servers.filter((server) => server.enabled).length;
  const catalogCount = servers.filter((server) => server.source === "catalog").length;
  const installedCatalogCount = servers.filter(
    (server) => server.source === "catalog" && server.installed,
  ).length;
  const connectedCount = status?.servers?.filter((server) => server.state === "connected").length ?? 0;
  const stateLabel = mcpStateLabel(servers, status);

  const scopeNote =
    mcpScope === "project"
      ? "项目级 · 仅信任项目后加载"
      : "用户级 · 所有项目共享，预置项按需安装";
  setHeader("MCP", servers.length ? `${servers.length} 个服务器 · ${scopeLabel}` : "未配置");
  const mcpHero = panelHeroHtml({
    ready: status ? connectedCount > 0 : enabledCount > 0,
    stateLabel,
    chips: [scopeLabel, ...(status ? [status.live ? "Agent 实时" : "离线检查"] : [])],
  });
  const mcpMetrics = panelMetricsHtml([
    {
      label: "服务器",
      value: servers.length,
      note: catalogCount ? `含 ${catalogCount} 个预置` : "已配置",
    },
    {
      label: "启用",
      value: enabledCount,
      note: servers.length ? `${servers.length - enabledCount} 个未启用` : "无服务器",
    },
    {
      label: "预置",
      value: catalogCount,
      note: catalogCount
        ? installedCatalogCount
          ? `${installedCatalogCount} 已安装`
          : "启动时安装"
        : "无预置",
    },
    { label: "已连接", value: status ? connectedCount : "—", note: status ? "最近检查" : "尚未检查" },
  ]);
  const serverList = servers.length
    ? panelCardHtml(
        "服务器",
        servers
          .map(
            (server) => `
          <div class="mcp-item${server.source === "catalog" ? " mcp-catalog-item" : ""}" data-mcp-server="${escapeHtml(server.name)}">
            <div class="mcp-top">
              <div class="mcp-identity">
                <span class="mcp-name">${escapeHtml(server.name)}</span>
                <span class="mcp-type">${escapeHtml(server.type)} · ${escapeHtml(server.exposure || "codemode")}</span>
                ${server.source === "catalog" ? `<span class="mcp-state mcp-source">预置</span>` : ""}
                <span class="mcp-state">${escapeHtml(mcpServerStateLabel(server))}</span>
              </div>
              <div class="mcp-actions">${mcpServerActionsHtml(server, status)}</div>
            </div>
            ${server.source === "catalog" ? "" : `<div class="mcp-meta">${escapeHtml(mcpServerMetaText(server))}</div>`}
            ${server.source !== "catalog" && server.description ? `<div class="mcp-meta">${escapeHtml(server.description)}</div>` : ""}
            ${server.source !== "catalog" && server.prerequisite ? `<div class="mcp-meta">运行要求：${escapeHtml(server.prerequisite)}</div>` : ""}
            ${server.installError ? `<div class="mcp-error">${escapeHtml(server.installError)}</div>` : ""}
            ${mcpStatusHtml(server, status)}
          </div>
        `,
          )
          .join(""),
        { aside: `<span class="panel-card-aside">启动后自动重载 Agent</span>` },
      )
    : `<div class="panel-empty-card">
        <div class="panel-empty-mark">MCP</div>
        <h3>还没有 MCP 服务器</h3>
        <p>${
          mcpScope === "project"
            ? "当前项目还没有 .pi/mcp.json。信任项目并重载 Agent 后可用。"
            : "添加服务器后，重载 Agent 才会加载。"
        }</p>
        <div class="empty-actions"><button class="panel-action primary" id="emptyCreateMcp" type="button">添加服务器</button></div>
      </div>`;
  const configCard = panelCardHtml(
    "配置",
    settingRowsHtml([{ label: "配置文件", value: data?.path || "", open: true }]),
  );
  const catalogErrors = Array.isArray(data?.catalogErrors) ? data.catalogErrors : [];
  const statusErrors = Array.isArray(status?.errors) ? status.errors : [];
  const errorMessages = [
    ...catalogErrors.map((error) => `catalog.json：${error}`),
    ...statusErrors,
  ];
  const errorCard = errorMessages.length
    ? panelCardHtml(
        "目录 / 检查错误",
        errorMessages.map((error) => `<div class="panel-error-row">${escapeHtml(error)}</div>`).join(""),
      )
    : "";
  const noteCard = status?.note
    ? panelCardHtml("说明", `<p class="panel-copy">${escapeHtml(status.note)}</p>`, { padded: true })
    : "";

  if (!servers.length) $("createButton").hidden = true;

  $("panelBody").innerHTML = `<div class="panel-page">${mcpHero}${mcpMetrics}
    <div class="mcp-scope-row">
      <div class="mcp-scope-switch" aria-label="MCP 配置作用域">
        <button class="mcp-scope-button ${mcpScope === "user" ? "active" : ""}" data-mcp-scope="user" type="button">用户级</button>
        <button class="mcp-scope-button ${mcpScope === "project" ? "active" : ""}" data-mcp-scope="project" type="button">项目级</button>
      </div>
      <span class="mcp-scope-note">${scopeNote}</span>
    </div>
    ${serverList}${configCard}${errorCard}${noteCard}
  </div>`;
  const emptyCreate = $("emptyCreateMcp");
  if (emptyCreate) emptyCreate.addEventListener("click", openMcpCreate);
  const addMcp = $("mcpAddButton");
  if (addMcp) addMcp.addEventListener("click", openMcpCreate);
  bindOpenButtons();
  $("panelBody").querySelectorAll("[data-mcp-scope]").forEach((button) => {
    button.addEventListener("click", async () => {
      mcpScope = button.dataset.mcpScope === "project" ? "project" : "user";
      await load();
    });
  });
  $("panelBody").querySelectorAll("[data-mcp-start]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.mcpStart;
      if (!id) return;
      const server = servers.find((item) => item.catalogId === id);
      if (!server) return;
      if (server.inputs?.length) {
        openMcpStart(server);
        return;
      }
      const original = button.textContent;
      button.disabled = true;
      button.textContent = "准备中…";
      setMcpCardStatus(server, server.type === "http" ? "配置中" : "安装中", "idle");
      try {
        await startCatalogFromPanel(server);
      } catch (error) {
        showMessage(error.message, true);
        setMcpCardStatus(server, server.type === "http" ? "配置失败" : "安装失败", "warn");
        button.disabled = false;
        button.textContent = original;
      }
    });
  });
  $("panelBody").querySelectorAll("[data-mcp-info]").forEach((button) => {
    button.addEventListener("click", () => {
      const server = servers.find((item) => item.name === button.dataset.mcpInfo);
      if (server) openMcpInfo(server);
    });
  });
  $("panelBody").querySelectorAll("[data-mcp-check]").forEach((button) => {
    button.addEventListener("click", async () => {
      const name = button.dataset.mcpCheck;
      const original = button.textContent;
      button.disabled = true;
      button.textContent = "检查中...";
      try {
        const result = await API.checkMcp(name, mcpScope);
        if (!result?.success) throw new Error(result?.error || "MCP 检查失败");
        const data = await API.listMcp(mcpScope);
        renderMcp(data, result);
        const report = result.servers?.find((item) => item.name === name);
        showMessage(
          report?.state === "connected"
            ? `${name} 已连接 · ${report.tools?.length ?? 0} 个工具`
            : `${name} 检查完成：${report?.error || report?.state || "未知"}`,
          report?.state !== "connected",
        );
      } catch (error) {
        showMessage(error.message, true);
        button.disabled = false;
        button.textContent = original;
      }
    });
  });
  $("panelBody").querySelectorAll("[data-mcp-toggle]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await API.toggleMcp(button.dataset.mcpToggle, button.dataset.enabled !== "true", mcpScope);
        await load();
        showMessage("MCP 状态已保存，重载 Agent 后生效");
      } catch (error) {
        showMessage(error.message, true);
        button.disabled = false;
      }
    });
  });
  $("panelBody").querySelectorAll("[data-mcp-edit]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const data = await API.listMcp(mcpScope);
        const server = data?.servers?.find((item) => item.name === button.dataset.mcpEdit);
        if (server) openMcpEditor(server);
      } catch (error) {
        showMessage(error.message, true);
      }
    });
  });
  $("panelBody").querySelectorAll("[data-mcp-delete]").forEach((button) => {
    button.addEventListener("click", () => openMcpDelete(button.dataset.mcpDelete));
  });
  $("panelBody").querySelectorAll("[data-mcp-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const name = button.dataset.mcpName;
      const action = button.dataset.mcpAction;
      if (!name || !action) return;
      button.disabled = true;
      try {
        const result = await API.runMcpCommand(name, action);
        if (!result?.ok) throw new Error(result?.error || "MCP 命令未执行");
        const messages = {
          login: "已请求登录，请在主窗口按提示完成浏览器授权与回填",
          logout: "已请求登出",
          reconnect: "已请求重连，稍后点“检查”确认状态",
        };
        showMessage(messages[action] || "MCP 命令已发送");
      } catch (error) {
        showMessage(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
  });
}

async function checkAllMcp(notify = false) {
  const button = $("checkMcpButton");
  if (button) {
    button.disabled = true;
    button.textContent = "检查中...";
  }
  try {
    const result = await API.checkMcp("", mcpScope);
    if (!result?.success) throw new Error(result?.error || "MCP 检查失败");
    const data = await API.listMcp(mcpScope);
    renderMcp(data, result);
    if (notify) {
      const connected = result.servers?.filter((server) => server.state === "connected").length ?? 0;
      const enabled = result.servers?.filter((server) => server.state !== "disabled").length ?? 0;
      const source = result.live ? "Agent 实时" : "离线";
      showMessage(
        enabled
          ? `${source}状态：已检查 ${enabled} 个服务器 · ${connected} 个连接`
          : "没有启用的 MCP 服务器",
      );
    }
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "检查连接";
    }
  }
}

function openMcpCreate() {
  mcpDialogScope = mcpScope;
  openMcpDialog(null);
}

function openMcpEditor(server) {
  mcpDialogScope = mcpScope;
  openMcpDialog(server);
}

function mcpToolExposureRows(server) {
  const report = mcpStatus?.servers?.find((item) => item.name === server?.name);
  const existing = server?.toolExposure && typeof server.toolExposure === "object" ? server.toolExposure : {};
  const tools = new Set([
    ...(Array.isArray(report?.tools) ? report.tools.map((tool) => String(tool)) : []),
    ...Object.keys(existing),
  ]);
  if (tools.size === 0) {
    return `<div class="mcp-tool-empty">先点服务器卡片的“检查”，发现工具后这里会出现逐工具开关。</div>`;
  }
  return `<div class="mcp-tool-list">${[...tools]
    .sort((left, right) => left.localeCompare(right))
    .map((tool) => {
      const mode = typeof existing[tool] === "string" ? existing[tool] : "direct";
      const checked = mode !== "hidden";
      const options = ["direct", "deferred", "codemode"]
        .map((value) => `<option value="${value}"${mode === value ? " selected" : ""}>${value}</option>`)
        .join("");
      return `<div class="mcp-tool-row">
        <label class="mcp-tool-toggle">
          <input type="checkbox" data-mcp-tool="${escapeHtml(tool)}"${checked ? " checked" : ""} />
          <span>${escapeHtml(tool)}</span>
        </label>
        <select class="dialog-input mcp-tool-mode" data-mcp-tool-mode="${escapeHtml(tool)}"${
          checked ? "" : " disabled"
        }>${options}</select>
      </div>`;
    })
    .join("")}</div>`;
}

function collectMcpToolExposure() {
  const inputs = [...document.querySelectorAll("[data-mcp-tool]")];
  if (inputs.length === 0) return null;
  const exposure = {};
  for (const input of inputs) {
    const mode = input.closest(".mcp-tool-row")?.querySelector("[data-mcp-tool-mode]");
    exposure[input.dataset.mcpTool] = input.checked ? (mode?.value || "direct") : "hidden";
  }
  return exposure;
}

function openMcpDialog(server) {
  const args = server?.args?.join("\n") ?? "";
  const headers = server?.headers && Object.keys(server.headers).length
    ? JSON.stringify(server.headers, null, 2)
    : "";
  setRuleDialogMode({
    mode: server ? "mcp-edit" : "mcp-create",
    id: server?.name || null,
    title: server ? `编辑 ${server.name}` : "添加 MCP 服务器",
    submit: "保存",
    body: `
      <div class="dialog-grid">
        <label class="dialog-field">
          <span>名称</span>
          <input id="mcpNameInput" class="dialog-input" placeholder="例如 chrome-devtools" autocomplete="off" spellcheck="false" value="${escapeHtml(server?.name || "")}" />
        </label>
        <label class="dialog-field">
          <span>类型</span>
          <select id="mcpTypeInput" class="dialog-input">
            <option value="stdio"${server?.type !== "http" ? " selected" : ""}>stdio</option>
            <option value="http"${server?.type === "http" ? " selected" : ""}>http</option>
          </select>
        </label>
        <label class="dialog-field dialog-field-wide">
          <span>命令</span>
          <input id="mcpCommandInput" class="dialog-input" placeholder="例如 npx" value="${escapeHtml(server?.command || "")}" />
        </label>
        <label class="dialog-field dialog-field-wide">
          <span>参数，每行一个</span>
          <textarea id="mcpArgsInput" class="dialog-textarea" placeholder="-y
chrome-devtools-mcp@latest">${escapeHtml(args)}</textarea>
        </label>
        <label class="dialog-field dialog-field-wide">
          <span>HTTP 地址</span>
          <input id="mcpUrlInput" class="dialog-input" placeholder="https://example.com/mcp" value="${escapeHtml(server?.url || "")}" />
        </label>
        <label class="dialog-field dialog-field-wide">
          <span>请求头 JSON（可选）</span>
          <textarea id="mcpHeadersInput" class="dialog-textarea" placeholder='{"Authorization": "Bearer \${TOKEN}"}'>${escapeHtml(headers)}</textarea>
        </label>
        <label class="dialog-field">
          <span>工具暴露</span>
          <select id="mcpExposureInput" class="dialog-input">
            <option value="codemode"${(server?.exposure || "codemode") === "codemode" ? " selected" : ""}>codemode · 脚本调用</option>
            <option value="deferred"${server?.exposure === "deferred" ? " selected" : ""}>deferred · tool_search 加载</option>
            <option value="direct"${server?.exposure === "direct" ? " selected" : ""}>direct · 直接声明</option>
            <option value="hidden"${server?.exposure === "hidden" ? " selected" : ""}>hidden · 隐藏</option>
          </select>
        </label>
        <label class="dialog-field dialog-field-wide">
          <span>描述（可选）</span>
          <input id="mcpDescriptionInput" class="dialog-input" placeholder="这个服务器提供什么工具" value="${escapeHtml(server?.description || "")}" />
        </label>
        <div class="dialog-field dialog-field-wide">
          <span>逐工具启停</span>
          ${mcpToolExposureRows(server)}
          <div class="model-hint">未勾选写入 hidden；列表来自最近一次“检查”，也可稍后手动编辑 mcp.json。</div>
        </div>
      </div>`,
  });
  $("ruleDialogBody").querySelectorAll("[data-mcp-tool]").forEach((input) => {
    input.addEventListener("change", () => {
      const mode = input.closest(".mcp-tool-row")?.querySelector("[data-mcp-tool-mode]");
      if (mode) mode.disabled = !input.checked;
    });
  });
}

function openMcpDelete(name) {
  mcpDialogScope = mcpScope;
  setRuleDialogMode({
    mode: "mcp-delete",
    id: name,
    title: "删除 MCP 服务器",
    submit: "删除",
    danger: true,
    body: `<p class="dialog-copy">服务器 <strong>${escapeHtml(name)}</strong> 会从当前${mcpScope === "project" ? "项目级" : "用户级"} <code>mcp.json</code> 中移除。此操作不可撤销。</p>`,
  });
}

function providerPreset(provider) {
  return PROVIDER_PRESETS.find((preset) => preset.id === provider);
}

function compactTokenCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return "未设置";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}m`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}k`;
  return String(count);
}

function panelHeroHtml({ ready = false, stateLabel = "", chips = [] }) {
  const chipHtml = chips
    .filter(Boolean)
    .map((chip, index) => {
      const label = typeof chip === "string" ? chip : chip.label;
      const accent = typeof chip === "object" && chip.accent;
      const separator = index > 0 ? '<span class="panel-summary-sep">·</span>' : "";
      return `${separator}<span class="panel-summary-chip${accent ? " accent" : ""}">${escapeHtml(label)}</span>`;
    })
    .join("");
  return `
    <section class="panel-summary${ready ? " ready" : ""}">
      ${stateLabel ? `<span class="panel-summary-state"><span class="panel-summary-dot"></span>${escapeHtml(stateLabel)}</span>` : ""}
      ${chipHtml ? `<div class="panel-summary-facts">${chipHtml}</div>` : ""}
    </section>
  `;
}

function panelMetricsHtml(items) {
  return `<div class="panel-stat-strip">${items
    .map(
      (item) => `<div class="panel-stat${item.tone ? ` ${item.tone}` : ""}"><strong class="panel-stat-value">${escapeHtml(
        item.value,
      )}</strong><span class="panel-stat-label">${escapeHtml(item.label)}</span></div>`,
    )
    .join("")}</div>`;
}

function panelCardHtml(title, body, { aside = "", padded = false, className = "" } = {}) {
  return `<section class="panel-card${className ? ` ${className}` : ""}"><div class="panel-card-head"><div class="panel-card-title">${escapeHtml(
    title,
  )}</div>${aside}</div><div class="panel-card-body${padded ? " padded" : ""}">${body}</div></section>`;
}

function settingsHeroHtml(state, workspaceConfig, projectTrust) {
  const current = state.current;
  const modelInfo = state.customProviders
    ?.find((item) => item.provider === current?.provider)
    ?.models?.find((model) => model.id === current?.id);
  const contextWindow = current?.contextWindow || modelInfo?.contextWindow;
  const domainLabel = { auto: "自动识别", js: "JavaScript", app: "App" }[workspaceConfig?.domain || "auto"];
  const trustLabel = projectTrust?.mode === "trust" ? "信任项目资源" : "不加载项目资源";
  return panelHeroHtml({
    ready: Boolean(current),
    stateLabel: current ? "运行时已连接" : "运行时未连接",
    chips: [
      { label: current ? modelDisplayName(current) : state.defaultModel || "未配置模型", accent: true },
      current?.provider || state.defaultProvider || "未选择服务商",
      domainLabel,
      trustLabel,
      contextWindow ? `上下文 ${compactTokenCount(contextWindow)}` : "",
    ],
  });
}

function oauthLoginCardHtml(state, provider, credential) {
  const info = state.oauthProviders?.find((item) => item.id === provider);
  if (!info) return "";
  const credentialType = info.credentialType || credential?.type || null;
  const isOAuth = credentialType === "oauth";
  const isApiKey = credentialType === "api_key";
  const statusText = isOAuth ? "已通过账号登录" : isApiKey ? "当前使用 API Key" : "未登录";
  const flowText = info.flow === "device" ? "设备码" : "浏览器授权";
  return `
    <div class="model-oauth">
      <div class="model-section-label">账号登录</div>
      <div class="model-oauth-card">
        <div class="model-oauth-copy">
          <div class="model-oauth-title">
            <strong>${escapeHtml(info.authName)}</strong>
            <span class="model-oauth-status${isOAuth ? " ready" : ""}"><span class="model-state-dot"></span>${escapeHtml(statusText)}</span>
          </div>
          <p>${escapeHtml(info.description)}</p>
          <div class="model-oauth-meta">${escapeHtml(info.name)} · ${escapeHtml(flowText)}</div>
        </div>
        <div class="model-oauth-actions">
          <button class="panel-action subtle" data-oauth-action="login" type="button">${isOAuth ? "重新登录" : "登录"}</button>
          ${isOAuth ? '<button class="panel-action subtle" data-oauth-action="logout" type="button">登出</button>' : ""}
        </div>
      </div>
      ${
        isApiKey
          ? '<div class="model-hint">账号登录会覆盖当前 API Key；API Key 仍可随时重新保存。</div>'
          : '<div class="model-hint">登录后会自动写入 Pi 的 auth.json，并在 Agent 重启后刷新模型目录。</div>'
      }
    </div>
  `;
}

function modelFormHtml(state) {
  const currentProvider = state.current?.provider === "unknown" ? null : state.current?.provider;
  const activeProvider =
    state.defaultProvider || currentProvider || "deepseek";
  const known = providerPreset(activeProvider);
  const preset = known ?? {
    id: activeProvider,
    label: activeProvider,
    name: activeProvider,
    custom: true,
    api: state.customProviders?.find((item) => item.provider === activeProvider)?.api || "openai-completions",
    models: [],
  };
  const customInfo = state.customProviders?.find((item) => item.provider === activeProvider);
  const currentId = state.current?.id === "unknown" ? null : state.current?.id;
  const activeModel = state.defaultModel || currentId || preset.models[0]?.id || "";
  const savedModelInfo = customInfo?.models?.find((model) => model.id === activeModel);
  const activeCredential = state.credentials?.find((item) => item.provider === activeProvider);
  const currentLabel = state.current ? modelDisplayName(state.current) : state.defaultModel || "未配置模型";
  const currentThinkingText = state.current ? thinkingLevelsText(state.current.thinkingLevels) : "运行时未连接";

  const providerOptions = [...PROVIDER_PRESETS];
  if (!known && activeProvider) {
    providerOptions.push({
      id: activeProvider,
      label: activeProvider,
      name: activeProvider,
      custom: true,
      api: customInfo?.api || "openai-completions",
      models: [],
    });
  }

  return `
    <section class="model-config">
      <div class="model-config-head">
        <div class="model-config-head-copy">
          <div class="model-config-title">模型</div>
          <div class="model-config-current">
            <span class="model-config-model">${escapeHtml(currentLabel)}</span>
            <span class="model-config-provider">${escapeHtml(known ? preset.label : activeProvider)}</span>
          </div>
          <div class="model-config-thinking">思考档位：${escapeHtml(currentThinkingText)}</div>
        </div>
        <span class="model-config-state ${state.current ? "ready" : ""}"><span class="model-state-dot"></span>${state.current ? "已连接" : "未连接"}</span>
      </div>
      <div class="model-grid">
        <label class="model-field">
          <span>服务商</span>
          <select id="modelProvider">
            ${providerOptions
              .map(
                (item) =>
                  `<option value="${escapeHtml(item.id)}" ${item.id === activeProvider ? "selected" : ""}>${escapeHtml(item.label)}</option>`,
              )
              .join("")}
          </select>
        </label>
        <label class="model-field">
          <span>模型 ID</span>
          <input id="modelId" class="model-input" list="modelOptions" value="${escapeHtml(activeModel)}" placeholder="例如 deepseek-flash" autocomplete="off" />
          <datalist id="modelOptions">
            ${preset.models.map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.name)}</option>`).join("")}
          </datalist>
        </label>
        <label class="model-field model-field-wide">
          <span>API Key</span>
          <input id="modelKey" class="model-input" type="password" value="" placeholder="${activeCredential ? "已保存，留空保持不变" : "输入 API Key"}" autocomplete="off" spellcheck="false" />
        </label>
        <label class="model-field model-custom-field">
          <span>接口地址</span>
          <input id="modelBaseUrl" class="model-input" value="${escapeHtml(customInfo?.baseUrl || "")}" placeholder="https://api.example.com/v1" autocomplete="off" />
        </label>
        <label class="model-field model-custom-field">
          <span>接口类型</span>
          <select id="modelApi">
            ${MODEL_APIS.map(
              ([value, label]) =>
                `<option value="${value}" ${value === (customInfo?.api || preset.api || "openai-completions") ? "selected" : ""}>${label}</option>`,
            ).join("")}
          </select>
        </label>
      </div>
      <div id="modelOauthSlot">${oauthLoginCardHtml(state, activeProvider, activeCredential)}</div>
      <div class="model-custom-field">
        <div class="model-section-label">能力与限额</div>
        <div class="model-capabilities">
          <label class="model-check">
            <input id="modelReasoning" type="checkbox" ${savedModelInfo?.reasoning ? "checked" : ""} />
            <span>推理模型</span>
          </label>
          <label class="model-check">
            <input id="modelVision" type="checkbox" ${savedModelInfo?.input?.includes("image") ? "checked" : ""} />
            <span>图像输入</span>
          </label>
          <label class="model-field model-number">
            <span>上下文窗口</span>
            <input id="modelContextWindow" class="model-input" type="number" min="1" step="1000" value="${escapeHtml(savedModelInfo?.contextWindow ?? 128000)}" />
          </label>
          <label class="model-field model-number">
            <span>最大输出</span>
            <input id="modelMaxTokens" class="model-input" type="number" min="1" step="1000" value="${escapeHtml(savedModelInfo?.maxTokens ?? 16384)}" />
          </label>
        </div>
      </div>
      <div class="model-library model-custom-field" id="modelLibrary" hidden></div>
      <div class="model-test-result" id="modelTestResult" hidden></div>
      <div class="model-actions">
        ${preset.custom ? '<span class="model-hint" id="modelHint">填写兼容端点后保存</span>' : '<span class="model-hint">使用内置模型目录</span>'}
        <div class="model-action-group">
          <button class="panel-action subtle" id="testModel" type="button">测试连接</button>
          <button class="panel-action subtle" id="testInference" type="button">测试推理</button>
          <button class="panel-action subtle" id="checkModel" type="button">检查配置</button>
          <button class="panel-action subtle" id="clearModelKey" type="button" ${activeCredential ? "" : "hidden"}>清除凭据</button>
          <button class="panel-action primary" id="saveModel" type="button">保存并重启 Agent</button>
        </div>
      </div>
    </section>
  `;
}

function renderModelTestResult(result) {
  const box = $("modelTestResult");
  if (!box) return;
  const ok = Boolean(result?.ok);
  box.hidden = false;
  box.className = `model-test-result ${ok ? "ready" : "error"}`;
  const models = Array.isArray(result?.models) ? result.models : [];
  const answer = result?.text ? `<div class="model-test-answer">${escapeHtml(result.text)}</div>` : "";
  box.innerHTML = `<div class="model-test-message">${escapeHtml(result?.message || "连接测试完成")}</div>${answer}${
    models.length
      ? `<div class="model-chips">${models
          .map(
            (model) =>
              `<button class="model-chip" type="button" data-model-id="${escapeHtml(model.id)}">${escapeHtml(modelDisplayName(model))}</button>`,
          )
          .join("")}</div>`
      : ""
  }`;
  box.querySelectorAll("[data-model-id]").forEach((button) => {
    button.addEventListener("click", () => {
      $("modelId").value = button.dataset.modelId || "";
      $("modelId").dispatchEvent(new Event("input", { bubbles: true }));
      showMessage(`已选择 ${button.dataset.modelId}`);
    });
  });
}

function bindModelForm(state) {
  const provider = $("modelProvider");
  const modelId = $("modelId");
  const modelKey = $("modelKey");
  const baseUrl = $("modelBaseUrl");
  const api = $("modelApi");
  const hint = $("modelHint");
  const testResult = $("modelTestResult");
  const library = $("modelLibrary");
  const customFields = document.querySelectorAll(".model-custom-field");
  const oauthSlot = $("modelOauthSlot");
  const reasoning = $("modelReasoning");
  const vision = $("modelVision");
  const contextWindow = $("modelContextWindow");
  const maxTokens = $("modelMaxTokens");

  const syncModelMeta = () => {
    const providerInfo = state.customProviders?.find((item) => item.provider === provider.value);
    const modelInfo = providerInfo?.models?.find((model) => model.id === modelId.value.trim());
    reasoning.checked = modelInfo?.reasoning === true;
    vision.checked = modelInfo?.input?.includes("image") === true;
    contextWindow.value = modelInfo?.contextWindow ?? 128000;
    maxTokens.value = modelInfo?.maxTokens ?? 16384;
  };

  const renderModelLibrary = (providerInfo) => {
    const models = providerInfo?.models || [];
    library.hidden = models.length === 0;
    library.innerHTML = models.length
      ? `<div class="model-library-head">已保存模型</div><div class="model-library-list">${models
          .map((model) => {
            const displayName = modelDisplayName(model);
            const meta = displayName === model.id ? "" : `<span>${escapeHtml(model.id)}</span>`;
            return `<button class="model-library-item" type="button" data-model-id="${escapeHtml(model.id)}"><strong>${escapeHtml(
              displayName,
            )}</strong>${meta}</button>`;
          })
          .join("")}</div>`
      : "";
    library.querySelectorAll("[data-model-id]").forEach((button) => {
      button.addEventListener("click", () => {
        modelId.value = button.dataset.modelId || "";
        modelId.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });
  };

  const syncApiHint = () => {
    const providerPresetInfo = providerPreset(provider.value);
    if (!providerPresetInfo?.custom) {
      if (hint) hint.textContent = "使用内置模型目录";
      return;
    }
    if (api.value === "anthropic-messages") {
      baseUrl.placeholder = "https://api.example.com";
      if (hint) hint.textContent = "Anthropic 填服务根地址，不要带 /v1";
    } else {
      baseUrl.placeholder = "https://api.example.com/v1";
      if (hint) hint.textContent = "填写兼容端点后保存";
    }
  };

  const syncProvider = () => {
    const preset = providerPreset(provider.value) || {
      id: provider.value,
      custom: true,
      api: "openai-completions",
      models: [],
    };
    const customInfo = state.customProviders?.find((item) => item.provider === provider.value);
    const credential = state.credentials?.find((item) => item.provider === provider.value);
    oauthSlot.innerHTML = oauthLoginCardHtml(state, provider.value, credential);
    customFields.forEach((field) => {
      field.hidden = !preset.custom;
    });
    baseUrl.value = customInfo?.baseUrl || "";
    api.value = customInfo?.api || preset.api || "openai-completions";
    const savedModel = state.defaultProvider === provider.value ? state.defaultModel : "";
    modelId.value = savedModel || preset.models[0]?.id || "";
    modelId.setAttribute("list", preset.models.length ? "modelOptions" : "");
    $("modelOptions").innerHTML = preset.models
      .map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.name)}</option>`)
      .join("");
    modelKey.value = "";
    modelKey.placeholder = credential ? "已保存，留空保持不变" : "输入 API Key";
    $("clearModelKey").hidden = !credential;
    syncModelMeta();
    renderModelLibrary(customInfo);
    testResult.hidden = true;
    testResult.innerHTML = "";
    syncApiHint();
  };

  const configForRequest = (preset) => {
    return {
      provider: provider.value,
      name: preset.name || provider.value,
      custom: Boolean(preset.custom),
      model: modelId.value.trim(),
      apiKey: modelKey.value.trim(),
      baseUrl: baseUrl.value.trim(),
      api: api.value,
      reasoning: reasoning.checked,
      input: vision.checked ? ["text", "image"] : ["text"],
      contextWindow: Number(contextWindow.value),
      maxTokens: Number(maxTokens.value),
    };
  };

  provider.addEventListener("change", syncProvider);
  oauthSlot.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-oauth-action]");
    if (!button) return;
    if (button.dataset.oauthAction === "login") {
      openOAuthLogin(provider.value);
      return;
    }
    if (button.dataset.oauthAction === "logout") {
      button.disabled = true;
      button.textContent = "登出中...";
      try {
        const result = await API.logoutOAuthProvider(provider.value);
        if (!result?.ok) throw new Error(result?.error || "登出失败");
        modelConfigState = await API.getModelConfig();
        showMessage("已退出账号登录");
        await renderSettings();
      } catch (error) {
        showMessage(agentErrorMessage(error.message, "登出失败"), true);
        button.disabled = false;
        button.textContent = "登出";
      }
    }
  });
  api.addEventListener("change", () => {
    syncApiHint();
    testResult.hidden = true;
    testResult.innerHTML = "";
  });
  modelId.addEventListener("input", syncModelMeta);
  syncProvider();

  $("clearModelKey").addEventListener("click", async () => {
    const current = provider.value;
    try {
      await API.clearModelKey(current);
      modelConfigState = await API.getModelConfig();
      showMessage("已清除该服务商的凭据");
      await renderSettings();
    } catch (error) {
      showMessage(error.message, true);
    }
  });

  $("checkModel").addEventListener("click", async () => {
    const preset = providerPreset(provider.value) || {
      id: provider.value,
      label: provider.value,
      name: provider.value,
      custom: true,
      api: "openai-completions",
    };
    try {
      const result = await API.checkModelConfig(configForRequest(preset));
      showMessage(result?.message || "配置检查完成", !result?.ok);
    } catch (error) {
      showMessage(error.message, true);
    }
  });

  $("testModel").addEventListener("click", async () => {
    const preset = providerPreset(provider.value) || {
      id: provider.value,
      label: provider.value,
      name: provider.value,
      custom: true,
      api: "openai-completions",
    };
    const button = $("testModel");
    button.disabled = true;
    button.textContent = "测试中...";
    try {
      const result = await API.testModelConnection(configForRequest(preset));
      renderModelTestResult(result);
    } catch (error) {
      renderModelTestResult({ ok: false, message: error.message });
    } finally {
      button.disabled = false;
      button.textContent = "测试连接";
    }
  });

  $("testInference").addEventListener("click", async () => {
    const preset = providerPreset(provider.value) || {
      id: provider.value,
      label: provider.value,
      name: provider.value,
      custom: true,
      api: "openai-completions",
    };
    const button = $("testInference");
    button.disabled = true;
    button.textContent = "推理中...";
    try {
      const result = await API.testModelInference(configForRequest(preset));
      renderModelTestResult(result);
    } catch (error) {
      renderModelTestResult({ ok: false, message: error.message });
    } finally {
      button.disabled = false;
      button.textContent = "测试推理";
    }
  });

  $("saveModel").addEventListener("click", async () => {
    const preset = providerPreset(provider.value) || {
      id: provider.value,
      label: provider.value,
      name: provider.value,
      custom: true,
      api: "openai-completions",
    };
    const config = configForRequest(preset);
    if (!config.model) {
      showMessage("请填写模型 ID", true);
      return;
    }
    const saveButton = $("saveModel");
    saveButton.disabled = true;
    saveButton.textContent = "保存中...";
    try {
      await API.saveModelConfig(config);
      modelConfigState = await API.getModelConfig();
      showMessage("模型已保存，Agent 已重启");
      await renderSettings();
    } catch (error) {
      showMessage(
        String(error.message || error).replace(/^Error invoking remote method '[^']+': Error: /, ""),
        true,
      );
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = "保存并重启 Agent";
    }
  });
}

function openOAuthLogin(provider) {
  const info = modelConfigState?.oauthProviders?.find((item) => item.id === provider);
  if (!info) {
    showMessage("当前服务商没有可用的账号登录", true);
    return;
  }
  oauthDialogState = {
    provider: info.id,
    info,
    loginId: null,
    action: "wait",
    url: "",
    authUrl: "",
    authInstructions: "",
    promptId: null,
  };
  setRuleDialogMode({
    mode: "oauth-login",
    title: `登录 ${info.name}`,
    submit: "等待授权",
    hideCancel: false,
    body: `
      <div class="oauth-dialog">
        <div class="oauth-status-line">
          <span class="oauth-pulse" aria-hidden="true"></span>
          <div class="oauth-status-copy">
            <strong id="oauthDialogMessage">正在启动账号登录…</strong>
            <span id="oauthDialogHint">${escapeHtml(info.description)}</span>
          </div>
        </div>
        <div class="oauth-dialog-detail" id="oauthDialogDetail"></div>
        <div class="dialog-message" id="oauthDialogError" role="status" aria-live="polite"></div>
      </div>`,
  });
  $("ruleDialogSubmit").disabled = true;
  API.startOAuthLogin(info.id)
    .then((result) => {
      if (!oauthDialogState || oauthDialogState.provider !== info.id) {
        if (result?.loginId) API.cancelOAuthLogin().catch(() => {});
        return;
      }
      oauthDialogState.loginId = result.loginId;
      renderOAuthDialog("等待授权完成…", "");
    })
    .catch((error) => {
      if (!oauthDialogState) return;
      oauthDialogState.action = "close";
      renderOAuthDialog("无法启动账号登录", "", true, error.message);
      const submit = $("ruleDialogSubmit");
      submit.disabled = false;
      submit.textContent = "关闭";
    });
}

function renderOAuthDialog(message, detailHtml = "", error = false, errorText = "") {
  const messageNode = $("oauthDialogMessage");
  const detailNode = $("oauthDialogDetail");
  const errorNode = $("oauthDialogError");
  if (!messageNode || !detailNode || !errorNode) return;
  messageNode.textContent = message;
  detailNode.innerHTML = detailHtml;
  errorNode.textContent = error ? errorText || message : "";
  errorNode.classList.toggle("visible", Boolean(error));
}

function oauthUiMessage(message) {
  const text = String(message || "");
  const translations = new Map([
    ["Complete login in your browser, or paste the final redirect URL here:", "在浏览器中完成登录；如果回调没有自动完成，请把最终的跳转链接粘贴到这里。"],
    ["Complete sign-in in your browser, or paste the authorization code / redirect URL here:", "在浏览器中完成授权；也可以把授权码或回调地址粘贴到这里。"],
    ["Complete sign-in in your browser. If the callback does not complete, paste the final redirect URL here.", "在浏览器中完成登录。如果回调没有自动完成，请把最终的跳转链接粘贴到这里。"],
    ["Complete sign-in in your browser. If the browser is on another machine, paste the final redirect URL here.", "在浏览器中完成授权。如果浏览器在另一台机器上，请把最终的跳转链接粘贴到这里。"],
  ]);
  if (translations.has(text)) return translations.get(text);
  const callback = text.match(/^Listening for OpenRouter OAuth callback on (.+)$/u);
  if (callback) return `正在监听 OpenRouter 授权回调：${callback[1]}`;
  return text;
}

function oauthAuthLinkHtml(state, includeInstructions = true) {
  if (!state.authUrl) return "";
  return `
    <div class="oauth-link-row">
      <button class="panel-action subtle" data-oauth-dialog-action="open-url" type="button">打开授权页</button>
      <span class="oauth-url">${escapeHtml(state.authUrl)}</span>
    </div>
    ${includeInstructions && state.authInstructions ? `<p class="oauth-instruction">${escapeHtml(oauthUiMessage(state.authInstructions))}</p>` : ""}
  `;
}

async function handleOAuthEvent(payload) {
  const state = oauthDialogState;
  if (!state || !payload) return;
  if (payload.loginId && !state.loginId) state.loginId = payload.loginId;
  if (state.loginId && payload.loginId && payload.loginId !== state.loginId) return;

  if (payload.kind === "progress") {
    renderOAuthDialog(oauthUiMessage(payload.message) || "正在处理…", "");
    return;
  }

  if (payload.kind === "prompt_closed") {
    if (payload.promptId !== state.promptId) return;
    state.promptId = null;
    state.action = "wait";
    renderOAuthDialog("浏览器回调已接管，等待授权完成…", oauthAuthLinkHtml(state));
    $("ruleDialogSubmit").disabled = true;
    $("ruleDialogSubmit").textContent = "等待授权";
    return;
  }

  if (payload.kind === "prompt") {
    const prompt = payload.prompt || {};
    state.promptId = payload.promptId;
    state.action = "prompt";
    const submit = $("ruleDialogSubmit");
    submit.disabled = false;
    submit.textContent = "提交";
    if (prompt.type === "select") {
      const options = (prompt.options || [])
        .map(
          (option) =>
            `<option value="${escapeHtml(option.id)}">${escapeHtml(option.label)}${option.description ? ` — ${escapeHtml(option.description)}` : ""}</option>`,
        )
        .join("");
      renderOAuthDialog(
        oauthUiMessage(prompt.message) || "请选择登录方式",
        `<label class="oauth-prompt-field"><span>选择</span><select id="oauthPromptInput" class="dialog-input">${options}</select></label>${oauthAuthLinkHtml(state, false)}`,
      );
    } else {
      const inputType = prompt.type === "secret" ? "password" : "text";
      const inputPlaceholder =
        prompt.type === "manual_code" ? "粘贴授权码或回调地址" : String(prompt.placeholder || "");
      renderOAuthDialog(
        oauthUiMessage(prompt.message) || "请完成授权",
        `<label class="oauth-prompt-field"><span>${prompt.type === "manual_code" ? "授权码 / 回调地址" : "输入"}</span><input id="oauthPromptInput" class="dialog-input" type="${inputType}" placeholder="${escapeHtml(inputPlaceholder)}" autocomplete="off" spellcheck="false" /></label>${oauthAuthLinkHtml(state, false)}`,
      );
    }
    $("oauthPromptInput")?.focus();
    return;
  }

  if (payload.kind === "result") {
    if (payload.ok) {
      oauthDialogState = null;
      $("ruleDialog").close();
      modelConfigState = await API.getModelConfig().catch(() => modelConfigState);
      await renderSettings();
      const count = Number(payload.modelCount || 0);
      const warning = payload.warning ? `。${payload.warning}` : "";
      showMessage(`已登录 ${state.info.name}${count ? `，可用模型 ${count} 个` : ""}${warning}`);
      return;
    }
    state.action = "close";
    renderOAuthDialog("账号登录未完成", "", true, payload.error || "登录失败");
    const submit = $("ruleDialogSubmit");
    submit.disabled = false;
    submit.textContent = "关闭";
    return;
  }

  if (payload.kind !== "event") return;
  const event = payload.event || {};
  if (event.type === "auth_url") {
    state.action = "open";
    state.url = event.url;
    state.authUrl = event.url;
    state.authInstructions = event.instructions || "";
    renderOAuthDialog(
      "请在浏览器中完成授权",
      `${event.instructions ? `<p class="oauth-instruction">${escapeHtml(oauthUiMessage(event.instructions))}</p>` : ""}${oauthAuthLinkHtml(state)}`,
    );
    const submit = $("ruleDialogSubmit");
    submit.disabled = false;
    submit.textContent = "打开授权页";
    return;
  }
  if (event.type === "device_code") {
    state.action = "open";
    state.url = event.verificationUri;
    state.authUrl = event.verificationUri;
    state.authInstructions = "";
    renderOAuthDialog(
      "在浏览器中输入设备码",
      `<div class="oauth-code-label">设备码</div><div class="oauth-code">${escapeHtml(event.userCode)}</div>${oauthAuthLinkHtml(state)}`,
    );
    const submit = $("ruleDialogSubmit");
    submit.disabled = false;
    submit.textContent = "打开授权页";
    return;
  }
  if (event.type === "info") {
    renderOAuthDialog(oauthUiMessage(event.message) || "请继续完成授权", "", false);
    return;
  }
}

async function submitOAuthDialog() {
  const state = oauthDialogState;
  const submit = $("ruleDialogSubmit");
  if (!state) {
    $("ruleDialog").close();
    return;
  }
  if (state.action === "open") {
    if (!state.url) return;
    await API.openExternal(state.url);
    return;
  }
  if (state.action === "prompt") {
    const input = $("oauthPromptInput");
    const value = String(input?.value || "").trim();
    if (!value) {
      renderOAuthDialog("请粘贴授权码或回调地址", "", true, "授权输入不能为空");
      return;
    }
    submit.disabled = true;
    submit.textContent = "提交中…";
    try {
      await API.respondOAuthPrompt(state.promptId, value);
      state.promptId = null;
      state.action = "wait";
      renderOAuthDialog("正在验证授权…", "");
      submit.textContent = "等待授权";
    } catch (error) {
      submit.disabled = false;
      submit.textContent = "提交";
      renderOAuthDialog("提交失败", "", true, error.message);
    }
    return;
  }
  if (state.action === "close") {
    $("ruleDialog").close();
  }
}

function promptConfigHtml(prompts) {
  const labels = {
    core: "核心提示",
    workflow: "工作流",
    js: "JavaScript 领域",
    app: "App 领域",
  };
  return `
    <section class="settings-card prompt-card">
      <div class="settings-section-head">提示词</div>
      ${prompts
        .map(
          (prompt) => `
            <div class="setting-row">
              <span class="setting-label">${escapeHtml(labels[prompt.name] || prompt.name)}</span>
              <span class="setting-value">${escapeHtml(prompt.name)} · ${(prompt.bytes / 1024).toFixed(1)} KB</span>
              <button class="text-button" data-prompt-action="edit" data-prompt-name="${escapeHtml(prompt.name)}" type="button">编辑</button>
              <button class="text-button" data-prompt-action="reset" data-prompt-name="${escapeHtml(prompt.name)}" type="button">恢复默认</button>
            </div>
          `,
        )
        .join("")}
      <div class="model-actions">
        <span class="model-hint">修改提示词后点击顶部“重载 Agent”生效</span>
        <button class="panel-action subtle" id="previewPromptButton" type="button">预览最终提示词</button>
        <button class="panel-action subtle" id="openPromptsDir" type="button">打开提示词目录</button>
      </div>
    </section>
  `;
}

function bindPromptActions(prompts) {
  document.querySelectorAll("[data-prompt-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.promptAction;
      const name = button.dataset.promptName;
      if (action === "edit") {
        try {
          const prompt = await API.readPrompt(name);
          setRuleDialogMode({
            mode: "prompt-edit",
            id: name,
            title: `编辑提示词 · ${name}`,
            submit: "保存",
            body: `
              <label class="dialog-field">
                <span>${escapeHtml(name)}.md</span>
                <textarea id="promptContentInput" class="dialog-textarea" spellcheck="false">${escapeHtml(prompt.content)}</textarea>
              </label>`,
          });
        } catch (error) {
          showMessage(error.message, true);
        }
      } else if (action === "reset") {
        setRuleDialogMode({
          mode: "prompt-reset",
          id: name,
          title: "恢复默认提示词",
          submit: "恢复",
          danger: true,
          body: `<p class="dialog-copy">会覆盖 <strong>${escapeHtml(name)}.md</strong>，恢复为内置默认内容。当前修改不可撤销。</p>`,
        });
      }
    });
  });
  $("openPromptsDir")?.addEventListener("click", () => openPath(runtimeInfo?.promptsDir));
  $("previewPromptButton")?.addEventListener("click", openPromptPreview);
}

function promptTemplatesHtml(templateData) {
  const templates = templateData?.templates ?? [];
  const userCount = templates.filter((template) => template.scope === "user").length;
  const projectCount = templates.length - userCount;
  const rows = templates.length
    ? templates
        .map(
          (template) => `
            <div class="setting-row prompt-template-row">
              <span class="setting-label">/${escapeHtml(template.id)} <span class="panel-chip">${template.scope === "project" ? "项目" : "用户"}</span></span>
              <span class="setting-value">${escapeHtml(template.description)}${template.argumentHint ? ` · ${escapeHtml(template.argumentHint)}` : ""}${template.valid ? "" : ` · ${escapeHtml(template.error || "文件无效")}`}</span>
              ${
                template.valid
                  ? `<button class="text-button" data-prompt-template-action="edit" data-template-scope="${escapeHtml(template.scope)}" data-template-id="${escapeHtml(template.id)}" type="button">编辑</button>
                     <button class="text-button danger" data-prompt-template-action="delete" data-template-scope="${escapeHtml(template.scope)}" data-template-id="${escapeHtml(template.id)}" type="button">删除</button>`
                  : `<span class="panel-chip">需手动处理</span>`
              }
            </div>
          `,
        )
        .join("")
    : `
      <div class="panel-empty-card prompt-template-empty">
        <div class="panel-empty-mark">/</div>
        <h3>还没有提示模板</h3>
        <p>新建一个 Markdown 模板后，Pi 会把它注册成斜杠命令。</p>
        <div class="empty-actions">
          <button class="panel-action primary" id="createPromptTemplateEmptyButton" type="button">新建模板</button>
        </div>
      </div>`;
  return `
    <section class="settings-card prompt-template-card">
      <div class="settings-section-head">提示模板</div>
      <div class="model-hint">Pi 会从用户级和项目级模板目录读取 .md 文件，并注册成命令面板里的斜杠命令。${userCount ? `用户级 ${userCount} 个` : ""}${projectCount ? `${userCount ? "，" : ""}项目级 ${projectCount} 个` : ""}</div>
      ${rows}
      <div class="model-actions">
        <span class="model-hint">项目级模板位于 .pi/prompts，需要信任项目后才会加载</span>
        <button class="panel-action subtle" id="createPromptTemplateButton" type="button">新建模板</button>
        <button class="panel-action subtle" id="openPromptTemplatesDir" type="button">打开用户模板目录</button>
      </div>
    </section>
  `;
}

function bindPromptTemplateActions(templateData) {
  $("createPromptTemplateButton")?.addEventListener("click", () => openPromptTemplateCreate());
  $("createPromptTemplateEmptyButton")?.addEventListener("click", () => openPromptTemplateCreate());
  $("openPromptTemplatesDir")?.addEventListener("click", () => openPath(runtimeInfo?.promptTemplatesDir));
  document.querySelectorAll("[data-prompt-template-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.promptTemplateAction;
      const templateScope = button.dataset.templateScope;
      const templateId = button.dataset.templateId;
      const template = (templateData?.templates ?? []).find(
        (item) => item.id === templateId && item.scope === templateScope,
      );
      if (!template) return;
      if (action === "delete") {
        openPromptTemplateDelete(template);
        return;
      }
      try {
        const loaded = await API.readPromptTemplate(templateScope, templateId);
        openPromptTemplateEdit(loaded);
      } catch (error) {
        showMessage(error.message, true);
      }
    });
  });
}

function promptTemplateFields({ scope = "user", description = "", argumentHint = "", content = "", id = null } = {}) {
  const scopeLabel = scope === "project" ? "项目级" : "用户级";
  return `
    <div class="dialog-grid">
      ${
        id
          ? `
            <div class="dialog-field"><span>模板 ID</span><strong class="dialog-value">/${escapeHtml(id)}</strong></div>
            <div class="dialog-field"><span>作用域</span><strong class="dialog-value">${scopeLabel}</strong></div>`
          : `
            <label class="dialog-field">
              <span>模板 ID</span>
              <input id="promptTemplateIdInput" class="dialog-input" placeholder="例如 review" autocomplete="off" spellcheck="false" />
            </label>
            <label class="dialog-field">
              <span>作用域</span>
              <select id="promptTemplateScopeInput" class="dialog-input">
                <option value="user" ${scope === "user" ? "selected" : ""}>用户级</option>
                <option value="project" ${scope === "project" ? "selected" : ""}>项目级</option>
              </select>
            </label>`
      }
      <label class="dialog-field dialog-field-wide">
        <span>描述</span>
        <input id="promptTemplateDescriptionInput" class="dialog-input" placeholder="命令面板里显示的说明" value="${escapeHtml(description)}" autocomplete="off" />
      </label>
      <label class="dialog-field dialog-field-wide">
        <span>参数提示</span>
        <input id="promptTemplateHintInput" class="dialog-input" placeholder="例如 [focus]（可留空）" value="${escapeHtml(argumentHint)}" autocomplete="off" />
      </label>
    </div>
    <label class="dialog-field">
      <span>模板正文</span>
      <textarea id="promptTemplateContentInput" class="dialog-textarea prompt-template-textarea" spellcheck="false" placeholder="用 $ARGUMENTS、$1 等占位符接收命令参数">${escapeHtml(content)}</textarea>
    </label>`;
}

function openPromptTemplateCreate() {
  setRuleDialogMode({
    mode: "prompt-template-create",
    title: "新建提示模板",
    submit: "创建",
    body: promptTemplateFields(),
  });
}

function openPromptTemplateEdit(template) {
  setRuleDialogMode({
    mode: "prompt-template-edit",
    id: template.id,
    scope: template.scope,
    title: `编辑提示模板 /${template.id} · ${template.scope === "project" ? "项目级" : "用户级"}`,
    body: promptTemplateFields(template),
  });
}

function openPromptTemplateDelete(template) {
  setRuleDialogMode({
    mode: "prompt-template-delete",
    id: template.id,
    scope: template.scope,
    title: "删除提示模板",
    submit: "删除",
    danger: true,
    body: `<p class="dialog-copy">提示模板 <strong>/${escapeHtml(template.id)}</strong> 会先移动到备份目录，再删除。此操作不可撤销。</p>`,
  });
}

function promptPreviewMeta(result) {
  const parts = [`${result.chars} 字符`];
  parts.push(result.activeRule ? `规则 ${result.activeRule}` : "未启用规则");
  parts.push(result.taskSource || "无任务状态");
  if (result.ruleIssue) parts.push(`规则错误：${result.ruleIssue}`);
  return parts.join(" · ");
}

function bindPromptPreview() {
  const draft = $("promptPreviewDraft");
  const meta = $("promptPreviewMeta");
  const output = $("promptPreviewOutput");
  const button = $("refreshPromptPreview");
  if (!draft || !meta || !output || !button) return;
  const refresh = async () => {
    button.disabled = true;
    button.textContent = "重算中...";
    try {
      const result = await API.previewPrompt(draft.value);
      output.textContent = result.prompt;
      meta.textContent = promptPreviewMeta(result);
    } catch (error) {
      meta.textContent = error.message;
      meta.classList.add("error");
    } finally {
      button.disabled = false;
      button.textContent = "重算";
    }
  };
  button.addEventListener("click", refresh);
  draft.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      refresh();
    }
  });
}

async function openPromptPreview() {
  try {
    const result = await API.previewPrompt("");
    setRuleDialogMode({
      mode: "prompt-preview",
      title: "最终提示词预览",
      submit: "关闭",
      body: `
        <label class="dialog-field">
          <span>草稿消息（可选）</span>
          <textarea id="promptPreviewDraft" class="dialog-textarea prompt-draft" placeholder="输入一段将要发送的话，按 Ctrl+Enter 重算" spellcheck="false"></textarea>
        </label>
        <div class="prompt-preview-toolbar">
          <button class="text-button" id="refreshPromptPreview" type="button">重算</button>
          <span class="model-hint" id="promptPreviewMeta">${escapeHtml(promptPreviewMeta(result))}</span>
        </div>
        <pre class="prompt-preview" id="promptPreviewOutput">${escapeHtml(result.prompt)}</pre>`,
    });
    bindPromptPreview();
  } catch (error) {
    showMessage(error.message, true);
  }
}

function trustFormHtml(mode) {
  const trusted = mode === "trust";
  return `
    <section class="settings-card workspace-card">
      <div class="settings-section-head">项目信任</div>
      <div class="model-grid">
        <label class="model-field model-field-wide">
          <span>项目资源</span>
          <select id="projectTrustMode">
            <option value="ask" ${trusted ? "" : "selected"}>不加载（默认）</option>
            <option value="trust" ${trusted ? "selected" : ""}>信任当前项目</option>
          </select>
        </label>
      </div>
      <div class="model-hint">信任后会加载当前工作区的 .pi 设置、扩展、MCP 和 Skill；下一次重载 Agent 生效。</div>
    </section>
  `;
}

function bindTrustForm() {
  const select = $("projectTrustMode");
  if (!select) return;
  select.addEventListener("change", async () => {
    try {
      await API.setProjectTrust(select.value);
      showMessage("项目信任已保存，重载 Agent 后生效");
    } catch (error) {
      showMessage(error.message, true);
    }
  });
}

function workspaceFormHtml(config) {
  const domain = config?.domain ?? "auto";
  const activeRule = config?.activeRule;
  return `
    <section class="settings-card workspace-card">
      <div class="settings-section-head">工作模式</div>
      <div class="model-grid">
        <label class="model-field">
          <span>领域模式</span>
          <select id="domainMode">
            <option value="auto" ${domain === "auto" ? "selected" : ""}>自动识别</option>
            <option value="js" ${domain === "js" ? "selected" : ""}>JavaScript</option>
            <option value="app" ${domain === "app" ? "selected" : ""}>App</option>
          </select>
        </label>
        <label class="model-field">
          <span>当前规则</span>
          <input id="activeRuleDisplay" class="model-input" value="${escapeHtml(activeRule || "未启用")}" readonly />
        </label>
      </div>
      <div class="model-actions">
        <button class="panel-action subtle" id="manageRules" type="button">管理规则</button>
      </div>
    </section>
  `;
}

function bindWorkspaceForm(config) {
  const domainMode = $("domainMode");
  const manageRules = $("manageRules");
  domainMode.addEventListener("change", async () => {
    domainMode.disabled = true;
    try {
      const result = await API.setDomain(domainMode.value);
      showMessage(`领域模式已设为 ${result.domain}，下一条消息生效`);
    } catch (error) {
      domainMode.value = config?.domain ?? "auto";
      showMessage(error.message, true);
    } finally {
      domainMode.disabled = false;
    }
  });
  manageRules.addEventListener("click", () => API.openPanel("rules"));
}

function themeSettingsCardHtml(theme) {
  return window.PiSpiderThemeCard.html(theme);
}

function bindThemeSettings() {
  $("importThemeButton")?.addEventListener("click", async () => {
    try {
      const response = await API.importTheme();
      if (response?.cancelled) return;
      if (!response?.ok) throw new Error(response?.error || "导入主题失败");
      await renderSettings();
      showMessage(`已应用主题：${response.customTheme?.name || "自定义主题"}`);
    } catch (error) {
      showMessage(error.message, true);
    }
  });
  $("resetThemeButton")?.addEventListener("click", async () => {
    try {
      const response = await API.resetTheme();
      if (!response?.ok) throw new Error(response?.error || "恢复主题失败");
      await renderSettings();
      showMessage("已恢复内置主题");
    } catch (error) {
      showMessage(error.message, true);
    }
  });
}

function advancedSettingsCardHtml(advanced, settingsPath) {
  const transport = advanced?.transport || "auto";
  const compaction = advanced?.compaction || {};
  const enabled = compaction.enabled !== false;
  const reserveTokens = compaction.reserveTokens ?? 16384;
  const keepRecentTokens = compaction.keepRecentTokens ?? 20000;
  const tools = Array.isArray(advanced?.defaultTools) ? advanced.defaultTools.join("\n") : "";
  const transportOptions = [
    { value: "auto", label: "自动（默认）" },
    { value: "sse", label: "SSE" },
    { value: "websocket", label: "WebSocket" },
    { value: "websocket-cached", label: "WebSocket（缓存）" },
  ];
  return `
    <section class="settings-card advanced-card">
      <div class="settings-section-head">高级设置</div>
      <div class="model-grid">
        <label class="model-field">
          <span>传输协议</span>
          <select id="advancedTransport">
            ${transportOptions
              .map(
                (option) =>
                  `<option value="${option.value}" ${transport === option.value ? "selected" : ""}>${option.label}</option>`,
              )
              .join("")}
          </select>
        </label>
        <label class="model-field">
          <span>HTTP 代理</span>
          <input id="advancedHttpProxy" class="model-input" value="${escapeHtml(
            advanced?.httpProxy || "",
          )}" placeholder="http://127.0.0.1:7890" autocomplete="off" spellcheck="false" />
        </label>
        <label class="model-field model-field-wide">
          <span>Shell 路径</span>
          <input id="advancedShellPath" class="model-input" value="${escapeHtml(
            advanced?.shellPath || "",
          )}" placeholder="留空使用自动探测" autocomplete="off" spellcheck="false" />
        </label>
      </div>
      <div class="advanced-subhead">默认工具</div>
      <textarea id="advancedDefaultTools" class="model-input advanced-tools-input" rows="4" placeholder="每行一个工具名称，例如 read、grep" spellcheck="false">${escapeHtml(
        tools,
      )}</textarea>
      <div class="model-hint">每行一个。纯名称替换默认集合；<code>+名称</code> 增加、<code>-名称</code> 移除，二者不能与纯名称混用；留空使用 Pi 默认的 read / bash / edit / write。</div>
      <div class="advanced-subhead">上下文压缩</div>
      <div class="model-grid">
        <label class="model-field">
          <span>自动压缩</span>
          <select id="advancedCompactionEnabled">
            <option value="true" ${enabled ? "selected" : ""}>开启</option>
            <option value="false" ${enabled ? "" : "selected"}>关闭</option>
          </select>
        </label>
        <label class="model-field">
          <span>预留 tokens</span>
          <input id="advancedCompactionReserve" class="model-input" type="number" min="0" step="1" value="${escapeHtml(
            String(reserveTokens),
          )}" />
        </label>
        <label class="model-field">
          <span>保留最近 tokens</span>
          <input id="advancedCompactionKeep" class="model-input" type="number" min="0" step="1" value="${escapeHtml(
            String(keepRecentTokens),
          )}" />
        </label>
      </div>
      <div class="model-hint">${
        compaction.hasModelOverrides
          ? "当前存在逐模型压缩覆盖，保存时保留。"
          : "未设置逐模型压缩覆盖。"
      } 参数写入用户级 settings.json，保存后重启 Agent 生效。</div>
      <div class="model-actions advanced-actions">
        <span class="advanced-settings-status" title="${escapeHtml(settingsPath || "")}">${escapeHtml(
          settingsPath || "settings.json",
        )}</span>
        <button class="panel-action primary" id="saveAdvancedSettings" type="button">保存并重启 Agent</button>
      </div>
    </section>
  `;
}

function bindAdvancedSettings() {
  const save = $("saveAdvancedSettings");
  if (!save) return;
  save.addEventListener("click", async () => {
    const reserveRaw = String($("advancedCompactionReserve")?.value || "").trim();
    const keepRaw = String($("advancedCompactionKeep")?.value || "").trim();
    const reserveTokens = Number(reserveRaw);
    const keepRecentTokens = Number(keepRaw);
    if (!reserveRaw || !Number.isSafeInteger(reserveTokens) || reserveTokens < 0) {
      showMessage("预留 tokens 必须是非负整数", true);
      return;
    }
    if (!keepRaw || !Number.isSafeInteger(keepRecentTokens) || keepRecentTokens < 0) {
      showMessage("保留最近 tokens 必须是非负整数", true);
      return;
    }
    const input = {
      transport: $("advancedTransport")?.value || "auto",
      httpProxy: String($("advancedHttpProxy")?.value || "").trim(),
      shellPath: String($("advancedShellPath")?.value || "").trim(),
      defaultTools: String($("advancedDefaultTools")?.value || "")
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean),
      compaction: {
        enabled: $("advancedCompactionEnabled")?.value !== "false",
        reserveTokens,
        keepRecentTokens,
      },
    };
    const label = save.textContent;
    save.disabled = true;
    save.textContent = "保存中…";
    try {
      const result = await API.setAdvancedSettings(input);
      if (result?.restartError) {
        showMessage(`高级设置已保存，但 Agent 未重启：${result.restartError}`, true);
      } else if (result?.restarted) {
        showMessage("高级设置已保存，Agent 已重启");
      } else {
        showMessage("高级设置已保存，Agent 启动后生效");
      }
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      save.disabled = false;
      save.textContent = label;
    }
  });
}

function extensionRowsHtml(rows) {
  if (!rows.length) {
    return `<div class="extension-empty">当前作用域没有扩展文件。</div>`;
  }
  return rows
    .map((row) => {
      const chips = [
        row.source === "settings" ? "settings" : row.source === "builtin" ? "" : "自动发现",
        row.builtin ? "内置" : "",
        row.loaded ? "" : "待信任项目",
        row.exists === false ? "文件缺失" : "",
      ].filter(Boolean);
      const title = row.builtin ? row.label || row.name : row.name;
      const detail = row.builtin
        ? `${row.description || "Pi 内置扩展"} · ${row.path}`
        : `${row.relativePath}${row.exists === false ? " · 文件不存在" : ""}`;
      return `
        <article class="extension-row${row.enabled ? "" : " disabled"}">
          <div class="extension-main">
            <div class="extension-title-line">
              <strong class="extension-name">${escapeHtml(title)}</strong>
              ${chips.map((chip) => `<span class="panel-chip">${escapeHtml(chip)}</span>`).join("")}
            </div>
            <div class="extension-detail">${escapeHtml(detail)}</div>
          </div>
          <div class="extension-actions">
            ${
              row.exists === false
                ? `<button class="text-button" type="button" disabled>文件缺失</button>`
                : `<button class="text-button" data-extension-toggle data-extension-id="${escapeHtml(row.id)}" type="button">${row.enabled ? "停用" : "启用"}</button>
                   ${row.builtin ? "" : `<button class="text-button" data-extension-open="${escapeHtml(row.path)}" type="button">打开</button>`}`
            }
          </div>
        </article>`;
    })
    .join("");
}

function extensionCardHtml(inventory) {
  const rows = inventory.extensions ?? [];
  const userRows = rows.filter((row) => !row.builtin && row.scope === "user");
  const projectRows = rows.filter((row) => !row.builtin && row.scope === "project");
  const builtins = rows.filter((row) => row.builtin);
  const groups = [
    { title: "用户级", rows: userRows, note: runtimeInfo?.extensionsDir || "agent/extensions" },
    { title: "项目级", rows: projectRows, note: runtimeInfo?.projectExtensionsDir || ".pi/extensions" },
    { title: "内置扩展", rows: builtins, note: "Pi 内置，可用 -builtin:<name> 停用" },
  ]
    .filter((group) => group.rows.length)
    .map(
      (group) => `
        <div class="extension-group">
          <div class="extension-group-head"><span>${escapeHtml(group.title)}</span><span>${group.rows.length} 个 · ${escapeHtml(group.note)}</span></div>
          ${extensionRowsHtml(group.rows)}
        </div>`,
    )
    .join("");
  return panelCardHtml("扩展清单", groups || `<div class="extension-empty">还没有扩展。</div>`, {
    padded: true,
  });
}

function packageFilterSummary(pkg) {
  const filters = Object.entries(pkg.filters ?? {});
  if (!filters.length) return "未限制资源类型";
  return filters.map(([key, values]) => `${key} ${values.length}`).join(" · ");
}

function packageRowsHtml(packages) {
  if (!packages.length) {
    return `
      <div class="panel-empty-card package-empty">
        <div class="panel-empty-mark">PKG</div>
        <h3>还没有 Pi package</h3>
        <p>package 可携带扩展、技能、提示模板和主题。安装后重载 Agent 生效。</p>
        <div class="empty-actions"><button class="panel-action primary" id="installPackageEmptyButton" type="button">安装 package</button></div>
      </div>`;
  }
  return packages
    .map((pkg) => {
      const installedLabel =
        pkg.installed === true
          ? `已安装${pkg.version ? ` · ${pkg.version}` : ""}`
          : pkg.installed === false
            ? "未安装"
            : "状态未知";
      const chips = [
        pkg.scope === "project" ? "项目" : "用户",
        pkg.loaded ? "已配置" : "待信任项目",
        pkg.autoload === false ? "仅过滤" : "",
        installedLabel,
      ].filter(Boolean);
      return `
        <article class="package-row">
          <div class="package-main">
            <div class="package-title-line">
              <strong class="package-source">${escapeHtml(pkg.source)}</strong>
              ${chips.map((chip) => `<span class="panel-chip">${escapeHtml(chip)}</span>`).join("")}
            </div>
            <div class="package-detail">${escapeHtml(packageFilterSummary(pkg))}</div>
            <div class="package-path">${escapeHtml(pkg.settingsPath || "")}${pkg.installPath ? ` · ${escapeHtml(pkg.installPath)}` : ""}</div>
            ${pkg.error ? `<div class="package-error">${escapeHtml(pkg.error)}</div>` : ""}
          </div>
          <div class="package-actions">
            ${
              pkg.error
                ? ""
                : `<button class="text-button" data-package-action="update" data-package-source="${escapeHtml(pkg.removeSource || pkg.source)}" data-package-scope="${escapeHtml(pkg.scope)}" type="button">更新</button>
                   <button class="text-button danger" data-package-action="remove" data-package-source="${escapeHtml(pkg.removeSource || pkg.source)}" data-package-scope="${escapeHtml(pkg.scope)}" type="button">移除</button>`
            }
          </div>
        </article>`;
    })
    .join("");
}

async function renderExtensions() {
  setHeader("扩展");
  let inventory = { extensions: [], packages: [], dirs: {}, settings: {} };
  try {
    inventory = await API.listExtensions();
  } catch (error) {
    showMessage(error.message, true);
  }
  const extensions = inventory.extensions ?? [];
  const packages = inventory.packages ?? [];
  const fileExtensions = extensions.filter((row) => !row.builtin);
  const builtins = extensions.filter((row) => row.builtin);
  const enabledCount = fileExtensions.filter((row) => row.enabled).length;
  const loadedCount = fileExtensions.filter((row) => row.enabled && row.loaded).length;
  const disabledCount = fileExtensions.filter((row) => !row.enabled).length;
  const builtinEnabled = builtins.filter((row) => row.enabled).length;
  const projectTrusted = inventory.settings?.projectTrusted === true;
  setHeader("扩展", `${fileExtensions.length} 个扩展 · ${packages.length} 个 package`);
  const hero = panelHeroHtml({
    ready: projectTrusted,
    stateLabel: projectTrusted ? "项目已信任" : "项目未信任",
    chips: packages.length ? [`${packages.length} 个 package`] : [],
  });
  const metrics = panelMetricsHtml([
    {
      label: "已加载扩展",
      value: String(loadedCount),
      note: enabledCount === loadedCount ? `已启用 ${enabledCount} 个` : `已启用 ${enabledCount} 个 · 项目待信任`,
    },
    { label: "已停用", value: String(disabledCount), note: "settings 覆盖" },
    { label: "Pi packages", value: String(packages.length), note: "用户 + 项目" },
    { label: "内置扩展", value: `${builtinEnabled}/${builtins.length}`, note: "MCP / codemode 等" },
  ]);
  const packageAside = `<button class="panel-action subtle" id="installPackageButton" type="button">安装 package</button>`;
  $("panelBody").innerHTML = `<div class="panel-page">${hero}${metrics}${extensionCardHtml(inventory)}${panelCardHtml(
    "Pi packages",
    packageRowsHtml(packages),
    { aside: packageAside, padded: true, className: "package-card" },
  )}<section class="extension-note-card"><strong>生效方式</strong><p>第三方 package 会执行代码，安装前确认来源；启停或安装后重载 Agent 生效。</p><div class="extension-note-actions"><button class="panel-action subtle" id="openUserNpmDir" type="button">打开用户 npm 目录</button><button class="panel-action subtle" id="openProjectNpmDir" type="button">打开项目 npm 目录</button></div></section></div>`;
  bindExtensionActions(inventory);
  bindPackageActions(inventory);
  $("installPackageButton")?.addEventListener("click", openPackageInstall);
  $("installPackageEmptyButton")?.addEventListener("click", openPackageInstall);
  $("openUserNpmDir")?.addEventListener("click", () => openPath(inventory.dirs?.userNpm));
  $("openProjectNpmDir")?.addEventListener("click", () => openPath(inventory.dirs?.projectNpm));
}

function bindExtensionActions(inventory) {
  document.querySelectorAll("[data-extension-toggle]").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = (inventory.extensions ?? []).find((item) => item.id === button.dataset.extensionId);
      if (!row) return;
      button.disabled = true;
      try {
        const target = row.builtin
          ? { scope: row.scope, builtin: true, name: row.name }
          : { scope: row.scope, relativePath: row.relativePath };
        await API.toggleExtension(target, !row.enabled);
        await renderExtensions();
        showMessage(`${row.builtin ? row.label || row.name : row.name} 已${row.enabled ? "停用" : "启用"}，重载 Agent 后生效`);
      } catch (error) {
        button.disabled = false;
        showMessage(error.message, true);
      }
    });
  });
  document.querySelectorAll("[data-extension-open]").forEach((button) => {
    button.addEventListener("click", () => openPath(button.dataset.extensionOpen));
  });
}

function findPackage(inventory, source, scope) {
  return (inventory.packages ?? []).find(
    (pkg) => pkg.scope === scope && (pkg.source === source || (pkg.removeSource || pkg.source) === source),
  );
}

function bindPackageActions(inventory) {
  document.querySelectorAll("[data-package-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const pkg = findPackage(inventory, button.dataset.packageSource, button.dataset.packageScope);
      if (!pkg) return;
      if (button.dataset.packageAction === "remove") openPackageRemove(pkg);
      else openPackageUpdate(pkg);
    });
  });
}

function openPackageInstall() {
  setRuleDialogMode({
    mode: "package-install",
    title: "安装 Pi package",
    submit: "安装",
    body: `
      <div class="dialog-grid">
        <label class="dialog-field dialog-field-wide">
          <span>Package source</span>
          <input id="packageSourceInput" class="dialog-input" placeholder="npm:@example/pi-tools@1.0.0 / git:github.com/example/pi-tools@v1 / ./local-package" autocomplete="off" spellcheck="false" />
        </label>
        <label class="dialog-field">
          <span>作用域</span>
          <select id="packageScopeInput" class="dialog-input">
            <option value="user">用户级 · agent/settings.json</option>
            <option value="project">项目级 · .pi/settings.json</option>
          </select>
        </label>
      </div>
      <p class="dialog-copy">package 可以携带扩展代码和技能。安装前请确认来源；项目级 package 需要先在设置中信任项目，安装完成后还需要重载 Agent。</p>`,
  });
}

function openPackageRemove(pkg) {
  setRuleDialogMode({
    mode: "package-remove",
    record: pkg,
    title: "移除 Pi package",
    submit: "移除",
    danger: true,
    body: `<p class="dialog-copy">会从 <strong>${escapeHtml(pkg.scope === "project" ? "项目 .pi/settings.json" : "用户 agent/settings.json")}</strong> 移除 <strong>${escapeHtml(pkg.source)}</strong>，并让 Pi 清理它的安装目录。此操作不会删除 package 声明之外的资源。</p>`,
  });
}

function openPackageUpdate(pkg) {
  setRuleDialogMode({
    mode: "package-update",
    record: pkg,
    title: "更新 Pi package",
    submit: "更新",
    body: `<p class="dialog-copy">会调用 <strong>pi update</strong> 重新解析 <strong>${escapeHtml(pkg.source)}</strong>；网络不可用或源不可达时可能失败。更新完成后需要重载 Agent。</p>`,
  });
}

function packageCommandError(result) {
  const text = [result?.error, result?.log].filter(Boolean).join("\n");
  return text.slice(-1_200) || "Pi package 命令失败";
}

async function renderSettings() {
  setHeader("设置", "");
  let state;
  let workspaceConfig;
  let prompts = [];
  let promptTemplates = { templates: [], dirs: {} };
  let projectTrust = { mode: "ask" };
  let advancedSettings = null;
  let themeState = null;
  try {
    state = await API.getModelConfig();
    modelConfigState = state;
  } catch (error) {
    showMessage(error.message, true);
    state = modelConfigState || { credentials: [], customProviders: [] };
  }
  try {
    workspaceConfig = await API.getWorkspaceConfig();
  } catch (error) {
    showMessage(error.message, true);
    workspaceConfig = { domain: "auto", activeRule: null };
  }
  try {
    prompts = await API.listPrompts();
  } catch (error) {
    showMessage(error.message, true);
  }
  try {
    promptTemplates = await API.listPromptTemplates();
  } catch (error) {
    showMessage(error.message, true);
  }
  try {
    projectTrust = await API.getProjectTrust();
  } catch (error) {
    showMessage(error.message, true);
  }
  try {
    advancedSettings = await API.getAdvancedSettings();
  } catch (error) {
    showMessage(error.message, true);
  }
  try {
    themeState = await API.getTheme();
  } catch (error) {
    showMessage(error.message, true);
  }
  const form = modelFormHtml(state);
  const workspaceForm = workspaceFormHtml(workspaceConfig);
  const trustForm = trustFormHtml(projectTrust.mode);
  const advancedSettingsPath =
    advancedSettings?.settingsPath || (runtimeInfo?.agentDir ? `${runtimeInfo.agentDir}\\settings.json` : "");
  const advancedForm = advancedSettingsCardHtml(advancedSettings, advancedSettingsPath);
  const themeForm = themeSettingsCardHtml(themeState?.customTheme);
  const promptForm = promptConfigHtml(prompts);
  const promptTemplatesForm = promptTemplatesHtml(promptTemplates);
  const rows = [
    { label: "数据目录", value: runtimeInfo.home, open: true },
    { label: "配置文件", value: runtimeInfo.configPath, open: true },
    { label: "Agent 目录", value: runtimeInfo.agentDir, open: true },
    { label: "认证文件", value: runtimeInfo.authPath || state.paths?.authPath, open: true },
    { label: "模型配置", value: runtimeInfo.modelsPath || state.paths?.modelsPath, open: true },
    { label: "规则目录", value: runtimeInfo.rulesDir, open: true },
    { label: "技能目录", value: runtimeInfo.skillsDir, open: true },
    { label: "提示词组件", value: runtimeInfo.promptsDir, open: true },
    { label: "Pi 模板目录", value: runtimeInfo.promptTemplatesDir, open: true },
    { label: "扩展目录", value: runtimeInfo.extensionsDir, open: true },
    { label: "项目扩展目录", value: runtimeInfo.projectExtensionsDir, open: true },
    { label: "用户 npm", value: runtimeInfo.userNpmDir, open: true },
    { label: "项目 npm", value: runtimeInfo.projectNpmDir, open: true },
    { label: "会话目录", value: runtimeInfo.sessionDir, open: true },
  ];
  const settingsHero = settingsHeroHtml(state, workspaceConfig, projectTrust);
  $("panelBody").innerHTML = `<div class="settings-page panel-page">${settingsHero}${form}<div class="settings-duo">${workspaceForm}${trustForm}</div>${themeForm}${advancedForm}${promptForm}${promptTemplatesForm}<section class="settings-paths-card"><div class="settings-section-head">文件与目录</div><div class="setting-card settings-paths">${settingRowsHtml(rows)}</div></section></div>`;
  bindOpenButtons();
  bindWorkspaceForm(workspaceConfig);
  bindTrustForm();
  bindThemeSettings();
  bindAdvancedSettings();
  bindModelForm(state);
  bindPromptActions(prompts);
  bindPromptTemplateActions(promptTemplates);
}


function renderProject() {
  const projectName = String(runtimeInfo?.repoRoot || "")
    .split(/[\\/]/)
    .filter(Boolean)
    .pop() || "当前项目";
  setHeader("项目", projectName);
  const projectHero = panelHeroHtml({
    ready: true,
    stateLabel: "已连接",
    chips: ["本地桌面"],
  });
  const projectMetrics = panelMetricsHtml([
    { label: "PiSpider", value: runtimeInfo?.version || "—", note: "桌面版本" },
    { label: "Electron", value: runtimeInfo?.electron || "—", note: "运行时" },
    { label: "Node", value: runtimeInfo?.node || "—", note: "运行时" },
    { label: "平台", value: runtimeInfo?.platform || "—", note: "当前环境" },
  ]);
  $("panelBody").innerHTML = `<div class="panel-page">${projectHero}${projectMetrics}${panelCardHtml(
    "路径",
    settingRowsHtml([
      { label: "工作区", value: runtimeInfo?.repoRoot || "—", open: true },
      { label: "配置文件", value: runtimeInfo?.configPath || "—", open: true },
      { label: "Agent 目录", value: runtimeInfo?.agentDir || "—", open: true },
    ]),
  )}</div>`;
  bindOpenButtons();
}

function statusCard(title, rows) {
  return panelCardHtml(title, settingRowsHtml(rows));
}

function diagnosticTone(status) {
  if (status === "ready") return "ok";
  if (status === "error" || status === "invalid") return "bad";
  return "warn";
}

function diagnosticsRowsHtml(diagnostics) {
  if (!diagnostics) {
    return `<div class="diagnostic-empty">尚未运行环境检查。</div>`;
  }
  const auth = diagnostics.auth;
  const authText = !auth
    ? "没有默认模型，跳过认证检查"
    : auth.status === "ready"
      ? `可用 · ${auth.authType || "credential"}`
      : auth.status === "not_ready"
        ? `未就绪${auth.error ? ` · ${auth.error}` : ""}`
        : auth.status === "invalid"
          ? `凭据无效${auth.error ? ` · ${auth.error}` : ""}`
          : auth.status === "error"
            ? auth.error || "认证检查失败"
            : auth.raw || "未返回状态";
  const authTone = auth ? diagnosticTone(auth.status) : "warn";
  const packageText = !diagnostics.packages.ok
    ? diagnostics.packages.error || "pi list 失败"
    : diagnostics.packages.text.replace(/^No packages installed\.?$/u, "未安装 package").replace(/\r?\n/gu, " · ");
  const packageTone = diagnostics.packages.ok ? "ok" : "bad";
  const files = diagnostics.files;
  const fileText = [
    `settings ${files.settings ? "存在" : "缺失"}`,
    `models ${files.models ? "存在" : "缺失"}`,
    `auth ${files.auth ? "存在" : "缺失"}`,
  ].join(" · ");
  const projectText = [
    `.pi/settings ${files.projectSettings ? "存在" : "无"}`,
    `.pi/mcp ${files.projectMcp ? "存在" : "无"}`,
    `项目 ${diagnostics.trust === "trust" ? "已信任" : "未信任"}`,
  ].join(" · ");
  const permissionLabels = { full: "全部允许", readonly: "只读", none: "禁用工具" };
  const permissionText = `${diagnostics.permission?.scope === "session" ? "当前会话" : "项目默认"} · ${
    permissionLabels[diagnostics.permission?.mode] || diagnostics.permission?.mode || "—"
  }`;
  const rows = [
    {
      label: "运行时",
      value: diagnostics.core.ok
        ? `Pi ${diagnostics.core.version} · Node ${diagnostics.node} · Electron ${diagnostics.electron}`
        : diagnostics.core.error || "无法读取 Pi 运行时",
      tone: diagnostics.core.ok ? "ok" : "bad",
    },
    { label: "模型认证", value: authText, tone: authTone },
    { label: "Pi packages", value: packageText || "没有输出", tone: packageTone },
    {
      label: "配置文件",
      value: diagnostics.settingsError ? `settings 格式错误 · ${diagnostics.settingsError}` : fileText,
      tone: diagnostics.settingsError ? "bad" : "ok",
    },
    { label: "项目资源", value: projectText, tone: diagnostics.trust === "trust" ? "ok" : "warn" },
    { label: "工具权限", value: permissionText, tone: "info" },
  ];
  return `<div class="diagnostic-list">${rows
    .map(
      (row) => `
        <div class="diagnostic-row">
          <span class="diagnostic-mark ${row.tone}"></span>
          <span class="diagnostic-label">${escapeHtml(row.label)}</span>
          <span class="diagnostic-value">${escapeHtml(row.value)}</span>
        </div>`,
    )
    .join("")}</div><div class="diagnostic-foot">检查时间 ${escapeHtml(
    diagnostics.checkedAt ? new Date(diagnostics.checkedAt).toLocaleString("zh-CN") : "—",
  )} · 核心 CLI ${escapeHtml(diagnostics.core.ok ? "可执行" : "不可用")}</div>`;
}

async function runDiagnostics() {
  const button = $("runDiagnosticsButton");
  const body = $("diagnosticsBody");
  if (!body) return;
  if (button) {
    button.disabled = true;
    button.textContent = "检查中…";
  }
  body.innerHTML = `<div class="diagnostic-empty">正在检查 Pi 运行时、认证和 package 状态…</div>`;
  try {
    const diagnostics = await API.getDiagnostics();
    body.innerHTML = diagnosticsRowsHtml(diagnostics);
  } catch (error) {
    body.innerHTML = `<div class="diagnostic-empty bad">${escapeHtml(error.message)}</div>`;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "重新检查";
    }
  }
}

async function exportDiagnostics() {
  const button = $("exportDiagnosticsButton");
  if (!button) return;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "导出中…";
  try {
    const result = await API.exportDiagnostics();
    if (result?.cancelled) return;
    const size = result.bytes < 1024 ? `${result.bytes} B` : `${(result.bytes / 1024).toFixed(1)} KB`;
    showMessage(`诊断报告已导出：${result.path}（${size}，${result.logEntries} 条日志）`);
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

async function renderStatus() {
  setHeader("状态");
  const [info, stateResponse, workspaceConfig, permission, trust, rulesData, skillsData, mcpUser, mcpProject, messagesResponse, prompt, sessionsData] =
    await Promise.all([
      API.getInfo().catch(() => null),
      API.getState().catch(() => null),
      API.getWorkspaceConfig().catch(() => null),
      API.getPermission().catch(() => null),
      API.getProjectTrust().catch(() => null),
      API.listRules().catch(() => ({ rules: [], activeRule: null })),
      API.listSkills().catch(() => []),
      API.listMcp("user").catch(() => ({ servers: [] })),
      API.listMcp("project").catch(() => ({ servers: [] })),
      API.getMessages().catch(() => null),
      API.previewPrompt("").catch(() => null),
      API.listSessions().catch(() => []),
    ]);

  const state = stateResponse?.success ? stateResponse.data : null;
  const session = state;
  const sessions = Array.isArray(sessionsData) ? sessionsData : [];
  const currentSession = sessions.find((item) => item.id === session?.sessionId);
  const rules = rulesData?.rules ?? [];
  const activeRule = rulesData?.activeRule ?? workspaceConfig?.activeRule ?? null;
  const skills = Array.isArray(skillsData) ? skillsData : [];
  const userServers = mcpUser?.servers ?? [];
  const projectServers = mcpProject?.servers ?? [];
  const mcpServers = [...userServers, ...projectServers];
  const enabledMcp = mcpServers.filter((server) => server.enabled).length;
  const messages = messagesResponse?.success ? messagesResponse.data?.messages ?? [] : [];
  const lastTask = [...messages]
    .reverse()
    .find((message) => message.role === "toolResult" && message.toolName === "ps_task");
  const task = lastTask?.details?.pispiderTask;
  const stageLabels = {
    intake: "接收",
    plan: "规划",
    execute: "执行",
    observe: "观察",
    verify: "验证",
    done: "完成",
    blocked: "阻塞",
  };
  const permissionLabels = {
    full: "全部允许",
    readonly: "只读",
    none: "禁用工具",
  };
  const domainLabels = { auto: "自动识别", js: "JavaScript", app: "App" };
  const modelLabel = session?.model
    ? `${session.model.provider || "unknown"} / ${modelDisplayName(session.model)}`
    : "未配置模型";
  const thinkingText = THINKING_LABELS[session?.thinkingLevel] || session?.thinkingLevel || "—";
  const permissionText = `${permission?.scope === "session" ? "当前会话" : "项目默认"} · ${permissionLabels[permission?.mode] || permission?.mode || "—"}`;
  const trustText = trust?.mode === "trust" ? "已信任，加载项目资源" : "不加载项目资源";
  const sessionLabel = currentSession?.name || session?.sessionName || currentSession?.preview || (session?.sessionId ? `未命名 · ${session.sessionId.slice(0, 8)}` : "尚未创建");
  const taskRows = task
    ? [
        { label: "阶段", value: stageLabels[task.stage] || task.stage },
        { label: "目标", value: task.goal || "—" },
        { label: "下一步", value: task.nextAction || "—" },
        { label: "最近更新", value: task.updatedAt || "—" },
      ]
    : [{ label: "任务状态", value: "当前分支还没有 ps_task 状态" }];
  const statusHero = panelHeroHtml({
    ready: Boolean(session),
    stateLabel: session ? "运行时已连接" : "运行时未连接",
    chips: [
      { label: modelLabel, accent: true },
      `思考 ${thinkingText}`,
      `权限 ${permissionText}`,
    ],
  });
  const statusMetrics = panelMetricsHtml([
    { label: "规则", value: rules.length, note: activeRule ? `当前 ${activeRule}` : "未启用" },
    { label: "技能", value: skills.length, note: "已安装" },
    { label: "MCP", value: mcpServers.length ? `${enabledMcp} / ${mcpServers.length}` : "0", note: mcpServers.length ? "已启用" : "未配置" },
    { label: "提示词", value: prompt ? formatCount(prompt.chars) : "—", note: prompt ? "字符" : "读取失败" },
  ]);

  $("panelBody").innerHTML = `<div class="panel-page">${statusHero}${statusMetrics}
    ${statusCard("工作区", [
      { label: "项目信任", value: trustText },
      { label: "会话", value: `${sessionLabel} · ${session?.messageCount ?? 0} 条消息` },
      { label: "工作区", value: info?.repoRoot || runtimeInfo?.repoRoot || "—", open: true },
    ])}
    ${statusCard("环境", [
      { label: "领域模式", value: domainLabels[workspaceConfig?.domain] || workspaceConfig?.domain || "—" },
      { label: "配置目录", value: info?.home || runtimeInfo?.home || "—", open: true },
    ])}
    ${statusCard("任务", taskRows)}
    ${prompt?.ruleIssue ? statusCard("提示词问题", [{ label: "规则错误", value: prompt.ruleIssue }]) : ""}
    ${panelCardHtml("环境诊断", `<div id="diagnosticsBody">${diagnosticsRowsHtml(null)}</div>`, {
      aside: `<div class="diagnostic-actions"><button class="panel-action subtle" id="exportDiagnosticsButton" type="button" title="导出包含本地路径、环境诊断和最近运行时日志的脱敏文本">导出诊断</button><button class="panel-action subtle" id="runDiagnosticsButton" type="button">运行诊断</button></div>`,
      padded: true,
    })}
  </div>`;
  bindOpenButtons();
  $("exportDiagnosticsButton")?.addEventListener("click", exportDiagnostics);
  $("runDiagnosticsButton")?.addEventListener("click", runDiagnostics);
  void runDiagnostics();
}

async function renderSession() {
  setHeader("会话");
  let session;
  let task;
  let stats;
  let autoRetryEnabled = true;
  try {
    const response = await API.getState();
    if (response?.success) session = response.data;
    const messagesResponse = await API.getMessages();
    if (messagesResponse?.success) {
      const messages = messagesResponse.data?.messages ?? [];
      task = [...messages]
        .reverse()
        .find((message) => message.role === "toolResult" && message.toolName === "ps_task")
        ?.details?.pispiderTask;
    }
    const statsResponse = await API.getSessionStats();
    if (statsResponse?.success) stats = statsResponse.data;
    try {
      const retryResponse = await API.getAutoRetry();
      autoRetryEnabled = retryResponse?.enabled !== false;
    } catch {}
  } catch {
    session = null;
  }

  const stageLabels = {
    intake: "接收",
    plan: "规划",
    execute: "执行",
    observe: "观察",
    verify: "验证",
    done: "完成",
    blocked: "阻塞",
  };
  const messageCount = session?.messageCount ?? 0;
  const contextUsage = stats?.contextUsage;
  const sessionHero = panelHeroHtml({
    ready: Boolean(session),
    stateLabel: session ? "会话已加载" : "会话未连接",
    chips: [
      { label: modelDisplayName(session?.model), accent: true },
      contextUsage ? `上下文 ${Number(contextUsage.percent ?? 0).toFixed(1)}%` : "",
    ],
  });
  const sessionMetrics = panelMetricsHtml([
    { label: "输入", value: stats ? formatCount(stats.tokens?.input) : "—", note: "tokens" },
    { label: "输出", value: stats ? formatCount(stats.tokens?.output) : "—", note: "tokens" },
    { label: "Token 总量", value: stats ? formatCount(stats.tokens?.total) : "—", note: "累计" },
    { label: "成本", value: stats?.cost != null ? `$${Number(stats.cost).toFixed(4)}` : "—", note: "本轮" },
  ]);
  const taskCard = task
    ? panelCardHtml(
        "任务状态",
        settingRowsHtml(
          [
            ["阶段", stageLabels[task.stage] || task.stage],
            ["目标", task.goal],
            ["范围", task.scope],
            ["下一步", task.nextAction],
            ["结果", task.result],
          ]
            .filter(([, value]) => value)
            .map(([label, value]) => ({ label, value })),
        ),
      )
    : "";
  const infoRows = [
    { label: "会话 ID", value: session?.sessionId || "尚未创建" },
    { label: "模型", value: modelDisplayName(session?.model) },
    { label: "消息", value: messageCount },
    {
      label: "上下文",
      value: contextUsage
        ? `${formatCount(contextUsage.tokens)} / ${formatCount(contextUsage.contextWindow)} · ${contextUsage.percent ?? "?"}%`
        : "暂无",
    },
    { label: "会话文件", value: session?.sessionFile || "尚未创建", open: true },
    { label: "Agent 目录", value: runtimeInfo.agentDir, open: true },
  ];

  $("panelBody").innerHTML = `<div class="panel-page">${sessionHero}${sessionMetrics}${panelCardHtml(
    "会话信息",
    settingRowsHtml(infoRows),
  )}${taskCard}${panelCardHtml("会话控制", sessionControlsHtml(session, autoRetryEnabled), { padded: true })}</div>`;
  bindOpenButtons();
  bindSessionControls(session, autoRetryEnabled);
}

function sessionControlsHtml(session, autoRetryEnabled) {
  return `
    <div class="session-toggle-list">
      <label class="session-toggle">
        <input id="autoCompactionInput" type="checkbox" ${session?.autoCompactionEnabled ? "checked" : ""} />
        <span>自动压缩上下文</span>
      </label>
      <label class="session-toggle">
        <input id="autoRetryInput" type="checkbox" ${autoRetryEnabled ? "checked" : ""} />
        <span>自动重试失败请求</span>
      </label>
    </div>
    <div class="session-actions">
        <button class="text-button" id="importSessionButton" type="button">从其他目录恢复</button>
        <button class="text-button" id="rewindOnceButton" type="button">回退上一轮</button>
        <button class="text-button" id="rewindRoundButton" type="button">再回退一轮</button>
        <button class="text-button" id="cloneSessionButton" type="button">复制会话</button>
        <button class="text-button" id="treeSessionButton" type="button">会话树</button>
        <button class="text-button" id="exportSessionButton" type="button">导出 HTML</button>
        <button class="text-button" id="exportSessionJsonlButton" type="button">导出 JSONL</button>
        <button class="text-button" id="shareSessionButton" type="button">分享到 Gist</button>
        <button class="text-button" id="resetTaskButton" type="button">重置任务</button>
        <button class="text-button" id="abortRetryButton" type="button">中止重试</button>
      </div>
      <div class="model-hint">模型、Thinking、当前会话权限在输入框底部切换；自动压缩只影响当前会话，自动重试是全局设置。跨目录会话会复制到当前会话目录再打开。</div>
  `;
}

function entryPreview(entry) {
  if (!entry) return "";
  if (entry.type === "message") {
    const message = entry.message || {};
    const role = { user: "用户", assistant: "助手", tool: "工具", system: "系统" }[message.role] || message.role || "消息";
    const content = message.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((part) => String(part?.text || "")).join(" ")
          : "";
    return `${role} · ${text.replace(/\s+/g, " ").trim().slice(0, 140) || "(空)"}`;
  }
  if (entry.type === "thinking_level_change") return String(entry.thinkingLevel || "off");
  if (entry.type === "model_change") return `模型 · ${entry.provider || ""}/${entry.modelId || ""}`;
  if (entry.type === "compaction") return "上下文压缩";
  if (entry.type === "branch_summary") return "分支摘要";
  if (entry.type === "label") return `标签 · ${entry.label || ""}`;
  return entry.type || "entry";
}

function entryTypeLabel(type) {
  const labels = {
    message: "消息",
    thinking_level_change: "思考等级",
    model_change: "模型",
    compaction: "压缩",
    branch_summary: "分支摘要",
    label: "标签",
    custom: "自定义",
    custom_message: "自定义消息",
    context_edit: "上下文",
    usage: "用量",
    session_info: "会话信息",
  };
  return labels[type] || type || "节点";
}

function treeNodesHtml(nodes, depth = 0) {
  return nodes
    .map((node) => {
      const entry = node.entry || {};
      const label = node.label ? `${node.label} · ` : "";
      const preview = entryPreview(entry);
      const entryId = entry.id || "";
      return `
        <div class="tree-node" style="--depth:${depth}">
          <div class="tree-node-main">
            <span class="tree-node-type">${escapeHtml(entryTypeLabel(entry.type))}</span>
            <span class="tree-node-text">${escapeHtml(`${label}${preview}`)}</span>
          </div>
          ${
            entryId
              ? `<div class="tree-node-actions">
                   <button class="text-button" data-tree-navigate="${escapeHtml(entryId)}" type="button">切换到此节点</button>
                   <button class="text-button" data-tree-fork="${escapeHtml(entryId)}" type="button">从此分支</button>
                   <button class="text-button" data-tree-copy="${escapeHtml(`${label}${preview}`)}" type="button">复制</button>
                   <button class="text-button" data-tree-label="${escapeHtml(entryId)}" data-tree-label-name="${escapeHtml(node.label || "")}" type="button">标记</button>
                 </div>`
              : ""
          }
          ${node.children?.length ? treeNodesHtml(node.children, depth + 1) : ""}
        </div>`;
    })
    .join("");
}

function bindTreeActions() {
  document.querySelectorAll("[data-tree-navigate]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("切换到这个节点继续？当前分支不会被删除，原会话仍保留。")) return;
      button.disabled = true;
      try {
        const response = await API.navigateSessionTree(button.dataset.treeNavigate);
        if (!response?.success) throw new Error(response?.error || "切换节点失败");
        if (response.data?.cancelled) {
          showMessage("扩展取消了这次切换");
          button.disabled = false;
          return;
        }
        $("ruleDialog").close();
        await load();
        showMessage(
          response.data?.editorText
            ? "已切换到此节点；输入框为空时会恢复该节点原消息"
            : "已切换到此节点，原分支仍保留",
        );
      } catch (error) {
        showMessage(agentErrorMessage(error.message, "切换节点失败"), true);
        button.disabled = false;
      }
    });
  });
  document.querySelectorAll("[data-tree-fork]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("从这条节点创建新分支？原会话会保留。")) return;
      try {
        const response = await API.forkSession(button.dataset.treeFork);
        if (!response?.success) throw new Error(response?.error || "创建分支失败");
        $("ruleDialog").close();
        await load();
        showMessage(response.data?.cancelled ? "扩展取消了这次分支" : "已从该节点创建分支");
      } catch (error) {
        showMessage(error.message, true);
      }
    });
  });
  document.querySelectorAll("[data-tree-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await API.copyText(button.dataset.treeCopy);
        showMessage("已复制节点内容");
      } catch (error) {
        showMessage(error.message, true);
      }
    });
  });
  document.querySelectorAll("[data-tree-label]").forEach((button) => {
    button.addEventListener("click", () => {
      openTreeLabel(button.dataset.treeLabel, button.dataset.treeLabelName || "");
    });
  });
}

function openTreeLabel(entryId, currentLabel) {
  if ($("ruleDialog").open) $("ruleDialog").close();
  setRuleDialogMode({
    mode: "tree-label",
    id: entryId,
    title: "标记节点",
    submit: "保存标记",
    body: `
      <label class="dialog-field dialog-field-wide">
        <span>标记</span>
        <input id="treeLabelInput" class="dialog-input" placeholder="留空清除标记" value="${escapeHtml(currentLabel)}" autocomplete="off" />
      </label>`,
  });
}

async function openSessionTree() {
  try {
    const response = await API.getSessionTree();
    const tree = response?.data?.tree ?? [];
    if (tree.length === 0) {
      showMessage("当前会话还没有树节点");
      return;
    }
    setRuleDialogMode({
      mode: "session-tree",
      id: "session",
      title: "会话树",
      submit: "关闭",
      hideCancel: true,
      body: `<div class="tree-list">${treeNodesHtml(tree)}</div>`,
    });
    bindTreeActions();
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function cloneSession() {
  try {
    const response = await API.cloneSession();
    if (!response?.success) throw new Error(response?.error || "复制会话失败");
    if (response.data?.cancelled) {
      showMessage("扩展取消了这次复制");
      return;
    }
    showMessage("已复制为新会话");
    await renderSession();
  } catch (error) {
    showMessage(agentErrorMessage(error.message, "复制会话失败"), true);
  }
}

async function exportSession() {
  try {
    const response = await API.exportSessionHtml();
    if (!response?.success) throw new Error(agentErrorMessage(response?.error, "导出失败"));
    const outputPath = response.data?.path;
    showMessage(outputPath ? `已导出到 ${outputPath}` : "已导出会话 HTML");
    if (outputPath) API.openPath(outputPath).catch(() => {});
  } catch (error) {
    showMessage(agentErrorMessage(error.message, "导出失败"), true);
  }
}

async function exportSessionJsonl() {
  try {
    const response = await API.exportSessionJsonl();
    if (!response?.success) {
      if (response?.cancelled) return;
      throw new Error(agentErrorMessage(response?.error, "导出失败"));
    }
    const outputPath = response.data?.path;
    showMessage(outputPath ? `已导出到 ${outputPath}` : "已导出会话 JSONL");
    if (outputPath) API.openPath(outputPath).catch(() => {});
  } catch (error) {
    showMessage(agentErrorMessage(error.message, "导出失败"), true);
  }
}

function setShareDialogMessage(text, error = false) {
  const node = $("shareDialogMessage");
  node.textContent = text;
  node.classList.toggle("error", error);
}

function shareDialogBodyHtml(data) {
  return `
    <p class="dialog-copy">已创建私有 Gist。会话 HTML 已上传，分享链接如下。</p>
    <label class="dialog-field dialog-field-wide">
      <span>分享预览</span>
      <input class="dialog-input" id="shareUrlInput" readonly value="${escapeHtml(data.viewerUrl)}" />
    </label>
    <label class="dialog-field dialog-field-wide">
      <span>Gist 地址</span>
      <input class="dialog-input" id="shareGistUrlInput" readonly value="${escapeHtml(data.gistUrl)}" />
    </label>
    <div class="share-dialog-actions">
      <button class="text-button" type="button" data-share-action="open">打开预览</button>
      <button class="text-button" type="button" data-share-action="copy">复制链接</button>
      <button class="text-button" type="button" data-share-action="copy-gist">复制 Gist</button>
    </div>
  `;
}

function openShareDialog() {
  shareDialogState = { mode: "confirm", data: null };
  $("shareDialogTitle").textContent = "分享会话";
  $("shareDialogBody").innerHTML = `
    <p class="dialog-copy">会导出当前会话的 HTML，并调用本机 <code>gh</code> 创建一个私有 Gist。会话内容会上传到 GitHub，请确认当前会话不含敏感信息。</p>
    <p class="dialog-copy">需要安装 <code>gh</code> 并先执行 <code>gh auth login</code>；也可以在设置 <code>PISPIDER_GH_BIN</code> 指定可执行文件路径。</p>
  `;
  $("shareDialogSubmit").textContent = "创建私有 Gist";
  $("shareDialogSubmit").disabled = false;
  $("shareDialogCancel").hidden = false;
  setShareDialogMessage("");
  $("shareDialog").showModal();
  $("shareDialogSubmit").focus();
}

async function submitShareDialog(event) {
  event.preventDefault();
  if (!shareDialogState) return;
  if (shareDialogState.mode === "result") {
    $("shareDialog").close();
    return;
  }
  if (shareDialogState.mode !== "confirm") return;
  shareDialogState.mode = "busy";
  const submit = $("shareDialogSubmit");
  submit.disabled = true;
  submit.textContent = "创建中...";
  setShareDialogMessage("正在导出当前会话并创建私有 Gist...", false);
  try {
    const response = await API.shareSession();
    if (!response?.success) throw new Error(agentErrorMessage(response?.error, "分享失败"));
    const data = response.data || {};
    if (!data.viewerUrl || !data.gistUrl) throw new Error("没有拿到完整的分享链接");
    shareDialogState = { mode: "result", data };
    $("shareDialogTitle").textContent = "分享成功";
    $("shareDialogBody").innerHTML = shareDialogBodyHtml(data);
    $("shareDialogSubmit").textContent = "完成";
    submit.disabled = false;
    $("shareDialogCancel").hidden = true;
    setShareDialogMessage("");
  } catch (error) {
    shareDialogState.mode = "confirm";
    submit.disabled = false;
    submit.textContent = "创建私有 Gist";
    setShareDialogMessage(agentErrorMessage(error.message, "分享失败"), true);
  }
}

async function handleShareDialogAction(action) {
  if (!shareDialogState?.data) return;
  const data = shareDialogState.data;
  try {
    if (action === "open") {
      await API.openExternal(data.viewerUrl);
    } else if (action === "copy") {
      await API.copyText(data.viewerUrl);
      setShareDialogMessage("分享链接已复制", false);
    } else if (action === "copy-gist") {
      await API.copyText(data.gistUrl);
      setShareDialogMessage("Gist 地址已复制", false);
    }
  } catch (error) {
    setShareDialogMessage(agentErrorMessage(error.message, "操作失败"), true);
  }
}

async function importSession() {
  const button = $("importSessionButton");
  if (button) {
    button.disabled = true;
    button.textContent = "选择文件...";
  }
  try {
    const result = await API.importSession();
    if (result?.cancelled) return;
    const response = await API.switchSession(result.path);
    if (!response?.success) throw new Error(agentErrorMessage(response?.error, "恢复会话失败"));
    const name = result.session?.sessionName || result.session?.name || "已导入会话";
    showMessage(result.imported ? `已恢复并打开：${name}` : `已打开会话：${name}`);
    await renderSession();
  } catch (error) {
    showMessage(agentErrorMessage(error.message, "恢复会话失败"), true);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "从其他目录恢复";
    }
  }
}

function bindSessionControls(session, autoRetryEnabled) {
  $("autoCompactionInput")?.addEventListener("change", async (event) => {
    try {
      const response = await API.setAutoCompaction(event.target.checked);
      if (!response?.success) throw new Error(response?.error || "更新自动压缩失败");
      showMessage(event.target.checked ? "已开启自动压缩" : "已关闭自动压缩");
      if (session) session.autoCompactionEnabled = event.target.checked;
    } catch (error) {
      event.target.checked = Boolean(session?.autoCompactionEnabled);
      showMessage(error.message, true);
    }
  });
  $("cloneSessionButton")?.addEventListener("click", cloneSession);
  $("importSessionButton")?.addEventListener("click", importSession);
  $("rewindOnceButton")?.addEventListener("click", () => openSessionRewind("once"));
  $("rewindRoundButton")?.addEventListener("click", () => openSessionRewind("round"));
  $("treeSessionButton")?.addEventListener("click", openSessionTree);
  $("exportSessionButton")?.addEventListener("click", exportSession);
  $("exportSessionJsonlButton")?.addEventListener("click", exportSessionJsonl);
  $("shareSessionButton")?.addEventListener("click", openShareDialog);
  $("resetTaskButton")?.addEventListener("click", openTaskReset);
  $("abortRetryButton")?.addEventListener("click", async () => {
    try {
      const response = await API.abortRetry();
      if (!response?.success) throw new Error(agentErrorMessage(response?.error, "中止重试失败"));
      showMessage("已请求中止重试");
    } catch (error) {
      showMessage(error.message, true);
    }
  });
  $("autoRetryInput")?.addEventListener("change", async (event) => {
    try {
      const response = await API.setAutoRetry(event.target.checked);
      if (!response?.success) throw new Error(response?.error || "更新自动重试失败");
      autoRetryEnabled = event.target.checked;
      showMessage(event.target.checked ? "已开启自动重试" : "已关闭自动重试");
    } catch (error) {
      event.target.checked = autoRetryEnabled;
      showMessage(error.message, true);
    }
  });
}

function formatCount(value) {
  if (value == null || !Number.isFinite(Number(value))) return "0";
  return Number(value).toLocaleString("zh-CN");
}

async function compactSession(customInstructions = "") {
  const button = $("compactButton");
  if (button) {
    button.disabled = true;
    button.textContent = "压缩中...";
  }
  try {
    const response = await API.compactSession(customInstructions);
    if (!response?.success) throw new Error(agentErrorMessage(response?.error, "压缩失败"));
    showMessage("上下文已压缩");
    await renderSession();
  } catch (error) {
    showMessage(agentErrorMessage(error.message, "压缩失败"), true);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "压缩上下文";
    }
  }
}

async function openSessionRename() {
  let name = "";
  try {
    const response = await API.getState();
    name = response?.data?.sessionName || "";
  } catch {}
  setRuleDialogMode({
    mode: "session-rename",
    id: "session",
    title: "重命名会话",
    submit: "保存",
    body: `
      <label class="dialog-field">
        <span>会话名称</span>
        <input id="sessionNameInput" class="dialog-input" maxlength="80" value="${escapeHtml(name)}" placeholder="例如：抓取商品列表" />
      </label>`,
  });
}

async function openSessionFork() {
  try {
    const response = await API.forkMessages();
    const messages = response?.data?.messages ?? [];
    if (messages.length === 0) {
      showMessage("当前会话还没有可回退的用户消息");
      return;
    }
    const items = messages
      .map(
        (message) => `
          <label class="fork-option">
            <input type="radio" name="forkEntry" value="${escapeHtml(message.entryId)}" />
            <span>${escapeHtml(String(message.text || "").slice(0, 160) || "无文本")}</span>
          </label>`,
      )
      .join("");
    setRuleDialogMode({
      mode: "session-fork",
      id: "session",
      title: "回退分支",
      submit: "创建分支",
      body: `<div class="fork-list">${items}</div>`,
    });
  } catch (error) {
    showMessage(error.message, true);
  }
}

function openSessionRewind(mode) {
  const isRound = mode === "round";
  setRuleDialogMode({
    mode: "session-rewind",
    id: isRound ? "round" : "once",
    title: isRound ? "再回退一轮" : "回退上一轮",
    submit: "回退",
    body: `<p class="dialog-copy">${
      isRound
        ? "会回到更早一条用户消息之前，并创建新的分支。"
        : "会回到最近一条用户消息之前，并创建新的分支。"
    } 当前分支不会被删除，仍可从会话树恢复。</p>`,
  });
}

async function load() {
  $("panelBody").innerHTML = `<div class="panel-empty">加载中...</div>`;
  $("createButton").hidden = kind !== "rules" && kind !== "skills" && kind !== "mcp";
  $("createButton").textContent =
    kind === "skills" ? "新建技能" : kind === "mcp" ? "添加服务器" : "新建规则";
  $("importSkillButton").hidden = kind !== "skills";
  $("reloadAgentButton").hidden = kind !== "skills" && kind !== "settings" && kind !== "mcp" && kind !== "extensions";
  $("compactButton").hidden = kind !== "session";
  $("renameSessionButton").hidden = kind !== "session";
  $("forkSessionButton").hidden = kind !== "session";
  $("checkMcpButton").hidden = kind !== "mcp";
  $("openDirButton").hidden = false;
  try {
    if (!runtimeInfo) runtimeInfo = await API.getInfo();

    if (kind === "rules") {
      $("refreshButton").hidden = false;
      $("openDirButton").textContent = "打开规则目录";
      renderRules(await API.listRules());
    } else if (kind === "skills") {
      $("refreshButton").hidden = false;
      $("openDirButton").textContent = "打开技能目录";
      renderSkills(await API.listSkills());
    } else if (kind === "mcp") {
      $("refreshButton").hidden = true;
      $("openDirButton").hidden = true;
      const mcpData = await API.listMcp(mcpScope);
      renderMcp(mcpData);
      if ((mcpData?.servers ?? []).length) void checkAllMcp(false);
    } else if (kind === "settings") {
      $("refreshButton").hidden = true;
      $("openDirButton").textContent = "打开数据目录";
      await renderSettings();
    } else if (kind === "extensions") {
      $("refreshButton").hidden = false;
      $("openDirButton").textContent = "打开用户扩展目录";
      await renderExtensions();
    } else if (kind === "project") {
      $("refreshButton").hidden = true;
      $("openDirButton").textContent = "打开工作区";
      renderProject();
    } else if (kind === "status") {
      $("refreshButton").hidden = false;
      $("openDirButton").textContent = "打开数据目录";
      await renderStatus();
    } else if (kind === "session") {
      $("refreshButton").hidden = false;
      $("openDirButton").textContent = "打开会话目录";
      await renderSession();
    } else {
      throw new Error(`未知面板：${kind}`);
    }
  } catch (error) {
    setHeader(PANEL_META[kind]?.title || "面板", "");
    $("panelBody").innerHTML = `<div class="panel-empty">${escapeHtml(error.message)}</div>`;
    showMessage(error.message, true);
  }
}

function bindStaticEvents() {
  $("refreshButton").addEventListener("click", load);
  $("createButton").addEventListener("click", () => {
    if (kind === "skills") openSkillCreate();
    else if (kind === "mcp") openMcpCreate();
    else openRuleCreate();
  });
  $("importSkillButton").addEventListener("click", importSkill);
  $("reloadAgentButton").addEventListener("click", reloadAgent);
  $("ruleForm").addEventListener("submit", submitRuleDialog);
  $("ruleDialogCancel").addEventListener("click", () => $("ruleDialog").close());
  $("ruleDialogClose").addEventListener("click", () => $("ruleDialog").close());
  $("ruleDialog").addEventListener("click", (event) => {
    if (event.target === $("ruleDialog")) $("ruleDialog").close();
  });
  $("shareForm").addEventListener("submit", submitShareDialog);
  $("shareDialogCancel").addEventListener("click", () => $("shareDialog").close());
  $("shareDialogClose").addEventListener("click", () => $("shareDialog").close());
  $("shareDialog").addEventListener("click", (event) => {
    if (event.target === $("shareDialog")) $("shareDialog").close();
  });
  $("shareDialog").addEventListener("close", () => {
    shareDialogState = null;
  });
  $("shareDialogBody").addEventListener("click", (event) => {
    const button = event.target.closest("[data-share-action]");
    if (!button) return;
    handleShareDialogAction(button.dataset.shareAction).catch((error) => {
      setShareDialogMessage(agentErrorMessage(error.message, "操作失败"), true);
    });
  });
  $("ruleDialogBody").addEventListener("click", (event) => {
    const button = event.target.closest("[data-oauth-dialog-action]");
    if (!button || !oauthDialogState) return;
    if (button.dataset.oauthDialogAction === "open-url") {
      if (oauthDialogState.authUrl) API.openExternal(oauthDialogState.authUrl).catch((error) => showMessage(error.message, true));
    }
  });
  $("ruleDialog").addEventListener("close", () => {
    if (!oauthDialogState) return;
    const loginId = oauthDialogState.loginId;
    oauthDialogState = null;
    if (loginId) API.cancelOAuthLogin().catch(() => {});
  });
  document.querySelectorAll("[data-window-action]").forEach((button) => {
    button.addEventListener("click", () => {
      API.windowAction(button.dataset.windowAction).catch((error) => showMessage(error.message, true));
    });
  });
  $("openDirButton").addEventListener("click", async () => {
    if (!runtimeInfo) {
      try {
        runtimeInfo = await API.getInfo();
      } catch (error) {
        showMessage(error.message, true);
        return;
      }
    }
    const directoryKey = PANEL_META[kind]?.directory;
    if (kind === "mcp" && mcpScope === "project" && runtimeInfo.repoRoot) {
      openPath(`${runtimeInfo.repoRoot}/.pi`);
      return;
    }
    openPath(directoryKey ? runtimeInfo[directoryKey] : runtimeInfo.home);
  });
  $("compactButton").addEventListener("click", openCompactDialog);
  $("renameSessionButton").addEventListener("click", openSessionRename);
  $("forkSessionButton").addEventListener("click", openSessionFork);
  $("checkMcpButton").addEventListener("click", () => checkAllMcp(true));
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if ($("ruleDialog")?.open || $("shareDialog")?.open) return;
  event.preventDefault();
  API.windowAction("close").catch(() => {});
});

bindStaticEvents();
API.onEvent((event) => {
  if (event?.type === "mcp_status_changed" && event.status) updateMcpLiveStatus(event.status);
  if (event?.type === "mcp_tool_runtime_changed") updateMcpToolRuntime(event);
});
load();
