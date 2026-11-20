/**
 * PiSpider desktop renderer.
 *
 * This file intentionally uses plain DOM APIs. The desktop shell is a client
 * for the RPC protocol; it should stay easy to replace with a richer UI later.
 */

const $ = (id) => document.getElementById(id);
const Slash = globalThis.PiSpiderSlash || null;
const MESSAGE_RENDER_WINDOW = 120;
const MESSAGE_RENDER_OVERSCAN = 28;
const MESSAGE_RENDER_MAX = 200;
const MESSAGE_MARGIN_HEIGHT = 24;
const MESSAGE_TEXT_LINE_HEIGHT = 24;
const MESSAGE_CODE_LINE_HEIGHT = 20;
const MESSAGE_CODE_BLOCK_OVERHEAD = 56;
const MESSAGE_MERMAID_ESTIMATED_HEIGHT = 280;
const MESSAGE_MARKDOWN_BLOCK_GAP = 14;
const MESSAGE_MARKDOWN_HEADING_GAP = 17;
const MESSAGE_CODE_BLOCK_GAP = 14;
const MESSAGE_ERROR_HEIGHT = 34;
const MESSAGE_HEADING_HEIGHTS = { 1: 48, 2: 36, 3: 28 };
const MESSAGE_TOOL_RESULT_HEIGHT = 53;
const MESSAGE_TURN_HEADER_HEIGHT = 46;
const PANEL_COLLAPSE_WIDTH = 1180;
const PANEL_OVERLAY_WIDTH = 1320;
const SCROLL_POSITIONS_KEY = "pispider-scroll-positions";
const MESSAGE_HEIGHT_CACHE_KEY = "pispider-message-heights";
const MESSAGE_HEIGHT_CACHE_VERSION = 5;
const MESSAGE_HEIGHT_CACHE_SESSION_LIMIT = 10;
const MESSAGE_HEIGHT_CACHE_ENTRY_LIMIT = 5000;
const MESSAGE_HEIGHT_LAYOUT_TOLERANCE = 2;
const COMMAND_HISTORY_KEY = "pispider-command-history";

const state = {
  info: null,
  sessions: [],
  session: null,
  messages: [],
  messageWindowStart: -1,
  messageWindowEnd: -1,
  messagePreviousTotal: 0,
  messageHeights: new Map(),
  messageHeightVersion: 0,
  messageOffsetCache: null,
  messageVirtualTarget: null,
  messageVirtualAnchor: null,
  messageVirtualFrame: 0,
  attachments: [],
  liveId: null,
  tools: new Map(),
  changes: new Map(),
  activeCodePath: null,
  openCodeFile: null,
  rules: [],
  skills: [],
  mcpServers: [],
  extensions: [],
  availableModels: [],
  modelFilter: "",
  modelScope: [],
  modelScopeView: "scoped",
  modelScopeEditing: false,
  modelScopeDraft: [],
  modelThinkingDefaults: {},
  thinkingLevels: [],
  commands: [],
  commandsLoaded: false,
  permissionMode: "full",
  projectChanges: null,
  streaming: false,
  shellRunning: false,
  starting: false,
  connected: false,
  runtimeState: "starting",
  theme: localStorage.getItem("pispider-theme") || "light",
  search: "",
  sessionSearchResults: [],
  sessionSearchActive: -1,
  sessionSearchSort: "relevance",
  sessionSearching: false,
  sessionSearchError: "",
  sessionSearchTotal: 0,
  confirmDeleteSession: "",
  sessionOrder: [],
  sessionSortMode: false,
  sessionDragPath: "",
  zoomFactor: 1,
  rightTab: localStorage.getItem("pispider-right-tab") || "browser",
  panelOpen: localStorage.getItem("pispider-panel") !== "closed",
  scrollOnRender: false,
  scrollRestorePending: false,
  messageDataKey: "",
  messageSessionKey: "",
  messageHeightSessionKey: "",
  messageHeightSessions: new Map(),
  messageHeightLayoutWidth: 0,
  messageHeightLayoutZoom: 0,
  messageLayoutAnchor: null,
  messageLayoutFollowLatest: false,
  scrollPositions: new Map(),
  pendingLogs: [],
  queueCount: 0,
  queueSteering: [],
  queueFollowUp: [],
  sessionStats: null,
  sessionStatsError: "",
  extensionStatus: "",
  extensionWidget: "",
  extensionDialogs: [],
  activeExtensionDialog: null,
  extensionDialogTimer: 0,
};

let fileSuggestionItems = [];
let fileSuggestionToken = null;
let fileSuggestionTimer = 0;
let fileSuggestionRequest = 0;

let commandSuggestionItems = [];
let commandSuggestionToken = null;
let commandSuggestionRequest = 0;
let commandsPromise = null;

let renderFrame = 0;
let scrollPersistTimer = 0;
let messageHeightPersistTimer = 0;
let messageLayoutResizeTimer = 0;
let messageLayoutAnchorTimer = 0;
let toastTimer = 0;
let statusBannerAction = null;
let sessionSearchTimer = 0;
let sessionSearchRequest = 0;
let statusBannerTone = "";
let focusBeforeExtensionDialog = null;
let shortcutsReturnFocus = null;
let changelogReturnFocus = null;
let commandPaletteReturnFocus = null;
let commandPaletteItems = [];
let commandPaletteResults = [];
let commandPaletteActive = 0;
let sessionPickerReturnFocus = null;
let sessionPickerItems = [];
let sessionPickerActive = 0;
let sessionPickerRequest = 0;
let commandHistory = [];
let agentRefreshGeneration = 0;
const actionOpenKeys = new Set();

function scheduleDomUpdate(callback) {
  if (!document.hidden) {
    requestAnimationFrame(callback);
    return;
  }
  setTimeout(callback, 0);
}

function scheduleRender() {
  if (renderFrame) return;
  renderFrame = scheduleDomUpdate(() => {
    renderFrame = 0;
    renderAll();
  });
}

const SEND_ICON = `
  <svg viewBox="0 0 18 18" width="16" height="16" fill="none">
    <path d="M9 14.5V3.7M4.8 7.9 9 3.7l4.2 4.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>
`;
const STOP_ICON = `
  <svg viewBox="0 0 18 18" width="16" height="16" fill="none">
    <rect x="5.2" y="5.2" width="7.6" height="7.6" rx="1.2" fill="currentColor"/>
  </svg>
`;
const ACTION_GLYPH = `
  <svg viewBox="0 0 16 16" width="11" height="11" fill="none" aria-hidden="true">
    <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" stroke-width="1"/>
    <path d="M5 6.5 7 8l-2 1.5M8.5 9h2.5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
  </svg>
`;
const ACTION_CHEVRON = `
  <svg viewBox="0 0 12 12" width="10" height="10" fill="none" aria-hidden="true">
    <path d="m4.5 3 3 3-3 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  </svg>
`;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
    .filter(Boolean)
    .join("\n\n");
}

function renderMarkdownInline(value) {
  const codeSpans = [];
  let text = String(value ?? "").replace(/`([^`\n]+)`/g, (_match, code) => {
    const index = codeSpans.length;
    codeSpans.push(code);
    return `@@PS_INLINE_CODE_${index}@@`;
  });
  text = escapeHtml(text)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  return text.replace(/@@PS_INLINE_CODE_(\d+)@@/g, (_match, index) => {
    return `<code>${escapeHtml(codeSpans[Number(index)])}</code>`;
  });
}

const CODE_KEYWORDS = {
  js: "const let var function return if else for while class new import export from async await try catch throw typeof this true false null undefined switch case break continue do in of as",
  ts: "const let var function return if else for while class new import export from async await try catch throw typeof this true false null undefined interface type extends implements public private protected readonly enum switch case break continue do in of as",
  py: "def class return if elif else for while import from as try except finally with lambda True False None and or not in is pass raise yield async await",
  sh: "if then else fi for in do done case esac function export local return while until echo",
  ps: "if else elseif foreach for while do until function param return switch try catch finally throw class enum",
  json: "true false null",
  sql: "select from where join on as and or not null insert update delete create table into values group by order limit offset having distinct left right inner outer union all case when then end",
};
const CODE_LANGUAGE_ALIASES = {
  javascript: "js",
  typescript: "ts",
  python: "py",
  bash: "sh",
  shell: "sh",
  powershell: "ps",
  ps1: "ps",
  yaml: "yml",
};

function highlightMarkdownCode(code, language) {
  const normalized = CODE_LANGUAGE_ALIASES[language] || language;
  const keywords = CODE_KEYWORDS[normalized];
  if (!keywords) return escapeHtml(code);
  const keywordList = new Set(keywords.split(/\s+/).filter(Boolean));
  const tokenPattern =
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;
  let html = "";
  let lastIndex = 0;
  let match;
  while ((match = tokenPattern.exec(code))) {
    html += escapeHtml(code.slice(lastIndex, match.index));
    const token = match[0];
    let className = "";
    if (match[1]) className = "tok-comment";
    else if (match[2]) className = "tok-string";
    else if (match[3]) className = "tok-number";
    else if (match[4] && keywordList.has(token)) className = "tok-keyword";
    html += className ? `<span class="${className}">${escapeHtml(token)}</span>` : escapeHtml(token);
    lastIndex = match.index + token.length;
  }
  html += escapeHtml(code.slice(lastIndex));
  return html;
}

function markdownCodeBlockHtml(block) {
  const language = block.language || "text";
  if (language.toLowerCase() === "mermaid") {
    return `<div class="code-block mermaid-block" data-language="mermaid">
      <div class="code-block-head">
        <span class="code-block-lang">mermaid</span>
        <div class="code-block-actions">
          <button class="mermaid-toggle" type="button" data-mermaid-toggle>查看源码</button>
          <button class="code-copy" type="button" data-code-copy>复制代码</button>
        </div>
      </div>
      <div class="mermaid-output" data-mermaid-output><span class="mermaid-placeholder">正在渲染图表…</span></div>
      <pre class="mermaid-source" hidden><code>${escapeHtml(block.code)}</code></pre>
    </div>`;
  }
  return `<div class="code-block" data-language="${escapeHtml(language)}">
      <div class="code-block-head">
        <span class="code-block-lang">${escapeHtml(language)}</span>
        <button class="code-copy" type="button" data-code-copy>复制代码</button>
      </div>
      <pre><code>${highlightMarkdownCode(block.code, language.toLowerCase())}</code></pre>
    </div>`;
}

function markdownTableCells(line) {
  if (!line.includes("|")) return [];
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return body.split("|").map((cell) => cell.trim());
}

function isMarkdownTableSeparator(line) {
  const cells = markdownTableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isMarkdownTableStart(lines, index) {
  return (
    index + 1 < lines.length &&
    String(lines[index] || "").includes("|") &&
    String(lines[index] || "").trim().length > 0 &&
    isMarkdownTableSeparator(lines[index + 1])
  );
}

function markdownTableHtml(lines, start) {
  const header = markdownTableCells(lines[start]);
  const separator = markdownTableCells(lines[start + 1]);
  const alignment = separator.map((cell) => {
    if (cell.startsWith(":") && cell.endsWith(":")) return "center";
    if (cell.endsWith(":")) return "right";
    return "left";
  });
  const rows = [];
  let index = start + 2;
  while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
    rows.push(markdownTableCells(lines[index]));
    index += 1;
  }
  const cell = (tag, value, column) =>
    `<${tag} class="align-${alignment[column] || "left"}">${renderMarkdownInline(value || "")}</${tag}>`;
  const head = `<thead><tr>${header.map((value, column) => cell("th", value, column)).join("")}</tr></thead>`;
  const body = rows.length
    ? `<tbody>${rows
        .map(
          (row) =>
            `<tr>${Array.from({ length: header.length }, (_v, column) =>
              cell("td", row[column] ?? "", column),
            ).join("")}</tr>`,
        )
        .join("")}</tbody>`
    : "";
  return {
    html: `<div class="markdown-table-wrap"><table class="markdown-table">${head}${body}</table></div>`,
    nextIndex: index,
  };
}

function markdownListMatch(line) {
  return /^([ \t]*)([-*+]|\d+\.)[ \t]+(.*)$/.exec(String(line || ""));
}

function markdownListIndent(indent) {
  return indent.replace(/\t/g, "  ").length;
}

function markdownListHtml(lines, start) {
  const first = markdownListMatch(lines[start]);
  const baseIndent = markdownListIndent(first[1]);
  const ordered = /^\d+\./.test(first[2]);
  const items = [];
  let index = start;
  while (index < lines.length) {
    const match = markdownListMatch(lines[index]);
    if (!match) break;
    const indent = markdownListIndent(match[1]);
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      if (items.length > 0) items[items.length - 1].push(lines[index].trim());
      index += 1;
      continue;
    }
    items.push([match[3]]);
    index += 1;
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) break;
      const nextMatch = markdownListMatch(line);
      if (nextMatch && markdownListIndent(nextMatch[1]) <= baseIndent) break;
      if (/^[ \t]{2,}/.test(line) || nextMatch) {
        items[items.length - 1].push(line.trim());
        index += 1;
        continue;
      }
      break;
    }
  }
  const tag = ordered ? "ol" : "ul";
  return {
    html: `<${tag}>${items.map((item) => `<li>${renderMarkdownInline(item.join(" "))}</li>`).join("")}</${tag}>`,
    nextIndex: index,
  };
}

function isMarkdownBlockStart(lines, index) {
  const text = lines[index] ?? "";
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^@@PS_CODE_\d+@@$/.test(trimmed)) return true;
  if (/^#{1,6}[ \t]+/.test(trimmed)) return true;
  if (/^>[ \t]?/.test(trimmed)) return true;
  if (/^([-*+]|\d+\.)[ \t]+/.test(trimmed)) return true;
  if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) return true;
  return isMarkdownTableStart(lines, index);
}

function renderMarkdownBlocks(source, codeBlocks) {
  const lines = String(source || "").split("\n");
  let html = "";
  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html += `<p>${paragraph.map(renderMarkdownInline).join("<br>")}</p>`;
    paragraph = [];
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      index += 1;
      continue;
    }

    const codeMatch = /^@@PS_CODE_(\d+)@@$/.exec(trimmed);
    if (codeMatch) {
      flushParagraph();
      const block = codeBlocks[Number(codeMatch[1])];
      if (block) html += markdownCodeBlockHtml(block);
      index += 1;
      continue;
    }

    const heading = /^(#{1,6})[ \t]+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      const level = Math.min(6, heading[1].length);
      html += `<h${level}>${renderMarkdownInline(heading[2])}</h${level}>`;
      index += 1;
      continue;
    }

    if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      html += "<hr>";
      index += 1;
      continue;
    }

    if (/^>[ \t]?/.test(trimmed)) {
      flushParagraph();
      const quote = [];
      while (index < lines.length && /^>[ \t]?/.test(lines[index].trim())) {
        quote.push(lines[index].trim().replace(/^>[ \t]?/, ""));
        index += 1;
      }
      html += `<blockquote class="markdown-quote">${renderMarkdownBlocks(quote.join("\n"), codeBlocks)}</blockquote>`;
      continue;
    }

    if (isMarkdownTableStart(lines, index)) {
      flushParagraph();
      const table = markdownTableHtml(lines, index);
      html += table.html;
      index = table.nextIndex;
      continue;
    }

    if (markdownListMatch(line)) {
      flushParagraph();
      const list = markdownListHtml(lines, index);
      html += list.html;
      index = list.nextIndex;
      continue;
    }

    paragraph.push(trimmed);
    index += 1;
    if (index < lines.length && isMarkdownBlockStart(lines, index)) {
      flushParagraph();
    }
  }
  flushParagraph();
  return html;
}

function renderMarkdown(value) {
  const source = String(value ?? "").replace(/\r\n?/g, "\n");
  const codeBlocks = [];
  const text = source.replace(/```([A-Za-z0-9_+-]*)[ \t]*\n([\s\S]*?)```/g, (_match, language, code) => {
    const index = codeBlocks.length;
    codeBlocks.push({ language, code: code.replace(/\n$/, "") });
    return `\n\n@@PS_CODE_${index}@@\n\n`;
  });
  return renderMarkdownBlocks(text, codeBlocks);
}

let mermaidModulePromise = null;
let mermaidRenderTimer = null;
let mermaidRenderBusy = false;
let mermaidRenderQueued = false;
let mermaidRenderGeneration = 0;
let mermaidRenderSequence = 0;

function loadMermaidModule() {
  if (!mermaidModulePromise) {
    mermaidModulePromise = (async () => {
      let lastError = null;
      for (const candidate of [
        "../vendor/mermaid/mermaid.esm.min.mjs",
        "../node_modules/mermaid/dist/mermaid.esm.min.mjs",
        "../../../node_modules/mermaid/dist/mermaid.esm.min.mjs",
      ]) {
        try {
          const module = await import(candidate);
          const instance = module.default ?? module.mermaid ?? module;
          if (typeof instance?.render === "function") return instance;
          lastError = new Error("Mermaid 模块缺少 render 方法");
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError ?? new Error("未找到本地 Mermaid 模块");
    })();
    mermaidModulePromise.catch(() => {
      mermaidModulePromise = null;
    });
  }
  return mermaidModulePromise;
}

function mermaidThemeVariables() {
  const style = getComputedStyle(document.documentElement);
  const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  return {
    darkMode: document.documentElement.dataset.theme === "dark",
    background: read("--chat-bg", "#ffffff"),
    primaryColor: read("--accent-soft", "#ececec"),
    primaryTextColor: read("--text", "#1a1a1a"),
    primaryBorderColor: read("--border", "#e2e2e2"),
    lineColor: read("--muted", "#767676"),
    secondaryColor: read("--panel-soft", "#f4f4f4"),
    tertiaryColor: read("--panel", "#fafafa"),
    mainBkg: read("--panel-soft", "#f4f4f4"),
    nodeBorder: read("--border", "#e2e2e2"),
    clusterBkg: read("--panel", "#fafafa"),
    clusterBorder: read("--border", "#e2e2e2"),
    titleColor: read("--text", "#1a1a1a"),
    edgeLabelBackground: read("--chat-bg", "#ffffff"),
    fontFamily: read("--font-ui", "Segoe UI, sans-serif"),
    fontSize: "12px",
  };
}

function configureMermaid(mermaid) {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: "base",
    themeVariables: mermaidThemeVariables(),
    flowchart: { htmlLabels: false, useMaxWidth: false, curve: "basis" },
    sequence: { useMaxWidth: false, wrap: true, mirrorActors: false, showSequenceNumbers: false },
    gantt: { useMaxWidth: false },
    journey: { useMaxWidth: false },
    timeline: { useMaxWidth: false },
    mindmap: { useMaxWidth: false },
    class: { useMaxWidth: false },
    state: { useMaxWidth: false },
    er: { useMaxWidth: false },
    pie: { useMaxWidth: false },
    gitGraph: { useMaxWidth: false },
  });
}

function mermaidBlockOutput(block) {
  return block.querySelector("[data-mermaid-output]");
}

function mermaidBlockSource(block) {
  return block.querySelector(".mermaid-source");
}

function mermaidBlockCode(block) {
  return mermaidBlockSource(block)?.querySelector("code")?.textContent ?? "";
}

function mermaidDiagramKind(code) {
  const lines = code.split(/\r?\n/).map((line) => line.trim());
  const firstIndex = lines.findIndex(Boolean);
  let start = firstIndex === -1 ? 0 : firstIndex;
  if (lines[start] === "---") {
    const end = lines.findIndex((line, index) => index > start && line === "---");
    if (end > start) start = end + 1;
  }
  const firstLine = lines.slice(start).find((line) => line && !line.startsWith("%%"));
  if (!firstLine) return "unknown";
  if (/^(?:flowchart-elk|flowchart|graph)\b/i.test(firstLine)) return "flowchart";
  if (/^sequenceDiagram\b/i.test(firstLine)) return "sequence";
  return firstLine.match(/^[A-Za-z][A-Za-z0-9_-]*/)?.[0] ?? "unknown";
}

function setMermaidBlockError(block, error) {
  const output = mermaidBlockOutput(block);
  const source = mermaidBlockSource(block);
  const toggle = block.querySelector("[data-mermaid-toggle]");
  block.dataset.mermaidState = "error";
  if (output) {
    output.innerHTML = `<div class="mermaid-error"><span>图表渲染失败</span><pre>${escapeHtml(
      error?.message || "未知错误",
    )}</pre></div>`;
  }
  if (source) source.hidden = false;
  if (toggle) toggle.textContent = "隐藏源码";
}

async function renderMermaidBlock(mermaid, block, generation) {
  const code = mermaidBlockCode(block).trim();
  const output = mermaidBlockOutput(block);
  if (!output) return;
  if (!code) {
    block.dataset.mermaidState = "empty";
    output.innerHTML = '<span class="mermaid-placeholder">空图表</span>';
    return;
  }
  const kind = mermaidDiagramKind(code);
  if (kind !== "flowchart" && kind !== "sequence") {
    setMermaidBlockError(block, new Error(`当前离线版本只包含 flowchart / sequence，无法渲染 ${kind} 图表`));
    return;
  }
  block.dataset.mermaidState = "rendering";
  output.innerHTML = '<span class="mermaid-placeholder">正在渲染图表…</span>';
  try {
    mermaidRenderSequence += 1;
    const result = await mermaid.render(`pispider-mermaid-${Date.now()}-${mermaidRenderSequence}`, code);
    if (generation !== mermaidRenderGeneration) return;
    const svg = typeof result === "string" ? result : result?.svg;
    if (!svg) throw new Error("Mermaid 没有返回 SVG");
    output.innerHTML = svg;
    block.dataset.mermaidState = "rendered";
    const source = mermaidBlockSource(block);
    if (source) source.hidden = true;
    const toggle = block.querySelector("[data-mermaid-toggle]");
    if (toggle) toggle.textContent = "查看源码";
  } catch (error) {
    if (generation !== mermaidRenderGeneration) return;
    setMermaidBlockError(block, error);
  }
}

async function renderMermaidBlocks(force = false) {
  if (mermaidRenderBusy) {
    mermaidRenderQueued = true;
    return;
  }
  const blocks = [...document.querySelectorAll(".mermaid-block")].filter(
    (block) => force || !block.dataset.mermaidState || block.dataset.mermaidState === "pending",
  );
  if (blocks.length === 0) return;
  mermaidRenderBusy = true;
  const generation = ++mermaidRenderGeneration;
  const nearBottom = isThreadNearBottom();
  const anchor = nearBottom ? null : captureMessageAnchor();
  try {
    let mermaid;
    try {
      mermaid = await loadMermaidModule();
      if (generation !== mermaidRenderGeneration) return;
      configureMermaid(mermaid);
    } catch (error) {
      if (generation !== mermaidRenderGeneration) return;
      for (const block of blocks) setMermaidBlockError(block, error);
      return;
    }
    for (const block of blocks) {
      if (generation !== mermaidRenderGeneration) return;
      await renderMermaidBlock(mermaid, block, generation);
    }
    if (measureRenderedMessages()) {
      const messages = visibleMessages();
      applyVirtualSpacers(messages, state.messageWindowStart, state.messageWindowEnd, messages.length);
    }
    if (nearBottom) scrollToBottom();
    else if (anchor) restoreMessageAnchor(anchor);
  } finally {
    mermaidRenderBusy = false;
    if (mermaidRenderQueued) {
      mermaidRenderQueued = false;
      scheduleMermaidRender(0);
    }
  }
}

function scheduleMermaidRender(delay = 0, force = false) {
  clearTimeout(mermaidRenderTimer);
  mermaidRenderTimer = setTimeout(() => {
    mermaidRenderTimer = null;
    renderMermaidBlocks(force).catch((error) => {
      console.error("Mermaid render failed", error);
    });
  }, delay);
}

function resetMermaidBlocks() {
  mermaidRenderGeneration += 1;
  for (const block of document.querySelectorAll(".mermaid-block")) {
    block.dataset.mermaidState = "";
    const output = mermaidBlockOutput(block);
    if (output) output.innerHTML = '<span class="mermaid-placeholder">正在渲染图表…</span>';
    const source = mermaidBlockSource(block);
    if (source) source.hidden = true;
    const toggle = block.querySelector("[data-mermaid-toggle]");
    if (toggle) toggle.textContent = "查看源码";
  }
  scheduleMermaidRender(0, true);
}

function shortText(value, max = 160) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function basename(filePath) {
  if (!filePath) return "项目";
  const parts = String(filePath).split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || filePath;
}

function timeLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时`;
  if (diff < 172_800_000) return "昨天";
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function modelDisplayName(model) {
  const name = String(model?.name || "").trim();
  if (name && !name.startsWith("自定义") && name !== "未知模型" && name !== "unknown") return name;
  return String(model?.id || "").trim() || name || "未配置模型";
}

function modelLabel() {
  const model = state.session?.model;
  if (!model || model.id === "unknown") return "未配置模型";
  return modelDisplayName(model);
}

