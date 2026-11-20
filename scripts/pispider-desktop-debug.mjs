#!/usr/bin/env node

/**
 * Dev-only CDP harness for the PiSpider Electron window.
 *
 * Start the desktop app with:
 *   .\node_modules\electron\dist\electron.exe . --remote-debugging-port=9347
 *
 * Then run fixed commands from the repository root:
 *   node scripts/pispider-desktop-debug.mjs state
 *   node scripts/pispider-desktop-debug.mjs switch-session <session.jsonl>
 *   node scripts/pispider-desktop-debug.mjs send "ping"
 *   node scripts/pispider-desktop-debug.mjs inject-event '{"type":"message_end",...}'
 *   node scripts/pispider-desktop-debug.mjs wait
 *
 * This script is intentionally not part of the packaged app. It exposes only
 * fixed renderer operations, not arbitrary eval, and works only while the app
 * has a local CDP port open.
 */

const port = Number(process.env.PISPIDER_DEBUG_PORT || 9347);
const baseUrl = `http://127.0.0.1:${port}`;
const command = process.argv[2] || "help";
const args = process.argv.slice(3);

function usage() {
  console.log(`PiSpider desktop debug (CDP ${baseUrl})

Commands:
  state                              Print current model, thinking levels, message window, and scroll state.
  switch-session <path>              Switch to a session file and print the resulting state.
  send <text>                        Put text into the composer and send it through the normal UI path.
  inject-event <json>                Feed one wire-level agent event into renderer handleEvent().
  wait [timeout-ms]                  Wait until the renderer is no longer streaming.
  help                               Show this help.

Environment:
  PISPIDER_DEBUG_PORT               CDP port, default 9347.
`);
}

async function getTarget() {
  let targets;
  try {
    targets = await (await fetch(`${baseUrl}/json`)).json();
  } catch (error) {
    throw new Error(`无法连接 ${baseUrl}: ${error.message}. 请用 --remote-debugging-port=${port} 启动桌面应用。`);
  }
  const target =
    targets.find((item) => item.type === "page" && item.title === "PiSpider") ||
    targets.find((item) => item.type === "page" && item.title.includes("PiSpider")) ||
    targets.find((item) => item.type === "page" && item.url.includes("renderer/index.html"));
  if (!target?.webSocketDebuggerUrl) throw new Error("没有找到 PiSpider 主窗口 CDP target");
  return target;
}

async function evaluate(expression) {
  const target = await getTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const response = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP timeout")), 60_000);
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timer);
      resolve(message);
    });
    ws.send(
      JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      }),
    );
  });
  ws.close();
  if (response.error) throw new Error(response.error.message || "CDP 调用失败");
  const exception = response.result?.exceptionDetails;
  if (exception) {
    throw new Error(exception.exception?.description || exception.text || "renderer 执行失败");
  }
  return response.result?.result?.value ?? null;
}

function embed(value) {
  return JSON.stringify(value).replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function stateExpression() {
  return `(() => {
    const scroll = document.getElementById("threadScroll");
    return {
      title: document.querySelector("#threadTitle")?.textContent || null,
      sessionFile: state.session?.sessionFile || null,
      model: state.session?.model ? {
        provider: state.session.model.provider || null,
        id: state.session.model.id || null,
        name: state.session.model.name || null,
        reasoning: state.session.model.reasoning === true,
      } : null,
      thinkingLevel: state.session?.thinkingLevel || null,
      thinkingLevels: state.thinkingLevels,
      messages: state.messages.length,
      messageWindow: [state.messageWindowStart, state.messageWindowEnd],
      previousTotal: state.messagePreviousTotal,
      scrollTop: scroll?.scrollTop ?? null,
      scrollMax: scroll ? scroll.scrollHeight - scroll.clientHeight : 0,
      streaming: state.streaming,
      sessions: state.sessions.map((session) => session.path),
    };
  })()`;
}

async function printState() {
  const result = await evaluate(stateExpression());
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  if (command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }
  if (command === "state") {
    await printState();
    return;
  }
  if (command === "switch-session") {
    const path = args[0];
    if (!path) throw new Error("用法: switch-session <session.jsonl>");
    const result = await evaluate(`(async () => {
      await switchSession(${embed(path)});
      await new Promise((resolve) => setTimeout(resolve, 400));
      return ${stateExpression()};
    })()`);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "send") {
    const text = args.join(" ").trim();
    if (!text) throw new Error('用法: send "<text>"');
    const result = await evaluate(`(async () => {
      const input = document.getElementById("promptInput");
      input.value = ${embed(text)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await sendPrompt();
      return ${stateExpression()};
    })()`);
    console.log(JSON.stringify(result, null, 2));
    console.warn("send 使用当前真实模型；如已配置付费 provider，会产生推理调用。");
    return;
  }
  if (command === "inject-event") {
    const raw = args.join(" ").trim();
    if (!raw) throw new Error("用法: inject-event '<json>'");
    const payload = JSON.parse(raw);
    const result = await evaluate(`(() => {
      handleEvent(${embed(payload)});
      return ${stateExpression()};
    })()`);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "wait") {
    const timeout = Number(args[0] || 30_000);
    const result = await evaluate(`(async () => {
      const deadline = Date.now() + ${timeout};
      while (state.streaming && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return ${stateExpression()};
    })()`);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  throw new Error(`未知命令: ${command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
