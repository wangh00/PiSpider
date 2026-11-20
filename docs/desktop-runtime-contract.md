# 桌面端运行时契约与 Pi 架构同步

更新时间：2026-11-16

本文回答两个问题：

1. PiSpider Desktop 的哪些能力来自 Pi 运行时，哪些仍是桌面主进程的本地适配。
2. Pi 升级时，桌面端要按什么契约同步，哪些做法是允许的，哪些需要上游接口。

CI / 功能清单见 [desktop-status.md](desktop-status.md)，CLI 与桌面差异见 [desktop-parity.md](desktop-parity.md)，Pi 升级流程见 [pi-upstream.md](pi-upstream.md)。

## 1. 基线结论

- 仓库内 Pi 包版本：`packages/coding-agent@1.5.2`、`packages/agent@1.5.2`。
- npm 上 `@earendil-works/pi-coding-agent` 最新版本：`1.5.2`（2026-11-16 实测）。
- 启动器 `scripts/pispider-launcher.mjs` 固定 `CORE_VERSION = 1.5.2`，不从 `latest` 动态取版本；桌面 staging 与 `packaged-runtime.cjs` 的同名常量由 `npm run check:core-version` 校验三处一致，升级用 `npm run pispider:core-version -- <x.y.z>`。
- 结论：当前没有 Pi 版本漂移，不需要做包升级；需要做的是桌面端与 RPC 契约的对齐，以及本地适配的收敛。

桌面 runtime 的启动顺序仍是：`PISPIDER_CORE_CLI` → 仓库 `dist/bundle/cli.js` → `$PISPIDER_HOME/runtime/core-1.5.2/` → 安装缓存。开发态可能运行本仓库构建产物，发布态运行缓存的上游 1.5.2；两者必须使用同一套 RPC 契约。

## 2. 能力归属矩阵