const PERMISSION_OPTIONS = [
  { id: "full", label: "全部允许", description: "当前项目：允许读取、修改文件、执行命令和使用 MCP 工具" },
  { id: "readonly", label: "只读", description: "当前项目：只允许 read、grep、find、ls；排除 MCP 和写入工具" },
  { id: "none", label: "禁用工具", description: "当前项目：关闭所有工具，只保留对话" },
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

function visibleThinkingLevels(levels) {
  const filtered = (Array.isArray(levels) ? levels : []).filter((level) =>
    DESKTOP_THINKING_LEVELS.includes(level),
  );
  return filtered.length ? filtered : ["off"];
}

function permissionLabel() {
  return PERMISSION_OPTIONS.find((option) => option.id === state.permissionMode)?.label || "全部允许";
}

function thinkingLabel() {
  return THINKING_LABELS[state.session?.thinkingLevel] || "";
}

function hideComposerPopovers() {
  $("modelPopover").hidden = true;
  $("permissionPopover").hidden = true;
  const statsPopover = $("threadStatsPopover");
  if (statsPopover) statsPopover.hidden = true;
  $("threadStatsButton")?.setAttribute("aria-expanded", "false");
  const queuePopover = $("queuePopover");
  if (queuePopover) queuePopover.hidden = true;
  $("queueButton")?.setAttribute("aria-expanded", "false");
}

function modelIdentity(model) {
  return model?.provider || model?.providerId || "";
}

function modelReference(model) {
  return `${modelIdentity(model)}/${model?.id || ""}`;
}

function wildcardMatch(value, pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  try {
    return new RegExp(`^${escaped}$`, "i").test(value);
  } catch {
    return false;
  }
}

function modelMatchesScope(model, patterns) {
  if (!patterns.length) return true;
  const provider = modelIdentity(model);
  const id = model?.id || "";
  const references = [`${provider}/${id}`, id].filter(Boolean);
  return patterns.some((raw) => {
    const pattern = String(raw || "").trim().replace(/:[A-Za-z0-9_-]+$/, "");
    return pattern && references.some((reference) => wildcardMatch(reference, pattern));
  });
}

function scopedAvailableModels() {
  return state.availableModels.filter((model) => modelMatchesScope(model, state.modelScope));
}

function scopePatternForReference(reference) {
  const base = reference.toLowerCase();
  const existing = state.modelScope.find(
    (pattern) => String(pattern || "").trim().replace(/:[A-Za-z0-9_-]+$/, "").toLowerCase() === base,
  );
  return existing || reference;
}

function renderModelScopeEditor() {
  const models = state.availableModels;
  const rows = models.length
    ? models
        .map((model) => {
          const reference = modelReference(model);
          const selected = state.modelScopeDraft.includes(reference);
          return `<label class="model-scope-row${
            selected ? " selected" : ""
          }"><input type="checkbox" data-scope-model="${escapeHtml(reference)}"${selected ? " checked" : ""} /><span class="popover-item-main"><span class="popover-item-title">${escapeHtml(
            modelDisplayName(model),
          )}</span><span class="popover-item-meta">${escapeHtml(reference)}</span></span></label>`;
        })
        .join("")
    : '<div class="popover-item-meta" style="padding:9px">暂无可用模型</div>';
  return `<div class="popover-heading popover-heading-row"><span>模型作用域</span><button class="popover-cycle" data-model-scope-cancel type="button">返回</button></div><div class="popover-note">勾选后模型循环只在这些模型之间切换。不勾选表示不限制，保存后会重启 Agent 并保留当前会话。</div><div class="model-scope-list">${rows}</div><div class="popover-actions"><button class="popover-cycle" data-model-scope-all type="button">全部可用</button><button class="popover-cycle primary" data-model-scope-save type="button">保存并重启</button></div>`;
}

function renderModelPopover() {
  const popover = $("modelPopover");
  if (state.modelScopeEditing) {
    popover.innerHTML = renderModelScopeEditor();
    return;
  }
  const allModels = state.availableModels;
  const scopeEnabled = state.modelScope.length > 0;
  const scopeView = scopeEnabled && state.modelScopeView !== "all";
  const models = scopeView ? scopedAvailableModels() : allModels;
  const query = state.modelFilter.trim().toLowerCase();
  const filteredModels = query
    ? models.filter((model) =>
        [model.name, model.id, model.provider, model.providerId]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query)),
      )
    : models;
  const levels = state.thinkingLevels.length ? state.thinkingLevels : ["off"];
  const current = state.session?.model;
  const thinking = state.session?.thinkingLevel || levels[0] || "off";
  const modelSection =
    filteredModels.length === 0
      ? `<div class="popover-item-meta" style="padding:9px">${
          query ? "没有匹配的模型" : scopeView ? "作用域内没有可用模型" : "暂无可用模型"
        }</div>`
      : filteredModels
          .map((model) => {
            const provider = modelIdentity(model);
            const id = model.id || "";
            const name = modelDisplayName(model);
            const selected = current?.provider === provider && current?.id === id;
            const defaultLevel = state.modelThinkingDefaults[`${provider}/${id}`];
            const defaultText = defaultLevel ? ` · 默认${THINKING_LABELS[defaultLevel] || defaultLevel}` : "";
            return `<button class="popover-item${selected ? " selected" : ""}" type="button" data-provider="${escapeHtml(
              provider,
            )}" data-model="${escapeHtml(id)}"><span class="popover-item-main"><span class="popover-item-title">${escapeHtml(
              name,
            )}</span><span class="popover-item-meta">${escapeHtml(provider)}${id && id !== name ? ` · ${escapeHtml(id)}` : ""}${escapeHtml(
              defaultText,
            )}</span></span>${selected ? '<span class="popover-check">✓</span>' : ""}</button>`;
          })
          .join("");
  const thinkingSection =
    levels.length > 1
      ? `<div class="popover-heading popover-heading-row"><span>思考强度</span><button class="popover-cycle" data-cycle-thinking type="button">下一个</button></div>${levels
          .map(
            (level) =>
              `<button class="popover-item${thinking === level ? " selected" : ""}" type="button" data-thinking="${escapeHtml(
                level,
              )}"><span class="popover-item-main"><span class="popover-item-title">${escapeHtml(
                THINKING_LABELS[level] || level,
              )}</span></span>${
                thinking === level ? '<span class="popover-check">✓</span>' : ""
              }</button>`,
          )
          .join("")}`
      : "";
  const thinkingNote =
    levels.length > 1 && !levels.includes("xhigh") && !levels.includes("max")
      ? '<div class="popover-note">当前模型没有声明“极高 / 最高”档位；请在模型配置中确认推理模型的 xhigh / max 映射。</div>'
      : "";
  const currentReference = current?.id ? modelReference(current) : "";
  const defaultLevel = currentReference ? state.modelThinkingDefaults[currentReference] || "" : "";
  const defaultSection =
    currentReference && levels.length > 1
      ? `<div class="popover-heading popover-heading-row"><span>该模型启动默认</span><span class="popover-item-meta">${escapeHtml(
          defaultLevel ? THINKING_LABELS[defaultLevel] || defaultLevel : "跟随全局",
        )}</span></div><div class="model-thinking-row"><select data-model-thinking-default aria-label="该模型启动默认思考档位"><option value=""${
          defaultLevel ? "" : " selected"
        }>跟随全局</option>${levels
          .map(
            (level) =>
              `<option value="${escapeHtml(level)}"${
                defaultLevel === level ? " selected" : ""
              }>${escapeHtml(THINKING_LABELS[level] || level)}</option>`,
          )
          .join("")}${
          defaultLevel && !levels.includes(defaultLevel)
            ? `<option value="${escapeHtml(defaultLevel)}" selected>${escapeHtml(
                THINKING_LABELS[defaultLevel] || defaultLevel,
              )}</option>`
            : ""
        }</select><button class="popover-cycle primary" data-save-model-thinking-default type="button">保存</button></div><div class="popover-note">写入 settings.json 的 modelThinkingLevels，保存后重启 Agent，并把当前会话同步到该档位。</div>`
      : "";
  const currentInScope =
    current &&
    state.availableModels.some(
      (model) =>
        modelIdentity(model) === current.provider &&
        model.id === current.id &&
        modelMatchesScope(model, state.modelScope),
    );
  const scopeNote = scopeEnabled
    ? `<div class="popover-note">作用域生效：${scopedAvailableModels().length} 个模型参与循环。${
        scopeView ? "当前只显示作用域模型。" : "当前显示全部模型。"
      }${current && !currentInScope ? " 当前模型不在作用域内。" : ""}</div>`
    : "";
  const headingActions = [
    allModels.length > 1 ? '<button class="popover-cycle" data-cycle-model type="button">下一个</button>' : "",
    scopeEnabled
      ? `<button class="popover-cycle" data-toggle-model-scope type="button">${scopeView ? "全部" : "作用域"}</button>`
      : "",
    `<button class="popover-cycle" data-edit-model-scope type="button">作用域设置</button>`,
  ]
    .filter(Boolean)
    .join("");
  popover.innerHTML = `<div class="popover-heading popover-heading-row"><span>模型</span><span class="popover-actions">${headingActions}</span></div><div class="search-box popover-search"><input id="modelSearchInput" value="${escapeHtml(
    state.modelFilter,
  )}" placeholder="搜索模型" autocomplete="off" spellcheck="false" /></div>${modelSection}${scopeNote}${thinkingSection}${defaultSection}${thinkingNote}`;
}

function renderPermissionPopover() {
  const popover = $("permissionPopover");
  popover.innerHTML = `<div class="popover-heading">当前会话工具权限</div>${PERMISSION_OPTIONS.map(
    (option) =>
      `<button class="popover-item${state.permissionMode === option.id ? " selected" : ""}" type="button" data-permission="${
        option.id
      }"><span class="popover-item-main"><span class="popover-item-title">${escapeHtml(option.label)}</span><span class="popover-item-meta">${escapeHtml(
        option.description,
      )}</span></span>${state.permissionMode === option.id ? '<span class="popover-check">✓</span>' : ""}</button>`,
  ).join("")}</div>`;
}

async function changeComposerModel(provider, modelId) {
  if (!provider || !modelId) return;
  try {
    const response = await window.pispider.setSessionModel(provider, modelId);
    if (!response?.success) throw new Error(response?.error || "切换模型失败");
    hideComposerPopovers();
    showToast(`已切换到 ${modelId}`);
    await refreshFromAgent();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function changeThinking(level) {
  try {
    const response = await window.pispider.setThinkingLevel(level);
    if (!response?.success) throw new Error(response?.error || "切换思考强度失败");
    hideComposerPopovers();
    showToast(`思考强度已切换为${THINKING_LABELS[level] || level}`);
    await refreshFromAgent();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function cycleComposerModel() {
  try {
    const response = await window.pispider.cycleSessionModel();
    if (!response?.success) throw new Error(response?.error || "切换模型失败");
    const next = response.data?.model;
    if (!next?.id) {
      showToast(state.modelScope.length ? "当前作用域内没有可循环的下一个模型" : "只有一个可用模型", "warning");
      return;
    }
    hideComposerPopovers();
    showToast(`已切换到 ${next.name || next.id}${response.data.isScoped ? "（作用域内）" : ""}`);
    await refreshFromAgent();
    await refreshAgentOptions();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function openModelScopeEditor() {
  state.modelScopeEditing = true;
  state.modelScopeDraft = state.modelScope.length ? scopedAvailableModels().map(modelReference) : [];
  state.modelFilter = "";
  renderModelPopover();
}

async function saveModelScope() {
  if (state.streaming) {
    showToast("请先停止当前任务再修改模型作用域", "warning");
    return;
  }
  if (state.queueCount > 0) {
    showToast("请先清空排队消息再修改模型作用域", "warning");
    return;
  }
  const button = document.querySelector("[data-model-scope-save]");
  if (button) {
    button.disabled = true;
    button.textContent = "保存中...";
  }
  try {
    const response = await window.pispider.setModelScope(state.modelScopeDraft.map(scopePatternForReference));
    if (!response?.ok) throw new Error(response?.error || "保存模型作用域失败");
    state.modelScope = Array.isArray(response.enabledModels) ? response.enabledModels : [];
    state.modelScopeEditing = false;
    state.modelScopeView = state.modelScope.length ? "scoped" : "all";
    hideComposerPopovers();
    showToast(`模型作用域已保存，Agent 已重启${state.modelScope.length ? `（${state.modelScope.length} 项）` : "（不限制）"}`);
    await refreshAgentOptions();
  } catch (error) {
    showToast(error.message, "error");
    if (button) {
      button.disabled = false;
      button.textContent = "保存并重启";
    }
  }
}

async function cycleThinkingLevel() {
  if (state.thinkingLevels.length < 2) return;
  const current = state.session?.thinkingLevel || state.thinkingLevels[0];
  const index = Math.max(0, state.thinkingLevels.indexOf(current));
  const next = state.thinkingLevels[(index + 1) % state.thinkingLevels.length];
  await changeThinking(next);
}

async function saveModelThinkingDefault() {
  const model = state.session?.model;
  if (!model?.id) {
    showToast("当前没有可配置的模型", "warning");
    return;
  }
  if (state.streaming) {
    showToast("请先停止当前任务再修改默认思考档位", "warning");
    return;
  }
  if (state.queueCount > 0) {
    showToast("请先清空排队消息再修改默认思考档位", "warning");
    return;
  }
  const select = document.querySelector("[data-model-thinking-default]");
  const level = select?.value || "";
  const reference = modelReference(model);
  const button = document.querySelector("[data-save-model-thinking-default]");
  if (button) {
    button.disabled = true;
    button.textContent = "保存中...";
  }
  try {
    const response = await window.pispider.setModelThinkingDefault(reference, level || null);
    if (!response?.ok) throw new Error(response?.error || "保存默认思考档位失败");
    state.modelThinkingDefaults = response.levels || {};
    hideComposerPopovers();
    const restartNote = response.restarted === false ? "配置已保存，runtime 未重启" : "Agent 已重启";
    if (level) {
      showToast(
        `已保存 ${modelDisplayName(model)} 的默认思考档位为${THINKING_LABELS[level] || level}，${restartNote}`,
      );
      const applied = await window.pispider.setThinkingLevel(level);
      if (!applied?.success) showToast("默认档位已保存，但当前会话应用失败", "warning");
      await refreshFromAgent();
    } else {
      showToast(`已清除该模型的默认思考档位，${restartNote}`);
    }
    await refreshAgentOptions();
  } catch (error) {
    showToast(error.message, "error");
    if (button) {
      button.disabled = false;
      button.textContent = "保存";
    }
  }
}

async function changePermission(mode) {
  if (!PERMISSION_OPTIONS.some((option) => option.id === mode) || mode === state.permissionMode) {
    hideComposerPopovers();
    return;
  }
  if (state.streaming) {
    hideComposerPopovers();
    showToast("请先停止当前任务再切换权限", "warning");
    return;
  }
  try {
    const response = await window.pispider.setPermission(mode);
    if (!response?.mode) throw new Error("切换权限失败");
    state.permissionMode = response.mode;
    hideComposerPopovers();
    const scopeLabel = response.scope === "project" ? "项目默认权限" : "当前会话权限";
    showToast(`${scopeLabel}已切换为${permissionLabel()}，Agent 已重启`);
    await refreshAgentOptions();
    await refreshFromAgent();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function refreshAgentOptions() {
  try {
    state.commands = [];
    state.commandsLoaded = false;
    commandsPromise = null;
    hideCommandSuggestions();
    const [modelsResponse, levelsResponse, permission, scopeResponse] = await Promise.all([
      window.pispider.getAvailableModels(),
      window.pispider.getThinkingLevels(),
      window.pispider.getPermission(),
      window.pispider.getModelScope(),
    ]);
    const models = modelsResponse?.data?.models;
    const levels = levelsResponse?.data?.levels;
    state.availableModels = Array.isArray(models) ? models : [];
    state.modelScope = Array.isArray(scopeResponse?.enabledModels) ? scopeResponse.enabledModels : [];
    state.modelThinkingDefaults =
      scopeResponse?.modelThinkingLevels && typeof scopeResponse.modelThinkingLevels === "object"
        ? scopeResponse.modelThinkingLevels
        : {};
    if (!state.modelScope.length) state.modelScopeView = "all";
    else if (!state.modelScopeEditing) state.modelScopeView = "scoped";
    state.thinkingLevels = visibleThinkingLevels(levels);
    state.permissionMode = permission?.mode || "full";
    scheduleRender();
  } catch {
    // Keep the last known options; the runtime may still be starting.
  }
}

function setStatus(stateName, detail) {
  const pill = $("runtimePill");
  state.runtimeState = stateName;
  pill.classList.toggle("ready", stateName === "ready" || stateName === "running");
  pill.classList.toggle("error", stateName === "error" || stateName === "stopped");
  const label =
    stateName === "ready" || stateName === "running"
      ? "就绪"
      : stateName === "starting"
        ? "连接中"
        : stateName === "stopped"
          ? "已停止"
          : "错误";
  pill.innerHTML = `<i></i> ${label}`;
  if (detail && stateName === "error") showToast(detail, "error");
}

function showToast(message, kind = "") {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.toggle("error", kind === "error");
  toast.classList.toggle("warning", kind === "warning");
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3600);
}

function showStatusBanner(message, options = {}) {
  const banner = $("statusBanner");
  if (!banner) return;
  const { tone = "info", actionLabel = "", action = null } = options;
  banner.className = `status-banner ${tone}`;
  banner.hidden = false;
  statusBannerTone = tone;
  $("statusBannerText").textContent = message;
  const actionButton = $("statusBannerAction");
  statusBannerAction = action;
  actionButton.hidden = !actionLabel;
  actionButton.textContent = actionLabel;
}

function hideStatusBanner(tone = "") {
  if (tone && statusBannerTone !== tone) return;
  $("statusBanner").hidden = true;
  statusBannerAction = null;
  statusBannerTone = "";
}

function handleMcpCommandState(payload) {
  const actionLabels = { login: "登录", logout: "登出", reconnect: "重连" };
  const actionLabel = actionLabels[payload?.action];
  if (!payload?.name || !actionLabel) return;
  const openMcp = () => openSecondary("mcp");
  if (payload.state === "pending") {
    showStatusBanner(`MCP ${payload.name}：正在${actionLabel}…`, {
      tone: "warning",
      actionLabel: "打开 MCP",
      action: openMcp,
    });
    return;
  }
  if (payload.state === "error") {
    showStatusBanner(`MCP ${payload.name} ${actionLabel}失败：${payload.error || "未知错误"}`, {
      tone: "error",
      actionLabel: "打开 MCP",
      action: openMcp,
    });
    return;
  }
  showStatusBanner(`MCP ${payload.name}：已发送${actionLabel}请求，请在 MCP 窗口确认状态。`, {
    tone: "info",
    actionLabel: "打开 MCP",
    action: openMcp,
  });
}

function openShortcuts() {
  const dialog = $("shortcutsDialog");
  if (!dialog || !dialog.hidden) return;
  shortcutsReturnFocus = document.activeElement;
  dialog.hidden = false;
  scheduleDomUpdate(() => $("shortcutsClose")?.focus());
}

function closeShortcuts() {
  const dialog = $("shortcutsDialog");
  if (!dialog || dialog.hidden) return;
  dialog.hidden = true;
  const target = shortcutsReturnFocus;
  shortcutsReturnFocus = null;
  if (target?.isConnected && typeof target.focus === "function") target.focus();
}

function toggleShortcuts() {
  const dialog = $("shortcutsDialog");
  if (!dialog) return;
  if (dialog.hidden) openShortcuts();
  else closeShortcuts();
}

async function showChangelogDialog() {
  if (typeof window.pispider.getChangelog !== "function") {
    showToast("当前版本不支持查看变更日志", "warning");
    return;
  }
  try {
    const response = await window.pispider.getChangelog();
    if (!response?.success) throw new Error(response?.error || "无法读取变更日志");
    const version = response.data?.version ? ` · ${response.data.version}` : "";
    $("changelogTitle").textContent = `变更日志${version}`;
    $("changelogBody").innerHTML = renderMarkdown(response.data?.content || "（暂无变更日志内容）");
    changelogReturnFocus = document.activeElement;
    $("changelogDialog").hidden = false;
    scheduleDomUpdate(() => $("changelogClose")?.focus());
  } catch (error) {
    showToast(error.message, "error");
  }
}

function closeChangelog() {
  const dialog = $("changelogDialog");
  if (!dialog || dialog.hidden) return;
  dialog.hidden = true;
  const target = changelogReturnFocus;
  changelogReturnFocus = null;
  if (target?.isConnected && typeof target.focus === "function") target.focus();
}

function paletteActions() {
  const actions = [
    { group: "会话", label: "新建任务", detail: "创建新的 Pi 会话", hint: "Ctrl+N", run: () => newTask() },
    { group: "会话", label: "恢复会话", detail: "打开会话导航，搜索并切换历史会话", hint: "Ctrl+Shift+K", run: () => openSessionPicker() },
    { group: "会话", label: "搜索任务", detail: "聚焦左栏会话搜索", hint: "Ctrl+K", run: () => $("searchInput").focus() },
    { group: "会话", label: "跳到最早消息", detail: "打开从第 1 条开始的历史窗口", hint: "Ctrl+Home", run: () => jumpToEarliestWindow() },
    { group: "会话", label: "回到最新消息", detail: "重置到最新窗口并滚到底部", hint: "Ctrl+End", run: () => scrollToLatest() },
    { group: "会话", label: "会话信息", detail: "打开当前会话详情窗口", run: () => openSecondary("session") },
    { group: "工作区", label: "显示 / 隐藏工作区", detail: "切换右栏上下文面板", hint: "Ctrl+B", run: () => setPanel(!state.panelOpen) },
    { group: "工作区", label: "查看项目变更", detail: "切到右栏代码页", run: () => { setPanel(true); setRightTab("changes"); } },
    { group: "工作区", label: "打开浏览器页", detail: "切到右栏浏览器", run: () => { setPanel(true); setRightTab("browser"); } },
    { group: "资源", label: "规则", detail: "打开规则管理窗口", run: () => openSecondary("rules") },
    { group: "资源", label: "技能", detail: "打开技能管理窗口", run: () => openSecondary("skills") },
    { group: "资源", label: "MCP", detail: "打开 MCP 服务窗口", run: () => openSecondary("mcp") },
    { group: "资源", label: "扩展与包", detail: "打开扩展和 Pi package 管理窗口", run: () => openSecondary("extensions") },
    { group: "资源", label: "运行状态", detail: "打开状态窗口", run: () => openSecondary("status") },
    { group: "设置", label: "设置", detail: "打开设置窗口", hint: "Ctrl+,", run: () => openSecondary("settings") },
    { group: "设置", label: "切换主题", detail: "在浅色 / 深色之间切换", run: () => applyTheme(state.theme === "dark" ? "light" : "dark") },
    { group: "设置", label: "外部编辑器写提示", detail: "把当前输入交给外部编辑器", hint: "Ctrl+G", run: () => editPromptExternally() },
    { group: "视图", label: "放大 10%", detail: `当前 ${Math.round(state.zoomFactor * 100)}%`, hint: "Ctrl++", run: () => stepZoom(0.1) },
    { group: "视图", label: "缩小 10%", detail: `当前 ${Math.round(state.zoomFactor * 100)}%`, hint: "Ctrl+-", run: () => stepZoom(-0.1) },
    { group: "视图", label: "恢复 100% 缩放", detail: "回到标准缩放", hint: "Ctrl+0", run: () => applyZoom(1) },
    { group: "帮助", label: "快捷键总览", detail: "查看全部键盘操作", hint: "Ctrl+/", run: () => openShortcuts() },
    { group: "帮助", label: "清空排队", detail: state.queueCount ? `${state.queueCount} 条排队消息` : "当前没有排队", run: () => clearQueuedMessages() },
  ];
  if (state.streaming) {
    actions.push({ group: "会话", label: "停止当前任务", detail: "中断正在运行的 Agent", run: () => stopCurrent() });
  }
  return actions;
}

function loadCommandHistory() {
  try {
    const stored = JSON.parse(localStorage.getItem(COMMAND_HISTORY_KEY) || "[]");
    if (Array.isArray(stored)) commandHistory = stored.filter((id) => typeof id === "string").slice(0, 8);
  } catch {
    commandHistory = [];
  }
}

function rememberCommandHistory(id) {
  if (!id) return;
  commandHistory = [id, ...commandHistory.filter((item) => item !== id)].slice(0, 8);
  try {
    localStorage.setItem(COMMAND_HISTORY_KEY, JSON.stringify(commandHistory));
  } catch {}
}

function withCommandHistory(items) {
  if (!commandHistory.length) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  const recent = commandHistory
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((item) => ({ ...item, group: "最近使用" }));
  if (!recent.length) return items;
  const recentIds = new Set(recent.map((item) => item.id));
  return [...recent, ...items.filter((item) => !recentIds.has(item.id))];
}

function buildCommandPaletteItems() {
  const actions = paletteActions().map((action) => ({
    id: `action:${action.group}:${action.label}`,
    kind: "action",
    group: action.group,
    label: action.label,
    detail: action.detail,
    hint: action.hint || "",
    search: `${action.label} ${action.detail} ${action.group}`.toLowerCase(),
    run: action.run,
  }));
  const commands = state.commands.map((command) => {
    const name = String(command.name || "").replace(/^\//, "");
    if (!name) return null;
    return {
      id: `command:${name}`,
      kind: "command",
      group: command.source === "skill" ? "技能命令" : "Pi 命令",
      label: `/${name}`,
      detail: shortText(command.description || "插入到输入框", 80),
      hint: "",
      search: `${name} ${command.description || ""}`.toLowerCase(),
      run: () => {
        const input = $("promptInput");
        input.value = `/${name} `;
        const cursor = input.value.length;
        input.setSelectionRange(cursor, cursor);
        autoResize();
        input.focus();
      },
    };
  });
  return withCommandHistory([...actions, ...commands.filter(Boolean)]);
}

function renderCommandPalette() {
  const list = $("commandPaletteList");
  if (!list) return;
  if (!commandPaletteResults.length) {
    list.innerHTML = '<div class="command-palette-empty">没有匹配的命令</div>';
    return;
  }
  let activeGroup = "";
  const rows = [];
  commandPaletteResults.forEach((item, index) => {
    if (item.group !== activeGroup) {
      activeGroup = item.group;
      rows.push(`<div class="command-palette-group">${escapeHtml(item.group)}</div>`);
    }
    rows.push(`
      <button class="command-palette-item${index === commandPaletteActive ? " is-active" : ""}" type="button" role="option" aria-selected="${index === commandPaletteActive}" data-palette-index="${index}">
        <span class="command-palette-item-main">
          <span class="command-palette-item-label">${escapeHtml(item.label)}</span>
          <span class="command-palette-item-detail">${escapeHtml(item.detail)}</span>
        </span>
        ${item.hint ? `<span class="command-palette-item-hint">${escapeHtml(item.hint)}</span>` : ""}
      </button>`);
  });
  list.innerHTML = rows.join("");
  list.querySelectorAll(".command-palette-item").forEach((button, index) => {
    button.addEventListener("mouseenter", () => {
      commandPaletteActive = index;
      list.querySelectorAll(".command-palette-item").forEach((item, itemIndex) => {
        item.classList.toggle("is-active", itemIndex === index);
        item.setAttribute("aria-selected", String(itemIndex === index));
      });
    });
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => runCommandPaletteItem(index));
  });
  const active = list.querySelector(".command-palette-item.is-active");
  active?.scrollIntoView({ block: "nearest" });
}

function filterCommandPalette() {
  const query = $("commandPaletteInput")?.value.trim().toLowerCase() || "";
  commandPaletteResults = query
    ? commandPaletteItems.filter((item) => item.search.includes(query))
    : commandPaletteItems;
  commandPaletteActive = 0;
  renderCommandPalette();
}

async function openCommandPalette() {
  const palette = $("commandPalette");
  if (!palette || !palette.hidden) return;
  commandPaletteReturnFocus = document.activeElement;
  palette.hidden = false;
  $("commandPaletteInput").value = "";
  commandPaletteItems = buildCommandPaletteItems();
  filterCommandPalette();
  scheduleDomUpdate(() => $("commandPaletteInput")?.focus());
  await loadCommands().catch(() => {});
  if (palette.hidden) return;
  commandPaletteItems = buildCommandPaletteItems();
  filterCommandPalette();
}

function closeCommandPalette() {
  const palette = $("commandPalette");
  if (!palette || palette.hidden) return;
  palette.hidden = true;
  const target = commandPaletteReturnFocus;
  commandPaletteReturnFocus = null;
  if (target?.isConnected && typeof target.focus === "function") target.focus();
  else $("promptInput")?.focus();
}

function runCommandPaletteItem(index) {
  const item = commandPaletteResults[index];
  if (!item) return;
  rememberCommandHistory(item.id);
  closeCommandPalette();
  try {
    item.run();
  } catch (error) {
    showToast(error.message || "命令执行失败", "error");
  }
}

function moveCommandPaletteActive(offset) {
  if (!commandPaletteResults.length) return;
  commandPaletteActive =
    (commandPaletteActive + offset + commandPaletteResults.length) % commandPaletteResults.length;
  renderCommandPalette();
}

function toggleCommandPalette() {
  if ($("commandPalette").hidden) openCommandPalette();
  else closeCommandPalette();
}

function sessionPickerMatches(session, query) {
  if (!query) return true;
  const haystack = [session.name, session.path, session.cwd, session.preview]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

function buildSessionPickerItems(query = "") {
  return [...state.sessions]
    .sort(
      (left, right) =>
        Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) ||
        (Number(right.updatedAt) || 0) - (Number(left.updatedAt) || 0),
    )
    .filter((session) => sessionPickerMatches(session, query.trim()));
}

function renderSessionPicker() {
  const list = $("sessionPickerList");
  if (!list) return;
  if (!sessionPickerItems.length) {
    list.innerHTML = '<div class="command-palette-empty">没有匹配的会话</div>';
    return;
  }
  const activeSession = state.session?.sessionFile || "";
  let activeGroup = "";
  const rows = [];
  sessionPickerItems.forEach((session, index) => {
    const group = session.pinned ? "置顶会话" : "最近会话";
    if (group !== activeGroup) {
      activeGroup = group;
      rows.push(`<div class="command-palette-group">${group}</div>`);
    }
    const current = session.path === activeSession;
    rows.push(`
      <button class="command-palette-item${index === sessionPickerActive ? " is-active" : ""}" type="button" role="option" aria-selected="${index === sessionPickerActive}" data-session-picker-index="${index}">
        <span class="command-palette-item-main">
          <span class="command-palette-item-label">${escapeHtml(session.name || session.path)}</span>
          <span class="command-palette-item-detail">${escapeHtml(
            [timeLabel(session.updatedAt), shortText(session.preview || session.cwd || "", 110)]
              .filter(Boolean)
              .join(" · "),
          )}</span>
        </span>
        <span class="command-palette-item-hint">${current ? "当前" : ""}</span>
      </button>`);
  });
  list.innerHTML = rows.join("");
  list.querySelectorAll(".command-palette-item").forEach((button) => {
    const index = Number(button.dataset.sessionPickerIndex);
    button.addEventListener("mouseenter", () => {
      sessionPickerActive = index;
      list.querySelectorAll(".command-palette-item").forEach((item) => {
        const itemIndex = Number(item.dataset.sessionPickerIndex);
        item.classList.toggle("is-active", itemIndex === index);
        item.setAttribute("aria-selected", String(itemIndex === index));
      });
    });
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => chooseSessionFromPicker(index));
  });
  const active = list.querySelector(".command-palette-item.is-active");
  active?.scrollIntoView({ block: "nearest" });
}

function filterSessionPicker() {
  sessionPickerItems = buildSessionPickerItems($("sessionPickerInput")?.value || "");
  sessionPickerActive = 0;
  renderSessionPicker();
}

async function openSessionPicker() {
  const dialog = $("sessionPicker");
  if (!dialog || !dialog.hidden) return;
  sessionPickerReturnFocus = document.activeElement;
  $("sessionPickerInput").value = "";
  sessionPickerItems = buildSessionPickerItems("");
  const currentIndex = sessionPickerItems.findIndex(
    (session) => session.path === (state.session?.sessionFile || ""),
  );
  sessionPickerActive = Math.max(0, currentIndex);
  renderSessionPicker();
  dialog.hidden = false;
  scheduleDomUpdate(() => $("sessionPickerInput")?.focus());
  const request = ++sessionPickerRequest;
  await refreshSessions();
  if (request !== sessionPickerRequest || dialog.hidden) return;
  filterSessionPicker();
}

function closeSessionPicker() {
  const dialog = $("sessionPicker");
  if (!dialog || dialog.hidden) return;
  dialog.hidden = true;
  sessionPickerRequest += 1;
  const target = sessionPickerReturnFocus;
  sessionPickerReturnFocus = null;
  if (target?.isConnected && typeof target.focus === "function") target.focus();
  else $("promptInput")?.focus();
}

function moveSessionPickerActive(offset) {
  if (!sessionPickerItems.length) return;
  sessionPickerActive =
    (sessionPickerActive + offset + sessionPickerItems.length) % sessionPickerItems.length;
  renderSessionPicker();
}

async function chooseSessionFromPicker(index) {
  const session = sessionPickerItems[index];
  if (!session) return;
  closeSessionPicker();
  if (session.path === state.session?.sessionFile) {
    $("promptInput")?.focus();
    return;
  }
  await switchSession(session.path);
  showToast(`已切换到 ${shortText(session.name || session.path, 60)}`);
}

async function applyZoom(factor) {
  try {
    const followLatest = isThreadNearBottom();
    setMessageLayoutAnchor(followLatest ? null : captureMessageAnchor(), followLatest);
    const response = await window.pispider.setZoom(factor);
    const next = Number(response?.factor);
    if (Number.isFinite(next)) state.zoomFactor = next;
    scheduleRender();
    showToast(`缩放 ${Math.round(state.zoomFactor * 100)}%`);
  } catch (error) {
    clearMessageLayoutAnchor();
    showToast(error.message, "error");
  }
}

async function stepZoom(delta) {
  const current = Number(state.zoomFactor) || 1;
  const next = Math.min(1.4, Math.max(0.7, Math.round((current + delta) * 10) / 10));
  await applyZoom(next);
}

function clearExtensionDialogTimer() {
  if (state.extensionDialogTimer) {
    clearTimeout(state.extensionDialogTimer);
    state.extensionDialogTimer = 0;
  }
}

function closeExtensionDialog(payload, sendResponse) {
  const request = state.activeExtensionDialog;
  if (!request) return;
  state.activeExtensionDialog = null;
  clearExtensionDialogTimer();
  $("extensionDialog").hidden = true;
  $("extensionDialogBody").replaceChildren();
  $("extensionDialogActions").replaceChildren();
  focusBeforeExtensionDialog?.focus?.();
  focusBeforeExtensionDialog = null;
  if (sendResponse && payload) {
    window.pispider.extensionUiResponse(request.id, payload).catch((error) => {
      showToast(error.message, "error");
    });
  }
  setTimeout(showNextExtensionDialog, 0);
}

function addExtensionButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `extension-button ${className}`.trim();
  button.textContent = label;
  button.addEventListener("click", onClick);
  $("extensionDialogActions").append(button);
  return button;
}

function showNextExtensionDialog() {
  if (state.activeExtensionDialog || state.extensionDialogs.length === 0) return;
  const request = state.extensionDialogs.shift();
  state.activeExtensionDialog = request;
  focusBeforeExtensionDialog =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const method = request.method;
  const title =
    request.title ||
    (method === "confirm"
      ? "操作确认"
      : method === "select"
        ? "选择一个选项"
        : method === "editor"
          ? "编辑内容"
          : "输入内容");
  $("extensionDialogTitle").textContent = title;
  $("extensionDialogKicker").textContent =
    method === "select" || method === "input" || method === "editor" ? "需要你的输入" : "需要确认";

  const body = $("extensionDialogBody");
  const actions = $("extensionDialogActions");
  body.replaceChildren();
  actions.replaceChildren();

  if (request.message) {
    const message = document.createElement("p");
    message.className = "extension-message";
    message.textContent = request.message;
    body.append(message);
  }

  let submit = null;
  let focusTarget = null;

  if (method === "select") {
    const options = Array.isArray(request.options) ? request.options : [];
    const list = document.createElement("div");
    list.className = "extension-options";
    for (const option of options) {
      const label = typeof option === "string" ? option : option?.label ?? option?.value ?? "";
      const value = typeof option === "string" ? option : option?.value ?? label;
      if (!label) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "extension-option";
      button.textContent = label;
      button.addEventListener("click", () => closeExtensionDialog({ value }, true));
      list.append(button);
    }
    body.append(list);
    if (!focusTarget) focusTarget = list.querySelector("button");
    addExtensionButton("取消", "", () => closeExtensionDialog({ cancelled: true }, true));
  } else if (method === "confirm") {
    addExtensionButton("取消", "", () => closeExtensionDialog({ confirmed: false }, true));
    const confirmButton = addExtensionButton("确认", "primary", () =>
      closeExtensionDialog({ confirmed: true }, true),
    );
    focusTarget = confirmButton;
  } else if (method === "input" || method === "editor") {
    const field = method === "editor" ? document.createElement("textarea") : document.createElement("input");
    field.className = `extension-field${method === "editor" ? " multiline" : ""}`;
    field.value = request.prefill || "";
    field.placeholder = request.placeholder || "";
    if (method === "input") {
      field.type = "text";
      field.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submit?.();
        }
      });
    }
    body.append(field);
    focusTarget = field;
    submit = () => closeExtensionDialog({ value: field.value }, true);
    addExtensionButton("取消", "", () => closeExtensionDialog({ cancelled: true }, true));
    addExtensionButton("确定", "primary", submit);
  }

  $("extensionDialog").hidden = false;
  requestAnimationFrame(() => {
    focusTarget?.focus();
    if (focusTarget instanceof HTMLTextAreaElement && focusTarget.value) {
      focusTarget.setSelectionRange(focusTarget.value.length, focusTarget.value.length);
    }
  });

  if (Number.isFinite(request.timeout) && request.timeout > 0) {
    state.extensionDialogTimer = setTimeout(() => {
      // Pi auto-resolves timed-out dialogs; closing locally avoids a stale modal.
      closeExtensionDialog(null, false);
    }, request.timeout);
  }
}

function handleExtensionUiRequest(request) {
  if (!request || typeof request !== "object") return;
  switch (request.method) {
    case "confirm":
    case "input":
    case "editor":
    case "select":
      if (typeof request.id !== "string" || !request.id) return;
      state.extensionDialogs.push(request);
      showNextExtensionDialog();
      return;
    case "notify":
      showToast(
        request.message || "扩展通知",
        request.notifyType === "error" ? "error" : request.notifyType === "warning" ? "warning" : "",
      );
      return;
    case "setStatus":
      if (request.statusKey === "pispider") return;
      state.extensionStatus = request.statusText || "";
      scheduleRender();
      return;
    case "setWidget":
      state.extensionWidget = Array.isArray(request.widgetLines)
        ? request.widgetLines.filter(Boolean).join(" · ").slice(0, 220)
        : "";
      scheduleRender();
      return;
    case "set_editor_text":
      if (typeof request.text === "string") {
        const input = $("promptInput");
        input.value = request.text;
        autoResize();
        input.focus();
      }
      return;
    case "setTitle":
      if (request.title) document.title = request.title;
      return;
    default:
      return;
  }
}

function appendToPrompt(text) {
  if (!text) return;
  const input = $("promptInput");
  input.value = input.value.trim() ? `${input.value.trimEnd()}\n\n${text}` : text;
  autoResize();
  input.focus();
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const dataUrl = String(reader.result || "");
      const comma = dataUrl.indexOf(",");
      if (comma < 0) {
        reject(new Error("无法读取图片"));
        return;
      }
      resolve({
        id: `image-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: file.name || "粘贴的图片",
        mimeType: file.type || "image/png",
        data: dataUrl.slice(comma + 1),
        preview: dataUrl,
      });
    });
    reader.addEventListener("error", () => reject(new Error("无法读取图片")));
    reader.readAsDataURL(file);
  });
}

function addImageAttachments(images) {
  const incoming = Array.from(images || []).filter((image) => image?.data && image?.mimeType);
  if (!incoming.length) return;
  const room = Math.max(0, 4 - state.attachments.length);
  if (room === 0) {
    showToast("最多附加 4 张图片", "error");
    return;
  }
  state.attachments.push(
    ...incoming.slice(0, room).map((image) => ({
      id: image.id || `image-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: image.name || "图片",
      mimeType: image.mimeType,
      data: image.data,
      preview: image.preview || `data:${image.mimeType};base64,${image.data}`,
    })),
  );
  renderAttachments();
  if (incoming.length > room) showToast("最多附加 4 张图片", "error");
}

