/**
 * Preload bridge. Keep the renderer free of Node and Electron primitives.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pispider", {
  getInfo: () => ipcRenderer.invoke("app:info"),
  getDiagnostics: () => ipcRenderer.invoke("system:diagnostics"),
  listSessions: () => ipcRenderer.invoke("sessions:list"),
  getSessionOrder: () => ipcRenderer.invoke("sessions:order"),
  setSessionOrder: (items) => ipcRenderer.invoke("sessions:set-order", items),
  searchSessions: (query, sort) => ipcRenderer.invoke("sessions:search", query, sort),
  deleteSession: (sessionPath) => ipcRenderer.invoke("sessions:delete", sessionPath),
  toggleSessionPin: (sessionPath) => ipcRenderer.invoke("sessions:pin", sessionPath),
  importSession: () => ipcRenderer.invoke("sessions:import"),
  importSessionPath: (sourcePath) => ipcRenderer.invoke("sessions:import-path", sourcePath),
  listRules: () => ipcRenderer.invoke("resources:rules"),
  getRule: (id) => ipcRenderer.invoke("resources:rule", id),
  createRule: (input) => ipcRenderer.invoke("resources:create-rule", input),
  updateRule: (id, content) => ipcRenderer.invoke("resources:update-rule", id, content),
  resetRule: (id) => ipcRenderer.invoke("resources:reset-rule", id),
  deleteRule: (id) => ipcRenderer.invoke("resources:delete-rule", id),
  activateRule: (id) => ipcRenderer.invoke("resources:activate-rule", id),
  listSkills: () => ipcRenderer.invoke("resources:skills"),
  createSkill: (input) => ipcRenderer.invoke("resources:create-skill", input),
  importSkill: (sourcePath) => ipcRenderer.invoke("resources:import-skill", sourcePath),
  deleteSkill: (id) => ipcRenderer.invoke("resources:delete-skill", id),
  listMcp: (scope) => ipcRenderer.invoke("resources:mcp", scope),
  startMcpCatalog: (id, scope, inputs) => ipcRenderer.invoke("resources:mcp-start", id, scope, inputs),
  saveMcp: (input, scope) => ipcRenderer.invoke("resources:mcp-save", input, scope),
  deleteMcp: (name, scope) => ipcRenderer.invoke("resources:mcp-delete", name, scope),
  toggleMcp: (name, enabled, scope) => ipcRenderer.invoke("resources:mcp-toggle", name, enabled, scope),
  checkMcp: (name, scope) => ipcRenderer.invoke("resources:mcp-check", name, scope),
  runMcpCommand: (name, action) => ipcRenderer.invoke("resources:mcp-command", name, action),
  listPrompts: () => ipcRenderer.invoke("resources:prompts"),
  readPrompt: (name) => ipcRenderer.invoke("resources:read-prompt", name),
  updatePrompt: (name, content) => ipcRenderer.invoke("resources:update-prompt", name, content),
  resetPrompt: (name) => ipcRenderer.invoke("resources:reset-prompt", name),
  previewPrompt: (text) => ipcRenderer.invoke("resources:preview-prompt", text),
  listPromptTemplates: () => ipcRenderer.invoke("resources:list-prompt-templates"),
  readPromptTemplate: (scope, id) => ipcRenderer.invoke("resources:read-prompt-template", scope, id),
  createPromptTemplate: (input) => ipcRenderer.invoke("resources:create-prompt-template", input),
  updatePromptTemplate: (scope, id, input) => ipcRenderer.invoke("resources:update-prompt-template", scope, id, input),
  deletePromptTemplate: (scope, id) => ipcRenderer.invoke("resources:delete-prompt-template", scope, id),
  listExtensions: () => ipcRenderer.invoke("resources:extensions"),
  toggleExtension: (target, enabled) => ipcRenderer.invoke("resources:toggle-extension", target, enabled),
  installPackage: (input) => ipcRenderer.invoke("resources:install-package", input),
  removePackage: (input) => ipcRenderer.invoke("resources:remove-package", input),
  updatePackage: (input) => ipcRenderer.invoke("resources:update-package", input),
  getWorkspaceConfig: () => ipcRenderer.invoke("config:get-workspace"),
  setDomain: (domain) => ipcRenderer.invoke("config:set-domain", domain),
  getProjectTrust: () => ipcRenderer.invoke("config:get-project-trust"),
  setProjectTrust: (mode) => ipcRenderer.invoke("config:set-project-trust", mode),
  readProjectFile: (targetPath) => ipcRenderer.invoke("project:read", targetPath),
  getProjectChanges: () => ipcRenderer.invoke("project:changes"),
  pickCodeFile: () => ipcRenderer.invoke("project:pick-file"),

  startAgent: () => ipcRenderer.invoke("agent:start"),
  stopAgent: () => ipcRenderer.invoke("agent:stop"),
  reloadAgent: () => ipcRenderer.invoke("agent:reload"),
  getState: () => ipcRenderer.invoke("agent:get-state"),
  getMessages: () => ipcRenderer.invoke("agent:get-messages"),
  getLastAssistantText: () => ipcRenderer.invoke("agent:last-assistant-text"),
  newSession: () => ipcRenderer.invoke("agent:new-session"),
  switchSession: (sessionPath) => ipcRenderer.invoke("agent:switch-session", sessionPath),
  setSessionName: (name) => ipcRenderer.invoke("agent:set-session-name", name),
  forkMessages: () => ipcRenderer.invoke("agent:fork-messages"),
  rewindSession: (mode) => ipcRenderer.invoke("agent:rewind", mode),
  forkSession: (entryId) => ipcRenderer.invoke("agent:fork", entryId),
  cloneSession: () => ipcRenderer.invoke("agent:clone"),
  getSessionTree: () => ipcRenderer.invoke("agent:session-tree"),
  exportSessionHtml: (outputPath) => ipcRenderer.invoke("agent:export-html", outputPath),
  exportSessionJsonl: (outputPath) => ipcRenderer.invoke("agent:export-jsonl", outputPath),
  shareSession: () => ipcRenderer.invoke("agent:share"),
  sendPrompt: (message, streaming, images) => ipcRenderer.invoke("agent:send-prompt", message, streaming, images),
  steerPrompt: (message, images) => ipcRenderer.invoke("agent:steer", message, images),
  abort: () => ipcRenderer.invoke("agent:abort"),
  setTreeLabel: (entryId, label) => ipcRenderer.invoke("agent:set-label", entryId, label),
  clearQueue: () => ipcRenderer.invoke("agent:clear-queue"),
  extensionUiResponse: (id, payload) => ipcRenderer.invoke("agent:extension-ui-response", id, payload),
  getSessionStats: () => ipcRenderer.invoke("agent:session-stats"),
  resetTask: () => ipcRenderer.invoke("agent:reset-task"),
  compactSession: (customInstructions) => ipcRenderer.invoke("agent:compact", customInstructions),
  setSessionModel: (provider, modelId) => ipcRenderer.invoke("agent:set-model", provider, modelId),
  cycleSessionModel: () => ipcRenderer.invoke("agent:cycle-model"),
  getAvailableModels: () => ipcRenderer.invoke("agent:available-models"),
  getCommands: () => ipcRenderer.invoke("agent:commands"),
  getCapabilities: (force = false) => ipcRenderer.invoke("agent:capabilities", force),
  runShell: (command, excludeFromContext) => ipcRenderer.invoke("shell:run", command, excludeFromContext),
  abortShell: () => ipcRenderer.invoke("shell:abort"),
  editText: (text) => ipcRenderer.invoke("editor:edit-text", text),
  getPermission: () => ipcRenderer.invoke("config:get-permission"),
  setPermission: (mode) => ipcRenderer.invoke("config:set-permission", mode),
  getThinkingLevels: () => ipcRenderer.invoke("agent:thinking-levels"),
  setThinkingLevel: (level) => ipcRenderer.invoke("agent:set-thinking-level", level),
  cycleThinkingLevel: () => ipcRenderer.invoke("agent:cycle-thinking-level"),
  setAutoCompaction: (enabled) => ipcRenderer.invoke("agent:set-auto-compaction", enabled),
  getAutoRetry: () => ipcRenderer.invoke("agent:auto-retry"),
  setAutoRetry: (enabled) => ipcRenderer.invoke("agent:set-auto-retry", enabled),
  abortRetry: () => ipcRenderer.invoke("agent:abort-retry"),

  setTheme: (theme) => ipcRenderer.invoke("theme:set", theme),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  openPath: (targetPath) => ipcRenderer.invoke("shell:open-path", targetPath),
  copyText: (text) => ipcRenderer.invoke("app:copy-text", text),
  quitApp: () => ipcRenderer.invoke("app:quit"),
  getChangelog: () => ipcRenderer.invoke("app:get-changelog"),
  getZoom: () => ipcRenderer.invoke("app:get-zoom"),
  setZoom: (factor) => ipcRenderer.invoke("app:set-zoom", factor),
  pickFiles: () => ipcRenderer.invoke("dialog:pick-files"),
  searchFiles: (query, cwd) => ipcRenderer.invoke("files:search", query, cwd),
  readImageFiles: (paths) => ipcRenderer.invoke("files:read-images", paths),
  pickDirectory: () => ipcRenderer.invoke("dialog:pick-directory"),
  openPanel: (kind) => ipcRenderer.invoke("panel:open", kind),
  closePanel: () => ipcRenderer.invoke("panel:close"),
  onPanelChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("panel:changed", listener);
    return () => ipcRenderer.removeListener("panel:changed", listener);
  },
  windowAction: (action) => ipcRenderer.invoke("panel:window-action", action),
  getModelConfig: () => ipcRenderer.invoke("config:get-model"),
  saveModelConfig: (config) => ipcRenderer.invoke("config:save-model", config),
  getModelScope: () => ipcRenderer.invoke("config:get-model-scope"),
  setModelScope: (patterns) => ipcRenderer.invoke("config:set-model-scope", patterns),
  getAdvancedSettings: () => ipcRenderer.invoke("config:get-advanced"),
  setAdvancedSettings: (input) => ipcRenderer.invoke("config:set-advanced", input),
  setModelThinkingDefault: (reference, level) =>
    ipcRenderer.invoke("config:set-model-thinking-default", reference, level),
  checkModelConfig: (config) => ipcRenderer.invoke("config:check-model", config),
  testModelConnection: (config) => ipcRenderer.invoke("config:test-model", config),
  testModelInference: (config) => ipcRenderer.invoke("config:test-inference", config),
  clearModelKey: (provider) => ipcRenderer.invoke("config:clear-key", provider),
  startOAuthLogin: (provider) => ipcRenderer.invoke("config:oauth-login", provider),
  cancelOAuthLogin: () => ipcRenderer.invoke("config:oauth-cancel"),
  respondOAuthPrompt: (promptId, value) => ipcRenderer.invoke("config:oauth-prompt", promptId, value),
  logoutOAuthProvider: (provider) => ipcRenderer.invoke("config:oauth-logout", provider),
  listModels: () => ipcRenderer.invoke("config:list-models"),

  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:event", listener);
    return () => ipcRenderer.removeListener("agent:event", listener);
  },
  onStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:status", listener);
    return () => ipcRenderer.removeListener("agent:status", listener);
  },
  onLog: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:log", listener);
    return () => ipcRenderer.removeListener("agent:log", listener);
  },
  onRuntimeExit: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:runtime-exit", listener);
    return () => ipcRenderer.removeListener("agent:runtime-exit", listener);
  },
  onTheme: (callback) => {
    const listener = (_event, theme) => callback(theme);
    ipcRenderer.on("theme:changed", listener);
    return () => ipcRenderer.removeListener("theme:changed", listener);
  },
  onModelChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("model:changed", listener);
    return () => ipcRenderer.removeListener("model:changed", listener);
  },
  onOAuthEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("auth:oauth-event", listener);
    return () => ipcRenderer.removeListener("auth:oauth-event", listener);
  },
  onResourcesChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("resources:changed", listener);
    return () => ipcRenderer.removeListener("resources:changed", listener);
  },
  onSessionsChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("sessions:changed", listener);
    return () => ipcRenderer.removeListener("sessions:changed", listener);
  },
  onMcpCommandState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("mcp:command-state", listener);
    return () => ipcRenderer.removeListener("mcp:command-state", listener);
  },
  onAgentReloaded: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:reloaded", listener);
    return () => ipcRenderer.removeListener("agent:reloaded", listener);
  },
});
