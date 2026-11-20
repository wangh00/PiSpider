import {
  applyTaskAction,
  reconstructTaskState,
  taskStateText,
  TASK_STAGES,
} from "./task-state.js";

const TASK_PARAMETERS = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["status", "plan", "note", "reroute", "stage", "complete", "reset"],
      description: "Task state operation",
    },
    goal: { type: "string", description: "Task goal; required on the first plan call" },
    scope: { type: "string", description: "Authorized target, boundaries, and exclusions" },
    steps: {
      type: "array",
      items: { type: "string" },
      maxItems: 20,
      description: "Short ordered plan steps",
    },
    text: { type: "string", description: "Observation text for action=note" },
    source: { type: "string", description: "Evidence source, path, URL, or command for action=note" },
    boundary: { type: "string", description: "Exact blocked action or limitation for action=reroute" },
    fallbacks: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
      description: "Adjacent analysis paths to try after a boundary for action=reroute",
    },
    stage: {
      type: "string",
      enum: TASK_STAGES,
      description: "New task stage for action=stage",
    },
    nextAction: { type: "string", description: "The single next action to take" },
    result: { type: "string", description: "Final result for action=complete" },
  },
  required: ["action"],
  additionalProperties: false,
};

export function registerTaskTool(pi, runtime) {
  pi.registerTool({
    name: "ps_task",
    label: "PiSpider Task",
    description:
      "Read or update branch-aware PiSpider task state. Use action=plan to initialize goal/scope/steps, note to record evidence, reroute to record a boundary plus adjacent fallbacks without abandoning the task, stage to change phase, complete to finish, status to inspect, reset to clear.",
    promptSnippet: "Track reverse-engineering goal, plan, evidence, boundary, fallbacks, and next action across branches",
    promptGuidelines: [
      "Use ps_task to persist a non-trivial PiSpider task's goal, plan, observations, and next action instead of relying on chat memory.",
      "Call ps_task with action=status before resuming a long or rewound task, and with action=note after each meaningful probe result.",
      "When a reverse-engineering path is blocked, use ps_task action=reroute with boundary and fallbacks, then continue with the revised next action instead of abandoning or resetting the task.",
    ],
    parameters: TASK_PARAMETERS,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const current = reconstructTaskState(ctx.sessionManager.getBranch());
      try {
        const next = applyTaskAction(current, params);
        runtime.taskState = next;
        return {
          content: [{ type: "text", text: taskStateText(next) }],
          details: { pispiderTask: next },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `PiSpider task error: ${error.message}` }],
          details: { pispiderTask: current },
          isError: true,
        };
      }
    },
  });
}