async function addImageFiles(files) {
  const images = Array.from(files || []).filter((file) => file && file.type?.startsWith("image/"));
  if (!images.length) return;
  const room = Math.max(0, 4 - state.attachments.length);
  if (room === 0) {
    showToast("最多附加 4 张图片", "error");
    return;
  }
  try {
    const loaded = await Promise.all(images.slice(0, room).map(readImageFile));
    addImageAttachments(loaded);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderAttachments() {
  const list = $("attachmentList");
  if (!list) return;
  list.hidden = state.attachments.length === 0;
  list.innerHTML = state.attachments
    .map(
      (image) => `
        <div class="attachment-item">
          <img src="${image.preview}" alt="${escapeHtml(image.name)}" />
          <button class="attachment-remove" type="button" data-attachment-id="${escapeHtml(image.id)}" aria-label="移除图片">×</button>
        </div>
      `,
    )
    .join("");
  list.querySelectorAll("[data-attachment-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.attachments = state.attachments.filter((image) => image.id !== button.dataset.attachmentId);
      renderAttachments();
    });
  });
}

function currentAtToken() {
  const input = $("promptInput");
  const cursor = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, cursor);
  const match = before.match(/(?:^|[\s])@([^\s@]*)$/);
  if (!match) return null;
  return { query: match[1], start: before.length - match[1].length - 1, end: cursor };
}

function hideFileSuggestions() {
  clearTimeout(fileSuggestionTimer);
  fileSuggestionToken = null;
  fileSuggestionItems = [];
  const box = $("fileSuggestions");
  if (box) box.hidden = true;
}

function renderFileSuggestions() {
  const box = $("fileSuggestions");
  if (!box) return;
  if (!fileSuggestionToken) {
    box.hidden = true;
    return;
  }
  if (!fileSuggestionItems.length) {
    box.innerHTML = '<div class="file-suggestion-empty">没有匹配的文件</div>';
    box.hidden = false;
    return;
  }
  box.innerHTML = fileSuggestionItems
    .map(
      (file, index) =>
        `<button class="file-suggestion${index === 0 ? " is-active" : ""}" type="button" data-file="${escapeHtml(file)}">${escapeHtml(file)}</button>`,
    )
    .join("");
  box.hidden = false;
  box.querySelectorAll(".file-suggestion").forEach((button, index) => {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => applyFileSuggestion(fileSuggestionItems[index]));
    button.addEventListener("mouseenter", () => {
      box.querySelectorAll(".file-suggestion").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
    });
  });
}

async function updateFileSuggestions() {
  clearTimeout(fileSuggestionTimer);
  const token = currentAtToken();
  if (!token) {
    hideFileSuggestions();
    return;
  }
  const requestId = ++fileSuggestionRequest;
  fileSuggestionTimer = setTimeout(async () => {
    try {
      const result = await window.pispider.searchFiles(token.query, state.session?.cwd || "");
      if (requestId !== fileSuggestionRequest) return;
      fileSuggestionToken = token;
      fileSuggestionItems = Array.isArray(result?.files) ? result.files : [];
      renderFileSuggestions();
    } catch {
      if (requestId === fileSuggestionRequest) hideFileSuggestions();
    }
  }, 140);
}

function applyFileSuggestion(file) {
  if (!file || !fileSuggestionToken) return;
  const input = $("promptInput");
  const before = input.value.slice(0, fileSuggestionToken.start);
  const after = input.value.slice(fileSuggestionToken.end);
  const inserted = `@${file} `;
  input.value = `${before}${inserted}${after}`;
  const cursor = before.length + inserted.length;
  input.setSelectionRange(cursor, cursor);
  hideFileSuggestions();
  autoResize();
  input.focus();
}

function currentCommandToken() {
  const input = $("promptInput");
  const value = input.value;
  if (!value.startsWith("/") || value.includes("\n")) return null;
  const body = value.slice(1);
  if (!/^[^\s]*$/.test(body)) return null;
  return { query: body.trim().toLowerCase() };
}

function hideCommandSuggestions() {
  commandSuggestionToken = null;
  commandSuggestionItems = [];
  const box = $("commandSuggestions");
  if (box) box.hidden = true;
}

async function loadCommands() {
  if (state.commandsLoaded) return state.commands;
  if (commandsPromise) return commandsPromise;
  commandsPromise = (async () => {
    try {
      const response = await window.pispider.getCommands();
      const rpcCommands = Array.isArray(response?.data?.commands) ? response.data.commands : [];
      state.commands = Slash ? Slash.mergeCommands(Slash.BUILTIN_COMMANDS, rpcCommands) : rpcCommands;
      state.commandsLoaded = true;
    } catch {
      state.commands = Slash ? Slash.BUILTIN_COMMANDS.slice() : [];
      state.commandsLoaded = true;
    } finally {
      commandsPromise = null;
    }
    return state.commands;
  })();
  return commandsPromise;
}

function renderCommandSuggestions() {
  const box = $("commandSuggestions");
  if (!box) return;
  if (!commandSuggestionToken) {
    box.hidden = true;
    return;
  }
  if (!commandSuggestionItems.length) {
    box.innerHTML = '<div class="command-suggestion-empty">没有匹配的命令</div>';
    box.hidden = false;
    return;
  }
  box.innerHTML = commandSuggestionItems
    .map((command, index) => {
      const source = command.source || "builtin";
      const sourceLabel = (Slash.SOURCE_LABELS && Slash.SOURCE_LABELS[source]) || "内置";
      const hint = command.argumentHint ? ` ${command.argumentHint}` : "";
      const description = `${command.description || "无描述"}${hint}`;
      return `
        <button class="command-suggestion${index === 0 ? " is-active" : ""}" type="button" data-command="${escapeHtml(command.name)}">
          <span class="command-name">/${escapeHtml(command.name)}</span>
          <span class="command-source source-${escapeHtml(source)}">${escapeHtml(sourceLabel)}</span>
          <span class="command-desc">${escapeHtml(description)}</span>
        </button>`;
    })
    .join("");
  box.hidden = false;
  box.querySelectorAll(".command-suggestion").forEach((button, index) => {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => applyCommandSuggestion(commandSuggestionItems[index]));
    button.addEventListener("mouseenter", () => {
      box.querySelectorAll(".command-suggestion").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
    });
  });
}

async function updateCommandSuggestions() {
  const token = currentCommandToken();
  if (!token) {
    hideCommandSuggestions();
    return;
  }
  const requestId = ++commandSuggestionRequest;
  const commands = await loadCommands();
  if (requestId !== commandSuggestionRequest) return;
  const current = currentCommandToken();
  if (!current || current.query !== token.query) return;
  commandSuggestionToken = current;
  const query = current.query;
  commandSuggestionItems = Slash.filterCommands(commands, query);
  renderCommandSuggestions();
}

