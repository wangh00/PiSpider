import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTaskAction,
  createTaskState,
  normalizeTaskState,
  reconstructTaskState,
  taskStateText,
} from "../src/task-state.js";

test("task state supports the full workflow", () => {
  let state = createTaskState();
  state = applyTaskAction(state, {
    action: "plan",
    goal: "Trace a signer",
    scope: "Authorized demo",
    steps: ["Capture", "Locate", "Verify"],
    nextAction: "Capture one request",
  });
  assert.equal(state.stage, "plan");
  state = applyTaskAction(state, { action: "note", text: "Found signer entry", source: "bundle.js:42", nextAction: "Trace inputs" });
  assert.equal(state.stage, "observe");
  assert.equal(state.observations.length, 1);
  state = applyTaskAction(state, {
    action: "reroute",
    boundary: "Authenticated endpoint is outside the owned test tenant",
    fallbacks: ["Trace call sites in the bundle", "Reproduce signing in an owned fixture"],
    nextAction: "Trace call sites",
  });
  assert.equal(state.stage, "execute");
  assert.equal(state.fallbacks.length, 2);
  assert.match(taskStateText(state), /Boundary: Authenticated endpoint/);
  state = applyTaskAction(state, { action: "stage", stage: "verify", nextAction: "Run vector" });
  state = applyTaskAction(state, { action: "complete", result: "Signer mapped" });
  assert.equal(state.stage, "done");
  assert.equal(state.nextAction, "");
  assert.match(taskStateText(state), /Signer mapped/);
});

test("task state validates required fields and caps stored observations", () => {
  assert.throws(() => applyTaskAction(createTaskState(), { action: "plan", steps: ["x"] }), /goal/);
  assert.throws(() => applyTaskAction(createTaskState(), { action: "note" }), /text/);
  let state = createTaskState();
  for (let index = 0; index < 30; index++) {
    state = applyTaskAction(state, { action: "note", text: `observation ${index}` });
  }
  assert.equal(state.observations.length, 20);
  assert.equal(state.observations[0].text, "observation 10");
});

test("task state reconstructs from branch tool results and reset markers", () => {
  const state = { action: "plan", goal: "Map API", stage: "plan", plan: ["A"], observations: [] };
  const entries = [
    { type: "message", message: { role: "toolResult", toolName: "ps_task", details: { pispiderTask: state } } },
    { type: "message", message: { role: "toolResult", toolName: "ps_task", details: { pispiderTask: { ...state, stage: "observe", observations: [{ text: "x" }] } } } },
  ];
  assert.equal(reconstructTaskState(entries).stage, "observe");
  entries.push({ type: "custom", customType: "pispider-task-reset", data: {} });
  assert.equal(reconstructTaskState(entries).stage, "intake");
});

test("normalization rejects invalid shapes and unknown stages", () => {
  const normalized = normalizeTaskState({ stage: "nope", plan: "not-an-array", observations: [{ text: "ok" }] });
  assert.equal(normalized.stage, "intake");
  assert.deepEqual(normalized.plan, []);
  assert.equal(normalized.observations[0].text, "ok");
});