| 能力 | 桌面入口 | 真实来源 | 归属 |
| --- | --- | --- | --- |
| runtime 启动 / 停止 / 重载 | `agent:start`、`agent:stop`、`agent:reload` | `node scripts/run-pispider.mjs --mode rpc` 子进程 | 桌面启动器 + Pi CLI |
| 运行时能力探测 | `agent:capabilities` | runtime ready 后调用 RPC `get_commands`，缓存命令名；`exit` 时清空 | Pi RPC |
| 提示、插话、排队、中止 | `agent:send-prompt`、`agent:steer`、`agent:abort`、`agent:clear-queue` | RPC `prompt` / `steer` / `abort` / `clear_queue`；排队状态由 `queue_update` 事件推送 `{steering, followUp}` | Pi RPC |
| 会话新建 / 切换 / 分支 / 复制 / 树 / 导出 | `agent:new-session`、`agent:switch-session`、`agent:fork`、`agent:clone`、`agent:session-tree`、`agent:export-html` | RPC `new_session`、`switch_session`、`fork`、`clone`、`get_tree`、`export_html` | Pi RPC |
| 会话重命名 / 统计 | `agent:set-session-name`、`agent:session-stats` | RPC `set_session_name`、`get_session_stats`；输入框模型名左侧圆环与会话窗口共用 `get_session_stats`，每轮 `agent_settled`、`compaction_end` 和手动刷新时读取 | Pi RPC |
| 树节点标记 | `agent:set-label` | 扩展命令 `/ps label <entryId> <json>` | PiSpider 扩展命令 |
| 模型 / 思考强度 / 压缩 / 重试 | `agent:set-model`、`agent:set-thinking-level`、`agent:compact`、`agent:set-auto-retry` | RPC 对应命令 | Pi RPC |
| 模型思考强度能力 | `agent:thinking-levels`、`config:get-model`、`config:save-model` | 桌面过滤 `minimal` 后展示；推理模型保存时默认写入 `models.json` 的 `thinkingLevelMap` xhigh / max 和 Anthropic 的 `compat.forceAdaptiveThinking`，不再提供设置开关；启动 / 重载前补齐历史模型默认值 | Pi RPC + 桌面本地适配 |
| MCP 配置增删改、启停、逐工具启停、检查 | `resources:mcp-*` | 桌面直接读写 `agent/mcp.json` 或 `.pi/mcp.json`，并自行做 MCP 握手探测；逐工具列表写入 `toolExposure`，未勾选为 `hidden`；`resources:mcp-check` 传空名称时检查当前作用域全部服务器 | 桌面本地适配 |
| MCP 登录 / 登出 / 单服务器热重连 | `resources:mcp-command` | RPC `prompt("/mcp login|logout|reconnect <name>")`；调用前用能力探测结果做命令门禁 | Pi MCP 扩展命令 + 桌面能力门禁 |
| MCP 命令状态跨窗口同步 | `mcp:command-state` | 主进程在 `runMcpServerCommand` 前后广播 `pending` / `sent` / `error`；主窗口显示横幅并可跳到 MCP 窗口 | 桌面本地事件，不属于 RPC 契约 |
| 应用级缩放 | `app:get-zoom`、`app:set-zoom` | 主进程维护 0.7–1.4 的 `zoomFactor`，应用到全部窗口并写入 `desktop.json`；启动时恢复 | 桌面本地适配 |
| 环境诊断 | `system:diagnostics` | 并行执行 Pi core CLI 的 `--version`、`auth check --json`、`list`；叠加 Node / Electron、配置文件存在性、项目信任和权限；不暴露凭据内容 | Pi CLI + 桌面本地汇总 |
| 规则 / 技能 / 提示词 / 领域 | `resources:*`、`config:set-domain` | 动态导入 `packages/pispider/src/*.js`，读写 `$PISPIDER_HOME` | PiSpider 产品层 |
| Pi 提示模板 | `resources:list-prompt-templates`、`resources:read-prompt-template`、`resources:create-prompt-template`、`resources:update-prompt-template`、`resources:delete-prompt-template` | 动态导入 `prompt-templates.js`，读写 `agent/prompts` 和项目 `.pi/prompts`；命令名来自文件名，重载 Agent 后由 Pi `get_commands` 暴露为 `source: "prompt"` | Pi 文件约定 + PiSpider 产品层 |
| Pi 扩展清单 / 启停 | `resources:extensions`、`resources:toggle-extension` | 动态导入 `extensions.js`，扫描 `agent/extensions` 与 `.pi/extensions`，读取 `settings.json.extensions` 的 `+path` / `-path` / `!pattern` / `-builtin:<name>`；启停写回对应 settings，重载 Agent 后生效 | Pi 资源约定 + PiSpider 产品层 |
| Pi package 清单 / 安装 / 更新 / 移除 | `resources:install-package`、`resources:remove-package`、`resources:update-package` | 清单来自用户级 / 项目级 `settings.json.packages`；命令直接执行 Pi core CLI（不经 `run-pispider.mjs` 的 `-e` 参数），项目级要求项目已信任并写 `.pi/settings.json` | Pi package CLI + PiSpider 产品层 |
| 模型配置 / 凭据 / 自定义 provider | `config:get-model`、`config:save-model`、`config:test-*` | 桌面直接写 `agent/auth.json`、`settings.json`、`models.json` | 桌面本地适配（风险区） |
| Provider OAuth 登录 / 登出 | `config:oauth-login`、`config:oauth-cancel`、`config:oauth-prompt`、`config:oauth-logout` | 主进程启动 `oauth-bridge.mjs`，调用 Pi 公开的 `ModelRuntime.login/logout`；`auth_url` / `device_code` / `prompt` / `progress` 通过 `auth:oauth-event` 发给设置窗口；成功后重启 runtime 并恢复当前会话 | Pi 公开 auth API + 桌面桥接 |
| 项目信任 / 会话权限 | `config:get-project-trust`、`config:set-permission` | `$PISPIDER_HOME/agent/desktop.json` 的 `projectTrust`、`projectPermissions`、`sessionPermissions` | 桌面本地状态 |
| 会话置顶 | `sessions:pin` | `desktop.json` 的 `pinnedSessions` | 桌面本地状态 |
| 会话搜索 | `sessions:search` | 主进程递归扫描 `sessions/`，解析会话 JSONL 的 `session` / `session_info` / `message` 条目；匹配标题、ID、cwd、user / assistant 正文，支持 `re:` 正则、多 token、`relevance` / `recent` 排序；单文件 8 MB、最多 80 条 | 桌面本地适配，不复制 Pi 会话结构 |
| 主窗口位置 / 尺寸 / 最大化 | 无单独 IPC，主进程内部 | `desktop.json` 的 `windowState`；启动读取，`resize` / `move` / `maximize` / `unmaximize` 250ms 防抖写回，关闭时同步补写 | 桌面本地状态 |
| 单实例窗口 | 无单独 IPC，主进程内部 | `app.requestSingleInstanceLock()`；第二实例聚焦已有窗口，没有窗口时重建 | 桌面本地能力 |
| 启动恢复上次会话 | `agent:start` | 首次启动后读 `desktop.json` 的 `lastSessionPath`，失效时取最近更新的已保存会话，再 RPC `switch_session`；启动参数先按该会话的 `sessionPermissions` 决定，切换会话和每轮 `agent_settled` 后更新路径与权限映射 | 桌面本地状态 + Pi RPC |
| 会话跨目录恢复 | `sessions:import` | `dialog` 选文件 → 校验 → 复制到 `sessions/` → RPC `switch_session` | 桌面本地适配 + Pi RPC |
| 当前会话删除 | `sessions:delete` | 主进程校验路径后删非当前 `.jsonl` | 桌面本地适配 |
| 项目文件 / 更改 / shell / 浏览器 | `project:*`、`shell:*`、`browser:*` | 桌面主进程 | 桌面本地能力 |

