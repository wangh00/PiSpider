/**
 * Formats and redacts the diagnostics report exported from the Status window.
 * The report is plain text so it can be attached to an issue without extra tooling.
 */

const REDACTION_PATTERNS = [
  [
    /("(?:apiKey|api_key|accessToken|access_token|refreshToken|refresh_token|token|secret|password)"\s*:\s*")[^"]*(")/giu,
    "$1***$2",
  ],
  [/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|secret|password)\s*[:=]\s*)[^\s,;"']+/giu, "$1***"],
  [/(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/giu, "$1***"],
  [/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "sk-***"],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/gu, "gh*_***"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/gu, "github_pat_***"],
  [/\bAIza[0-9A-Za-z_-]{20,}\b/gu, "AIza***"],
];

function redactDiagnosticText(value) {
  let text = String(value ?? "");
  for (const [pattern, replacement] of REDACTION_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

function logLine(entry) {
  const at = String(entry?.at || "—");
  const level = String(entry?.level || "info").toUpperCase();
  const source = String(entry?.source || "app");
  const text = String(entry?.text || "").replace(/\r?\n/gu, "\n    ");
  return `${at} [${level}] ${source}: ${text}`;
}

function buildDiagnosticsReport(report) {
  const app = report?.app || {};
  const agent = report?.agent || {};
  const logs = Array.isArray(report?.logs) ? report.logs : [];
  const lines = [
    "PiSpider 诊断报告",
    `生成时间：${report?.generatedAt || "—"}`,
    `应用：${app.name || "PiSpider"} ${app.version || "—"} · PiSpider ${app.piSpiderVersion || "—"}`,
    `平台：${app.platform || "—"} ${app.arch || ""} · Electron ${app.electron || "—"} · Node ${app.node || "—"}`,
    `打包版本：${app.packaged ? "是" : "否"} · 语言 ${app.locale || "—"}`,
    `Agent：${agent.status || "not-started"}${agent.pid ? ` · pid ${agent.pid}` : ""}`,
    "",
    "环境诊断",
    JSON.stringify(report?.diagnostics ?? null, null, 2),
    "",
    `运行时日志（${logs.length} 条）`,
    logs.length ? logs.map(logLine).join("\n") : "（本轮没有运行时日志）",
    "",
    "结构化数据",
    JSON.stringify(
      {
        generatedAt: report?.generatedAt || null,
        app,
        agent,
        diagnostics: report?.diagnostics ?? null,
      },
      null,
      2,
    ),
    "",
  ];
  return `${redactDiagnosticText(lines.join("\n")).trimEnd()}\n`;
}

module.exports = { redactDiagnosticText, buildDiagnosticsReport };
