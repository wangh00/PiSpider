function messageText(message) {
  if (!message || message.role !== "user") return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((block) => block?.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export function findUserEntries(branch = []) {
  return branch
    .filter((entry) => entry?.type === "message" && entry.message?.role === "user")
    .map((entry) => ({ id: entry.id, text: messageText(entry.message), timestamp: entry.timestamp }));
}

export async function performRewind(args, ctx) {
  const mode = String(args ?? "once").trim().toLowerCase();
  if (!["once", "round"].includes(mode)) throw new Error("rewind mode must be once or round");
  await ctx.waitForIdle();
  const users = findUserEntries(ctx.sessionManager.getBranch());
  if (users.length === 0) throw new Error("No user message is available to rewind");
  const target = mode === "round" ? users[Math.max(0, users.length - 2)] : users[users.length - 1];
  if (!target) throw new Error("No earlier user turn is available for round rewind");
  ctx.ui.notify(
    `Rewinding ${mode === "once" ? "the latest turn" : "one round back"}; the original branch stays in the session tree.`,
    "info",
  );
  await ctx.fork(target.id, { position: "before" });
}