原则：

- Agent 状态、会话内容、模型调用、工具执行只走 RPC，桌面不复制。
- Provider OAuth 不在桌面复制 provider 协议：主进程只启动 `oauth-bridge.mjs`，由桥接进程调用 Pi 的 `ModelRuntime.login/logout`，桌面只负责交互事件和 runtime 重启。
- 桌面可以拥有自己的 UI 状态（置顶、窗口、面板、主题），但不要复制 Pi 的会话结构或消息格式。
- Pi 没有的运行时能力，优先用公开扩展命令桥接（如 `/mcp`、`/ps`），不要修改 Pi 核心。

## 3. 现有风险

### 3.1 配置写入不是单写入点

`auth.json`、`settings.json`、`models.json` 仍由桌面设置窗口直接写入；`mcp.json`、`config.json`、`desktop.json` 也由不同函数分别写。CLI 和桌面同时运行时没有锁，后写覆盖先写。Provider OAuth 走 Pi 的凭据存储，凭据写入带 provider 级互斥；但 API Key 保存仍是桌面直写，两条路径尚未统一到同一个 `config-store`。

本轮已做：

- `desktop.json` 的项目信任、权限、置顶统一走 `writeDesktopSettings()`，内部使用临时文件 + rename 原子写。
- 主窗口 `windowState` 也写入 `desktop.json`：`resize` / `move` / `maximize` / `unmaximize` 250ms 防抖异步写，`close` 时同步补写，避免最后一刻挪动窗口丢失。

仍需做：

- 抽 `config-store`，所有写入走同一入口：读 → 合并 → 原子写 → 备份 → 通知。
- `windowState` 与置顶、权限共用 `desktop.json`，高频 move / resize 仍可能与 pin 写并发；本轮用原子写降低损坏风险，但没有串行队列或独立文件。需要跨进程互斥的配置（auth / settings / models / mcp）加锁文件；无法加锁时，桌面在保存前检测 runtime 是否正在运行并提示。
- 不要新增“某个 IPC 里顺手 writeFile”的写法；新增写入必须先扩展 `config-store`。

### 3.2 RPC 响应没有 schema 校验

