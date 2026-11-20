export const TASK_STAGES = ["intake", "plan", "execute", "observe", "verify", "done", "blocked"];

export function createTaskState() {
  return {
    stage: "intake",
    goal: "",
    scope: "",
    plan: [],
    observations: [],
    boundary: "",
    fallbacks: [],
    nextAction: "",
    result: "",
    updatedAt: null,
  };
}

function cleanText(value, max = 2000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanList(value, maxItems = 20, maxItem = 600) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item, maxItem))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function normalizeTaskState(value) {
  const base = createTaskState();
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  return {
    stage: TASK_STAGES.includes(value.stage) ? value.stage : base.stage,
    goal: cleanText(value.goal),
    scope: cleanText(value.scope),
    plan: cleanList(value.plan),
    observations: Array.isArray(value.observations)
      ? value.observations
          .filter((item) => item && typeof item === "object")
          .map((item) => ({
            text: cleanText(item.text, 1200),
            source: cleanText(item.source, 300),
            at: cleanText(item.at, 40),
          }))
          .filter((item) => item.text)
          .slice(-20)
      : [],
    nextAction: cleanText(value.nextAction),
    boundary: cleanText(value.boundary, 1200),
    fallbacks: cleanList(value.fallbacks, 8, 600),
    result: cleanText(value.result),
    updatedAt: cleanText(value.updatedAt, 40) || null,
  };
}

export function applyTaskAction(state, params = {}) {
  const next = normalizeTaskState(state);
  const now = new Date().toISOString();
  const action = params.action;

  if (action === "reset") {
    return createTaskState();
  }
  if (action === "plan") {
    if (params.goal) next.goal = cleanText(params.goal);
    if (params.scope) next.scope = cleanText(params.scope);
    if (params.steps) next.plan = cleanList(params.steps);
    if (params.nextAction) next.nextAction = cleanText(params.nextAction);
    if (!next.goal) throw new Error("plan requires goal on the first call");
    next.stage = "plan";
    next.updatedAt = now;
    return next;
  }
  if (action === "note") {
    if (!params.text) throw new Error("note requires text");
    next.observations.push({
      text: cleanText(params.text, 1200),
      source: cleanText(params.source, 300),
      at: now,
    });
    next.observations = next.observations.slice(-20);
    if (next.stage === "intake" || next.stage === "plan") next.stage = "observe";
    if (params.nextAction) next.nextAction = cleanText(params.nextAction);
    next.updatedAt = now;
    return next;
  }
  if (action === "reroute") {
    if (!params.boundary) throw new Error("reroute requires boundary");
    next.boundary = cleanText(params.boundary, 1200);
    if (params.fallbacks) next.fallbacks = cleanList(params.fallbacks, 8, 600);
    if (params.nextAction) next.nextAction = cleanText(params.nextAction);
    next.stage = "execute";
    next.updatedAt = now;
    return next;
  }
  if (action === "stage") {
    if (!TASK_STAGES.includes(params.stage)) throw new Error(`invalid stage: ${params.stage}`);
    if (params.nextAction) next.nextAction = cleanText(params.nextAction);
    next.stage = params.stage;
    next.updatedAt = now;
    return next;
  }
  if (action === "complete") {
    if (!params.result) throw new Error("complete requires result");
    next.result = cleanText(params.result, 2000);
    next.stage = "done";
    next.nextAction = "";
    next.updatedAt = now;
    return next;
  }
  if (action === "status") {
    return next;
  }
  throw new Error(`unknown task action: ${action}`);
}

export function reconstructTaskState(entries = []) {
  let state = createTaskState();
  for (const entry of entries) {
    if (entry?.type === "custom" && entry.customType === "pispider-task-reset") {
      state = createTaskState();
      continue;
    }
    if (entry?.type !== "message") continue;
    const message = entry.message;
    if (!message || message.role !== "toolResult" || message.toolName !== "ps_task") continue;
    const stored = message.details?.pispiderTask;
    if (stored) state = normalizeTaskState(stored);
  }
  return state;
}

export function taskStateText(state) {
  if (!state || state.stage === "intake" && !state.goal && !state.plan.length) {
    return "PiSpider task: empty (use ps_task action=plan to initialize)";
  }
  const lines = [`PiSpider task [${state.stage}]`];
  if (state.goal) lines.push(`Goal: ${state.goal}`);
  if (state.scope) lines.push(`Scope: ${state.scope}`);
  if (state.plan.length) {
    lines.push("Plan:");
    state.plan.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  }
  if (state.observations.length) {
    lines.push("Recent evidence:");
    for (const item of state.observations.slice(-5)) {
      lines.push(`- ${item.text}${item.source ? ` [${item.source}]` : ""}`);
    }
  }
  if (state.boundary) lines.push(`Boundary: ${state.boundary}`);
  if (state.fallbacks.length) {
    lines.push("Continuity options:");
    for (const item of state.fallbacks.slice(0, 8)) lines.push(`- ${item}`);
  }
  if (state.nextAction) lines.push(`Next: ${state.nextAction}`);
  if (state.result) lines.push(`Result: ${state.result}`);
  return lines.join("\n");
}