function applyCommandSuggestion(command) {
  if (!command?.name) return;
  const input = $("promptInput");
  const name = String(command.name).replace(/^\//, "");
  input.value = `/${name} `;
  const cursor = input.value.length;
  input.setSelectionRange(cursor, cursor);
  autoResize();
  hideCommandSuggestions();
  hideFileSuggestions();
  input.focus();
}

function slashCommandName(value) {
  return String(value || "").replace(/^\//, "").trim().toLowerCase();
}

function isBuiltinCommand(name) {
  return Boolean(Slash) && Slash.BUILTIN_COMMANDS.some((command) => command.name === name);
}

/**
 * Intercept a parsed slash command before it reaches the model.
 * Returns true when the command was handled locally (built-in executed or
 * rejected); false when it is an RPC command and should be sent as a prompt.
 */
async function handleSlashCommand(parsed, images) {
  await loadCommands();
  if (isBuiltinCommand(parsed.name)) {
    if (images.length) {
      showToast("命令不能附加图片", "error");
      return true;
    }
    await executeBuiltinCommand(parsed.name, parsed.args);
    return true;
  }
  const rpcCommand = state.commands.some((command) => slashCommandName(command.name) === parsed.name);
  if (rpcCommand) return false;
  showToast(`未知命令 /${parsed.name}，输入 / 查看可用命令`, "error");
  return true;
}

async function executeBuiltinCommand(name, args) {
  if (!Slash) {
    showToast(`未知命令 /${name}，输入 / 查看可用命令`, "error");
    return;
  }
  const resolved = Slash.resolveBuiltinAction(name, args);
  if (resolved.action === "error") {
    showToast(resolved.payload.message, "error");
    return;
  }
  if (resolved.action === "unknown") {
    showToast(`未知命令 /${name}，输入 / 查看可用命令`, "error");
    return;
  }
  const payload = resolved.payload || {};
  let clearInput = true;
  switch (resolved.action) {
    case "openPanel":
      openSecondary(payload.kind);
      if (payload.toast) showToast(payload.toast);
      break;
    case "openModelMenu":
      state.modelFilter = "";
      renderModelPopover();
      $("modelPopover").hidden = false;
      break;
    case "setModel":
      await changeComposerModel(payload.provider, payload.modelId);
      break;
    case "openThinkingMenu":
      state.modelFilter = "";
      renderModelPopover();
      $("modelPopover").hidden = false;
      showToast("在模型菜单中选择思考强度");
      break;
    case "setThinking":
      await changeThinking(payload.level);
      break;
    case "openModelScopeEditor":
      openModelScopeEditor();
      break;
    case "exportHtml":
      await runExportSessionHtml(payload.path || "");
      break;
    case "exportJsonl":
      await runExportSessionJsonl(payload.path);
      break;
    case "importSession":
      await runImportSession();
      break;
    case "importSessionPath":
      await runImportSessionPath(payload.path);
      break;
    case "shareSession":
      await runShareSession();
      break;
    case "openBugReport":
      openBugReport(payload.description);
      break;
    case "copyLastAssistant":
      await copyLastAssistant();
      break;
    case "setSessionName":
      await runSetSessionName(payload.name);
      break;
    case "showChangelog":
      await showChangelogDialog();
      break;
    case "openShortcuts":
      openShortcuts();
      break;
    case "cloneSession":
      await runCloneSession();
      break;
    case "newSession":
      await newTask();
      break;
    case "compact":
      await runCompact(payload.instructions);
      break;
    case "openSessionList":
      await openSessionPicker();
      break;
    case "reloadAgent":
      await runReloadAgent();
      break;
    case "quitApp":
      await quitApp();
      break;
    default:
      showToast(`未知命令 /${name}`, "error");
      clearInput = false;
  }
  if (clearInput) {
    const input = $("promptInput");
    input.value = "";
    autoResize();
    hideFileSuggestions();
    hideCommandSuggestions();
  }
}

async function runExportSessionHtml(outputPath) {
  if (state.streaming) {
    showToast("Agent 正在运行，请先停止当前任务", "warning");
    return;
  }
  try {
    const response = outputPath
      ? await window.pispider.exportSessionHtml(outputPath)
      : await window.pispider.exportSessionHtml();
    if (!response?.success) throw new Error(response?.error || "导出 HTML 失败");
    showToast(`已导出会话：${response.data?.path || "HTML 文件"}`);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function runExportSessionJsonl(outputPath) {
  if (state.streaming) {
    showToast("Agent 正在运行，请先停止当前任务", "warning");
    return;
  }
  try {
    const response = await window.pispider.exportSessionJsonl(outputPath || undefined);
    if (!response?.success) {
      if (response?.cancelled) {
        showToast("已取消导出");
        return;
      }
      throw new Error(response?.error || "导出 JSONL 失败");
    }
    showToast(`已导出会话：${response.data?.path || "JSONL 文件"}`);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function runImportSession() {
  try {
    const response = await window.pispider.importSession();
    if (response?.cancelled) {
      showToast("已取消导入");
      return;
    }
    showToast(response?.imported ? "会话已导入" : "会话已恢复");
    await refreshSessions();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function runImportSessionPath(sourcePath) {
  try {
    const response = await window.pispider.importSessionPath(sourcePath);
    if (response?.cancelled) {
      showToast("已取消导入");
      return;
    }
    showToast(response?.imported ? "会话已导入" : "会话已恢复");
    await refreshSessions();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function runShareSession() {
  try {
    const response = await window.pispider.shareSession();
    if (!response?.success) throw new Error(response?.error || "分享失败");
    const url = response.data?.viewerUrl || response.data?.gistUrl || "";
    showToast(url ? `已分享：${url}` : "会话已分享");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function openBugReport(description) {
  const info = state.info || {};
  const lines = [
    description ? `### 问题描述\n${description}` : "",
    "### 运行环境",
    `- 平台：${info.platform || "未知"}`,
    `- Electron：${info.electron || "未知"}`,
    `- Node：${info.node || "未知"}`,
    `- 工作区：${info.repoRoot || "未知"}`,
  ].filter(Boolean);
  const url = `https://github.com/earendil-works/pi/issues/new?body=${encodeURIComponent(lines.join("\n"))}`;
  window.pispider.openExternal(url);
  showToast("已在浏览器打开问题反馈页面");
}

async function copyLastAssistant() {
  if (typeof window.pispider.getLastAssistantText !== "function") {
    showToast("当前版本不支持复制助手回复", "warning");
    return;
  }
  try {
    const response = await window.pispider.getLastAssistantText();
    const text = response?.success ? String(response.data?.text || "") : "";
    if (!text) {
      showToast("还没有可复制的助手回复", "warning");
      return;
    }
    await window.pispider.copyText(text);
    showToast("已复制最后一条助手回复");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function runSetSessionName(name) {
  try {
    const response = await window.pispider.setSessionName(name);
    if (!response?.success) throw new Error(response?.error || "重命名失败");
    showToast("会话名称已更新");
    await refreshFromAgent();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function runCloneSession() {
  try {
    const response = await window.pispider.cloneSession();
    if (!response?.success) {
      if (response?.cancelled) {
        showToast("已取消复制会话");
        return;
      }
      throw new Error(response?.error || "复制会话失败");
    }
    showToast("会话已复制");
    await refreshSessions();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function runCompact(instructions) {
  if (state.streaming) {
    showToast("Agent 正在运行，请先停止当前任务", "warning");
    return;
  }
  try {
    const response = await window.pispider.compactSession(instructions || "");
    if (!response?.success) throw new Error(response?.error || "压缩上下文失败");
    showToast("上下文已压缩");
    await refreshFromAgent();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function runReloadAgent() {
  try {
    const response = await window.pispider.reloadAgent();
    if (response && response.success === false) throw new Error(response.error || "重载失败");
    showToast("正在重载 Agent…");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function quitApp() {
  if (typeof window.pispider.quitApp !== "function") {
    showToast("当前版本不支持退出命令", "warning");
    return;
  }
  try {
    const response = await window.pispider.quitApp();
    if (response && response.success === false) throw new Error(response.error || "退出失败");
  } catch (error) {
    showToast(error.message, "error");
  }
}


async function clearQueuedMessages({ restore = true, silent = false } = {}) {
  try {
    const response = await window.pispider.clearQueue();
    if (response?.success === false) throw new Error(response.error || "清空排队失败");
    const steering = response?.data?.steering ?? [];
    const followUp = response?.data?.followUp ?? [];
    const queued = [...steering, ...followUp].filter(Boolean).join("\n\n").trim();
    state.queueCount = 0;
    state.queueSteering = [];
    state.queueFollowUp = [];
    if (restore && queued) appendToPrompt(queued);
    scheduleRender();
    if (!silent) showToast(queued ? "已清空排队，并把内容放回输入框" : "没有排队消息");
    return queued;
  } catch (error) {
    if (!silent) showToast(error.message, "error");
    return "";
  }
}

function queuedItems() {
  return [
    ...state.queueSteering.map((text, index) => ({ kind: "插话", text, index })),
    ...state.queueFollowUp.map((text, index) => ({ kind: "排队", text, index })),
  ];
}

function renderQueue() {
  const popover = $("queuePopover");
  const count = state.queueCount;
  const button = $("queueButton");
  button.hidden = count === 0;
  button.textContent = `${count} 条排队`;
  button.setAttribute("aria-expanded", count > 0 && !popover.hidden ? "true" : "false");
  $("clearQueueButton").hidden = count === 0;
  if (count === 0) {
    popover.hidden = true;
    $("queueList").replaceChildren();
    return;
  }
  if (popover.hidden) return;
  const items = queuedItems();
  $("queueList").innerHTML = items.length
    ? items
        .map(
          (item, index) => `<div class="queue-item">
            <span class="queue-kind">${item.kind}</span>
            <span class="queue-text">${escapeHtml(item.text)}</span>
            <button class="queue-copy" type="button" data-queue-copy="${index}">复制</button>
          </div>`,
        )
        .join("")
    : `<div class="queue-empty">排队文本暂时为空。</div>`;
}

function applyTheme(theme, persist = true) {
  state.theme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = state.theme;
  if (persist) localStorage.setItem("pispider-theme", state.theme);
  if (document.querySelector(".mermaid-block")) resetMermaidBlocks();
  window.pispider.setTheme(state.theme).catch(() => {});
}

function setPanel(open, persist = true) {
  if (open !== state.panelOpen) {
    const followLatest = isThreadNearBottom();
    setMessageLayoutAnchor(followLatest ? null : captureMessageAnchor(), followLatest);
  }
  state.panelOpen = open;
  $("appBody").classList.toggle("panel-hidden", !open);
  $("contextPanel").hidden = false;
  const toggle = $("panelButton");
  if (toggle) {
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.title = open ? "关闭上下文面板" : "打开上下文面板";
  }
  if (persist) localStorage.setItem("pispider-panel", open ? "open" : "closed");
  syncPanelClearance();
  setTimeout(scheduleRender, 280);
}

function syncPanelClearance() {
  if (!state.panelOpen || window.innerWidth > PANEL_OVERLAY_WIDTH) return;
  const app = $("appBody");
  const main = document.querySelector(".main-column");
  const composer = $("composer");
  if (!app || !main || !composer) return;
  const mainRect = main.getBoundingClientRect();
  const composerRect = composer.getBoundingClientRect();
  const clearance = Math.max(0, Math.round(mainRect.bottom - composerRect.top + 24));
  app.style.setProperty("--panel-clearance", `${clearance}px`);
}

function setPanelBackdrop(kind) {
  const backdrop = $("panelBackdrop");
  if (!backdrop) return;
  backdrop.hidden = !kind;
  document.body.classList.toggle("panel-modal", Boolean(kind));
}

function closePanelModal() {
  setPanelBackdrop(null);
  window.pispider.closePanel().catch(() => {});
}

function setRightTab(tab) {
  state.rightTab = tab === "changes" ? "changes" : "browser";
  localStorage.setItem("pispider-right-tab", state.rightTab);
  document.querySelectorAll(".context-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === state.rightTab);
  });
  renderContext();
  if (state.rightTab === "changes") refreshProjectChanges();
}

function setNav(nav) {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.nav === nav);
  });
}

function currentSessionScrollKey() {
  return state.session?.sessionFile || state.session?.sessionId || "__no-session__";
}

function isThreadNearBottom() {
  const scroll = $("threadScroll");
  return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 100;
}

function readScrollState() {
  const scroll = $("threadScroll");
  const max = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
  const atBottom = max - scroll.scrollTop < 100;
  const anchor = captureMessageAnchor();
  return {
    top: scroll.scrollTop,
    max,
    ratio: max > 0 ? scroll.scrollTop / max : 0,
    atBottom,
    atLatest: atBottom,
    anchorKey: anchor?.key || "",
    anchorIndex: Number.isInteger(anchor?.index) ? anchor.index : -1,
    anchorOffset: Number.isFinite(anchor?.offset) ? anchor.offset : null,
    updatedAt: Date.now(),
  };
}

function persistScrollPositionsSoon() {
  if (scrollPersistTimer) return;
  scrollPersistTimer = setTimeout(() => {
    scrollPersistTimer = 0;
    try {
      const entries = [...state.scrollPositions.entries()]
        .sort((left, right) => (left[1].updatedAt || 0) - (right[1].updatedAt || 0))
        .slice(-120);
      localStorage.setItem(SCROLL_POSITIONS_KEY, JSON.stringify(entries));
    } catch {}
  }, 250);
}

function loadScrollPositions() {
  try {
    const stored = JSON.parse(localStorage.getItem(SCROLL_POSITIONS_KEY) || "[]");
    if (!Array.isArray(stored)) return;
    for (const entry of stored.slice(-120)) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string" || !entry[1]) continue;
      const value = entry[1];
      state.scrollPositions.set(entry[0], {
        top: Number(value.top) || 0,
        ratio: Number(value.ratio) || 0,
        atBottom: Boolean(value.atBottom),
        atLatest: Boolean(value.atLatest),
        anchorKey: typeof value.anchorKey === "string" ? value.anchorKey : "",
        anchorIndex: Number.isInteger(value.anchorIndex) ? value.anchorIndex : -1,
        anchorOffset: Number.isFinite(value.anchorOffset) ? value.anchorOffset : null,
        updatedAt: Number(value.updatedAt) || 0,
      });
    }
  } catch {}
}

function currentMessageHeightLayout() {
  const listWidth = Number($("messageList")?.clientWidth) || 0;
  return {
    width: listWidth > 0 ? Math.round(listWidth * 10) / 10 : 0,
    zoom: Number(state.zoomFactor) || 1,
  };
}

function messageHeightLayoutMatches(candidate, layout) {
  if (!candidate || layout.width <= 0) return false;
  return (
    Math.abs((Number(candidate.width) || 0) - layout.width) <= MESSAGE_HEIGHT_LAYOUT_TOLERANCE &&
    Math.abs((Number(candidate.zoom) || 1) - layout.zoom) <= 0.001
  );
}

function setMessageLayoutAnchor(anchor, followLatest = false) {
  state.messageLayoutAnchor = anchor || null;
  state.messageLayoutFollowLatest = Boolean(followLatest);
  if (messageLayoutAnchorTimer) clearTimeout(messageLayoutAnchorTimer);
  if (!state.messageLayoutAnchor && !state.messageLayoutFollowLatest) {
    messageLayoutAnchorTimer = 0;
    return;
  }
  messageLayoutAnchorTimer = setTimeout(() => {
    messageLayoutAnchorTimer = 0;
    state.messageLayoutAnchor = null;
    state.messageLayoutFollowLatest = false;
  }, 1000);
}

function clearMessageLayoutAnchor() {
  setMessageLayoutAnchor(null);
}

function syncMessageHeightLayout() {
  const layout = currentMessageHeightLayout();
  if (layout.width <= 0) return false;
  if (!state.messageHeightLayoutWidth) {
    state.messageHeightLayoutWidth = layout.width;
    state.messageHeightLayoutZoom = layout.zoom;
    return false;
  }
  const widthChanged =
    Math.abs(state.messageHeightLayoutWidth - layout.width) > MESSAGE_HEIGHT_LAYOUT_TOLERANCE;
  const zoomChanged = Math.abs((state.messageHeightLayoutZoom || 1) - layout.zoom) > 0.001;
  if (!widthChanged && !zoomChanged) return false;
  if (!state.messageLayoutAnchor && !state.messageLayoutFollowLatest && !isThreadNearBottom()) {
    const snapshot = state.scrollPositions.get(currentSessionScrollKey());
    if (snapshot?.anchorKey && Number.isFinite(snapshot.anchorOffset)) {
      state.messageLayoutAnchor = {
        key: snapshot.anchorKey,
        index: snapshot.anchorIndex,
        offset: snapshot.anchorOffset,
      };
    }
  }
  state.messageHeights.clear();
  state.messageOffsetCache = null;
  state.messageHeightVersion += 1;
  if (state.messageHeightSessionKey) state.messageHeightSessions.delete(state.messageHeightSessionKey);
  state.messageHeightLayoutWidth = layout.width;
  state.messageHeightLayoutZoom = layout.zoom;
  persistMessageHeightsSoon();
  return true;
}

function loadMessageHeightCache() {
  state.messageHeightSessions.clear();
  try {
    const stored = JSON.parse(localStorage.getItem(MESSAGE_HEIGHT_CACHE_KEY) || "[]");
    if (!Array.isArray(stored)) return;
    const sessions = stored
      .filter(
        (entry) =>
          Array.isArray(entry) &&
          typeof entry[0] === "string" &&
          entry[1] &&
          entry[1].version === MESSAGE_HEIGHT_CACHE_VERSION &&
          entry[1].heights &&
          typeof entry[1].heights === "object" &&
          Number(entry[1].layoutWidth) > 0 &&
          Number.isFinite(Number(entry[1].layoutZoom)),
      )
      .sort((left, right) => (Number(left[1].updatedAt) || 0) - (Number(right[1].updatedAt) || 0))
      .slice(-MESSAGE_HEIGHT_CACHE_SESSION_LIMIT);
    for (const [sessionKey, value] of sessions) {
      const heights = new Map();
      for (const [heightKey, entry] of Object.entries(value.heights)) {
        const numericHeight = Number(entry?.h ?? entry);
        const signature = typeof entry?.s === "string" ? entry.s : "";
        if (Number.isFinite(numericHeight) && numericHeight > 0) {
          heights.set(heightKey, { height: numericHeight, signature });
        }
        if (heights.size >= MESSAGE_HEIGHT_CACHE_ENTRY_LIMIT) break;
      }
      state.messageHeightSessions.set(sessionKey, {
        updatedAt: Number(value.updatedAt) || 0,
        width: Number(value.layoutWidth),
        zoom: Number(value.layoutZoom),
        heights,
      });
    }
  } catch {}
}

function saveActiveMessageHeights() {
  const sessionKey = state.messageHeightSessionKey;
  if (!sessionKey || state.messageHeights.size === 0) return;
  const layout =
    state.messageHeightLayoutWidth > 0
      ? {
          width: state.messageHeightLayoutWidth,
          zoom: state.messageHeightLayoutZoom || 1,
        }
      : currentMessageHeightLayout();
  if (layout.width <= 0) return;
  const previous = state.messageHeightSessions.get(sessionKey);
  const heights = messageHeightLayoutMatches(previous, layout) ? previous.heights : new Map();
  for (const [heightKey, entry] of state.messageHeights) {
    if (entry && Number.isFinite(entry.height) && entry.height > 0) heights.set(heightKey, entry);
  }
  while (heights.size > MESSAGE_HEIGHT_CACHE_ENTRY_LIMIT) {
    const oldestKey = heights.keys().next().value;
    if (!oldestKey) break;
    heights.delete(oldestKey);
  }
  state.messageHeightSessions.set(sessionKey, {
    updatedAt: Date.now(),
    width: layout.width,
    zoom: layout.zoom,
    heights,
  });
}

function persistMessageHeightsNow() {
  if (messageHeightPersistTimer) {
    clearTimeout(messageHeightPersistTimer);
    messageHeightPersistTimer = 0;
  }
  saveActiveMessageHeights();
  try {
    const sessions = [...state.messageHeightSessions.entries()]
      .sort((left, right) => (left[1].updatedAt || 0) - (right[1].updatedAt || 0))
      .slice(-MESSAGE_HEIGHT_CACHE_SESSION_LIMIT)
      .map(([sessionKey, cache]) => [
        sessionKey,
        {
          version: MESSAGE_HEIGHT_CACHE_VERSION,
          updatedAt: cache.updatedAt || 0,
          layoutWidth: cache.width || 0,
          layoutZoom: cache.zoom || 1,
          heights: Object.fromEntries(
            [...cache.heights].map(([heightKey, entry]) => [
              heightKey,
              { h: entry.height, s: entry.signature || "" },
            ]),
          ),
        },
      ]);
    const keptSessions = new Set(sessions.map(([sessionKey]) => sessionKey));
    for (const sessionKey of state.messageHeightSessions.keys()) {
      if (!keptSessions.has(sessionKey) && sessionKey !== state.messageHeightSessionKey) {
        state.messageHeightSessions.delete(sessionKey);
      }
    }
    localStorage.setItem(MESSAGE_HEIGHT_CACHE_KEY, JSON.stringify(sessions));
  } catch {}
}

function persistMessageHeightsSoon() {
  if (messageHeightPersistTimer) return;
  messageHeightPersistTimer = setTimeout(persistMessageHeightsNow, 600);
}

function loadMessageHeightsForSession(sessionKey) {
  const layout = currentMessageHeightLayout();
  state.messageHeightSessionKey = sessionKey;
  state.messageHeightLayoutWidth = layout.width;
  state.messageHeightLayoutZoom = layout.zoom;
  const cache = state.messageHeightSessions.get(sessionKey);
  if (cache && messageHeightLayoutMatches(cache, layout)) {
    for (const [heightKey, entry] of cache.heights) {
      state.messageHeights.set(heightKey, entry);
    }
  }
  state.messageHeightVersion += 1;
  state.messageOffsetCache = null;
}

function rememberScrollPosition() {
  if (!state.session || state.scrollRestorePending) return;
  if (state.messageSessionKey !== currentSessionScrollKey()) return;
  const snapshot = readScrollState();
  state.scrollPositions.set(currentSessionScrollKey(), snapshot);
  persistScrollPositionsSoon();
}

function setThreadScrollTop(top) {
  const scroll = $("threadScroll");
  const previousBehavior = scroll.style.scrollBehavior;
  scroll.style.scrollBehavior = "auto";
  scroll.scrollTop = top;
  scroll.style.scrollBehavior = previousBehavior;
}

function restoreScrollSnapshot(snapshot, key) {
  const total = visibleMessageCount();
  // No saved position means this session was not read before. Render the
  // latest slice and let the initial bottom scroll settle; the virtual list
  // keeps the full transcript height available even before that.
  if (!snapshot) {
    resetMessageWindow();
    state.scrollOnRender = true;
    state.scrollRestorePending = false;
    return;
  }
  if (snapshot.atLatest || snapshot.atBottom) {
    resetMessageWindow();
    state.scrollOnRender = true;
    state.scrollRestorePending = false;
    return;
  }
  resetMessageWindow();
  state.scrollOnRender = false;
  state.scrollRestorePending = true;
  const savedIndex = Number.isInteger(snapshot.anchorIndex) ? snapshot.anchorIndex : -1;
  if (savedIndex >= 0 && savedIndex < total) {
    const range = virtualRangeForIndex(total, savedIndex);
    state.messageWindowStart = range.start;
    state.messageWindowEnd = range.end;
    state.messagePreviousTotal = total;
  }
  invalidateMessageRender();
  scheduleDomUpdate(() => {
    if (!state.scrollRestorePending) return;
    const scroll = $("threadScroll");
    const max = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    let top = max;
    if (savedIndex >= 0 && savedIndex < total && Number.isFinite(snapshot.anchorOffset)) {
      const offsets = messageOffsets(visibleMessages());
      top = messageVirtualContentTop() + offsets[savedIndex] - snapshot.anchorOffset;
    } else if (snapshot && !snapshot.atBottom) {
      const savedTop = Number(snapshot.top);
      const savedRatio = Number(snapshot.ratio);
      if (Number.isFinite(savedRatio) && savedRatio > 0) top = savedRatio * max;
      else if (Number.isFinite(savedTop) && savedTop <= max + 20) top = savedTop;
    }
    setThreadScrollTop(Math.min(Math.max(0, top), max));
    if (snapshot.anchorKey && Number.isFinite(snapshot.anchorOffset)) {
      restoreMessageAnchor({ key: snapshot.anchorKey, offset: snapshot.anchorOffset });
    }
    state.scrollOnRender = false;
    state.scrollRestorePending = false;
    updateScrollLatestButton();
    refreshVirtualMessageWindow();
    if (key) {
      state.scrollPositions.set(key, readScrollState());
      persistScrollPositionsSoon();
    }
  });
}

function restoreSessionScroll(key) {
  restoreScrollSnapshot(state.scrollPositions.get(key), key);
}

function scrollToBottom(smooth = false) {
  const scroll = $("threadScroll");
  const apply = () => {
    if (state.scrollRestorePending) return;
    setThreadScrollTop(scroll.scrollHeight);
    state.scrollOnRender = false;
    updateScrollLatestButton();
    rememberScrollPosition();
  };
  if (!smooth) {
    apply();
    scheduleDomUpdate(apply);
    setTimeout(apply, 0);
    return;
  }
  scheduleDomUpdate(() => {
    const behavior = !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto";
    scroll.scrollTo({ top: scroll.scrollHeight, behavior });
    state.scrollOnRender = false;
    updateScrollLatestButton();
    setTimeout(rememberScrollPosition, 400);
  });
}

function updateScrollLatestButton() {
  const scroll = $("threadScroll");
  const button = $("scrollLatestButton");
  if (!button || !scroll) return;
  const hasContent = state.messages.length > 0 || state.tools.size > 0;
  const distance = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
  button.hidden = !hasContent || distance < 180;
}

function updateThreadRange(start, end, total) {
  const range = $("threadRange");
  if (!range) return;
  const wrapper = range.closest(".thread-subline");
  const nav = $("threadWindowNav");
  const visible = total > MESSAGE_RENDER_WINDOW;
  range.hidden = !visible;
  if (wrapper) wrapper.hidden = !visible;
  if (nav) nav.hidden = !visible;
  if (!visible) {
    range.textContent = "";
    range.removeAttribute("title");
    return;
  }
  range.textContent = `共 ${total} 条`;
  range.title = `滚动条代表完整会话，当前只渲染视口附近的 ${end - start} 条消息`;
}

function formatTokenCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return "0";
  if (count < 1_000) return String(Math.round(count));
  if (count < 1_000_000) {
    const digits = count < 10_000 ? 1 : 0;
    return `${(count / 1_000).toFixed(digits)}k`;
  }
  return `${(count / 1_000_000).toFixed(1)}M`;
}

function threadContextUsage(stats) {
  const usage = stats?.contextUsage;
  if (!usage || typeof usage !== "object") return null;
  const used = Number(usage.tokens);
  const total = Number(usage.contextWindow);
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
  const ratio = Math.max(0, Math.min(1, used / total));
  const percent = Math.round(ratio * 100);
  return { used, total, ratio, percent, high: percent >= 75, critical: percent >= 90 };
}

const CONTEXT_RING_RADIUS = 7;
const CONTEXT_RING_CIRCUMFERENCE = 2 * Math.PI * CONTEXT_RING_RADIUS;

function contextRingSvg(ratio = 0) {
  const value = Math.max(0, Math.min(1, Number(ratio) || 0));
  const offset = CONTEXT_RING_CIRCUMFERENCE * (1 - value);
  return `<svg class="context-ring-svg" viewBox="0 0 18 18" width="20" height="20" aria-hidden="true">
    <circle class="context-ring-track" cx="9" cy="9" r="${CONTEXT_RING_RADIUS}" fill="none" stroke-width="2.6"/>
    <circle class="context-ring-fill" cx="9" cy="9" r="${CONTEXT_RING_RADIUS}" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="${CONTEXT_RING_CIRCUMFERENCE.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 9 9)"/>
  </svg>`;
}

function renderThreadStatsPopover() {
  const popover = $("threadStatsPopover");
  if (!popover) return;
  const stats = state.sessionStats;
  const context = threadContextUsage(stats);
  if (!stats) {
    popover.innerHTML = `<div class="popover-heading popover-heading-row"><span>会话用量</span><button class="popover-cycle" data-refresh-thread-stats type="button">刷新</button></div><div class="popover-item-meta" style="padding:3px 9px 10px">${
      state.sessionStatsError || "正在读取会话统计..."
    }</div>`;
    return;
  }
  const tokens = stats.tokens || {};
  const tokenValue = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? formatTokenCount(number) : "—";
  };
  const cost = stats.cost != null && Number.isFinite(Number(stats.cost)) ? `$${Number(stats.cost).toFixed(4)}` : "—";
  const contextSection = context
    ? `<div class="thread-stats-context"><div class="thread-stats-context-head"><span>上下文</span><strong class="${
        context.critical ? "critical" : context.high ? "warn" : ""
      }">${context.percent}%</strong></div><div class="thread-stats-meter${
        context.critical ? " critical" : context.high ? " warn" : ""
      }"><span style="width:${context.percent}%"></span></div><div class="popover-item-meta">${formatTokenCount(
        context.used,
      )} / ${formatTokenCount(context.total)} tokens</div></div>`
    : "";
  const rows = [
    ["输入", tokenValue(tokens.input)],
    ["输出", tokenValue(tokens.output)],
    ["Token 总量", tokenValue(tokens.total)],
    ["成本", cost],
  ];
  popover.innerHTML = `<div class="popover-heading popover-heading-row"><span>会话用量</span><button class="popover-cycle" data-refresh-thread-stats type="button">刷新</button></div>${contextSection}<div class="thread-stats-rows">${rows
    .map(
      ([label, value]) =>
        `<div class="thread-stats-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
    )
    .join("")}</div><div class="popover-note">统计来自 Pi 的 get_session_stats；每轮 Agent 结束后刷新。</div>`;
}

function renderThreadStats() {
  const button = $("threadStatsButton");
  if (!button) return;
  const stats = state.sessionStats;
  const context = threadContextUsage(stats);
  if (context) {
    button.innerHTML = `<span class="context-ring">${contextRingSvg(context.ratio)}</span><span class="context-ring-value">${context.percent}%</span>`;
    button.setAttribute("aria-label", `上下文用量 ${context.percent}%`);
  } else {
    button.innerHTML = `<span class="context-ring">${contextRingSvg(0)}</span><span class="context-ring-value">—</span>`;
    button.setAttribute("aria-label", stats?.tokens?.total ? "上下文用量未知" : "查看会话用量");
  }
  button.classList.toggle("warn", Boolean(context?.high || context?.critical));
  button.title = stats
    ? `${context ? `上下文 ${context.percent}% · ${formatTokenCount(context.used)} / ${formatTokenCount(context.total)} tokens` : "上下文用量未知"}${
        stats.tokens?.total ? ` · Token ${formatTokenCount(stats.tokens.total)}` : ""
      }${stats.cost != null && Number.isFinite(Number(stats.cost)) ? ` · 成本 $${Number(stats.cost).toFixed(4)}` : ""}`
    : state.sessionStatsError || "查看会话用量";
  const popover = $("threadStatsPopover");
  if (popover && !popover.hidden) renderThreadStatsPopover();
}

async function refreshThreadStats(generation = agentRefreshGeneration) {
  const sessionFile = state.session?.sessionFile || null;
  try {
    const response = await window.pispider.getSessionStats();
    if (generation !== agentRefreshGeneration) return;
    if ((state.session?.sessionFile || null) !== sessionFile) return;
    if (response?.success) {
      state.sessionStats = response.data || null;
      state.sessionStatsError = "";
    } else {
      state.sessionStats = null;
      state.sessionStatsError = response?.error || "无法读取会话统计";
    }
  } catch (error) {
    if (generation !== agentRefreshGeneration) return;
    state.sessionStats = null;
    state.sessionStatsError = error.message;
  }
  renderThreadStats();
}

function renderHeader() {
  const session = state.session;
  const firstUser = state.messages.find((message) => message.role === "user");
  const title =
    session?.sessionName ||
    (firstUser ? shortText(contentToText(firstUser.content), 72) : "") ||
    "新任务";
  $("threadTitle").textContent = title;
  $("modelChip").textContent = modelLabel();
  $("modelButton").title = `切换模型 · ${state.session?.model?.provider || ""}`.trim();
  $("thinkingChip").textContent = thinkingLabel();
  $("permissionChip").textContent = permissionLabel();
  $("cwdLabel").textContent = "PiSpider";
  $("streamingHint").textContent =
    state.extensionStatus ||
    state.extensionWidget ||
    (state.streaming ? "Agent 正在工作 · Ctrl+Enter 插话" : "");
  const sendButton = $("sendButton");
  sendButton.classList.toggle("is-stopping", state.streaming);
  sendButton.innerHTML = state.streaming ? STOP_ICON : SEND_ICON;
  sendButton.title = state.streaming ? "停止" : "发送";
  sendButton.setAttribute("aria-label", state.streaming ? "停止" : "发送");
  $("sessionCount").textContent = String(state.sessions.length);
  $("ruleCount").textContent = String(state.rules.length);
  $("skillCount").textContent = String(state.skills.length);
  $("mcpCount").textContent = String(state.mcpServers.length);
  $("extensionCount").textContent = String(state.extensions.filter((extension) => !extension.builtin).length);
  $("changeCount").textContent = String(codeEntries().length);
}

function messageBlocks(message) {
  if (typeof message.content === "string") {
    return [{ type: "text", text: message.content }];
  }
  if (!Array.isArray(message.content)) return [];
  return message.content;
}

function messageImageBlocks(message) {
  return messageBlocks(message).filter((block) => block?.type === "image" && block.data);
}

function messageImageElement(image) {
  const element = document.createElement("img");
  element.src = `data:${image.mimeType || "image/png"};base64,${image.data}`;
  element.alt = "附加图片";
  // Images decode after the message is laid out; re-measure once the real box
  // is known so the virtual spacer does not keep the pre-decode estimate.
  element.addEventListener("load", () => refreshActionGroupLayout());
  element.addEventListener("error", () => refreshActionGroupLayout());
  return element;
}

function renderMessageImageStrip(images) {
  const strip = document.createElement("div");
  strip.className = "message-images";
  for (const image of images) strip.appendChild(messageImageElement(image));
  return strip;
}

function messageCopyText(message) {
  if (message.role === "user") return contentToText(message.content).trim();
  if (message.role === "bashExecution") {
    const output = formatShellResult(message);
    return `$ ${message.command}${output ? `\n\n${output}` : ""}`.trim();
  }
  if (message.role !== "assistant") return "";
  return messageBlocks(message)
    .filter((block) => block?.type === "text")
    .map((block) => block.text || "")
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function actionGroupStatus(actions, group) {
  if ((group?._live && state.streaming) || actions.some((action) => action.status === "running")) return "running";
  if (actions.some((action) => action.status === "error")) return "error";
  return "done";
}

function actionGroupTitle(actions, status) {
  if (status === "running") {
    const running = [...actions].reverse().find((action) => action.status === "running");
    const current = running || actions[actions.length - 1];
    return `正在运行${current?.summary ? ` ${shortText(current.summary, 110)}` : ""}`;
  }
  if (status === "error") return `已执行 ${actions.length} 个动作 · 有失败`;
  return `已执行 ${actions.length} 个动作`;
}

function normalizedActionGroupActions(group) {
  if (group._live) return group.actions || [];
  return (group.actions || []).map((entry) => actionFromMessage(entry.message, entry.call));
}

function refreshActionGroupLayout() {
  scheduleDomUpdate(() => {
    if (!measureRenderedMessages()) return;
    const messages = visibleMessages();
    if (state.messageWindowStart < 0 || state.messageWindowEnd < 0) return;
    applyVirtualSpacers(messages, state.messageWindowStart, state.messageWindowEnd, messages.length);
  });
}

function renderActionRow(action, group, index) {
  const key = `${group.id}:${action.id || index}`;
  const details = document.createElement("details");
  details.className = "action-row";
  details.open = actionOpenKeys.has(key);
  const statusClass = action.status === "running" ? "running" : action.status === "error" ? "error" : "";
  const sections = (action.sections || [])
    .map(
      (section) => `
        <div class="tool-section">
          <div class="tool-section-label">${escapeHtml(section.label)}</div>
          <pre class="tool-output">${escapeHtml(section.text || "（无输出）")}</pre>
        </div>
      `,
    )
    .join("");
  details.innerHTML = `
    <summary>
      <span class="tool-status ${statusClass}"></span>
      <span class="action-row-name">${escapeHtml(action.name)}</span>
      <span class="action-row-kind">${escapeHtml(action.kind)}</span>
      <span class="action-row-summary">${escapeHtml(action.summary || "（无输出）")}</span>
      <span class="action-row-status">${escapeHtml(action.statusText || "")}</span>
    </summary>
    <div class="action-row-body">${sections}</div>
  `;
  details.addEventListener("toggle", () => {
    if (details.open) actionOpenKeys.add(key);
    else actionOpenKeys.delete(key);
    refreshActionGroupLayout();
  });
  return details;
}

function renderActionGroupCard(group) {
  const actions = normalizedActionGroupActions(group);
  const status = actionGroupStatus(actions, group);
  const title = actionGroupTitle(actions, status);
  const details = document.createElement("details");
  details.className = "action-group";
  details.open = actionOpenKeys.has(group.id);
  details.dataset.actionKey = group.id;
  details.innerHTML = `
    <summary>
      <span class="action-group-mark ${status}">${ACTION_GLYPH}</span>
      <span class="action-group-title">${escapeHtml(title)}</span>
      <span class="action-group-chevron">${ACTION_CHEVRON}</span>
    </summary>
    <div class="action-group-body"></div>
  `;
  const body = details.querySelector(".action-group-body");
  actions.forEach((action, index) => body.appendChild(renderActionRow(action, group, index)));
  details.addEventListener("toggle", () => {
    if (details.open) actionOpenKeys.add(group.id);
    else actionOpenKeys.delete(group.id);
    refreshActionGroupLayout();
  });
  return details;
}

function turnTitleText(turn) {
  if (turn.live) {
    const current =
      turn.liveGroup?.actions?.find((tool) => tool.status === "running") || turn.liveGroup?.actions?.at(-1);
    const summary = current ? actionFromTool(current).summary : "";
    if (summary) return `正在运行 · ${shortText(summary, 90)}`;
    return `正在运行 · ${turn.actionCount} 个动作`;
  }
  const duration = turnDurationText(turn.durationMs);
  return `${duration ? `用时 ${duration}` : "已执行"} · ${turn.actionCount} 个动作`;
}

function renderTurnLiveActions(container, group) {
  container.replaceChildren();
  for (const [index, tool] of (group?.actions || []).entries()) {
    container.appendChild(renderActionRow(actionFromTool(tool), { id: "live-action-group" }, index));
  }
}

function renderTurnSummary(turn) {
  const details = document.createElement("details");
  details.className = "turn-card";
  details.open = actionOpenKeys.has(turn.id);
  const status = turn.live ? "running" : "done";
  details.innerHTML = `
    <summary>
      <span class="turn-mark ${status}">${ACTION_GLYPH}</span>
      <span class="turn-title">${escapeHtml(turnTitleText(turn))}</span>
      <span class="turn-chevron">${ACTION_CHEVRON}</span>
    </summary>
    <div class="turn-steps"></div>
  `;
  const body = details.querySelector(".turn-steps");
  turn.steps.forEach((step, stepIndex) => {
    if (step.kind === "thinking") {
      const thinking = document.createElement("details");
      thinking.className = "thinking-block turn-thinking";
      thinking.innerHTML = `<summary>思考过程</summary><div class="thinking-text">${escapeHtml(step.text)}</div>`;
      body.appendChild(thinking);
      return;
    }
    if (step.kind === "text") {
      const text = document.createElement("div");
      text.className = "turn-step-text markdown";
      text.innerHTML = renderMarkdown(step.text);
      body.appendChild(text);
      return;
    }
    if (step.kind === "actions" || step.kind === "liveActions") {
      const list = document.createElement("div");
      list.className = `turn-action-list${step.kind === "liveActions" ? " turn-live-actions" : ""}`;
      if (step.kind === "liveActions") {
        renderTurnLiveActions(list, step.group);
      } else {
        const actions = normalizedActionGroupActions(step.group);
        actions.forEach((action, index) =>
          list.appendChild(renderActionRow(action, { id: `${turn.id}:step:${stepIndex}` }, index)),
        );
      }
      body.appendChild(list);
    }
  });
  details.addEventListener("toggle", () => {
    if (details.open) actionOpenKeys.add(turn.id);
    else actionOpenKeys.delete(turn.id);
    refreshActionGroupLayout();
  });
  return details;
}

function createMessageCopyButton(message) {
  const copyText = messageCopyText(message);
  if (!copyText) return null;
  const copyButton = document.createElement("button");
  copyButton.className = "message-copy";
  copyButton.type = "button";
  copyButton.textContent = "复制";
  copyButton.title = "复制这条消息";
  copyButton.setAttribute("aria-label", "复制这条消息");
  copyButton.addEventListener("click", async () => {
    try {
      await window.pispider.copyText(copyText);
      showToast(message.role === "user" ? "已复制你的消息" : "已复制回复");
    } catch (error) {
      showToast(error.message, "error");
    }
  });
  return copyButton;
}

function renderAssistantContent(message, body, { skipThinking = false } = {}) {
  const blocks = messageBlocks(message);
  if (blocks.length === 0 && message._live) {
    const text = document.createElement("div");
    text.className = "message-text";
    text.textContent = "思考中...";
    body.appendChild(text);
  }
  let imageStrip = null;
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && block.text) {
      const text = document.createElement("div");
      text.className = "message-text markdown";
      text.innerHTML = renderMarkdown(block.text);
      body.appendChild(text);
    } else if (block.type === "thinking" && block.thinking && !skipThinking) {
      const details = document.createElement("details");
      details.className = "thinking-block";
      details.innerHTML = `<summary>思考过程</summary><div class="thinking-text">${escapeHtml(
        block.thinking,
      )}</div>`;
      body.appendChild(details);
    } else if (block.type === "image" && block.data) {
      if (!imageStrip || body.lastElementChild !== imageStrip) {
        imageStrip = renderMessageImageStrip([]);
        body.appendChild(imageStrip);
      }
      imageStrip.appendChild(messageImageElement(block));
    }
  }
  const errorText = typeof message.errorMessage === "string" ? message.errorMessage.trim() : "";
  if (errorText) {
    const error = document.createElement("div");
    error.className = "message-error";
    error.textContent = `请求失败：${errorText}`;
    body.appendChild(error);
  } else if (blocks.length === 0) {
    const text = document.createElement("div");
    text.className = "message-text message-empty";
    text.textContent = "模型未返回内容";
    body.appendChild(text);
  }
}

function renderMessage(message) {
  if (message.role === "system") return null;

  const wrapper = document.createElement("article");
  wrapper.className = `message message-${message.role === "user" ? "user" : "assistant"}`;
  if (message.role === "bashExecution" || message.role === "toolResult") {
    wrapper.classList.add("message-tool");
  }
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = message.role === "user" ? "你" : "PS";
  const body = document.createElement("div");
  body.className = "message-body";
  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent =
    message.role === "user"
      ? "你"
      : message.role === "bashExecution"
        ? "Shell"
        : message.role === "toolResult"
          ? message.toolName || "工具结果"
          : "PiSpider";
  body.appendChild(label);

  const copyButton = createMessageCopyButton(message);

  if (message.role === "user") {
    const text = document.createElement("div");
    text.className = "message-text";
    text.textContent = contentToText(message.content);
    if (text.textContent) body.appendChild(text);
    const images = messageImageBlocks(message);
    if (images.length) body.appendChild(renderMessageImageStrip(images));
  } else if (message.role === "bashExecution") {
    body.appendChild(renderBashExecutionMessage(message));
  } else if (message.role === "toolResult") {
    body.appendChild(renderToolResultMessage(message));
  } else {
    if (message._turn) body.appendChild(renderTurnSummary(message._turn));
    renderAssistantContent(message, body, { skipThinking: Boolean(message._turn) });
  }

  if (copyButton) body.appendChild(copyButton);
  wrapper.append(avatar, body);
  return wrapper;
}

function updateLiveTurnCard(element, turn) {
  const card = element.querySelector(".turn-card");
  if (!card || !turn) return false;
  const title = card.querySelector(".turn-title");
  if (title) title.textContent = turnTitleText(turn);
  const thinking = card.querySelector(".turn-thinking .thinking-text");
  if (thinking) thinking.textContent = turn.thinkingText || "";
  const steps = card.querySelector(".turn-steps");
  let liveList = steps?.querySelector(".turn-live-actions") || null;
  if (!turn.liveGroup) {
    liveList?.remove();
    return true;
  }
  if (!steps) return false;
  if (!liveList) {
    liveList = document.createElement("div");
    liveList.className = "turn-action-list turn-live-actions";
    steps.appendChild(liveList);
  }
  renderTurnLiveActions(liveList, turn.liveGroup);
  return true;
}

function updateLiveTurnMessage(element, message) {
  const body = element.querySelector(".message-body");
  const turn = body?.querySelector(".turn-card");
  if (!body || !turn) return false;
  updateLiveTurnCard(element, message._turn);
  for (const child of [...body.children]) {
    if (child === turn || child.classList.contains("message-label")) continue;
    child.remove();
  }
  renderAssistantContent(message, body, { skipThinking: Boolean(message._turn) });
  const copyButton = createMessageCopyButton(message);
  if (copyButton) body.appendChild(copyButton);
  return true;
}

function toolKindLabel(name) {
  const lower = String(name || "").toLowerCase();
  if (lower.includes("bash") || lower.includes("shell")) return "命令";
  if (lower.includes("read")) return "读取";
  if (lower.includes("write")) return "写入";
  if (lower.includes("edit")) return "编辑";
  if (lower.includes("grep") || lower.includes("search")) return "搜索";
  if (lower.includes("find") || lower.includes("glob")) return "查找";
  if (lower.includes("ls") || lower.includes("list")) return "目录";
  if (lower.includes("ps_task")) return "任务";
  return "工具";
}

function renderBashExecutionMessage(message) {
  const details = document.createElement("details");
  details.className = "tool-card";
  const failed = Boolean(message.cancelled) || (message.exitCode != null && Number(message.exitCode) !== 0);
  const summary = message.excludeFromContext ? "不写入上下文" : "";
  details.innerHTML = `
    <summary>
      <span class="tool-status ${failed ? "error" : ""}"></span>
      <span class="tool-name">shell</span>
      <span class="tool-kind">${escapeHtml(toolKindLabel("shell"))}</span>
      <span class="tool-summary">${escapeHtml(shortText(message.command || "", 120))}</span>
      <span class="tool-duration">${summary}</span>
    </summary>
    <div class="tool-body">
      <div class="tool-section">
        <div class="tool-section-label">命令</div>
        <pre class="tool-output">${escapeHtml(message.command || "")}</pre>
      </div>
      <div class="tool-section">
        <div class="tool-section-label">输出</div>
        <pre class="tool-output">${escapeHtml(formatShellResult(message))}</pre>
      </div>
    </div>
  `;
  return details;
}

function renderToolResultMessage(message) {
  const details = document.createElement("details");
  details.className = "tool-card";
  const output = contentToText(message.content);
  const images = messageImageBlocks(message);
  const summaryText = output || (images.length ? `${images.length} 张图片` : "");
  details.innerHTML = `
    <summary>
      <span class="tool-status ${message.isError ? "error" : ""}"></span>
      <span class="tool-name">${escapeHtml(message.toolName || "tool")}</span>
      <span class="tool-kind">${escapeHtml(toolKindLabel(message.toolName))}</span>
      <span class="tool-summary">${escapeHtml(shortText(summaryText, 120))}</span>
    </summary>
    <div class="tool-body">
      <div class="tool-section">
        <div class="tool-section-label">输出</div>
        <pre class="tool-output">${escapeHtml(output || "（无输出）")}</pre>
      </div>
    </div>
  `;
  if (images.length) {
    const section = document.createElement("div");
    section.className = "tool-section";
    const label = document.createElement("div");
    label.className = "tool-section-label";
    label.textContent = "图片";
    section.append(label, renderMessageImageStrip(images));
    details.querySelector(".tool-body")?.appendChild(section);
  }
  return details;
}

let messageRenderStructure = null;
let toolRenderStructure = null;
let messageTopSpacer = null;
let messageBottomSpacer = null;
const messageNodes = new Map();

function invalidateMessageRender() {
  messageRenderStructure = null;
  toolRenderStructure = null;
  messageNodes.clear();
  state.messageOffsetCache = null;
  state.messageHeightVersion += 1;
}

function messageStructureKey(messages) {
  return messages
    .map(
      (message, index) =>
        `${index}:${message.role}:${message.id || ""}:${message.timestamp || ""}:${message._optimistic ? "o" : ""}:${
          message._actionCount || ""
        }:${message._turn?.signature || ""}:${message._live ? "" : messageHeightSignature(message)}`,
    )
    .join("|");
}

function contentFingerprint(value) {
  const text = contentToText(value);
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return `${text.length}:${hash}`;
}

function toolStructureKey(tools) {
  return tools
    .map(
      (tool) =>
        `${tool.id}:${tool.status}:${tool.durationMs || 0}:${contentFingerprint(
          tool.partialResult?.content,
        )}:${contentFingerprint(tool.result?.content)}`,
    )
    .join("|");
}

function messageNodeKey(message, index) {
  return message.id || `${message.role}:${message.timestamp || index}`;
}

function normalizeMessageWindow(total, followLatest = false) {
  let start = state.messageWindowStart;
  let end = state.messageWindowEnd;
  const previousTotal = state.messagePreviousTotal;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
    end = total;
    start = Math.max(0, total - MESSAGE_RENDER_WINDOW);
  } else if (end > total) {
    end = total;
    start = Math.max(0, Math.min(start, end - 1));
  } else if (followLatest && total >= previousTotal) {
    end = total;
    start = Math.max(0, end - MESSAGE_RENDER_WINDOW);
  }
  if (start < 0) start = 0;
  if (end > total) end = total;
  if (end < start) end = start;
  if (end - start > MESSAGE_RENDER_MAX) start = Math.max(0, end - MESSAGE_RENDER_MAX);
  state.messageWindowStart = start;
  state.messageWindowEnd = end;
  state.messagePreviousTotal = total;
  return { start, end };
}

function isActionMessage(message) {
  return message?.role === "toolResult" || message?.role === "bashExecution";
}

function toolCallIndex(messages) {
  const calls = new Map();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const block of messageBlocks(message)) {
      if (block?.type === "toolCall" && block.id) calls.set(block.id, block);
    }
  }
  return calls;
}

function actionArgsText(value) {
  if (value == null) return "";
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return "";
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function actionArgsObject(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function actionSummary(name, args, fallback = "") {
  const lower = String(name || "").toLowerCase();
  const data = actionArgsObject(args);
  if (data) {
    if (typeof data.command === "string" && data.command.trim()) return shortText(data.command, 160);
    if (typeof data.task === "string" && data.task.trim()) return shortText(data.task, 160);
    const filePath = data.path || data.file_path;
    if (typeof filePath === "string" && filePath.trim()) {
      if (lower.includes("write") || lower.includes("edit")) {
        return shortText(filePath.split(/[\\/]/).pop() || filePath, 160);
      }
      return shortText(filePath, 160);
    }
    if (typeof data.url === "string" && data.url.trim()) return shortText(data.url, 160);
    try {
      return shortText(JSON.stringify(data), 160);
    } catch {
      return shortText(String(data), 160);
    }
  }
  return shortText(String(fallback || ""), 160);
}

function actionFromMessage(message, call = null) {
  if (message.role === "bashExecution") {
    const failed = Boolean(message.cancelled) || (message.exitCode != null && Number(message.exitCode) !== 0);
    return {
      id: message.id || `shell-${message.timestamp || ""}`,
      name: "shell",
      kind: toolKindLabel("shell"),
      summary: shortText(message.command || "", 160),
      status: failed ? "error" : "done",
      statusText: message.cancelled ? "已取消" : failed ? "失败" : "",
      sections: [
        { label: "命令", text: message.command || "" },
        { label: "输出", text: formatShellResult(message) },
      ],
    };
  }
  const name = message.toolName || call?.name || "tool";
  const output = contentToText(message.content);
  const args = call?.arguments;
  const sections = [];
  if (args != null) sections.push({ label: "参数", text: actionArgsText(args) });
  sections.push({ label: "输出", text: output || "（无输出）" });
  return {
    id: message.toolCallId || message.id || `${name}-${message.timestamp || ""}`,
    name,
    kind: toolKindLabel(name),
    summary: actionSummary(name, args, output),
    status: message.isError ? "error" : "done",
    statusText: message.isError ? "失败" : "",
    sections,
  };
}

function actionFromTool(tool) {
  const name = tool.name || "tool";
  const status = tool.status === "running" ? "running" : tool.status === "error" ? "error" : "done";
  const duration = tool.durationMs ? `${Math.round(tool.durationMs)} ms` : "";
  const output = toolOutput(tool);
  const sections = [{ label: "参数", text: actionArgsText(tool.args) || "（无参数）" }];
  if (output) sections.push({ label: status === "running" ? "实时输出" : "结果", text: output });
  return {
    id: tool.id,
    name,
    kind: toolKindLabel(name),
    summary: actionSummary(name, tool.args, output),
    status,
    statusText: status === "running" ? "运行中" : status === "error" ? "失败" : duration,
    sections,
  };
}

function persistedToolIds() {
  return new Set(
    state.messages
      .filter((message) => message.role === "toolResult" && message.toolCallId)
      .map((message) => message.toolCallId),
  );
}

function prunePersistedTools() {
  const persisted = persistedToolIds();
  for (const toolId of state.tools.keys()) {
    if (persisted.has(toolId)) state.tools.delete(toolId);
  }
}

function visibleLiveTools() {
  const persisted = persistedToolIds();
  return [...state.tools.values()].filter((tool) => !persisted.has(tool.id));
}

function liveActionGroup() {
  const tools = visibleLiveTools().sort((left, right) => left.startedAt - right.startedAt);
  if (!tools.length) return null;
  return {
    id: "live-action-group",
    role: "actionGroup",
    actions: tools,
    _actionCount: tools.length,
    _live: true,
    timestamp: tools[0]?.startedAt || 0,
  };
}

function groupActionMessages(messages, calls) {
  const groups = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!isActionMessage(message)) {
      groups.push(message);
      continue;
    }
    const first = message;
    const actions = [];
    while (index < messages.length && isActionMessage(messages[index])) {
      const action = messages[index];
      actions.push({
        message: action,
        call: action.toolCallId ? calls.get(action.toolCallId) : null,
      });
      index += 1;
    }
    index -= 1;
    groups.push({
      id: `action-group:${first.id || first.toolCallId || first.timestamp || groups.length}`,
      role: "actionGroup",
      actions,
      _actionCount: actions.length,
      timestamp: first.timestamp || 0,
    });
  }
  return groups;
}

function assistantMessageText(message) {
  return messageBlocks(message)
    .filter((block) => block?.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n\n");
}

function finalThinkingText(message) {
  return messageBlocks(message)
    .filter((block) => block?.type === "thinking" && block.thinking)
    .map((block) => block.thinking)
    .join("\n\n")
    .trim();
}

function turnDurationText(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 1000) return "";
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes} 分 ${seconds} 秒`;
  return `${seconds} 秒`;
}

function turnStepsFor(messages, calls, finalMessage) {
  const steps = [];
  for (const item of groupActionMessages(messages, calls)) {
    if (item.role === "actionGroup") {
      steps.push({ kind: "actions", group: item });
      continue;
    }
    if (item.role !== "assistant") continue;
    if (finalMessage && (item === finalMessage || (item.id && item.id === finalMessage.id))) continue;
    const text = assistantMessageText(item).trim();
    if (text) steps.push({ kind: "text", text });
  }
  return steps;
}

function buildTurnView(userMessage, messages, calls, isLastTurn, liveGroup = null) {
  const actionCount = messages.filter(isActionMessage).length + (liveGroup?.actions.length || 0);
  if (actionCount === 0) return null;
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const lastTextAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && assistantMessageText(message).trim());
  const finalMessage =
    state.streaming && isLastTurn && lastAssistant ? lastAssistant : lastTextAssistant || lastAssistant;
  const thinkingText = finalThinkingText(finalMessage);
  const steps = turnStepsFor(messages, calls, finalMessage);
  if (thinkingText) steps.unshift({ kind: "thinking", text: thinkingText });
  if (liveGroup) steps.push({ kind: "liveActions", group: liveGroup });
  const lastMessage = messages[messages.length - 1];
  const finalTimestamp =
    Math.max(lastMessage?.timestamp || 0, liveGroup?.timestamp || 0) ||
    finalMessage?.timestamp ||
    userMessage.timestamp ||
    0;
  const durationMs =
    finalTimestamp && userMessage.timestamp ? Math.max(0, finalTimestamp - userMessage.timestamp) : 0;
  const live = Boolean((state.streaming && isLastTurn) || finalMessage?._live || liveGroup);
  const finalFingerprint = finalMessage?._live ? "" : contentFingerprint(finalMessage?.content);
  const signature = `${actionCount}:${steps.length}:${finalMessage?.id || ""}:${live ? "live" : "done"}:${finalFingerprint}`;
  const view = finalMessage
    ? { ...finalMessage }
    : {
        id: `turn-final:${userMessage.id || userMessage.timestamp || "last"}`,
        role: "assistant",
        content: [],
        timestamp: finalTimestamp,
        _live: Boolean(state.streaming && isLastTurn),
      };
  view._turn = {
    id: `turn:${userMessage.id || userMessage.timestamp || "last"}`,
    actionCount,
    steps,
    durationMs,
    live,
    liveGroup,
    thinkingText,
    signature,
  };
  return view;
}

function visibleMessages() {
  const messages = state.messages.filter((message) => message.role !== "system");
  const calls = toolCallIndex(state.messages);
  const visible = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== "user") {
      visible.push(message);
      continue;
    }
    visible.push(message);
    const segment = [];
    let cursor = index + 1;
    while (cursor < messages.length && messages[cursor].role !== "user") {
      segment.push(messages[cursor]);
      cursor += 1;
    }
    index = cursor - 1;
    const isLastTurn = cursor >= messages.length;
    const turn = buildTurnView(message, segment, calls, isLastTurn, isLastTurn ? liveActionGroup() : null);
    if (turn) visible.push(turn);
    else visible.push(...segment);
  }
  return visible;
}

function compactHeightSignature(value) {
  const text = String(value ?? "");
  if (text.length <= 120) return `${text.length}:${text}`;
  return `${text.length}:${text.slice(0, 56)}:${text.slice(-56)}`;
}

function blockHeightSignature(block) {
  if (!block || typeof block !== "object") return "?";
  if (block.type === "text") return `t:${compactHeightSignature(block.text)}`;
  if (block.type === "thinking") return `k:${compactHeightSignature(block.thinking)}`;
  if (block.type === "image") return `i:${block.mimeType || ""}:${String(block.data || "").length}`;
  if (block.type === "toolCall") {
    const args = block.arguments;
    const argText =
      typeof args === "string"
        ? args
        : args && typeof args === "object"
          ? `${Object.keys(args).join(",")}:${String(args.command ?? args.path ?? args.query ?? args.file_path ?? "").length}`
          : "";
    return `c:${block.id || ""}:${compactHeightSignature(argText)}`;
  }
  return `o:${block.type || ""}`;
}

// Height cache entries are keyed by message id, so content edits that keep the
// same id need a cheap fingerprint to invalidate the stale measurement.
function messageHeightSignature(message) {
  const parts = [message.role || "", message._turn ? "turn" : ""];
  if (message.toolName) parts.push(`n:${message.toolName}`);
  if (message.isError) parts.push("err");
  if (message.cancelled) parts.push("cancelled");
  if (message.exitCode != null) parts.push(`x:${message.exitCode}`);
  if (message.command) parts.push(`cmd:${compactHeightSignature(message.command)}`);
  if (message.errorMessage) parts.push(`msg:${compactHeightSignature(message.errorMessage)}`);
  for (const block of messageBlocks(message)) parts.push(blockHeightSignature(block));
  return compactHeightSignature(parts.join("|"));
}

function messageHeightKey(message, index) {
  // Keep heights attached to messages, not slice indices, across fork/insert.
  return message.id ? `id:${message.id}` : `fallback:${messageNodeKey(message, index)}`;
}

function estimatedTextWidth(text) {
  let width = 0;
  for (const character of String(text ?? "")) {
    width += character.codePointAt(0) > 255 ? 14 : 7;
  }
  return width;
}

function estimatedTextLines(text, width = 680) {
  const lines = String(text ?? "").split("\n");
  let total = 0;
  for (const line of lines) {
    total += Math.max(1, Math.ceil(estimatedTextWidth(line) / width));
  }
  return total;
}

function estimatedWrappedLines(text, width = 500) {
  return Math.max(1, Math.ceil(estimatedTextWidth(text) / width));
}

function estimatedUserTextWidth() {
  const listWidth = Number($("messageList")?.clientWidth) || 860;
  return Math.max(240, Math.min(720, listWidth * 0.82) - 26);
}

function estimatedAssistantTextWidth() {
  const listWidth = Number($("messageList")?.clientWidth) || 860;
  return Math.max(240, Math.min(720, listWidth * 0.82));
}

function estimatedMarkdownHeight(value) {
  const source = String(value ?? "");
  const blocks = [];
  const codeFence = /```([A-Za-z0-9_+-]*)\n([\s\S]*?)```/g;
  let previousEnd = 0;
  const addTextBlocks = (text) => {
    const textWidth = estimatedAssistantTextWidth();
    const paragraphs = text
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
    for (const paragraph of paragraphs) {
      const heading = paragraph.match(/^(#{1,3})[ \t]+(.+)$/m);
      if (heading) {
        blocks.push({ height: MESSAGE_HEADING_HEIGHTS[heading[1].length] ?? 36, gap: MESSAGE_MARKDOWN_HEADING_GAP });
        continue;
      }
      if (/^[-*][ \t]+/m.test(paragraph)) {
        blocks.push({ height: estimatedTextLines(paragraph, textWidth) * MESSAGE_TEXT_LINE_HEIGHT, gap: MESSAGE_MARKDOWN_BLOCK_GAP });
        continue;
      }
      blocks.push({ height: estimatedTextLines(paragraph, textWidth) * MESSAGE_TEXT_LINE_HEIGHT, gap: MESSAGE_MARKDOWN_BLOCK_GAP });
    }
  };
  for (const match of source.matchAll(codeFence)) {
    addTextBlocks(source.slice(previousEnd, match.index));
    const isMermaid = match[1].toLowerCase() === "mermaid";
    blocks.push({
      height: isMermaid
        ? MESSAGE_MERMAID_ESTIMATED_HEIGHT
        : MESSAGE_CODE_BLOCK_OVERHEAD + Math.max(1, match[2].replace(/\n$/, "").split("\n").length) * MESSAGE_CODE_LINE_HEIGHT,
      gap: MESSAGE_CODE_BLOCK_GAP,
    });
    previousEnd = match.index + match[0].length;
  }
  addTextBlocks(source.slice(previousEnd));
  let height = 0;
  let previousBlock = null;
  for (const block of blocks) {
    if (previousBlock) height += Math.max(previousBlock.gap, block.gap);
    height += block.height;
    previousBlock = block;
  }
  return height;
}

function messageEstimatedHeight(message) {
  const blocks = messageBlocks(message);
  const imageCount = blocks.filter((block) => block?.type === "image" && block.data).length;
  if (message.role === "toolResult" || message.role === "bashExecution") {
    return MESSAGE_TOOL_RESULT_HEIGHT + MESSAGE_MARGIN_HEIGHT;
  }
  if (message.role === "user") {
    const textHeight = estimatedWrappedLines(contentToText(message.content), estimatedUserTextWidth()) * MESSAGE_TEXT_LINE_HEIGHT;
    return MESSAGE_MARGIN_HEIGHT + 41 + textHeight + imageCount * 194;
  }
  let bodyHeight = 0;
  let thinkingCount = 0;
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && block.text) bodyHeight += estimatedMarkdownHeight(block.text);
    else if (block.type === "thinking" && block.thinking) thinkingCount += 1;
  }
  if (imageCount) bodyHeight += imageCount * 194 + 7;
  if (message._live && blocks.length === 0) bodyHeight += MESSAGE_TEXT_LINE_HEIGHT;
  const errorHeight = typeof message.errorMessage === "string" && message.errorMessage.trim() ? MESSAGE_ERROR_HEIGHT : 0;
  const turnHeaderHeight = message._turn ? MESSAGE_TURN_HEADER_HEIGHT : 0;
  const visibleThinkingCount = message._turn ? 0 : thinkingCount;
  return MESSAGE_MARGIN_HEIGHT + 42 + turnHeaderHeight + bodyHeight + visibleThinkingCount * 24 + errorHeight;
}

function messageMeasuredHeight(message, index) {
  const entry = state.messageHeights.get(messageHeightKey(message, index));
  if (entry && entry.signature === messageHeightSignature(message) && entry.height > 0) {
    return entry.height;
  }
  return messageEstimatedHeight(message);
}

function messageOffsets(messages) {
  const cache = state.messageOffsetCache;
  if (
    cache &&
    cache.total === messages.length &&
    cache.version === state.messageHeightVersion
  ) {
    return cache.offsets;
  }
  const offsets = new Array(messages.length + 1);
  offsets[0] = 0;
  for (let index = 0; index < messages.length; index += 1) {
    offsets[index + 1] = offsets[index] + messageMeasuredHeight(messages[index], index);
  }
  state.messageOffsetCache = {
    total: messages.length,
    version: state.messageHeightVersion,
    offsets,
  };
  return offsets;
}

function virtualRangeForIndex(total, index) {
  const start = Math.max(
    0,
    Math.min(index - MESSAGE_RENDER_OVERSCAN, total - MESSAGE_RENDER_WINDOW),
  );
  const end = Math.min(
    total,
    start + MESSAGE_RENDER_WINDOW + MESSAGE_RENDER_OVERSCAN * 2,
  );
  return { start, end };
}

function messageIndexAtOffset(offsets, target, total) {
  if (total <= 0) return 0;
  let low = 0;
  let high = total - 1;
  let found = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle] <= target) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

function messageVirtualContentTop() {
  const list = $("messageList");
  const scroll = $("threadScroll");
  if (!list || !scroll || list.hidden) return 0;
  const paddingTop = parseFloat(getComputedStyle(list).paddingTop) || 0;
  return (
    list.getBoundingClientRect().top -
    scroll.getBoundingClientRect().top +
    scroll.scrollTop +
    paddingTop
  );
}

function ensureVirtualSpacers() {
  if (!messageTopSpacer) {
    messageTopSpacer = document.createElement("div");
    messageTopSpacer.className = "message-virtual-spacer";
    messageTopSpacer.setAttribute("aria-hidden", "true");
  }
  if (!messageBottomSpacer) {
    messageBottomSpacer = document.createElement("div");
    messageBottomSpacer.className = "message-virtual-spacer";
    messageBottomSpacer.setAttribute("aria-hidden", "true");
  }
  return { top: messageTopSpacer, bottom: messageBottomSpacer };
}

function applyVirtualSpacers(messages, start, end, total) {
  const spacers = ensureVirtualSpacers();
  const offsets = messageOffsets(messages);
  spacers.top.style.height = `${Math.max(0, Math.round(offsets[start] || 0))}px`;
  spacers.bottom.style.height = `${Math.max(0, Math.round(offsets[total] - offsets[end]))}px`;
  return offsets;
}

function measureRenderedMessages() {
  let changed = false;
  for (const element of messageNodes.values()) {
    const heightKey = element.dataset.messageHeightKey;
    if (!heightKey) continue;
    const marginBottom = parseFloat(getComputedStyle(element).marginBottom) || 0;
    const height = element.getBoundingClientRect().height + marginBottom;
    if (!Number.isFinite(height) || height <= 0) continue;
    const signature = element.dataset.messageHeightSignature || "";
    const previous = state.messageHeights.get(heightKey);
    if (
      !previous ||
      previous.signature !== signature ||
      !Number.isFinite(previous.height) ||
      Math.abs(previous.height - height) > 0.5
    ) {
      state.messageHeights.set(heightKey, { height, signature });
      changed = true;
    }
  }
  if (changed) {
    state.messageHeightVersion += 1;
    state.messageOffsetCache = null;
    persistMessageHeightsSoon();
  }
  return changed;
}


function renderMessages() {
  const list = $("messageList");
  const empty = $("threadEmpty");
  if (document.querySelector(".mermaid-block")) scheduleMermaidRender();
  const allMessages = visibleMessages();
  const total = allMessages.length;
  const layoutChanged = syncMessageHeightLayout();
  const layoutFollowLatest = layoutChanged && state.messageLayoutFollowLatest;
  const layoutAnchor = layoutChanged ? state.messageLayoutAnchor : null;
  if (layoutChanged) clearMessageLayoutAnchor();
  const nearBottom = layoutFollowLatest || isThreadNearBottom();
  const pendingTarget = state.messageVirtualTarget;
  const { start, end } = normalizeMessageWindow(
    total,
    !pendingTarget && !state.scrollRestorePending && (state.scrollOnRender || nearBottom),
  );
  updateThreadRange(start, end, total);
  const renderedMessages = allMessages.slice(start, end);
  const hasContent = total > 0 || state.tools.size > 0;

  empty.hidden = hasContent;
  list.hidden = !hasContent;
  if (!hasContent) {
    list.replaceChildren();
    $("toolList").replaceChildren();
    messageRenderStructure = "";
    toolRenderStructure = "";
    messageNodes.clear();
    state.messageVirtualTarget = null;
    state.messageVirtualAnchor = null;
    state.messageSessionKey = state.messageDataKey;
    updateScrollLatestButton();
    return;
  }

  const structure = `${start}:${end}:${total}|${messageStructureKey(renderedMessages)}`;
  const anchor =
    !pendingTarget && !state.scrollOnRender && !nearBottom
      ? layoutAnchor || captureMessageAnchor()
      : null;
  if (structure !== messageRenderStructure) {
    const spacers = ensureVirtualSpacers();
    list.replaceChildren();
    messageNodes.clear();
    list.appendChild(spacers.top);
    for (const [index, message] of renderedMessages.entries()) {
      const element = renderMessage(message);
      if (!element) continue;
      const messageIndex = start + index;
      const key = messageNodeKey(message, messageIndex);
      element.dataset.messageKey = key;
      element.dataset.messageIndex = String(messageIndex);
      element.dataset.messageHeightKey = messageHeightKey(message, messageIndex);
      element.dataset.messageHeightSignature = messageHeightSignature(message);
      list.appendChild(element);
      messageNodes.set(key, element);
    }
    list.appendChild(spacers.bottom);
    messageRenderStructure = structure;
  } else if (state.liveId) {
    const index = renderedMessages.findIndex((message) => message.id === state.liveId);
    const live = index >= 0 ? renderedMessages[index] : null;
    if (live) {
      const messageIndex = start + index;
      const key = messageNodeKey(live, messageIndex);
      const previous = messageNodes.get(key);
      if (previous && live._turn && updateLiveTurnMessage(previous, live)) {
        previous.dataset.messageKey = key;
        previous.dataset.messageIndex = String(messageIndex);
        previous.dataset.messageHeightKey = messageHeightKey(live, messageIndex);
        previous.dataset.messageHeightSignature = messageHeightSignature(live);
        messageNodes.set(key, previous);
      } else {
        const element = renderMessage(live);
        if (element) {
          element.dataset.messageKey = key;
          element.dataset.messageIndex = String(messageIndex);
          element.dataset.messageHeightKey = messageHeightKey(live, messageIndex);
          element.dataset.messageHeightSignature = messageHeightSignature(live);
          if (previous) previous.replaceWith(element);
          else list.insertBefore(element, messageBottomSpacer);
          messageNodes.set(key, element);
        }
      }
    }
  }

  const liveTurn = renderedMessages.find((message) => message._turn?.live);
  if (liveTurn && liveTurn.id !== state.liveId) {
    const messageIndex = start + renderedMessages.indexOf(liveTurn);
    const node = messageNodes.get(messageNodeKey(liveTurn, messageIndex));
    if (node) updateLiveTurnCard(node, liveTurn._turn);
  }

  applyVirtualSpacers(allMessages, start, end, total);
  if (measureRenderedMessages()) {
    applyVirtualSpacers(allMessages, start, end, total);
  }

  const toolList = $("toolList");
  const tools = liveTurn ? [] : visibleLiveTools().sort((left, right) => left.startedAt - right.startedAt);
  const toolsStructure = toolStructureKey(tools);
  if (toolsStructure !== toolRenderStructure) {
    toolList.replaceChildren();
    if (tools.length) {
      toolList.appendChild(
        renderActionGroupCard({
          id: "live-action-group",
          role: "actionGroup",
          actions: tools.map(actionFromTool),
          _actionCount: tools.length,
          _live: true,
          timestamp: tools[0]?.startedAt || 0,
        }),
      );
    }
    toolRenderStructure = toolsStructure;
  }

  const scroll = $("threadScroll");
  state.messageSessionKey = state.messageDataKey;
  if (state.messageVirtualTarget) {
    const target = state.messageVirtualTarget;
    const virtualAnchor = state.messageVirtualAnchor;
    const offsets = messageOffsets(allMessages);
    const targetIndex = Math.max(0, Math.min(total - 1, target.index));
    const targetTop =
      targetIndex === 0 ? 0 : messageVirtualContentTop() + offsets[targetIndex] + target.within;
    setThreadScrollTop(Math.max(0, Math.min(targetTop, scroll.scrollHeight)));
    if (virtualAnchor) restoreMessageAnchor(virtualAnchor);
    state.messageVirtualTarget = null;
    state.messageVirtualAnchor = null;
    state.scrollOnRender = false;
    rememberScrollPosition();
    updateScrollLatestButton();
    return;
  }
  if (state.scrollRestorePending) {
    updateScrollLatestButton();
    return;
  }
  if (state.scrollOnRender || nearBottom) {
    scrollToBottom();
    state.scrollOnRender = false;
    return;
  }
  if (anchor) restoreMessageAnchor(anchor);
  updateScrollLatestButton();
}

function visibleMessageCount() {
  return visibleMessages().length;
}

function captureMessageAnchor(preferLast = false) {
  const scroll = $("threadScroll");
  const viewport = scroll.getBoundingClientRect();
  const visible = [...document.querySelectorAll("#messageList .message")].filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.bottom > viewport.top + 1 && rect.top < viewport.bottom - 1;
  });
  if (!visible.length) return null;
  const element = preferLast ? visible[visible.length - 1] : visible[0];
  const key = element.dataset.messageKey;
  if (!key) return null;
  return {
    key,
    index: Number.isInteger(Number(element.dataset.messageIndex)) ? Number(element.dataset.messageIndex) : -1,
    offset: element.getBoundingClientRect().top - viewport.top,
  };
}

function restoreMessageAnchor(anchor) {
  if (!anchor?.key) return false;
  const element = messageNodes.get(anchor.key);
  if (!element) return false;
  const scroll = $("threadScroll");
  const delta = element.getBoundingClientRect().top - scroll.getBoundingClientRect().top - anchor.offset;
  setThreadScrollTop(scroll.scrollTop + delta);
  return true;
}

function resetMessageHeights(sessionKey = "") {
  clearMessageLayoutAnchor();
  saveActiveMessageHeights();
  state.messageHeights.clear();
  state.messageHeightSessionKey = "";
  state.messageHeightVersion += 1;
  state.messageOffsetCache = null;
  if (sessionKey) loadMessageHeightsForSession(sessionKey);
  persistMessageHeightsSoon();
}

function resetMessageWindow() {
  state.messageWindowStart = -1;
  state.messageWindowEnd = -1;
  state.messagePreviousTotal = 0;
  state.messageVirtualTarget = null;
  state.messageVirtualAnchor = null;
  state.messageVirtualFrame = 0;
}

function scrollToLatest() {
  const smooth = isThreadNearBottom();
  resetMessageWindow();
  state.scrollRestorePending = false;
  state.scrollOnRender = true;
  invalidateMessageRender();
  renderMessages();
  scrollToBottom(smooth);
}

function jumpToEarliestWindow() {
  const total = visibleMessageCount();
  if (total === 0) return;
  const range = virtualRangeForIndex(total, 0);
  state.messageWindowStart = range.start;
  state.messageWindowEnd = range.end;
  state.messagePreviousTotal = total;
  state.scrollOnRender = false;
  state.scrollRestorePending = false;
  state.messageVirtualAnchor = null;
  state.messageVirtualTarget = { index: 0, within: 0 };
  invalidateMessageRender();
  renderMessages();
}

function queueVirtualScrollRefresh() {
  if (state.messageVirtualFrame) return;
  state.messageVirtualFrame = 1;
  scheduleDomUpdate(() => {
    if (!state.messageVirtualFrame) return;
    state.messageVirtualFrame = 0;
    refreshVirtualMessageWindow();
  });
}

function refreshVirtualMessageWindow() {
  if (state.scrollRestorePending || state.scrollOnRender) return;
  const allMessages = visibleMessages();
  const total = allMessages.length;
  if (total === 0) return;
  const { start, end } = normalizeMessageWindow(total, false);
  const offsets = messageOffsets(allMessages);
  const scroll = $("threadScroll");
  const target = Math.max(0, scroll.scrollTop - messageVirtualContentTop());
  const index = messageIndexAtOffset(offsets, target, total);
  if (index >= start + MESSAGE_RENDER_OVERSCAN && index < end - MESSAGE_RENDER_OVERSCAN) return;
  const next = virtualRangeForIndex(total, index);
  if (next.start === start && next.end === end) return;
  state.messageWindowStart = next.start;
  state.messageWindowEnd = next.end;
  state.messagePreviousTotal = total;
  state.messageVirtualAnchor = captureMessageAnchor();
  state.messageVirtualTarget = {
    index,
    within: Math.max(0, target - offsets[index]),
  };
  state.scrollOnRender = false;
  renderMessages();
}

function maybeShiftMessageWindow() {
  queueVirtualScrollRefresh();
}

function toolSummary(tool) {
  const args = tool.args ?? {};
  if (typeof args === "string") return shortText(args, 140);
  if (args.command) return shortText(args.command, 140);
  if (args.path) return shortText(args.path, 140);
  if (args.file_path) return shortText(args.file_path, 140);
  if (args.url) return shortText(args.url, 140);
  return shortText(JSON.stringify(args), 140);
}

function toolOutput(tool) {
  if (tool.result) {
    const text = contentToText(tool.result.content);
    if (text) return text;
    return JSON.stringify(tool.result, null, 2);
  }
  if (tool.partialResult) {
    const text = contentToText(tool.partialResult.content);
    if (text) return text;
    return JSON.stringify(tool.partialResult, null, 2);
  }
  return "";
}

function renderToolCard(tool) {
  const details = document.createElement("details");
  details.className = "tool-card";
  const statusClass = tool.status === "running" ? "running" : tool.status === "error" ? "error" : "";
  const duration = tool.durationMs ? `${Math.round(tool.durationMs)} ms` : "";
  const args = typeof tool.args === "string" ? tool.args : JSON.stringify(tool.args ?? {}, null, 2);
  const output = toolOutput(tool);
  details.innerHTML = `
    <summary>
      <span class="tool-status ${statusClass}"></span>
      <span class="tool-name">${escapeHtml(tool.name)}</span>
      <span class="tool-kind">${escapeHtml(toolKindLabel(tool.name))}</span>
      <span class="tool-summary">${escapeHtml(toolSummary(tool))}</span>
      <span class="tool-duration">${escapeHtml(duration)}</span>
    </summary>
    <div class="tool-body">
      <div class="tool-section">
        <div class="tool-section-label">参数</div>
        <pre class="tool-output">${escapeHtml(args)}</pre>
      </div>
      ${
        output
          ? `<div class="tool-section">
        <div class="tool-section-label">${tool.status === "running" ? "实时输出" : "结果"}</div>
        <pre class="tool-output">${escapeHtml(output)}</pre>
      </div>`
          : ""
      }
    </div>
  `;
  return details;
}

function sessionGroupLabel(session) {
  if (session.pinned) return "置顶";
  const updated = new Date(session.updatedAt);
  if (Number.isNaN(updated.getTime())) return "更早";
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfUpdated = new Date(updated.getFullYear(), updated.getMonth(), updated.getDate());
  const days = Math.floor((startOfToday - startOfUpdated) / 86_400_000);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return "本周";
  return "更早";
}

function orderedSessionsByManualOrder() {
  const orderIndex = new Map(state.sessionOrder.map((sessionPath, index) => [sessionPath, index]));
  return [...state.sessions].sort((left, right) => {
    const pinnedDelta = Number(right.pinned) - Number(left.pinned);
    if (pinnedDelta) return pinnedDelta;
    const leftOrder = orderIndex.get(left.path);
    const rightOrder = orderIndex.get(right.path);
    if (leftOrder !== undefined || rightOrder !== undefined) {
      return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER);
    }
    return String(right.updatedAt).localeCompare(String(left.updatedAt));
  });
}

function sortSessionsLocally() {
  state.sessions = orderedSessionsByManualOrder();
}

function ensureSessionOrderComplete() {
  state.sessionOrder = orderedSessionsByManualOrder().map((session) => session.path);
}

function sessionSortRowHtml(session, position) {
  const active = state.session?.sessionFile === session.path;
  const previewText = session.preview || session.cwd || "暂无消息";
  return `<div class="session-row session-sort-row${active ? " active" : ""}" data-sort-session="${escapeHtml(
    session.path,
  )}" data-sort-group="${session.pinned ? "pinned" : "recent"}">
    <span class="session-drag-handle" draggable="true" tabindex="0" role="button" title="拖动调整顺序，或用 Alt+↑ / Alt+↓" aria-label="拖动调整顺序">≡</span>
    <button class="session-item${active ? " active" : ""}" data-session="${escapeHtml(session.path)}" type="button">
      <div class="session-item-top">
        <span class="session-title">${escapeHtml(session.name)}</span>
        <span class="session-time">${escapeHtml(timeLabel(session.updatedAt))}</span>
      </div>
      <span class="session-preview">${escapeHtml(previewText)}</span>
    </button>
    <span class="session-sort-position">${position + 1}</span>
  </div>`;
}

function renderSessionSortMode(list) {
  const ordered = orderedSessionsByManualOrder();
  const groups = [
    { label: "置顶会话", pinned: true },
    { label: "最近会话", pinned: false },
  ];
  const body = groups
    .map((group) => {
      const sessions = ordered.filter((session) => session.pinned === group.pinned);
      if (!sessions.length) return "";
      return `<div class="session-group-head"><span>${group.label}</span><span class="section-count">${sessions.length}</span></div>${sessions
        .map((session, index) => sessionSortRowHtml(session, index))
        .join("")}`;
    })
    .join("");
  list.innerHTML = `<div class="session-sort-bar"><span>拖动 ≡ 调整顺序，自动保存</span><div class="session-sort-actions"><button class="popover-cycle" data-reset-session-order type="button">恢复默认</button><button class="popover-cycle primary" data-exit-session-sort type="button">完成</button></div></div>${
    body || '<div class="sidebar-empty">暂无任务</div>'
  }`;
}

async function persistSessionOrder(order) {
  const previous = state.sessionOrder;
  state.sessionOrder = order;
  sortSessionsLocally();
  renderSessions();
  try {
    const response = await window.pispider.setSessionOrder(order);
    if (Array.isArray(response?.order)) state.sessionOrder = response.order;
  } catch (error) {
    state.sessionOrder = previous;
    sortSessionsLocally();
    renderSessions();
    showToast(error.message || "保存排序失败", "error");
  }
}

function commitSessionGroupOrder(pinned, paths) {
  const ordered = orderedSessionsByManualOrder();
  const pinnedPaths = pinned ? paths : ordered.filter((session) => session.pinned).map((session) => session.path);
  const recentPaths = pinned ? ordered.filter((session) => !session.pinned).map((session) => session.path) : paths;
  void persistSessionOrder([...pinnedPaths, ...recentPaths]);
}

function reorderSessionOrder(draggedPath, targetPath, placeAfter) {
  if (!draggedPath || !targetPath || draggedPath === targetPath) return;
  const ordered = orderedSessionsByManualOrder();
  const target = ordered.find((session) => session.path === targetPath);
  const dragged = ordered.find((session) => session.path === draggedPath);
  if (!target || !dragged || Boolean(target.pinned) !== Boolean(dragged.pinned)) return;
  const paths = ordered
    .filter((session) => Boolean(session.pinned) === Boolean(target.pinned) && session.path !== draggedPath)
    .map((session) => session.path);
  const targetIndex = paths.indexOf(targetPath);
  if (targetIndex < 0) return;
  paths.splice(placeAfter ? targetIndex + 1 : targetIndex, 0, draggedPath);
  commitSessionGroupOrder(Boolean(target.pinned), paths);
}

function moveSessionByStep(sessionPath, offset) {
  const ordered = orderedSessionsByManualOrder();
  const session = ordered.find((entry) => entry.path === sessionPath);
  if (!session) return;
  const paths = ordered
    .filter((entry) => Boolean(entry.pinned) === Boolean(session.pinned))
    .map((entry) => entry.path);
  const index = paths.indexOf(sessionPath);
  const next = index + offset;
  if (index < 0 || next < 0 || next >= paths.length) return;
  paths.splice(index, 1);
  paths.splice(next, 0, sessionPath);
  commitSessionGroupOrder(Boolean(session.pinned), paths);
}

function toggleSessionSortMode() {
  if (state.sessionSortMode) {
    state.sessionSortMode = false;
    renderSessions();
    return;
  }
  if (state.search.trim()) {
    showToast("请先清空搜索再调整会话顺序", "warning");
    return;
  }
  ensureSessionOrderComplete();
  state.sessionSortMode = true;
  state.confirmDeleteSession = "";
  renderSessions();
}

async function resetSessionOrder() {
  const previous = state.sessionOrder;
  state.sessionOrder = [];
  try {
    await window.pispider.setSessionOrder([]);
  } catch (error) {
    state.sessionOrder = previous;
    sortSessionsLocally();
    renderSessions();
    showToast(error.message || "恢复默认排序失败", "error");
    return;
  }
  sortSessionsLocally();
  renderSessions();
  showToast("已恢复默认排序");
}

function clearSessionDragState() {
  state.sessionDragPath = "";
  for (const row of document.querySelectorAll(
    ".session-sort-row.dragging, .session-sort-row.drop-before, .session-sort-row.drop-after",
  )) {
    row.classList.remove("dragging", "drop-before", "drop-after");
  }
}

function sessionDropAfter(event, row) {
  const rect = row.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function searchHighlightTerms(query) {
  const text = String(query || "").trim();
  if (!text || /^re:/iu.test(text)) return [];
  const terms = [];
  const matcher = /"([^"]+)"|(\S+)/gu;
  let match;
  while ((match = matcher.exec(text))) terms.push(match[1] ?? match[2]);
  const meaningful = terms.filter((term) => term.length > 1);
  return meaningful.length ? meaningful : terms.filter(Boolean);
}

function highlightText(value, query) {
  const text = String(value ?? "");
  const raw = String(query || "").trim();
  if (!raw) return escapeHtml(text);
  let pattern = null;
  if (/^re:/iu.test(raw)) {
    try {
      pattern = new RegExp(raw.slice(3), "gi");
    } catch {
      return escapeHtml(text);
    }
  } else {
    const terms = searchHighlightTerms(raw);
    if (!terms.length) return escapeHtml(text);
    pattern = new RegExp(terms.map(escapeRegExp).join("|"), "gi");
  }
  let cursor = 0;
  let html = "";
  for (const match of text.matchAll(pattern)) {
    if (!match[0]) continue;
    html += escapeHtml(text.slice(cursor, match.index));
    html += `<mark class="search-hit">${escapeHtml(match[0])}</mark>`;
    cursor = match.index + match[0].length;
  }
  return html + escapeHtml(text.slice(cursor));
}

function sessionRowHtml(session, index, searchResult = null) {
  const active = state.session?.sessionFile === session.path;
  const searchActive = Number.isInteger(index) && index === state.sessionSearchActive;
  const confirming = state.confirmDeleteSession === session.path;
  const previewText = searchResult?.snippet || session.preview || session.cwd || "暂无消息";
  const matchField = searchResult?.matchField
    ? `<span class="session-match-field">${escapeHtml(searchResult.matchField)}</span>`
    : "";
  return `
      <div class="session-row ${active ? "active" : ""} ${session.pinned ? "pinned" : ""} ${
        confirming ? "confirming" : ""
      } ${searchActive ? "search-active" : ""}">
        <button class="session-item ${active ? "active" : ""}" data-session="${escapeHtml(
          session.path,
        )}" ${Number.isInteger(index) ? `data-search-index="${index}"` : ""} type="button">
          <div class="session-item-top">
            <span class="session-title">${highlightText(session.name, state.search)}</span>
            <span class="session-time">${escapeHtml(timeLabel(session.updatedAt))}</span>
          </div>
          <span class="session-preview ${searchResult ? "search-preview" : ""}">${matchField}${highlightText(
            previewText,
            state.search,
          )}</span>
        </button>
        <button class="session-pin ${session.pinned ? "on" : ""}" data-pin-session="${escapeHtml(
          session.path,
        )}" type="button" title="${session.pinned ? "取消置顶" : "置顶会话"}" aria-label="${
          session.pinned ? "取消置顶" : "置顶会话"
        }">${session.pinned ? "★" : "☆"}</button>
        ${
          active
            ? ""
            : confirming
              ? `<div class="session-delete-confirm">
          <span>删除？</span>
          <button data-confirm-delete="${escapeHtml(session.path)}" type="button">删除</button>
          <button data-cancel-delete="${escapeHtml(session.path)}" type="button">取消</button>
        </div>`
              : `<button class="session-delete" data-delete-session="${escapeHtml(
                  session.path,
                )}" type="button" title="删除会话" aria-label="删除会话">×</button>`
        }
      </div>
    `;
}

function sessionSearchSummaryHtml(count) {
  const total = Number(state.sessionSearchTotal || count);
  const countLabel = state.sessionSearching
    ? "搜索中…"
    : total > count
      ? `${count} / ${total} 个匹配`
      : `${count} 个匹配`;
  return `<div class="session-search-summary">
    <span>${countLabel}</span>
    <div class="session-search-sort" role="group" aria-label="搜索结果排序">
      <button data-search-sort="relevance" class="${state.sessionSearchSort === "relevance" ? "active" : ""}" type="button">相关度</button>
      <button data-search-sort="recent" class="${state.sessionSearchSort === "recent" ? "active" : ""}" type="button">最近</button>
    </div>
  </div>`;
}

function resetSessionSearch() {
  sessionSearchRequest += 1;
  state.sessionSearchResults = [];
  state.sessionSearchTotal = 0;
  state.sessionSearching = false;
  state.sessionSearchError = "";
  state.sessionSearchActive = -1;
}

function scheduleSessionSearch(delay = 220) {
  clearTimeout(sessionSearchTimer);
  sessionSearchRequest += 1;
  const query = state.search.trim();
  if (!query) {
    resetSessionSearch();
    renderSessions();
    return;
  }
  state.sessionSearching = true;
  state.sessionSearchError = "";
  renderSessions();
  sessionSearchTimer = setTimeout(() => {
    void runSessionSearch(query);
  }, delay);
}

async function runSessionSearch(query = state.search.trim()) {
  const request = ++sessionSearchRequest;
  if (!query) {
    resetSessionSearch();
    renderSessions();
    return;
  }
  state.sessionSearching = true;
  state.sessionSearchError = "";
  renderSessions();
  try {
    const result = await window.pispider.searchSessions(query, state.sessionSearchSort);
    if (request !== sessionSearchRequest || query !== state.search.trim()) return;
    if (!result?.ok) {
      state.sessionSearchResults = [];
      state.sessionSearchTotal = 0;
      state.sessionSearchError = result?.error || "搜索失败";
    } else {
      state.sessionSearchResults = Array.isArray(result.items) ? result.items : [];
      state.sessionSearchTotal = Number(result.total || state.sessionSearchResults.length);
      state.sessionSearchError = "";
    }
  } catch (error) {
    if (request !== sessionSearchRequest || query !== state.search.trim()) return;
    state.sessionSearchResults = [];
    state.sessionSearchTotal = 0;
    state.sessionSearchError = error.message;
  }
  if (request !== sessionSearchRequest) return;
  state.sessionSearching = false;
  state.sessionSearchActive = -1;
  renderSessions();
}

function renderSessions() {
  const list = $("sessionList");
  const query = state.search.trim();
  $("sessionCount").textContent = String(state.sessions.length);
  $("sortSessionsButton")?.classList.toggle("active", state.sessionSortMode);

  if (!query && state.sessionSortMode) {
    state.sessionSearchActive = -1;
    renderSessionSortMode(list);
    return;
  }

  if (!query) {
    state.sessionSearchActive = -1;
    const filtered = state.sessions;
    if (filtered.length === 0) {
      list.innerHTML = `<div class="sidebar-empty">暂无任务</div>`;
      return;
    }
    const groups = new Map();
    for (const session of filtered) {
      const label = sessionGroupLabel(session);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(session);
    }
    list.innerHTML = [...groups.entries()]
      .map(
        ([label, sessions]) => `
      <div class="session-group-head">
        <span>${label}</span>
        <span class="section-count">${sessions.length}</span>
      </div>
      ${sessions.map(sessionRowHtml).join("")}
    `,
      )
      .join("");
    return;
  }

  if (state.sessionSearchError) {
    list.innerHTML = `<div class="sidebar-empty search-error">${escapeHtml(state.sessionSearchError)}</div>`;
    return;
  }

  const results = state.sessionSearchResults;
  if (state.sessionSearching && results.length === 0) {
    list.innerHTML = `<div class="sidebar-empty">搜索中…</div>`;
    return;
  }
  if (results.length === 0) {
    list.innerHTML = `<div class="sidebar-empty">${state.sessions.length === 0 ? "暂无任务" : "没有匹配的任务或消息"}</div>`;
    return;
  }

  if (state.sessionSearchActive >= results.length) state.sessionSearchActive = results.length - 1;
  list.innerHTML =
    sessionSearchSummaryHtml(results.length) +
    results.map((result, index) => sessionRowHtml(result.session, index, result)).join("");
}

function relativeCodePath(targetPath) {
  return displayPath(targetPath).split(/[\\/]/).filter(Boolean).join("/");
}

function codeCrumbs(targetPath) {
  const root = state.info?.repoRoot ? basename(state.info.repoRoot) : "";
  const parts = [root, ...relativeCodePath(targetPath).split("/").filter(Boolean)].filter(Boolean);
  return parts
    .map((part, index) => `<span class="${index === parts.length - 1 ? "code-crumb-current" : ""}">${escapeHtml(part)}</span>`)
    .join('<span class="code-crumb-sep">›</span>');
}

function codeEntries() {
  const changes = [...state.changes.values()].sort((left, right) => right.at - left.at);
  if (state.openCodeFile && !state.changes.has(state.openCodeFile.path)) {
    return [state.openCodeFile, ...changes];
  }
  return changes;
}

function activeCodeEntry() {
  const entries = codeEntries();
  if (state.activeCodePath) {
    const found = entries.find((entry) => entry.path === state.activeCodePath);
    if (found) return found;
  }
  return entries[0] || null;
}

function codeLanguage(targetPath) {
  const ext = String(targetPath).split(".").pop()?.toLowerCase() || "";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "css") return "css";
  if (ext === "md") return "md";
  if (ext === "json") return "json";
  if (ext === "ts" || ext === "tsx") return "ts";
  return "js";
}

function renderCodeTabs(activePath) {
  return codeEntries()
    .map((entry) => {
      const active = entry.path === activePath;
      const stats =
        entry.tool === "read"
          ? `<span class="code-file-badge">只读</span>`
          : `<span class="code-file-added">+${entry.added ?? 0}</span><span class="code-file-removed">-${entry.removed ?? 0}</span>`;
      return `
        <button class="code-file-tab ${active ? "active" : ""}" data-code-path="${escapeHtml(entry.path)}" type="button">
          <span class="code-file-icon">${codeLanguage(entry.path)}</span>
          <span class="code-file-name">${escapeHtml(basename(entry.path))}</span>
          ${stats}
        </button>
      `;
    })
    .join("");
}

function renderCodeLines(entry) {
  const source = String(entry.content ?? entry.patch ?? "");
  const isDiff = entry.content === undefined || entry.content === null;
  const lines = source ? source.split("\n") : [""];
  const visible = lines.slice(0, 2400);
  const rows = visible
    .map((line, index) => {
      const kind = isDiff
        ? line.startsWith("+")
          ? "added"
          : line.startsWith("-")
            ? "removed"
            : line.startsWith("@@")
              ? "hunk"
              : ""
        : "";
      return `<div class="code-line ${kind}"><span class="code-ln">${index + 1}</span><span class="code-text">${escapeHtml(
        line || " ",
      )}</span></div>`;
    })
    .join("");
  const more = lines.length > visible.length ? `<div class="code-more">已截断，仅显示前 ${visible.length} 行</div>` : "";
  return `<div class="code-scroll"><div class="code-lines">${rows}</div>${more}</div>`;
}

function renderChanges() {
  const entry = activeCodeEntry();
  if (!entry) {
    const changes = state.projectChanges;
    const files = Array.isArray(changes?.files) ? changes.files.slice(0, 40) : [];
    const sourceLabel = changes?.source === "git" ? `Git 更改${changes.branch ? ` · ${changes.branch}` : ""}` : "项目最近修改";
    const fileList = files.length
      ? `<div class="project-change-head"><span>${escapeHtml(sourceLabel)}</span><button class="hint-button" data-refresh-project type="button">刷新</button></div><div class="project-change-list">${files
          .map(
            (file) =>
              `<button class="project-change-item" type="button" data-project-path="${escapeHtml(file.path)}"><span class="project-change-path">${escapeHtml(
                file.path,
              )}</span>${file.status ? `<span class="project-change-status">${escapeHtml(file.status)}</span>` : ""}</button>`,
          )
          .join("")}</div>`
      : `<div class="project-change-head"><span>${escapeHtml(sourceLabel)}</span><button class="hint-button" data-refresh-project type="button">刷新</button></div><div class="code-empty-note">当前目录没有可显示的项目文件。</div>`;
    return `
      <div class="code-empty">
        <div class="code-empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
            <path d="M8.5 4.5h7l3 3v12h-10z" stroke="currentColor" stroke-width="1.3"/>
            <path d="M9 10h6M9 13h6M9 16h3.5" stroke="currentColor" stroke-width="1.1"/>
          </svg>
        </div>
        <div class="code-empty-title">打开项目文件查看内容</div>
        <button class="code-open-button" data-open-file type="button">打开项目文件</button>
        ${fileList}
      </div>
    `;
  }

  return `
    <div class="code-shell">
      <div class="code-tabbar">
        ${renderCodeTabs(entry.path)}
        <button class="code-open-file" data-open-file type="button" title="打开项目文件">+</button>
      </div>
      <div class="code-pathbar">
        <div class="code-crumbs">${codeCrumbs(entry.path)}</div>
        <div class="code-actions">
          <button class="code-action" data-refresh-code="${escapeHtml(entry.path)}" type="button">刷新</button>
          <button class="code-action" data-open-path="${escapeHtml(entry.path)}" type="button">打开</button>
        </div>
      </div>
      <div class="code-main">${renderCodeLines(entry)}</div>
      <div class="code-status">
        <span>${entry.tool === "read" ? "只读预览" : entry.tool === "write" ? "写入文件" : "修改文件"}</span>
        <span class="code-status-right">
          ${
            entry.tool === "read"
              ? `${entry.lines ?? 0} 行`
              : `<span class="code-status-added">+${entry.added ?? 0}</span><span class="code-status-removed">-${entry.removed ?? 0}</span>`
          }
        </span>
      </div>
    </div>
  `;
}

function displayPath(targetPath) {
  const root = state.info?.repoRoot;
  if (root && targetPath.startsWith(root)) {
    return targetPath.slice(root.length).replace(/^[\\/]/, "");
  }
  return targetPath;
}

function countLines(value) {
  const text = String(value ?? "");
  return text ? text.split("\n").length : 0;
}

function parseToolArgs(tool) {
  if (!tool?.args) return {};
  if (typeof tool.args === "object") return tool.args;
  try {
    return JSON.parse(tool.args);
  } catch {
    return {};
  }
}

function recordChange(tool) {
  if (tool.name !== "write" && tool.name !== "edit") return;
  const args = parseToolArgs(tool);
  const target = args.path || args.file_path;
  if (!target) return;

  const edits = Array.isArray(args.edits)
    ? args.edits
    : args.oldText !== undefined || args.newText !== undefined
      ? [{ oldText: args.oldText, newText: args.newText }]
      : [];
  let added = 0;
  let removed = 0;
  let patch = "";

  if (tool.name === "write") {
    const content = String(args.content ?? "");
    added = countLines(content);
    patch = content
      .split("\n")
      .slice(0, 120)
      .map((line) => `+ ${line}`)
      .join("\n");
  } else {
    edits.forEach((edit, index) => {
      const oldText = String(edit?.oldText ?? "");
      const newText = String(edit?.newText ?? "");
      removed += countLines(oldText);
      added += countLines(newText);
      const oldLines = oldText.split("\n").slice(0, 60).map((line) => `- ${line}`).join("\n");
      const newLines = newText.split("\n").slice(0, 60).map((line) => `+ ${line}`).join("\n");
      patch += `${index > 0 ? "\n\n" : ""}@@ 修改 ${index + 1} @@\n${oldLines}${oldLines && newLines ? "\n" : ""}${newLines}`;
    });
  }

  if (patch.length > 6000) patch = `${patch.slice(0, 6000)}\n...`;

  const previous = state.changes.get(target);
  state.changes.set(target, {
    path: target,
    relative: displayPath(target),
    tool: tool.name,
    at: Date.now(),
    added: (previous?.added ?? 0) + added,
    removed: (previous?.removed ?? 0) + removed,
    patch: patch || "无文本差异。",
    content: previous?.content,
    lines: previous?.lines,
  });
  state.activeCodePath = target;
  hydrateCodeEntry(target);
}

async function hydrateCodeEntry(targetPath) {
  const entry = state.changes.get(targetPath);
  if (!entry) return;
  try {
    const data = await window.pispider.readProjectFile(targetPath);
    entry.content = data.text;
    entry.relative = data.relative;
    entry.lines = data.lines;
    scheduleRender();
  } catch {
    // Fall back to the write/edit patch when the file cannot be read.
  }
}

async function openCodePath(targetPath) {
  try {
    const data = await window.pispider.readProjectFile(targetPath);
    state.openCodeFile = {
      path: data.path,
      relative: data.relative,
      content: data.text,
      lines: data.lines,
      tool: "read",
      at: Date.now(),
    };
    state.activeCodePath = data.path;
    if (state.rightTab !== "changes") setRightTab("changes");
    else scheduleRender();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function refreshActiveCode() {
  const entry = activeCodeEntry();
  if (!entry) return;
  if (entry.tool === "read") {
    await openCodePath(entry.path);
    return;
  }
  await hydrateCodeEntry(entry.path);
}

function handleCodeAction(event) {
  const projectFile = event.target.closest("[data-project-path]");
  if (projectFile) {
    openCodePath(projectFile.dataset.projectPath);
    return;
  }
  const refreshProject = event.target.closest("[data-refresh-project]");
  if (refreshProject) {
    refreshProjectChanges();
    return;
  }
  const fileTab = event.target.closest("[data-code-path]");
  if (fileTab) {
    state.activeCodePath = fileTab.dataset.codePath;
    scheduleRender();
    return;
  }
  if (event.target.closest("[data-open-file]")) {
    window.pispider
      .pickCodeFile()
      .then((targetPath) => (targetPath ? openCodePath(targetPath) : null))
      .catch((error) => showToast(error.message, "error"));
    return;
  }
  const refresh = event.target.closest("[data-refresh-code]");
  if (refresh) {
    refreshActiveCode();
    return;
  }
  const open = event.target.closest("[data-open-path]");
  if (open?.dataset.openPath) {
    window.pispider.openPath(open.dataset.openPath).catch((error) => showToast(error.message, "error"));
  }
}

function renderContext() {
  const browserActive = state.rightTab !== "changes";
  $("contextBody").classList.toggle("browser-active", browserActive);
  $("contextBody").classList.toggle("code-active", !browserActive);
  $("browserView").hidden = !browserActive;
  $("changesView").hidden = browserActive;
  if (browserActive) return;

  $("changesBody").innerHTML = renderChanges();
}

function renderAll() {
  renderHeader();
  renderSessions();
  renderAttachments();
  renderMessages();
  renderQueue();
  renderContext();
}

function normalizeMessage(message) {
  if (!message || typeof message !== "object") return null;
  if (!message.role) return null;
  return message;
}

function findMessageIndex(predicate) {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    if (predicate(state.messages[index])) return index;
  }
  return -1;
}

function addOptimisticMessage(text) {
  const id = `optimistic-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  resetMessageWindow();
  state.scrollRestorePending = false;
  state.messages.push({
    id,
    role: "user",
    content: text,
    _optimistic: true,
    timestamp: Date.now(),
  });
  state.scrollOnRender = true;
  return id;
}

function removeOptimisticMessage(id) {
  state.messages = state.messages.filter((message) => message.id !== id);
}

function updateLiveAssistant(update) {
  const index = state.liveId
    ? state.messages.findIndex((message) => message.id === state.liveId)
    : findMessageIndex((message) => message._live);
  if (index < 0) return;
  const live = state.messages[index];
  const event = update.assistantMessageEvent;
  if (!event) return;

  if (event.type === "text_delta" && event.delta) {
    const block = ensureBlock(live, event.contentIndex, "text");
    block.text = (block.text ?? "") + event.delta;
  } else if (event.type === "text_end" && event.content) {
    const block = ensureBlock(live, event.contentIndex, "text");
    block.text = event.content;
  } else if (event.type === "thinking_delta" && event.delta) {
    const block = ensureBlock(live, event.contentIndex, "thinking");
    block.thinking = (block.thinking ?? "") + event.delta;
  } else if (event.type === "thinking_end" && event.content) {
    const block = ensureBlock(live, event.contentIndex, "thinking");
    block.thinking = event.content;
  } else if (event.type === "toolcall_start") {
    const block = ensureBlock(live, event.contentIndex, "toolCall");
    block.id = event.id;
    block.name = event.toolName;
    block.arguments = "";
  } else if (event.type === "toolcall_delta") {
    const block = ensureBlock(live, event.contentIndex, "toolCall");
    block.arguments = (block.arguments ?? "") + (event.delta ?? "");
  } else if (event.type === "toolcall_end" && event.toolCall) {
    const block = ensureBlock(live, event.contentIndex, "toolCall");
    block.id = event.toolCall.id;
    block.name = event.toolCall.name;
    block.arguments = event.toolCall.arguments;
  } else if (event.type === "error") {
    showToast(event.error || "The model stream returned an error.", "error");
  }
}

function ensureBlock(message, index, type) {
  if (!Array.isArray(message.content)) message.content = [];
  if (!message.content[index] || message.content[index].type !== type) {
    message.content[index] = { type };
  }
  return message.content[index];
}

function handleToolStart(event) {
  const tool = {
    id: event.toolCallId,
    name: event.toolName,
    args: event.args ?? {},
    status: "running",
    partialResult: null,
    result: null,
    startedAt: Date.now(),
    durationMs: null,
  };
  state.tools.set(tool.id, tool);
  scheduleRender();
}

function handleToolEnd(event) {
  const tool = state.tools.get(event.toolCallId);
  if (!tool) {
    handleToolStart(event);
  }
  const current = state.tools.get(event.toolCallId);
  current.status = event.isError ? "error" : "done";
  current.result = event.result;
  current.durationMs = event.durationMs ?? Date.now() - current.startedAt;

  if (event.toolName === "write" || event.toolName === "edit") {
    if (!event.isError) recordChange(current);
  }
  scheduleRender();
}

function handleEvent(event) {
  if (!event || typeof event !== "object") return;
  switch (event.type) {
    case "agent_start":
      state.streaming = true;
      setStatus("running", "Agent 正在工作");
      break;
    case "agent_end":
      break;
    case "agent_settled":
      state.streaming = false;
      state.queueCount = 0;
      state.queueSteering = [];
      state.queueFollowUp = [];
      state.liveId = null;
      setStatus("ready", "");
      refreshFromAgent();
      refreshSessions();
      refreshResources();
      break;
    case "message_start": {
      const followLatest = isThreadNearBottom();
      const message = normalizeMessage(event.message);
      if (!message) break;
      if (message.role === "user") {
        const optimistic = findMessageIndex((item) => item._optimistic);
        if (optimistic >= 0) state.messages.splice(optimistic, 1);
        state.messages.push(message);
      } else if (message.role === "assistant") {
        const live = { ...message, content: Array.isArray(message.content) ? [...message.content] : [], _live: true };
        state.liveId = `live-${Date.now()}`;
        live.id = state.liveId;
        state.messages.push(live);
      } else if (message.role === "toolResult") {
        // Tool cards come from tool_execution_* events; keep the final message
        // only when get_messages restores the session later.
      }
      if (followLatest) state.scrollOnRender = true;
      scheduleRender();
      break;
    }
    case "message_update":
      updateLiveAssistant(event);
      scheduleRender();
      break;
    case "message_end": {
      const followLatest = isThreadNearBottom();
      const message = normalizeMessage(event.message);
      if (!message) break;
      if (message.role === "assistant") {
        const index = state.liveId
          ? state.messages.findIndex((item) => item.id === state.liveId)
          : findMessageIndex((item) => item._live);
        if (index >= 0) state.messages[index] = message;
        else state.messages.push(message);
        state.liveId = null;
        invalidateMessageRender();
      } else if (message.role === "user") {
        const last = findMessageIndex((item) => item._optimistic);
        if (last >= 0) state.messages.splice(last, 1);
        if (!state.messages.some((item) => item.role === "user" && item.timestamp === message.timestamp)) {
          state.messages.push(message);
        }
      }
      if (followLatest) state.scrollOnRender = true;
      scheduleRender();
      break;
    }
    case "tool_execution_start":
      handleToolStart(event);
      break;
    case "tool_execution_update": {
      const tool = state.tools.get(event.toolCallId);
      if (tool) {
        tool.partialResult = event.partialResult;
        scheduleRender();
      }
      break;
    }
    case "bash_execution_update": {
      const tool = [...state.tools.values()].find((item) => item.name === "shell" && item.status === "running");
      if (tool) {
        tool.streamText = (tool.streamText || "") + String(event.delta || "");
        tool.partialResult = { content: [{ type: "text", text: tool.streamText }] };
        scheduleRender();
      }
      break;
    }
    case "tool_execution_end":
      handleToolEnd(event);
      break;
    case "session_start":
      state.sessionStats = null;
      state.sessionStatsError = "";
      $("threadStatsPopover").hidden = true;
      resetMessageHeights();
      resetMessageWindow();
      refreshFromAgent();
      refreshSessions();
      break;
    case "session_info_changed":
      if (state.session) state.session.sessionName = event.name;
      refreshSessions();
      scheduleRender();
      break;
    case "queue_update":
      state.queueSteering = Array.isArray(event.steering) ? event.steering.filter(Boolean) : [];
      state.queueFollowUp = Array.isArray(event.followUp) ? event.followUp.filter(Boolean) : [];
      state.queueCount = state.queueSteering.length + state.queueFollowUp.length;
      scheduleRender();
      break;
    case "extension_error":
      showToast(`${event.extensionPath || "Extension"}: ${event.error}`, "error");
      break;
    case "compaction_start":
      setStatus("running", "正在压缩上下文");
      break;
    case "compaction_end":
      setStatus(state.streaming ? "running" : "ready", "");
      refreshThreadStats();
      break;
    case "auto_retry_start":
      setStatus("running", `正在重试（${event.attempt}/${event.maxAttempts}）`);
      break;
    case "extension_ui_request":
      handleExtensionUiRequest(event);
      break;
    default:
      break;
  }
}

async function refreshSessions() {
  try {
    const [sessions, orderResponse] = await Promise.all([
      window.pispider.listSessions(),
      window.pispider.getSessionOrder().catch(() => ({ order: [] })),
    ]);
    state.sessions = Array.isArray(sessions) ? sessions : [];
    state.sessionOrder = Array.isArray(orderResponse?.order) ? orderResponse.order : [];
    scheduleRender();
    if (state.search.trim()) scheduleSessionSearch(100);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function refreshResources() {
  try {
    const [ruleData, skills, mcp, extensionData] = await Promise.all([
      window.pispider.listRules(),
      window.pispider.listSkills(),
      window.pispider.listMcp(),
      window.pispider.listExtensions().catch(() => ({ extensions: [] })),
    ]);
    state.rules = ruleData?.rules ?? [];
    state.skills = skills ?? [];
    state.mcpServers = mcp?.servers ?? [];
    state.extensions = extensionData?.extensions ?? [];
    scheduleRender();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function refreshProjectChanges() {
  try {
    state.projectChanges = await window.pispider.getProjectChanges();
    scheduleRender();
  } catch {
    state.projectChanges = { source: "recent", files: [] };
    scheduleRender();
  }
}

async function refreshFromAgent(attempt = 0) {
  const generation = ++agentRefreshGeneration;
  const previousKey = currentSessionScrollKey();
  const previousScroll = state.scrollRestorePending ? null : readScrollState();
  try {
    const stateResponse = await window.pispider.getState();
    if (generation !== agentRefreshGeneration) return;
    if (stateResponse?.success) {
      state.session = stateResponse.data;
      state.connected = true;
      setStatus("ready", "");
      await refreshAgentOptions();
    } else if (stateResponse && !stateResponse.success) {
      throw new Error(stateResponse.error || "无法读取 Agent 状态");
    }

    const messagesResponse = await window.pispider.getMessages();
    if (generation !== agentRefreshGeneration) return;
    if (messagesResponse?.success) {
      state.messages = (messagesResponse.data?.messages ?? [])
        .map(normalizeMessage)
        .filter(Boolean);
      state.messageDataKey = currentSessionScrollKey();
      state.liveId = null;
      if (!state.streaming) prunePersistedTools();
      invalidateMessageRender();
      scheduleRender();
      const nextKey = currentSessionScrollKey();
      if (nextKey !== previousKey) {
        actionOpenKeys.clear();
        resetMessageHeights(nextKey);
        resetMessageWindow();
        restoreSessionScroll(nextKey);
      } else {
        if (state.messageHeightSessionKey !== nextKey) resetMessageHeights(nextKey);
        if (previousScroll) restoreScrollSnapshot(previousScroll, nextKey);
      }
    }
    refreshSessions();
    refreshThreadStats(generation);
  } catch (error) {
    if (generation !== agentRefreshGeneration) return;
    if (attempt < 8) {
      setTimeout(() => refreshFromAgent(attempt + 1), 350);
      return;
    }
    state.connected = false;
    setStatus("error", error.message);
  }
}

async function startAgent() {
  if (state.starting || state.connected) return;
  state.starting = true;
  setStatus("starting", "Starting PiSpider runtime");
  try {
    await window.pispider.startAgent();
    await refreshFromAgent();
    hideStatusBanner("error");
  } catch (error) {
    state.connected = false;
    setStatus("error", error.message);
    showStatusBanner(`运行时连接失败：${error.message}`, {
      tone: "error",
      actionLabel: "重试",
      action: () => startAgent(),
    });
  } finally {
    state.starting = false;
    scheduleRender();
  }
}

async function newTask() {
  if (state.shellRunning) {
    showToast("命令正在执行，请先停止", "error");
    return;
  }
  try {
    if (!state.connected) await startAgent();
    rememberScrollPosition();
    const response = await window.pispider.newSession();
    if (!response?.success) throw new Error(response?.error || "无法创建会话");
    state.messages = [];
    state.messageDataKey = "";
    resetMessageHeights();
    resetMessageWindow();
    state.tools.clear();
    actionOpenKeys.clear();
    state.changes.clear();
    state.activeCodePath = null;
    state.openCodeFile = null;
    state.session = null;
    state.sessionStats = null;
    state.sessionStatsError = "";
    $("threadStatsPopover").hidden = true;
    invalidateMessageRender();
    scheduleRender();
    await refreshFromAgent();
    await refreshSessions();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function editPromptExternally() {
  const input = $("promptInput");
  if (!input) return;
  showToast("已打开外部编辑器，保存并关闭后回填输入框");
  try {
    const response = await window.pispider.editText(input.value);
    if (!response?.success) throw new Error(response?.error || "外部编辑器没有返回内容");
    input.value = response.data?.text ?? input.value;
    autoResize();
    input.focus();
    showToast("已回填外部编辑器内容");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function deleteSession(sessionPath) {
  window.pispider
    .deleteSession(sessionPath)
    .then(async () => {
      if (state.confirmDeleteSession === sessionPath) state.confirmDeleteSession = "";
      await refreshSessions();
      showToast("会话已删除");
    })
    .catch((error) => showToast(error.message || "删除会话失败", "error"));
}

async function toggleSessionPin(sessionPath) {
  try {
    const result = await window.pispider.toggleSessionPin(sessionPath);
    await refreshSessions();
    showToast(result?.pinned ? "已置顶会话" : "已取消置顶");
  } catch (error) {
    showToast(error.message || "更新会话置顶失败", "error");
  }
}

async function switchSession(sessionPath) {
  if (state.shellRunning) {
    showToast("命令正在执行，请先停止", "error");
    return;
  }
  try {
    if (!state.connected) await startAgent();
    rememberScrollPosition();
    const response = await window.pispider.switchSession(sessionPath);
    if (!response?.success) throw new Error(response?.error || "无法切换会话");
    resetMessageHeights();
    resetMessageWindow();
    state.tools.clear();
    actionOpenKeys.clear();
    state.changes.clear();
    state.activeCodePath = null;
    state.openCodeFile = null;
    state.sessionStats = null;
    state.sessionStatsError = "";
    $("threadStatsPopover").hidden = true;
    await refreshFromAgent();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function formatShellResult(result) {
  const parts = [];
  const output = String(result?.output || "").trimEnd();
  if (output) parts.push(output);
  if (result?.cancelled) parts.push("已取消");
  else if (result?.exitCode != null) parts.push(`exit ${result.exitCode}`);
  if (result?.truncated && result?.fullOutputPath) {
    parts.push(`输出已截断，完整输出：${result.fullOutputPath}`);
  }
  return parts.join("\n\n") || "(无输出)";
}

async function runShellCommand(text) {
  const excludeFromContext = text.startsWith("!!");
  const command = (excludeFromContext ? text.slice(2) : text.slice(1)).trim();
  if (!command) {
    showToast("请输入要执行的命令", "error");
    return;
  }
  if (state.streaming) {
    showToast("Agent 正在运行，请先停止当前任务", "error");
    return;
  }
  if (!state.connected) {
    await startAgent();
    if (!state.connected) return;
  }

  const id = `local-shell-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const startedAt = Date.now();
  const tool = { id, name: "shell", args: { command }, status: "running", startedAt };
  state.tools.set(id, tool);
  state.streaming = true;
  state.shellRunning = true;
  setStatus("running", "正在执行命令");
  scheduleRender();

  try {
    const response = await window.pispider.runShell(command, excludeFromContext);
    if (!response?.success) throw new Error(response?.error || "命令执行失败");
    const result = response.data || {};
    const failed = result.exitCode != null && Number(result.exitCode) !== 0;
    await refreshFromAgent();
    state.tools.delete(id);
    if (failed) showToast(`命令退出码 ${result.exitCode}`, "error");
  } catch (error) {
    state.tools.set(id, {
      ...tool,
      status: "error",
      durationMs: Date.now() - startedAt,
      result: { content: [{ type: "text", text: error.message }], isError: true },
    });
    showToast(error.message, "error");
  } finally {
    state.shellRunning = false;
    state.streaming = false;
    setStatus("ready", "");
    scheduleRender();
  }
}

async function sendPrompt() {
  const input = $("promptInput");
  const text = input.value.trim();
  const images = state.attachments.map((image) => ({
    type: "image",
    data: image.data,
    mimeType: image.mimeType,
  }));
  if (!text && !images.length) return;
  if (text.startsWith("!")) {
    if (images.length) {
      showToast("shell 命令不能附加图片", "error");
      return;
    }
    if (state.streaming) {
      showToast("Agent 正在运行，请先停止当前任务", "error");
      return;
    }
    input.value = "";
    autoResize();
    hideFileSuggestions();
    hideCommandSuggestions();
    await runShellCommand(text);
    return;
  }
  const slash = Slash ? Slash.parseSlashInput(text) : null;
  if (slash) {
    const handled = await handleSlashCommand(slash, images);
    if (handled) return;
  }
  const visibleText = text || "请查看这张图片。";

  if (!state.connected) {
    await startAgent();
    if (!state.connected) return;
  }
  if (images.length && Array.isArray(state.session?.model?.input) && !state.session.model.input.includes("image")) {
    showStatusBanner("当前模型未启用图像输入，需要在设置里勾选“图像输入”。", {
      tone: "warning",
      actionLabel: "打开设置",
      action: () => window.pispider.openPanel("settings"),
    });
    return;
  }

  const optimisticId = addOptimisticMessage(visibleText);
  hideFileSuggestions();
  hideCommandSuggestions();
  input.value = "";
  autoResize();
  state.scrollOnRender = true;
  scheduleRender();

  try {
    const response = await window.pispider.sendPrompt(visibleText, state.streaming, images);
    if (!response?.success) {
      removeOptimisticMessage(optimisticId);
      throw new Error(response?.error || "请求被拒绝");
    }
    state.attachments = [];
    renderAttachments();
    if (!state.streaming) {
      state.streaming = true;
      setStatus("running", "Agent 正在工作");
    }
    scheduleRender();
  } catch (error) {
    removeOptimisticMessage(optimisticId);
    input.value = text;
    autoResize();
    showToast(error.message, "error");
    scheduleRender();
  }
}

async function steerPrompt() {
  if (!state.streaming) {
    await sendPrompt();
    return;
  }
  const input = $("promptInput");
  const text = input.value.trim();
  const images = state.attachments.map((image) => ({
    type: "image",
    data: image.data,
    mimeType: image.mimeType,
  }));
  if (!text && !images.length) return;
  if (text.startsWith("!")) {
    showToast("插话不能执行 shell 命令", "error");
    return;
  }
  const slash = Slash ? Slash.parseSlashInput(text) : null;
  if (slash) {
    const handled = await handleSlashCommand(slash, images);
    if (handled) return;
  }
  if (images.length && Array.isArray(state.session?.model?.input) && !state.session.model.input.includes("image")) {
    showStatusBanner("当前模型未启用图像输入，需要在设置里勾选“图像输入”。", {
      tone: "warning",
      actionLabel: "打开设置",
      action: () => window.pispider.openPanel("settings"),
    });
    return;
  }
  const visibleText = text || "请查看这张图片。";
  const optimisticId = addOptimisticMessage(visibleText);
  hideFileSuggestions();
  hideCommandSuggestions();
  input.value = "";
  autoResize();
  state.scrollOnRender = true;
  scheduleRender();
  try {
    const response = await window.pispider.steerPrompt(visibleText, images);
    if (!response?.success) {
      removeOptimisticMessage(optimisticId);
      throw new Error(response?.error || "插话被拒绝");
    }
    state.attachments = [];
    renderAttachments();
    showToast("已插入当前回合");
    scheduleRender();
  } catch (error) {
    removeOptimisticMessage(optimisticId);
    input.value = visibleText;
    autoResize();
    showToast(error.message, "error");
    scheduleRender();
  }
}

async function stopCurrent() {
  if (state.shellRunning) {
    try {
      const response = await window.pispider.abortShell();
      if (!response?.ok) throw new Error(response?.error || "停止命令失败");
      showToast("已请求停止命令");
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }
  try {
    const queued = await clearQueuedMessages({ restore: true, silent: true });
    await window.pispider.abort();
    state.streaming = false;
    state.queueCount = 0;
    state.queueSteering = [];
    state.queueFollowUp = [];
    setStatus("ready", "");
    scheduleRender();
    showToast(queued ? "已停止，排队内容已放回输入框" : "已停止");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function openSecondary(kind) {
  if (!$("panelBackdrop")?.hidden) return;
  setPanelBackdrop(kind);
  window.pispider.openPanel(kind).catch((error) => {
    setPanelBackdrop(null);
    showToast(error.message, "error");
  });
}

function bindBrowser() {
  const form = $("browserForm");
  const address = $("browserAddress");
  const frame = $("browserFrame");
  const status = $("browserStatus");
  const backButton = $("browserBack");
  const forwardButton = $("browserForward");
  const reloadButton = $("browserReload");
  if (!form || !address || !frame || !status) return;
  let loading = false;

  const reloadIcon =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M18 8.5a6.5 6.5 0 1 0 .6 7.1M18 5.5v3.2h-3.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const stopIcon =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

  const updateNav = () => {
    let canBack = false;
    let canForward = false;
    try {
      canBack = Boolean(frame.canGoBack?.());
      canForward = Boolean(frame.canGoForward?.());
    } catch {}
    if (backButton) backButton.disabled = !canBack;
    if (forwardButton) forwardButton.disabled = !canForward;
    if (reloadButton) {
      reloadButton.title = loading ? "停止加载" : "刷新";
      reloadButton.innerHTML = loading ? stopIcon : reloadIcon;
    }
  };

  const setStatus = (text, error = false) => {
    status.textContent = text;
    status.hidden = false;
    status.classList.toggle("error", error);
  };

  const openAddress = () => {
    let value = address.value.trim();
    if (!value) return;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`;
    if (!/^https?:\/\//i.test(value)) {
      setStatus("只支持 http 和 https 地址。", true);
      return;
    }
    address.value = value;
    frame.hidden = false;
    setStatus(`正在打开 ${value}`);
    frame.src = value;
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    openAddress();
  });

  backButton?.addEventListener("click", () => {
    if (frame.canGoBack?.()) frame.goBack?.();
  });
  forwardButton?.addEventListener("click", () => {
    if (frame.canGoForward?.()) frame.goForward?.();
  });
  reloadButton?.addEventListener("click", () => {
    if (loading) frame.stop?.();
    else frame.reload?.();
  });

  frame.addEventListener("dom-ready", updateNav);

  frame.addEventListener("did-start-loading", () => {
    loading = true;
    updateNav();
    if (!frame.hidden) setStatus("正在加载...");
  });
  frame.addEventListener("did-stop-loading", () => {
    loading = false;
    updateNav();
    const url = frame.getURL?.() || "";
    if (!/^https?:\/\//i.test(url)) {
      if (frame.hidden) {
        status.textContent = "输入网址后在这里打开网页。";
        status.classList.remove("error");
      }
      return;
    }
    status.hidden = true;
    status.classList.remove("error");
    address.value = url;
  });
  frame.addEventListener("did-navigate", (event) => {
    if (/^https?:\/\//i.test(event.url || "")) address.value = event.url;
    updateNav();
  });
  frame.addEventListener("did-navigate-in-page", (event) => {
    if (/^https?:\/\//i.test(event.url || "")) address.value = event.url;
    updateNav();
  });
  frame.addEventListener("did-fail-load", (event) => {
    if (event.errorCode === -3) return;
    loading = false;
    updateNav();
    setStatus(`无法打开页面：${event.errorDescription || event.errorCode}`, true);
  });
  updateNav();
}

function autoResize() {
  const input = $("promptInput");
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  syncPanelClearance();
}

function bindEvents() {
  bindBrowser();
  $("newTaskButton").addEventListener("click", newTask);
  $("changesBody").addEventListener("click", handleCodeAction);
  $("refreshSessionsButton").addEventListener("click", refreshSessions);
  $("sortSessionsButton").addEventListener("click", toggleSessionSortMode);
  $("searchInput").addEventListener("input", (event) => {
    state.search = event.target.value;
    state.sessionSearchActive = -1;
    if (state.sessionSortMode) state.sessionSortMode = false;
    scheduleSessionSearch();
  });
  $("searchInput").addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!state.search.trim() || state.sessionSearchResults.length === 0) return;
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      state.sessionSearchActive =
        state.sessionSearchActive < 0
          ? offset > 0
            ? 0
            : state.sessionSearchResults.length - 1
          : (state.sessionSearchActive + offset + state.sessionSearchResults.length) %
            state.sessionSearchResults.length;
      renderSessions();
      $("sessionList")
        .querySelector(".session-item.search-active")
        ?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (event.key === "Enter" && state.search.trim()) {
      if (state.sessionSearching) return;
      const target = state.sessionSearchResults[state.sessionSearchActive >= 0 ? state.sessionSearchActive : 0]
        ?.session;
      if (!target) return;
      event.preventDefault();
      state.sessionSearchActive = -1;
      renderSessions();
      switchSession(target.path);
      return;
    }
    if (event.key === "Escape") {
      event.target.value = "";
      state.search = "";
      resetSessionSearch();
      renderSessions();
      event.target.blur();
    }
  });

  $("sessionList").addEventListener("click", (event) => {
    if (event.target.closest("[data-exit-session-sort]")) {
      event.stopPropagation();
      state.sessionSortMode = false;
      renderSessions();
      return;
    }
    if (event.target.closest("[data-reset-session-order]")) {
      event.stopPropagation();
      resetSessionOrder();
      return;
    }
    const sortButton = event.target.closest("[data-search-sort]");
    if (sortButton) {
      event.stopPropagation();
      state.sessionSearchSort = sortButton.dataset.searchSort === "recent" ? "recent" : "relevance";
      state.sessionSearchActive = -1;
      scheduleSessionSearch(0);
      return;
    }
    const pinButton = event.target.closest("[data-pin-session]");
    if (pinButton) {
      event.stopPropagation();
      toggleSessionPin(pinButton.dataset.pinSession);
      return;
    }
    const confirmButton = event.target.closest("[data-confirm-delete]");
    if (confirmButton) {
      event.stopPropagation();
      deleteSession(confirmButton.dataset.confirmDelete);
      return;
    }
    const cancelButton = event.target.closest("[data-cancel-delete]");
    if (cancelButton) {
      event.stopPropagation();
      state.confirmDeleteSession = "";
      renderSessions();
      return;
    }
    const deleteButton = event.target.closest("[data-delete-session]");
    if (deleteButton) {
      event.stopPropagation();
      state.confirmDeleteSession = deleteButton.dataset.deleteSession;
      renderSessions();
      return;
    }
    const button = event.target.closest("[data-session]");
    if (button) {
      if (state.confirmDeleteSession) {
        state.confirmDeleteSession = "";
        renderSessions();
      }
      switchSession(button.dataset.session);
    }
  });

  $("sessionList").addEventListener("dragstart", (event) => {
    const handle = event.target.closest(".session-drag-handle");
    const row = handle?.closest(".session-sort-row");
    if (!row) return;
    state.sessionDragPath = row.dataset.sortSession || "";
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", state.sessionDragPath);
    row.classList.add("dragging");
  });
  $("sessionList").addEventListener("dragover", (event) => {
    const row = event.target.closest(".session-sort-row");
    if (!row || !state.sessionDragPath || row.dataset.sortSession === state.sessionDragPath) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    for (const other of $("sessionList").querySelectorAll(".drop-before, .drop-after")) {
      if (other !== row) other.classList.remove("drop-before", "drop-after");
    }
    const after = sessionDropAfter(event, row);
    row.classList.toggle("drop-after", after);
    row.classList.toggle("drop-before", !after);
  });
  $("sessionList").addEventListener("dragleave", (event) => {
    const row = event.target.closest(".session-sort-row");
    if (row && !row.contains(event.relatedTarget)) row.classList.remove("drop-before", "drop-after");
  });
  $("sessionList").addEventListener("drop", (event) => {
    const row = event.target.closest(".session-sort-row");
    if (!row || !state.sessionDragPath) return;
    event.preventDefault();
    const targetPath = row.dataset.sortSession || "";
    const after = sessionDropAfter(event, row);
    const draggedPath = state.sessionDragPath;
    clearSessionDragState();
    reorderSessionOrder(draggedPath, targetPath, after);
  });
  $("sessionList").addEventListener("dragend", () => clearSessionDragState());
  $("sessionList").addEventListener("keydown", (event) => {
    const handle = event.target.closest(".session-drag-handle");
    if (!handle || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    const row = handle.closest(".session-sort-row");
    moveSessionByStep(row?.dataset.sortSession || "", event.key === "ArrowDown" ? 1 : -1);
  });

  $("sendButton").addEventListener("click", () => {
    if (state.streaming) stopCurrent();
    else sendPrompt();
  });
  $("statusBannerAction").addEventListener("click", () => {
    const action = statusBannerAction;
    hideStatusBanner();
    action?.();
  });
  $("statusBannerDismiss").addEventListener("click", hideStatusBanner);
  $("queueButton").addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = $("queuePopover").hidden;
    hideComposerPopovers();
    if (!willOpen) return;
    $("queuePopover").hidden = false;
    renderQueue();
    $("queueButton").setAttribute("aria-expanded", "true");
  });
  $("queueCloseButton").addEventListener("click", () => {
    hideComposerPopovers();
  });
  $("queueList").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-queue-copy]");
    if (!button) return;
    const item = queuedItems()[Number(button.dataset.queueCopy)];
    if (!item) return;
    try {
      await window.pispider.copyText(item.text);
      showToast("已复制排队消息");
    } catch (error) {
      showToast(error.message, "error");
    }
  });
  $("messageList").addEventListener("click", async (event) => {
    const mermaidToggle = event.target.closest("[data-mermaid-toggle]");
    if (mermaidToggle) {
      const block = mermaidToggle.closest(".mermaid-block");
      const source = block ? mermaidBlockSource(block) : null;
      if (source) {
        source.hidden = !source.hidden;
        mermaidToggle.textContent = source.hidden ? "查看源码" : "隐藏源码";
      }
      return;
    }
    const button = event.target.closest("[data-code-copy]");
    if (!button) return;
    const code = button.closest(".code-block")?.querySelector("code")?.textContent ?? "";
    if (!code) return;
    try {
      await window.pispider.copyText(code);
      showToast("已复制代码");
    } catch (error) {
      showToast(error.message, "error");
    }
  });
  $("clearQueueButton").addEventListener("click", () => clearQueuedMessages());
  $("extensionDialogClose").addEventListener("click", () => {
    if (state.activeExtensionDialog) closeExtensionDialog({ cancelled: true }, true);
  });
  $("modelButton").addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = $("modelPopover").hidden;
    hideComposerPopovers();
    if (willOpen) {
      state.modelFilter = "";
      renderModelPopover();
      $("modelPopover").hidden = false;
    }
  });
  $("permissionButton").addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = $("permissionPopover").hidden;
    hideComposerPopovers();
    if (willOpen) {
      renderPermissionPopover();
      $("permissionPopover").hidden = false;
    }
  });
  $("modelPopover").addEventListener("input", (event) => {
    if (event.target.id !== "modelSearchInput") return;
    state.modelFilter = event.target.value;
    const position = event.target.selectionStart ?? state.modelFilter.length;
    renderModelPopover();
    const input = $("modelSearchInput");
    input?.focus();
    input?.setSelectionRange(position, position);
  });
  $("modelPopover").addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-scope-model]");
    if (!checkbox) return;
    const reference = checkbox.dataset.scopeModel;
    if (!reference) return;
    if (checkbox.checked) {
      if (!state.modelScopeDraft.includes(reference)) state.modelScopeDraft.push(reference);
    } else {
      state.modelScopeDraft = state.modelScopeDraft.filter((entry) => entry !== reference);
    }
    checkbox.closest(".model-scope-row")?.classList.toggle("selected", checkbox.checked);
  });
  $("modelPopover").addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target.closest("[data-edit-model-scope]")) {
      openModelScopeEditor();
      return;
    }
    if (event.target.closest("[data-toggle-model-scope]")) {
      state.modelScopeView = state.modelScopeView === "all" ? "scoped" : "all";
      renderModelPopover();
      return;
    }
    if (event.target.closest("[data-model-scope-cancel]")) {
      state.modelScopeEditing = false;
      renderModelPopover();
      return;
    }
    if (event.target.closest("[data-model-scope-all]")) {
      state.modelScopeDraft = [];
      renderModelPopover();
      return;
    }
    if (event.target.closest("[data-model-scope-save]")) {
      saveModelScope();
      return;
    }
    if (event.target.closest("[data-save-model-thinking-default]")) {
      saveModelThinkingDefault();
      return;
    }
    if (event.target.closest("[data-cycle-model]")) {
      cycleComposerModel();
      return;
    }
    if (event.target.closest("[data-cycle-thinking]")) {
      cycleThinkingLevel();
      return;
    }
    const thinkingItem = event.target.closest("[data-thinking]");
    if (thinkingItem) {
      changeThinking(thinkingItem.dataset.thinking);
      return;
    }
    const item = event.target.closest("[data-provider][data-model]");
    if (!item) return;
    changeComposerModel(item.dataset.provider, item.dataset.model);
  });
  $("permissionPopover").addEventListener("click", (event) => {
    const item = event.target.closest("[data-permission]");
    if (!item) return;
    changePermission(item.dataset.permission);
  });

  $("attachButton").addEventListener("click", async () => {

    try {
      const paths = await window.pispider.pickFiles();
      if (!paths?.length) return;
      const imagePattern = /\.(png|jpe?g|gif|webp|bmp)$/i;
      const imagePaths = paths.filter((filePath) => imagePattern.test(filePath));
      const otherPaths = paths.filter((filePath) => !imagePattern.test(filePath));
      if (imagePaths.length) {
        if (imagePaths.length > 4) showToast("最多附加 4 张图片", "error");
        const selectedImages = imagePaths.slice(0, 4);
        const images = await window.pispider.readImageFiles(selectedImages);
        addImageAttachments(images);
        const loadedNames = new Set((images || []).map((image) => image.name));
        const failed = selectedImages.filter((filePath) => {
          const name = filePath.split(/[\\/]/).pop();
          return !loadedNames.has(name);
        });
        otherPaths.push(...failed);
      }
      if (otherPaths.length) {
        const input = $("promptInput");
        const suffix = otherPaths.map((filePath) => `文件：${filePath}`).join("\n");
        input.value = `${input.value}${input.value ? "\n\n" : ""}${suffix}`;
        autoResize();
        input.focus();
      }
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  $("promptInput").addEventListener("input", () => {
    autoResize();
    updateCommandSuggestions();
    updateFileSuggestions();
  });
  $("promptInput").addEventListener("paste", (event) => {
    const files = Array.from(event.clipboardData?.items || [])
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (!files.length) return;
    event.preventDefault();
    addImageFiles(files);
  });
  const composer = $("composer");
  composer.addEventListener("dragover", (event) => {
    if (Array.from(event.dataTransfer?.items || []).some((item) => item.type.startsWith("image/"))) {
      event.preventDefault();
    }
  });
  composer.addEventListener("drop", (event) => {
    const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    event.preventDefault();
    addImageFiles(files);
  });
  $("promptInput").addEventListener("click", () => {
    updateCommandSuggestions();
    updateFileSuggestions();
  });
  $("promptInput").addEventListener("keydown", (event) => {
    const commandBox = $("commandSuggestions");
    const commandSuggestions =
      commandBox && !commandBox.hidden ? [...commandBox.querySelectorAll(".command-suggestion")] : [];
    if (commandSuggestions.length) {
      const activeIndex = Math.max(
        0,
        commandSuggestions.findIndex((item) => item.classList.contains("is-active")),
      );
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const offset = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = (activeIndex + offset + commandSuggestions.length) % commandSuggestions.length;
        commandSuggestions.forEach((item, index) => item.classList.toggle("is-active", index === nextIndex));
        commandSuggestions[nextIndex].scrollIntoView({ block: "nearest" });
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        applyCommandSuggestion(commandSuggestionItems[activeIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        hideCommandSuggestions();
        return;
      }
    }
    if (commandBox && !commandBox.hidden && event.key === "Escape") {
      event.preventDefault();
      hideCommandSuggestions();
      return;
    }
    const box = $("fileSuggestions");
    const suggestions = box && !box.hidden ? [...box.querySelectorAll(".file-suggestion")] : [];
    if (suggestions.length) {
      const activeIndex = Math.max(0, suggestions.findIndex((item) => item.classList.contains("is-active")));
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const offset = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = (activeIndex + offset + suggestions.length) % suggestions.length;
        suggestions.forEach((item, index) => item.classList.toggle("is-active", index === nextIndex));
        suggestions[nextIndex].scrollIntoView({ block: "nearest" });
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        applyFileSuggestion(fileSuggestionItems[activeIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        hideFileSuggestions();
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if ((event.ctrlKey || event.metaKey) && state.streaming) {
        steerPrompt();
      } else {
        sendPrompt();
      }
    }
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#composer")) {
      hideFileSuggestions();
      hideCommandSuggestions();
    }
    if (!event.target.closest("#modelButton, #modelPopover, #permissionButton, #permissionPopover, #queueButton, #queuePopover")) {
      hideComposerPopovers();
    }
    const statsPopover = $("threadStatsPopover");
    if (statsPopover && !statsPopover.hidden && !event.target.closest("#threadStatsButton, #threadStatsPopover")) {
      statsPopover.hidden = true;
      $("threadStatsButton")?.setAttribute("aria-expanded", "false");
    }
  });

  document.querySelectorAll(".starter-card").forEach((button) => {
    button.addEventListener("click", () => {
      $("promptInput").value = button.dataset.starter || "";
      autoResize();
      $("promptInput").focus();
    });
  });

  $("themeButton").addEventListener("click", () => {
    applyTheme(state.theme === "dark" ? "light" : "dark");
  });
  $("panelButton").addEventListener("click", () => setPanel(!state.panelOpen));
  $("closePanelButton").addEventListener("click", () => setPanel(false));
  $("shortcutsButton")?.addEventListener("click", openShortcuts);
  $("shortcutsHintButton").addEventListener("click", openShortcuts);
  $("shortcutsClose").addEventListener("click", closeShortcuts);
  $("shortcutsDialog").addEventListener("click", (event) => {
    if (event.target === $("shortcutsDialog")) closeShortcuts();
  });
  $("changelogClose")?.addEventListener("click", closeChangelog);
  $("changelogDialog")?.addEventListener("click", (event) => {
    if (event.target === $("changelogDialog")) closeChangelog();
  });
  $("commandPaletteHintButton").addEventListener("click", openCommandPalette);
  $("commandPaletteInput").addEventListener("input", filterCommandPalette);
  $("commandPaletteInput").addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveCommandPaletteActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      runCommandPaletteItem(commandPaletteActive);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeCommandPalette();
    }
  });
  $("commandPalette").addEventListener("click", (event) => {
    if (event.target === $("commandPalette")) closeCommandPalette();
  });
  $("sessionPickerInput")?.addEventListener("input", filterSessionPicker);
  $("sessionPickerInput")?.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveSessionPickerActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      chooseSessionFromPicker(sessionPickerActive);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSessionPicker();
    }
  });
  $("sessionPicker")?.addEventListener("click", (event) => {
    if (event.target === $("sessionPicker")) closeSessionPicker();
  });
  $("sessionInfoButton").addEventListener("click", () => openSecondary("session"));
  $("threadStatsButton").addEventListener("click", (event) => {
    event.stopPropagation();
    const popover = $("threadStatsPopover");
    const button = $("threadStatsButton");
    const wasOpen = !popover.hidden;
    hideComposerPopovers();
    if (wasOpen) return;
    if (!state.sessionStats) refreshThreadStats();
    renderThreadStatsPopover();
    popover.hidden = false;
    button.setAttribute("aria-expanded", "true");
  });
  $("threadStatsPopover").addEventListener("click", (event) => {
    event.stopPropagation();
    if (!event.target.closest("[data-refresh-thread-stats]")) return;
    refreshThreadStats();
  });

  $("contextTabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-tab]");
    if (tab) setRightTab(tab.dataset.tab);
  });

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.panel;
      if (kind) openSecondary(kind);
    });
  });

  $("overviewButton").addEventListener("click", () => openSecondary("project"));
  $("settingsButton").addEventListener("click", () => openSecondary("settings"));

  $("threadScroll").addEventListener("scroll", () => {
    state.scrollOnRender = false;
    rememberScrollPosition();
    updateScrollLatestButton();
    maybeShiftMessageWindow();
  });
  $("threadScroll").addEventListener(
    "wheel",
    (event) => {
      if (event.deltaY < 0 && $("threadScroll").scrollTop <= 4) maybeShiftMessageWindow();
      else if (
        event.deltaY > 0 &&
        $("threadScroll").scrollHeight - $("threadScroll").scrollTop - $("threadScroll").clientHeight <= 4
      ) {
        maybeShiftMessageWindow();
      }
    },
    { passive: true },
  );
  $("scrollLatestButton").addEventListener("click", () => {
    scrollToLatest();
  });
  $("threadJumpEarliest").addEventListener("click", () => {
    jumpToEarliestWindow();
  });
  $("threadJumpLatest").addEventListener("click", () => {
    scrollToLatest();
  });

  document.addEventListener("keydown", (event) => {
    const sessionPicker = $("sessionPicker");
    if (sessionPicker && !sessionPicker.hidden) {
      if (
        event.key === "Escape" ||
        ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "k")
      ) {
        event.preventDefault();
        closeSessionPicker();
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        $("sessionPickerInput")?.focus();
        return;
      }
      return;
    }
    const sessionPickerToggle =
      (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "k";
    if (sessionPickerToggle && $("panelBackdrop").hidden && !state.activeExtensionDialog) {
      event.preventDefault();
      openSessionPicker();
      return;
    }
    const commandPalette = $("commandPalette");
    if (commandPalette && !commandPalette.hidden) {
      if (
        event.key === "Escape" ||
        ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "p")
      ) {
        event.preventDefault();
        closeCommandPalette();
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        $("commandPaletteInput")?.focus();
        return;
      }
      return;
    }
    const commandPaletteToggle =
      (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "p";
    if (commandPaletteToggle && $("panelBackdrop").hidden && !state.activeExtensionDialog) {
      event.preventDefault();
      toggleCommandPalette();
      return;
    }
    const shortcutsDialog = $("shortcutsDialog");
    if (shortcutsDialog && !shortcutsDialog.hidden) {
      if (
        event.key === "Escape" ||
        event.key === "F1" ||
        ((event.ctrlKey || event.metaKey) && (event.key === "/" || event.key === "?"))
      ) {
        event.preventDefault();
        closeShortcuts();
        return;
      }
      if (event.key === "Tab") {
        const focusables = [...shortcutsDialog.querySelectorAll("button, input, textarea")].filter(
          (element) => !element.disabled,
        );
        if (focusables.length > 0) {
          event.preventDefault();
          focusables[0].focus();
        }
        return;
      }
      return;
    }
    const changelogDialog = $("changelogDialog");
    if (changelogDialog && !changelogDialog.hidden) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeChangelog();
      }
      return;
    }
    const shortcutsToggle =
      event.key === "F1" || ((event.ctrlKey || event.metaKey) && (event.key === "/" || event.key === "?"));
    if (shortcutsToggle && $("panelBackdrop").hidden && !state.activeExtensionDialog) {
      event.preventDefault();
      toggleShortcuts();
      return;
    }
    if (!$("panelBackdrop")?.hidden) {
      if (event.key === "Escape") {
        event.preventDefault();
        closePanelModal();
      }
      return;
    }
    if (state.activeExtensionDialog) {
      const card = $("extensionDialog").querySelector(".extension-card");
      const focusables = card
        ? [...card.querySelectorAll("button, input, textarea")].filter((element) => !element.disabled)
        : [];
      if (event.key === "Tab" && focusables.length > 0) {
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        } else if (!card.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
        }
      }
      if (state.activeExtensionDialog.method === "select" && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        const options = [...card.querySelectorAll(".extension-option")];
        const current = options.indexOf(document.activeElement);
        if (current >= 0) {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          options[(current + step + options.length) % options.length].focus();
        }
      }
    }
    if (event.key === "Escape" && state.activeExtensionDialog) {
      event.preventDefault();
      closeExtensionDialog({ cancelled: true }, true);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "," && !state.activeExtensionDialog) {
      event.preventDefault();
      openSecondary("settings");
      return;
    }
    if (event.key === "Escape" && !$("threadStatsPopover").hidden) {
      event.preventDefault();
      $("threadStatsPopover").hidden = true;
      $("threadStatsButton").setAttribute("aria-expanded", "false");
      return;
    }
    if (event.key === "Escape" && !$("queuePopover").hidden) {
      event.preventDefault();
      hideComposerPopovers();
      return;
    }
    const textEntryFocused =
      document.activeElement?.tagName === "INPUT" ||
      document.activeElement?.tagName === "TEXTAREA" ||
      document.activeElement?.isContentEditable;
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.shiftKey &&
      !event.altKey &&
      (event.key === "Home" || event.key === "End") &&
      !textEntryFocused &&
      !state.activeExtensionDialog
    ) {
      event.preventDefault();
      if (event.key === "Home") jumpToEarliestWindow();
      else scrollToLatest();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && ["+", "=", "-", "_", "0"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "0") applyZoom(1);
      else stepZoom(event.key === "+" || event.key === "=" ? 0.1 : -0.1);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
      event.preventDefault();
      newTask();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      $("searchInput").focus();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
      event.preventDefault();
      setPanel(!state.panelOpen);
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "g") {
      event.preventDefault();
      editPromptExternally();
    }
    if (
      event.key === "/" &&
      !event.ctrlKey &&
      !event.metaKey &&
      $("panelBackdrop").hidden &&
      !state.activeExtensionDialog &&
      document.activeElement?.tagName !== "INPUT" &&
      document.activeElement?.tagName !== "TEXTAREA"
    ) {
      event.preventDefault();
      $("searchInput").focus();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleRender();
  });

  window.addEventListener("resize", () => {
    syncPanelClearance();
    const followLatest = isThreadNearBottom();
    if (followLatest) {
      setMessageLayoutAnchor(null, true);
    } else {
      const snapshot = state.scrollPositions.get(currentSessionScrollKey());
      if (!state.messageLayoutAnchor && snapshot?.anchorKey && Number.isFinite(snapshot.anchorOffset)) {
        setMessageLayoutAnchor({
          key: snapshot.anchorKey,
          index: snapshot.anchorIndex,
          offset: snapshot.anchorOffset,
        });
      }
    }
    if (messageLayoutResizeTimer) clearTimeout(messageLayoutResizeTimer);
    messageLayoutResizeTimer = setTimeout(() => {
      messageLayoutResizeTimer = 0;
      scheduleRender();
    }, 120);
  });

  $("panelBackdrop").addEventListener("click", closePanelModal);
  $("contextPanel").addEventListener("transitionend", (event) => {
    if (event.propertyName === "width" || event.propertyName === "flex-basis") scheduleRender();
  });

  window.pispider.onEvent(handleEvent);
  window.pispider.onPanelChanged((payload) => {
    setPanelBackdrop(payload?.kind || null);
  });
  window.pispider.onStatus((payload) => {
    if (payload.state === "starting") setStatus("starting", payload.detail);
    else if (payload.state === "running") setStatus("running", payload.detail);
    else if (payload.state === "stopping") setStatus("starting", payload.detail);
    else if (payload.state === "stopped") {
      state.connected = false;
      state.streaming = false;
      setStatus("stopped", payload.detail);
    } else if (payload.state === "error") {
      state.connected = false;
      setStatus("error", payload.detail);
    }
    scheduleRender();
  });
  window.pispider.onRuntimeExit((payload) => {
    state.connected = false;
    state.streaming = false;
    setStatus(payload.code === 0 ? "stopped" : "error", `Runtime 已退出：${payload.signal || payload.code}`);
    showToast("PiSpider runtime 已退出。使用“新建任务”或重启应用。");
  });
  window.pispider.onLog((payload) => {
    if (payload.stream === "error") showToast(payload.text, "error");
  });
  window.pispider.onModelChanged((payload) => {
    state.connected = false;
    state.streaming = false;
    showToast(payload?.model ? `模型已切换：${payload.model}` : "模型配置已更新", "success");
    setTimeout(() => {
      if (!state.starting) startAgent();
    }, 350);
  });
  window.pispider.onResourcesChanged(() => {
    refreshResources();
  });
  window.pispider.onSessionsChanged(() => {
    refreshSessions();
  });
  window.pispider.onMcpCommandState?.((payload) => {
    handleMcpCommandState(payload);
  });
  window.pispider.onAgentReloaded(() => {
    showToast("Agent 已重新加载", "success");
    setTimeout(() => {
      refreshFromAgent();
      refreshSessions();
    }, 350);
  });
}

async function init() {
  loadScrollPositions();
  loadMessageHeightCache();
  loadCommandHistory();
  window.addEventListener("pagehide", persistMessageHeightsNow);
  applyTheme(state.theme, false);
  setPanel(state.panelOpen && window.innerWidth >= PANEL_COLLAPSE_WIDTH, false);
  setRightTab(state.rightTab);
  bindEvents();
  window.pispider.getZoom?.().then((response) => {
    const factor = Number(response?.factor);
    if (Number.isFinite(factor)) state.zoomFactor = factor;
  }).catch(() => {});

  try {
    state.info = await window.pispider.getInfo();
    const project = "PiSpider";
    $("projectName").textContent = project;
    $("emptyTitle").textContent = `在 ${project} 里开始`;
    scheduleRender();
  } catch (error) {
    showToast(error.message, "error");
    showStatusBanner(`无法读取桌面信息：${error.message}`, {
      tone: "error",
      actionLabel: "重新加载",
      action: () => location.reload(),
    });
  }
  await refreshSessions();
  await refreshResources();
  await refreshProjectChanges();
  await startAgent();
}

init();