桌面主进程用 `call(method, params)` 返回任意 JSON，然后直接读 `response.success`、`response.data`。Pi 1.5.2 的 `rpc-types.ts` 是权威形状，但桌面没有校验。

风险：Pi 升级后字段改名或错误形状变化时，桌面可能静默渲染空数据，而不是明确失败。

建议：

- 由 `rpc-types.ts` 生成或手写一份 JSON schema（只覆盖桌面用到的命令与事件）。
- `runtime-client` 在解析响应时校验 `success`、`command`、`data` 最小字段；事件按 `type` 分发，未知事件计数并记录日志。
- 每次 Pi 升级增加一条契约测试：启动 RPC，调用只读命令，断言响应字段。

### 3.3 直接导入产品层源码

桌面主进程通过 `loadPispiderModule("rules.js")` 等动态导入 `packages/pispider/src/*.js`。这比复制格式好，但仍耦合内部文件路径与函数签名。

建议：

- `packages/pispider` 暴露一个稳定的 `desktop-services` 入口，导出规则、技能、提示词、配置的读写函数和错误类型。
- 或者提供 CLI 子命令，由桌面调用；二选一，不要让桌面记住多个内部模块名。

### 3.4 能力缺口只能靠扩展命令或上游接口

| 缺口 | 现状 | 可行路径 |
| --- | --- | --- |
| 逐条队列查看 / 删除 / 恢复 | RPC 只有 `clear_queue` 返回全部队列文本，没有逐项 API；`queue_update` 只给 `steering` / `followUp` 文本数组 | 当前：`queue_update` 数组在 renderer 只读展示、逐项复制；`clear_queue` 负责全部清空并放回输入框。不采用 `clear_queue` + `follow_up` 重建，因为会丢图片并改变顺序。中期向 Pi 提议 `get_queue` / `remove_queue_item` |
| MCP 服务器状态订阅 | 已接：扩展通过 `registerMcpStatusProvider(provider, subscribe)` 发布快照和变化通知；RPC `mcp_status` 读快照，`mcp_status_changed` 会话事件推送变化。逐工具列表仍只是配置层 `toolExposure`，不是运行时状态 | 检查 + `/mcp reconnect` 保留作为兜底；逐工具运行时状态订阅后续再向 Pi 提议 |
| 会话树节点删除 | RPC `get_tree` 只读，无删除 | 不实现文件级删除；等 Pi 提供分支裁剪 API，或仅做“隐藏节点”本地视图 |
| `/share` | 交互模式命令，RPC 没有对应命令 | 桌面已实现 `export_html` + `gh gist create --public=false` 的 GitHub 私有 Gist 分享，`gh` 登录检查、viewer URL 和临时 HTML 目录由主进程处理；Pi Radius artifact / 分享目的地设置等完整 `/share` 等上游 RPC |
| 单会话权限 | 已接：`desktop.json` 的 `sessionPermissions` 以会话文件绝对路径为 key，缺失时回退 `projectPermissions[repoRoot]`；切换会话、启动恢复、新建会话和权限变更时先确定目标模式，必要时重启 runtime 再 `switch_session` / `new_session` | 无 |
| 模型作用域 | 已接：桌面主进程读写 `settings.json.enabledModels`，保存后重启 runtime；模型菜单默认按 scope 过滤，循环走 `cycle_model` | 若多窗口需要实时同步，可向上游提议 scoped models 的 RPC 读写 |
| 会话节点排序 | 桌面列表已支持置顶；树内节点顺序由 Pi 决定 | 树保持只读顺序，排序只作用于会话列表 |

### 3.5 事件覆盖不完整

桌面 `handleEvent` 只处理一部分 Pi 事件。此前缺少 `session_start`，导致二次窗口切换会话后主窗口不刷新。本轮已补。

维护要求：

- `rpc-types.ts` 或 `rpc-mode.ts` 中新增事件时，必须同步检查 `renderer/app.js` 的 `handleEvent`。
- 未知事件不要静默丢弃：至少在调试日志里记录 `event.type`。
- 每次升级后跑一次“事件清单对照”：Pi 事件 → 桌面处理函数 → 是否有 UI 反馈。

