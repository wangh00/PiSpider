/**
 * Derive per-tool runtime state from Pi's tool execution events.
 *
 * MCP does not expose a per-tool health endpoint, and the MCP extension's live
 * status only reports server state plus tool names. This tracker stays honest:
 * it reports what this runtime observed (running, last success/failure, calls,
 * duration), not a server-declared tool health state.
 */

const TOOL_EVENT_TYPES = new Set(["tool_execution_start", "tool_execution_update", "tool_execution_end"]);

function parseMcpToolName(value) {
  const match = /^mcp__(.+?)__(.+)$/u.exec(String(value ?? ""));
  if (!match) return null;
  return { server: match[1], tool: match[2] };
}

function resultText(result) {
  if (typeof result === "string") return result.trim();
  if (!result || typeof result !== "object") return "";
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
  return text;
}

function createMcpToolRuntimeTracker(now = () => new Date().toISOString()) {
  const tools = new Map();
  const runningCalls = new Map();

  function snapshotForServer(serverName) {
    const snapshot = {};
    for (const runtime of tools.values()) {
      if (runtime.server === serverName) snapshot[runtime.tool] = { ...runtime };
    }
    return snapshot;
  }

  function handleEvent(event) {
    if (!event || typeof event !== "object" || !TOOL_EVENT_TYPES.has(event.type)) return null;
    const owner = parseMcpToolName(event.toolName);
    if (!owner) return null;

    const fullName = String(event.toolName);
    const previous = tools.get(fullName);

    if (event.type === "tool_execution_start") {
      const runtime = {
        server: owner.server,
        tool: owner.tool,
        state: "running",
        calls: (previous?.calls ?? 0) + 1,
        lastStartedAt: now(),
        lastFinishedAt: previous?.lastFinishedAt ?? null,
        lastDurationMs: previous?.lastDurationMs ?? null,
        lastError: "",
      };
      tools.set(fullName, runtime);
      if (event.toolCallId) runningCalls.set(String(event.toolCallId), fullName);
      return { toolName: fullName, ...runtime };
    }

    if (!previous) return null;

    if (event.type === "tool_execution_update") {
      if (previous.state === "running") return { toolName: fullName, ...previous };
      const runtime = { ...previous, state: "running" };
      tools.set(fullName, runtime);
      return { toolName: fullName, ...runtime };
    }

    if (event.toolCallId) runningCalls.delete(String(event.toolCallId));
    const result = event.isError ? resultText(event.result).slice(0, 240) : "";
    const runtime = {
      ...previous,
      state: event.isError ? "error" : "success",
      lastFinishedAt: now(),
      lastDurationMs: typeof event.durationMs === "number" ? event.durationMs : null,
      lastError: result || (event.isError ? "调用失败" : ""),
    };
    tools.set(fullName, runtime);
    return { toolName: fullName, ...runtime };
  }

  function settle() {
    const changes = [];
    const finishedAt = now();
    for (const fullName of new Set(runningCalls.values())) {
      const runtime = tools.get(fullName);
      if (!runtime) continue;
      const next = {
        ...runtime,
        state: "error",
        lastFinishedAt: finishedAt,
        lastError: "调用中断",
      };
      tools.set(fullName, next);
      changes.push({ toolName: fullName, ...next });
    }
    runningCalls.clear();
    return changes;
  }

  function decorate(status) {
    if (!status || typeof status !== "object" || !Array.isArray(status.servers)) return status;
    return {
      ...status,
      servers: status.servers.map((server) => ({
        ...server,
        toolRuntime:
          server && typeof server.name === "string" ? snapshotForServer(server.name) : {},
      })),
    };
  }

  function reset() {
    tools.clear();
    runningCalls.clear();
  }

  return { handleEvent, settle, snapshotForServer, decorate, reset };
}

module.exports = { createMcpToolRuntimeTracker, parseMcpToolName };
