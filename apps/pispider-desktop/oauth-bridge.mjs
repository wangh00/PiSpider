/**
 * Desktop OAuth bridge.
 *
 * Runs Pi's public ModelRuntime.login/logout in an isolated Node process and
 * speaks newline-delimited JSON with the Electron main process. Provider
 * protocols stay inside Pi; this file only adapts prompts and auth events.
 */

import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const coreIndex = String(process.env.PISPIDER_CORE_INDEX || "").trim();
if (!coreIndex) {
  process.stderr.write("PISPIDER_CORE_INDEX is required\n");
  process.exit(1);
}

const core = await import(pathToFileURL(coreIndex).href);
const ModelRuntime = core.ModelRuntime;
const CredentialSynchronizationError = core.CredentialSynchronizationError;
if (typeof ModelRuntime?.create !== "function") {
  process.stderr.write(`ModelRuntime is not exported by ${coreIndex}\n`);
  process.exit(1);
}

const SUPPORTED_PROVIDERS = new Set(["kimi-coding", "openrouter", "openai"]);
const pendingPrompts = new Map();
let runtimePromise = null;
let activeLogin = null;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function assertProvider(provider) {
  if (typeof provider !== "string" || !SUPPORTED_PROVIDERS.has(provider)) {
    throw new Error(`不支持的 OAuth 服务商：${String(provider || "")}`);
  }
  return provider;
}

function runtimeFor(message) {
  if (!runtimePromise) {
    runtimePromise = ModelRuntime.create({
      authPath: message.authPath,
      modelsPath: message.modelsPath,
      refreshOnCreate: false,
    });
  }
  return runtimePromise;
}

function closePrompt(promptId, reason) {
  const pending = pendingPrompts.get(promptId);
  if (!pending) return;
  pendingPrompts.delete(promptId);
  pending.signal?.removeEventListener("abort", pending.onAbort);
  send({ kind: "prompt_closed", loginId: pending.loginId, promptId });
  pending.reject(new Error(reason || "Login prompt cancelled"));
}

function promptForLogin(loginId) {
  return (prompt) =>
    new Promise((resolve, reject) => {
      const promptId = randomUUID();
      const promptSignal = prompt.signal;
      const onAbort = () => closePrompt(promptId, "Login prompt cancelled");
      const pending = { loginId, promptId, resolve, reject, signal: promptSignal, onAbort };
      pendingPrompts.set(promptId, pending);
      promptSignal?.addEventListener("abort", onAbort, { once: true });
      send({
        kind: "prompt",
        loginId,
        promptId,
        prompt: {
          type: prompt.type,
          message: prompt.message,
          placeholder: prompt.placeholder,
          options: prompt.options,
        },
      });
      if (promptSignal?.aborted) closePrompt(promptId, "Login prompt cancelled");
    });
}

function notifyForLogin(loginId) {
  return (event) => {
    send({ kind: "event", loginId, event });
  };
}

async function refreshProviderModels(runtime, provider) {
  try {
    await runtime.refresh({
      providers: [provider],
      allowNetwork: true,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // The credential is saved; the next agent start also refreshes the catalog.
  }
  return runtime.getModels(provider).length;
}

async function login(message) {
  const provider = assertProvider(message.provider);
  const loginId = String(message.loginId || "");
  if (!loginId) throw new Error("缺少 loginId");
  if (activeLogin) throw new Error("已有登录正在进行");
  if (typeof message.deviceId !== "string" || !message.deviceId.trim()) {
    throw new Error("缺少设备标识");
  }

  const controller = new AbortController();
  activeLogin = { loginId, provider, controller };
  try {
    const runtime = await runtimeFor(message);
    const interaction = {
      signal: controller.signal,
      prompt: promptForLogin(loginId),
      notify: notifyForLogin(loginId),
    };
    const credential = await runtime.login(provider, "oauth", interaction, {
      getDeviceId: () => message.deviceId,
      agentName: message.agentName || "PiSpider",
    });
    const models = await refreshProviderModels(runtime, provider);
    send({
      kind: "result",
      loginId,
      ok: true,
      provider,
      credentialType: credential.type,
      modelCount: models,
    });
  } catch (error) {
    if (error instanceof CredentialSynchronizationError) {
      send({
        kind: "result",
        loginId,
        ok: true,
        provider,
        warning: `登录成功，但模型状态同步失败：${errorMessage(error)}`,
      });
    } else {
      send({
        kind: "result",
        loginId,
        ok: false,
        provider,
        error: errorMessage(error),
      });
    }
  } finally {
    if (activeLogin?.loginId === loginId) activeLogin = null;
  }
}

async function logout(message) {
  const provider = assertProvider(message.provider);
  const runtime = await runtimeFor(message);
  try {
    await runtime.logout(provider, { signal: AbortSignal.timeout(30_000) });
    send({ kind: "result", loginId: message.loginId, ok: true, provider });
  } catch (error) {
    send({
      kind: "result",
      loginId: message.loginId,
      ok: false,
      provider,
      error: errorMessage(error),
    });
  }
}

function answerPrompt(message) {
  const pending = pendingPrompts.get(String(message.promptId || ""));
  if (!pending) throw new Error("授权输入已失效");
  pendingPrompts.delete(pending.promptId || message.promptId);
  pending.signal?.removeEventListener("abort", pending.onAbort);
  pending.resolve(String(message.value ?? ""));
}

async function handleCommand(message) {
  switch (message?.command) {
    case "login":
      await login(message);
      break;
    case "logout":
      await logout(message);
      break;
    case "cancel":
      activeLogin?.controller.abort(new Error("Login cancelled"));
      break;
    case "prompt-response":
      answerPrompt(message);
      break;
    default:
      send({ kind: "result", ok: false, error: "未知桥接命令" });
  }
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += String(chunk);
  const lines = input.split(/\r?\n/u);
  input = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      send({ kind: "result", ok: false, error: `桥接消息不是 JSON：${errorMessage(error)}` });
      continue;
    }
    handleCommand(message).catch((error) => {
      send({ kind: "result", loginId: message.loginId, ok: false, error: errorMessage(error) });
    });
  }
});
process.stdin.on("end", () => {
  activeLogin?.controller.abort(new Error("Login cancelled"));
  process.exit(0);
});