### 3.6 能力探测是软门禁，不是硬依赖

`AgentProcess` 在 runtime ready 后调用 `get_commands`，把命令名缓存在 `capabilities.commands`；`capabilities.checkedAt` 为 `null` 表示尚未检查，runtime `exit` 时清空。`agent:capabilities` 暴露给 renderer，MCP 单服务器命令在发送前先读缓存：

- 已检查且命令列表没有 `mcp` / `/mcp` 时，直接返回“当前 runtime 不支持 /mcp 命令，请升级 PiSpider core 后重载 Agent”。
- 未检查或 `get_commands` 失败时放行 `prompt("/mcp ...")`，由 runtime 返回真实错误；不要把探测失败当成不支持。

边界：

- 能力探测只覆盖命令存在性，不覆盖命令参数、返回形状或工具级状态。
- 新增依赖 runtime 命令的桌面入口时，先登记到 `capabilities` 检查，再在 UI 显示不可用原因。
- 不要把 `get_commands` 的结果当权限模型；权限仍由 runtime 的 tools / approve 参数控制。

## 4. 同步策略

### 4.1 版本策略

- Pi 核心保持 1.5.2，不做本地补丁。
- 升级只按 `pi-upstream.md` §5 执行；升级提交只包含上游包与锁文件。
- 桌面端需要的 Pi 行为，先找公开扩展 API 或扩展命令；找不到再提上游 RPC 需求。

### 4.2 分层策略

```text
Electron main
  ├── runtime-client        JSONL RPC transport, request/response, event fan-out
  ├── config-store          唯一配置写入点（Pi 配置 + PiSpider 配置 + desktop.json）
  ├── session-store         会话扫描、导入、删除、置顶
  ├── pispider-services     规则 / 技能 / 提示词 / 领域 / Pi 提示模板 / 扩展与 package 清单（稳定导出）
  ├── package-cli           Pi core CLI 子进程调用（安装 / 更新 / 移除）
  ├── panel-manager         二次窗口生命周期
  └── browser-controller    右栏浏览器
```

渲染层只通过 `preload.cjs` 白名单调用上述能力，不直接读写文件，也不解析 Pi 的 JSONL。

### 4.3 契约测试

最小集合：

1. 启动 RPC，`get_commands` 必须包含 `mcp`、`ps`。
2. `get_state` / `get_messages` / `get_session_stats` 返回形状符合 `rpc-types.ts`。
3. `switch_session` 能打开复制到 `sessions/` 内的 `.jsonl`（跨目录恢复先导入再切换）。
4. `prompt("/mcp reconnect <name>")` 对未知服务器返回 `disposition: "handled"` 且不崩溃；服务器不存在的错误由扩展通知承担。
5. `sessions:import-path` 对无效 JSONL 返回明确错误，不覆盖同名文件；`sessions:import` 只负责弹文件选择框。
6. 首次 `agent:start` 后 `get_state.sessionFile` 等于 `desktop.json.lastSessionPath`；删除该文件、改成目录外路径或指向无法加载的会话后，启动仍能落到最近会话或空会话，不崩溃。
7. `new_session` 后文件尚未落盘时 `lastSessionPath` 不被覆盖；一轮 `agent_settled` 后若会话文件已存在，则更新为新路径。
8. Pi 升级后，桌面 `handleEvent` 覆盖新增事件或显式忽略。
9. `agent:capabilities` 在 runtime ready 后包含 `mcp`、`ps`；runtime 退出后 `checkedAt` 清空，重新启动后重新探测。
10. 命令列表缺少 `mcp` 时，`resources:mcp-command` 返回可读的不支持错误；未检查时放行，不误报。
11. `resources:toggle-extension` 对自动发现文件写入 `-extensions/foo.ts`，再次启用写入 `+extensions/foo.ts`；拒绝绝对路径和 `..` 逃逸。`resources:extensions` 的项目级资源在项目未信任时返回 `loaded: false`。
12. `resources:install-package` / `remove-package` 调用 Pi core CLI 而不是带 `-e` 的 RPC 启动器；本地 package 移除使用解析后的绝对路径，安装或移除后不改动其他 settings 字段。
13. `system:diagnostics` 返回 Pi 版本、认证状态和 package 诊断文本；不返回 API Key 或其他凭据内容。核心 CLI 缺失时 `core.ok` 为 false，其余本地检查仍返回。
14. 同一会话切换 `full / readonly / none` 后，`desktop.json.sessionPermissions[sessionFile]` 写入新模式，runtime 命令行追加对应参数并恢复同一会话；不同会话各自保留模式，切回时 runtime 按目标会话重启。新建会话回落项目默认；删除会话清理 `sessionPermissions` 条目。

