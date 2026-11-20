/**
 * Diagnostics report tests. These cover redaction of credentials and the
 * plain-text shape consumed by the Status window export.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { redactDiagnosticText, buildDiagnosticsReport } = require("../doctor-report.cjs");

test("redactDiagnosticText masks common credential shapes", () => {
  const input = [
    "api_key=sk-proj-abcdefghijklmnop",
    "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secret",
    '{"token":"ghp_abcdefghijklmnopqrstuvwxyz","password":"hunter2"}',
    "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz",
    "AIzaSyA1234567890abcdefghijklmnopqrstu",
  ].join("\n");
  const output = redactDiagnosticText(input);
  assert.doesNotMatch(output, /sk-proj-abcdefghijklmnop/u);
  assert.doesNotMatch(output, /eyJhbGciOiJIUzI1NiJ9/u);
  assert.doesNotMatch(output, /ghp_abcdefghijklmnopqrstuvwxyz/u);
  assert.doesNotMatch(output, /hunter2/u);
  assert.doesNotMatch(output, /github_pat_11ABCDEFG/u);
  assert.doesNotMatch(output, /AIzaSyA1234567890/u);
  assert.match(output, /api_key=\*\*\*/u);
  assert.match(output, /Bearer \*\*\*/u);
});

test("buildDiagnosticsReport keeps the readable sections and redacts secrets", () => {
  const report = {
    generatedAt: "2026-11-20T07:00:00.000Z",
    app: {
      name: "PiSpider",
      version: "0.1.0",
      piSpiderVersion: "0.1.0",
      platform: "win32",
      arch: "x64",
      electron: "45.3.2",
      node: "22.23.2",
      packaged: false,
      locale: "zh-CN",
    },
    agent: { status: "running", pid: 1234 },
    diagnostics: { core: { ok: true, version: "1.5.2" }, settingsError: null },
    logs: [
      {
        at: "2026-11-20T06:59:59.000Z",
        level: "warn",
        source: "agent.stderr",
        text: "token=sk-ant-secret-value\nnext line",
      },
    ],
  };
  const output = buildDiagnosticsReport(report);
  assert.match(output, /PiSpider 诊断报告/u);
  assert.match(output, /Agent：running · pid 1234/u);
  assert.match(output, /环境诊断/u);
  assert.match(output, /运行时日志（1 条）/u);
  assert.match(output, /agent\.stderr: token=\*\*\*/u);
  assert.doesNotMatch(output, /sk-ant-secret-value/u);
  assert.match(output, /结构化数据/u);
});

test("buildDiagnosticsReport handles an empty log and missing diagnostics", () => {
  const output = buildDiagnosticsReport({ generatedAt: "2026-11-20T07:00:00.000Z", logs: [] });
  assert.match(output, /（本轮没有运行时日志）/u);
  assert.match(output, /"diagnostics": null/u);
  assert.ok(output.endsWith("\n"));
});
