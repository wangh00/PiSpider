import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createMcpToolRuntimeTracker, parseMcpToolName } = require("../mcp-tool-runtime.cjs");

test("parseMcpToolName keeps server and tool names", () => {
  assert.deepEqual(parseMcpToolName("mcp__chrome_devtools__take_screenshot"), {
    server: "chrome_devtools",
    tool: "take_screenshot",
  });
  assert.equal(parseMcpToolName("bash"), null);
  assert.equal(parseMcpToolName(""), null);
});

test("tracks running, success, failure, call count and duration", () => {
  let tick = 0;
  const tracker = createMcpToolRuntimeTracker(() => `t${++tick}`);

  const start = tracker.handleEvent({
    type: "tool_execution_start",
    toolCallId: "call-1",
    toolName: "mcp__chrome__navigate",
  });
  assert.equal(start.state, "running");
  assert.equal(start.calls, 1);

  const end = tracker.handleEvent({
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "mcp__chrome__navigate",
    isError: false,
    durationMs: 123,
  });
  assert.equal(end.state, "success");
  assert.equal(end.lastDurationMs, 123);
  assert.equal(end.lastError, "");

  const startAgain = tracker.handleEvent({
    type: "tool_execution_start",
    toolCallId: "call-2",
    toolName: "mcp__chrome__navigate",
  });
  assert.equal(startAgain.calls, 2);

  const fail = tracker.handleEvent({
    type: "tool_execution_end",
    toolCallId: "call-2",
    toolName: "mcp__chrome__navigate",
    isError: true,
    result: { content: [{ type: "text", text: "tab not found" }] },
  });
  assert.equal(fail.state, "error");
  assert.equal(fail.lastError, "tab not found");
});

test("decorates server status with per-tool runtime and ignores non-MCP events", () => {
  let tick = 0;
  const tracker = createMcpToolRuntimeTracker(() => `t${++tick}`);
  tracker.handleEvent({
    type: "tool_execution_start",
    toolCallId: "call-1",
    toolName: "mcp__docs__search",
  });

  const status = {
    servers: [
      { name: "docs", state: "connected", tools: ["search"] },
      { name: "other", state: "connected", tools: ["read"] },
    ],
    errors: [],
  };
  const decorated = tracker.decorate(status);
  assert.equal(decorated.servers[0].toolRuntime.search.state, "running");
  assert.deepEqual(decorated.servers[1].toolRuntime, {});

  assert.equal(
    tracker.handleEvent({ type: "tool_execution_start", toolCallId: "shell-1", toolName: "bash" }),
    null,
  );
});

test("settle marks interrupted calls and reset clears state", () => {
  let tick = 0;
  const tracker = createMcpToolRuntimeTracker(() => `t${++tick}`);
  tracker.handleEvent({
    type: "tool_execution_start",
    toolCallId: "call-1",
    toolName: "mcp__docs__search",
  });

  const changes = tracker.settle();
  assert.equal(changes.length, 1);
  assert.equal(changes[0].state, "error");
  assert.equal(changes[0].lastError, "调用中断");

  tracker.reset();
  assert.deepEqual(tracker.snapshotForServer("docs"), {});
});