### 4.4 上游接口建议

按优先级提交给 Pi：

1. `get_queue` / `remove_queue_item`：桌面逐条队列管理的基础。
2. `get_mcp_status` / `mcp_reconnect` RPC：`mcp_status` 已接，`mcp_status_changed` 已接；`mcp_reconnect` 仍通过 `/mcp reconnect` 扩展命令。
3. `share_session`：把 `/share` 的导出与上传逻辑暴露给 RPC。
4. `delete_session_node` 或分支裁剪 API：会话树节点删除。
5. scoped models 的 RPC 读写：桌面当前直接读写 `settings.json.enabledModels`，RPC 化后可避免多窗口配置不一致。

在这些接口出现前，桌面只做“可解释的降级”，不复制 Pi 内部逻辑。

## 5. 分阶段

Phase 0（本轮）：

- 完成基线核对：Pi 1.5.2 与 npm 最新一致。
- `desktop.json` 单写入点 + 原子写。
- MCP 登录 / 登出 / 热重连接入 `/mcp` 扩展命令。
- MCP 命令状态通过 `mcp:command-state` 广播到主窗口横幅（pending / sent / error）。
- 排队消息只读面板（`queue_update` 分组查看 / 逐项复制）与长会话完整虚拟滚动、滚动切片切换、锚点 / `atLatest` 恢复、“回到最新”、“共 N 条”提示、`Ctrl+Home` / `Ctrl+End` 首尾跳转和会话切换滚动恢复。
- 会话跨目录恢复、会话置顶。
- 启动恢复上次会话，`desktop.json` 增加 `lastSessionPath`。
- 运行时能力探测 + MCP 命令门禁。
- MCP 逐工具启停列表（`toolExposure`）。
- 主窗口位置 / 尺寸 / 最大化持久化、单实例锁、关闭时同步补写。
- 本文与 [desktop-ui.md](desktop-ui.md) 建立。

Phase 1：

- 从 `main.cjs` 抽出 `runtime-client`、`config-store`、`session-store`。
- `auth.json` / `settings.json` / `models.json` 写入迁移到 `config-store`，加锁与备份。
- 增加 RPC 契约测试和 IPC 参数测试。

Phase 2：

- RPC schema 校验、事件清单对照、未知事件日志。
- 产品层 `desktop-services` 稳定导出。
- 二次窗口与主窗口共用 tokens（已提前完成，见 `renderer/tokens.css`）。

Phase 3：

- 单实例 runtime / daemon；CLI 与桌面通过本地 socket 或锁共存。
- 上游 RPC 接口落地后，移除桌面自定义 MCP 探测与降级逻辑。

## 6. 验收清单

- 每个桌面 IPC 都能在本文矩阵中找到归属；新增 IPC 必须同时更新矩阵。
- 新增配置写入必须经过 `config-store`，且使用原子写。
- Pi 只读命令的响应形状有测试；事件有处理或显式忽略。
- 运行时能力探测与依赖命令的 UI 门禁保持一致。
- `node --check`、`npm run pispider:check`、`npm run pispider:test` 通过。
- Pi 升级后按 `pi-upstream.md` §5.3 与本文章节 3.5 一起检查。
