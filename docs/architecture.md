# PiSpider 架构

当前桌面端状态和下一步见 [desktop-status.md](desktop-status.md)；UI 审计见 [desktop-ui.md](desktop-ui.md)；RPC 契约与 Pi 架构同步见 [desktop-runtime-contract.md](desktop-runtime-contract.md)；本页描述长期结构和数据边界。

## 1. 仓库形态

PiSpider 是一个单一 monorepo。根目录既是项目入口，也是 Pi workspace 的根。

```text
PiSpider/
  package.json                 # workspace、构建、测试和 PiSpider 启动脚本
  run.ps1 / run.cmd / run.sh   # 三个平台入口，统一委托 Node 启动器
  scripts/
    run-pispider.mjs        # 跨平台启动器
    pispider-launcher.mjs   # 启动路径解析
    pispider-doctor.mjs     # 环境检查
  packages/
    coding-agent/              # Pi CLI；作为底座使用，不修改其行为
    pispider/               # PiSpider 产品层，纯 JavaScript Pi 扩展包
      vendor/pi-computer-use/  # 可选内置 Computer Use 扩展
    ...                        # Pi 的其他 workspace 包
  apps/                        # Pi 上游实验应用 + PiSpider Desktop 外壳
    pispider-desktop/          # Electron 客户端；只通过 RPC 驱动 runtime
  docs/                        # PiSpider 开发文档
  PRODUCT_PLAN.md              # 产品与实施框架
  PI_README.md                 # 上游 Pi README
```

`packages/pispider` 通过 `package.json` 的 `pi.extensions` 注册 `./src/index.js`。它没有运行时 npm 依赖，也不需要构建；Pi 通过 `-e packages/pispider` 加载。`vendor/pi-computer-use` 是可选的第三方内置扩展，只有开启 `PISPIDER_COMPUTER_USE` 时才会作为第二个 `-e` 入口加载。

## 2. 分层

```text
Pi Core
  packages/agent, ai, coding-agent, tui, ...
        │  公开 Extension API / Session / Prompt / Skill / Fork
        ▼
PiSpider Product Layer
  packages/pispider
        │
        ├── before_agent_start → 追加可见领域提示
        ├── resources_discover → 暴露 $PISPIDER_HOME/skills
        ├── /ps               → 产品命令入口
        ├── ps_task            → 分支感知任务状态
        ├── session_tree/fork  → 回退与状态恢复
        └── vendor/pi-computer-use → 仅在 PISPIDER_COMPUTER_USE=1 时加载
        │
        ▼
Local Data
  $PISPIDER_HOME/
    config.json
    prompts/ rules/ skills/ backups/ state/
    agent/              # Pi 配置、认证、模型和会话
      helpers/pi-computer-use/ # 可选 Computer Use helper
    runtime/core-1.5.2/ # 启动器缓存
```

Pi 核心与 PiSpider 的数据目录分离。产品层只读写 `$PISPIDER_HOME`；启动器同时把 Pi 子进程的全局 agent 目录指向 `$PISPIDER_HOME/agent`，所以独立安装的 Pi 仍使用自己的 `~/.pi`。两边不共享 `~/.pi` 下的认证、模型、MCP 和会话；Pi 上游仍会把 `~/.agents/skills` 作为用户 Skill 根目录加载，这部分不属于 `~/.pi`，如需连它一起隔离，需要后续显式加 `--no-skills` 或调整资源发现策略。

## 3. 启动链路

根目录的 `npm run pispider` 执行 `scripts/run-pispider.mjs`。

启动器按以下顺序选择 Pi 运行时：

1. `PISPIDER_CORE_CLI` 指定的 CLI 文件；
2. `packages/coding-agent/dist/bundle/cli.js`，即当前仓库已构建的 Pi；
3. `$PISPIDER_HOME/runtime/core-1.5.2/` 中的缓存版已发布 Pi；
4. 缓存不存在时，用 npm 将该版本安装到上述缓存目录，再启动。

启动子进程前，启动器会设置 `PI_CODING_AGENT_DIR` 和 `PI_CODING_AGENT_SESSION_DIR`，指向 `$PISPIDER_HOME/agent` 及其 `sessions/`，并移除继承的 `PI_PACKAGE_DIR`。用户也可以通过 `PISPIDER_AGENT_DIR`、`PISPIDER_SESSION_DIR` 覆盖路径。

当 `PISPIDER_COMPUTER_USE=1` 时，启动器额外追加：

```text
-e packages/pispider/vendor/pi-computer-use/extensions/computer-use.ts
```

同时把 `PI_COMPUTER_USE_WINDOWS_HELPER_PATH` 和 `PI_COMPUTER_USE_LINUX_HELPER_PATH` 指向 `$PISPIDER_HOME/agent/helpers/pi-computer-use/`。扩展默认不加载，避免 11 个 Computer Use 工具进入普通会话的工具面。

如果本机已有 Pi 用户配置，可用 `npm run pispider:migrate` 导入认证、模型、MCP、设置和用户指令；`--include-resources` 额外导入主题、提示模板和 Skill，`--include-extensions` 额外导入扩展代码。迁移不复制会话历史，也不覆盖已有文件。

缓存安装使用 `--ignore-scripts`，不执行包生命周期脚本。启动器不依赖 `npx` 从 monorepo 根解析包，避免工作区中的同名源码包抢占已发布版本。

`run.ps1`、`run.cmd`、`run.sh` 只负责定位仓库根目录并调用 `scripts/run-pispider.mjs`，不再经过 npm 参数转发。

### 桌面客户端链路

`apps/pispider-desktop` 是可选的 Electron 外壳，不复制 Agent 逻辑。它由主进程启动：

```text
node scripts/run-pispider.mjs --mode rpc
```

然后按行解析 JSONL RPC，把 `get_state`、`get_messages`、`new_session`、`switch_session`、`prompt`、`abort`、`clear_queue` 包装成受控 IPC。renderer 通过 `contextBridge` 只拿到白名单方法，不直接访问 Node。

`main.cjs` 使用系统 Node（`PISPIDER_NODE`、`npm_node_execpath`，最后回退 `node`）启动 runtime，不能使用 Electron 的 `process.execPath`，因为开发态下那指向 `electron.exe`。桌面端的窗口、主题、会话扫描和文件选择都在主进程完成；runtime 仍写入 `$PISPIDER_HOME`，和 CLI 共用同一份配置与会话目录。

主进程在 runtime ready 后调用 RPC `get_commands`，把命令名缓存在 `AgentProcess.capabilities`，通过 `agent:capabilities` 暴露给 renderer；runtime `exit` 时清空。依赖扩展命令的桌面入口（例如 `/mcp login|logout|reconnect`）先读这份缓存做软门禁：已检查且缺少命令时返回明确错误，未检查时放行由 runtime 报真实错误。能力探测只覆盖命令存在性，不代替参数校验、响应校验或权限模型。

主窗口位置、尺寸和最大化状态写入 `desktop.json` 的 `windowState`。启动时读取，若保存坐标不在任何显示器 workArea 内则只保留宽高并居中；`resize` / `move` / `maximize` / `unmaximize` 250ms 防抖异步写回，关闭时同步补写，避免最后一刻移动窗口丢失。`app.requestSingleInstanceLock()` 保证第二次启动只聚焦已有窗口，没有窗口时重建。`windowState` 与置顶、权限仍共用 `desktop.json`，目前靠原子写降低损坏风险，尚未引入写队列或独立文件。`zoomFactor` 同样写入 `desktop.json`，主进程通过 `app:set-zoom` 应用到所有窗口，启动时恢复。

renderer 的会话列表使用完整虚拟滚动：只渲染视口附近约 120–176 条消息，顶部和底部 `.message-virtual-spacer` 按已测高度与分类型离屏估算补齐整段会话，原生滚动条覆盖完整会话。`renderMessages()` 由 `messageIndexAtOffset()` 选择目标消息、`virtualRangeForIndex()` 生成切片（120 条基准、上下各 28 条 overscan、单次最多 200 条）；`messageHeights` 保存已渲染消息的真实高度，并按会话持久化到 localStorage（最近 10 个会话、每会话最多 5000 条，版本 5，每条含 `layoutWidth` / `layoutZoom` 和内容指纹），reload / 切换后复用与当前布局及内容匹配的已访问切片。`syncMessageHeightLayout()` 在 `renderMessages()` 开头比较 `#messageList.clientWidth` 和 `state.zoomFactor`；宽度差 >2px 或缩放变化时清空当前会话高度、删除该会话缓存并重测当前切片。`window.resize` 120ms 去抖、`setPanel()` 的 280ms / `transitionend`、`applyZoom()` 和 `visibilitychange` 都触发重新渲染；布局操作前记录 `anchorKey / anchorIndex / anchorOffset` 或底部意图，测量后恢复。离屏估算按列表宽度动态取用户 / 助手正文宽度；用户按连续文本计行，助手 Markdown 按标题 / 列表 / 代码块逐块累加（代码块 `56 + 行数 * 20`、块间 gap 14、错误块 34），`renderMarkdown()` 将连续列表行收成 `<ul>`。240 条混合探针首次打开估算与全量真实总高度差为 `-39.6px`（约 0.02%）。滚动刷新经 `scheduleDomUpdate()` 合并，页面隐藏时退化为 `setTimeout`，避免 `requestAnimationFrame` 暂停导致切片停在错误位置。滚动只在 `scrollOnRender` 或距底部 100px 内跟随，用户上滚后流式输出不会改变切片或视口；历史切片内收到 `message_start` / `message_end` 只更新底部占位高度。`thread-scroll` 顶部 sticky“回到最新”按钮会重置最新切片并回底。每个会话以 `top / ratio / atBottom / atLatest / anchorKey / anchorIndex / anchorOffset` 为快照，`switchSession()` 切换前记录、`refreshFromAgent()` 切换后恢复；恢复时先用 `anchorIndex` 设置切片，再按 key + 视口偏移或比例定位，缺失锚点时回退 `top / ratio`。`scrollRestorePending` 期间 `normalizeMessageWindow()` 不跟随底部，避免历史锚点被最新切片覆盖；`refreshFromAgent()` 仍用代际标记丢弃过期响应。没有快照的目标会话直接取最新切片并落底。消息总数超过 120 条时标题下只显示“共 N 条”，`Ctrl+Home` 跳到最早切片、`Ctrl+End` 回到最新切片，输入框聚焦时不拦截这两个快捷键，命令面板也提供对应动作。快捷键总览是独立 `#shortcutsDialog`，`Ctrl+/` / `F1` 打开时拦截其他全局快捷键并把焦点留在弹层内。命令面板是独立 `#commandPalette`，`Ctrl+Shift+P` 打开，本地动作直接调用 renderer 函数，Pi 命令来自 `get_commands` 并只把 `/name ` 插入输入框，不伪造执行结果；执行记录只存命令 id 到 localStorage `pispider-command-history`（最多 8 条），打开时置顶为“最近使用”分组。会话搜索的 `↑↓` 只在输入框内移动结果高亮，`Enter` 调 `switchSession()`，不经过命令面板。`queue_update` 的 `steering` / `followUp` 文本数组保存在 renderer，仅用于“N 条排队”面板查看和逐项复制；清空仍走 `clear_queue`，不通过重建队列模拟单条删除。

主界面输入框模型名左侧的上下文圆环通过 `agent:session-stats` 调用 RPC `get_session_stats`；`refreshThreadStats()` 读取 `tokens.input/output/total`、`cost` 和 `contextUsage.tokens/contextWindow`，按当前 `sessionFile` 与 `agentRefreshGeneration` 丢弃过期响应。圆环按 `tokens / contextWindow` 比例填充，右侧显示百分比；点击打开会话用量弹层。数据和弹层在每轮 `agent_settled` 的 `refreshFromAgent()`、`compaction_end` 和手动刷新时更新，流式期间不逐 token 刷新；会话切换、新建和 `session_start` 清空统计并关闭弹层。没有上下文窗口信息时显示空环和“—”；上下文达到 75% / 90% 时圆环转为危险色。

CLI 和桌面共用数据目录，但不是同一个进程。两边同时操作同一会话、`auth.json`、`settings.json` 或 MCP 配置时存在覆盖风险；当前阶段避免让 CLI 和桌面同时修改同一份状态，长期应改为单实例 runtime / daemon，或至少引入写锁。桌面端的新文件读写应优先收敛到 RPC，避免继续扩大主进程直接改配置的范围。

桌面进程首次启动 runtime 后会自动恢复上次会话：切换会话时主进程把路径写入 `desktop.json` 的 `lastSessionPath`，下次 `agent:start` 在启动完成后执行 `switch_session`；记录不存在时取最近更新的已保存会话，路径不在会话目录或文件已删除时回退到空会话。renderer 不需要自己保存“当前会话”，持久状态仍收敛在主进程。

当前桌面客户端只提供通用 Agent 和工具调用展示，不内置 `web_hook`、`js_bundle`、`node_replay`。右栏固定为内置浏览器和当前会话代码更改；左栏的规则、技能、设置、项目和会话信息通过 `panel:open` 打开独立 `BrowserWindow`，不占用右栏。同一时间只保留一个二次窗口：主进程在打开新面板前关闭旧面板，主窗口通过 `panel:changed` 显示灰色遮罩并阻止点击；点击遮罩或按 `Esc` 调用 `panel:close` 关闭当前窗口。二次窗口使用 `frame:false`、`transparent:true` 和透明背景，由 `renderer/panel.css` 的 `.window-shell` 提供圆角与阴影；自定义标题栏通过 `panel:window-action` 执行最小化和关闭。主窗口和二次窗口的视觉变量统一来自 `renderer/tokens.css`，两个窗口的 CSS 只保留布局与组件规则；消息列表按结构签名重建，流式 token 只替换 live 助手节点，历史会话内的中间助手文字和连续工具动作按用户回合收成一个可折叠回合卡，卡头显示用时和动作数，最终回复仍在卡外直接可见。

设置子窗口直接读写 `$PISPIDER_HOME/agent` 下的 `auth.json`、`settings.json` 和 `models.json`。`config:save-model` 会合并 provider 凭据、默认模型和自定义端点；API Key 只写入 `auth.json`，不返回给 renderer。保存后主进程重启 RPC runtime，并发送 `model:changed`，主窗口重新连接。内置 provider 只写 `auth.json` 和 `settings.json`；自定义 provider 还会写 `models.json` 的 `providers` 条目。模型作用域由 `config:get-model-scope` / `config:set-model-scope` 读写 `settings.json.enabledModels`；保存后主进程重启 runtime 并恢复当前 `sessionFile`，RPC 本身没有设置 scope 的入口。详见 [apps/pispider-desktop/README.md](../apps/pispider-desktop/README.md)。

Provider 账号登录走独立的 `apps/pispider-desktop/oauth-bridge.mjs`。主进程只启动这个 Node 桥接进程，通过逐行 JSON 转发 `auth_url`、`device_code`、`prompt` 和 `progress`，实际 OAuth 协议仍由 Pi 公开的 `ModelRuntime.login/logout` 执行，不在桌面复制 provider 实现。当前接入 Kimi For Coding（设备码）、OpenRouter（浏览器回调 + 授权码兜底）和 OpenAI（ChatGPT 登录，固定 `127.0.0.1:1455` 回调 + 手动回调 URL）。凭据由 Pi 凭据存储写入 `agent/auth.json`；成功后主进程重启 runtime 并恢复当前会话，登出删除本地凭据后同样重启。桥接进程可取消，退出或超时会清理；登录只输出状态和模型数量，不把 token 返回给 renderer。


规则通过 `resources:rule`、`resources:create-rule`、`resources:update-rule`、`resources:delete-rule`、`resources:activate-rule` 调用 `packages/pispider/src/rules.js`，不复制规则格式。规则写入 `$PISPIDER_HOME/rules/<id>/RULE.md`，删除前备份到 `$PISPIDER_HOME/backups/rules`；启用状态写入 `config.json` 的 `activeRule`，下一次 Agent 对话重新加载。工作模式使用 `config:get-workspace` / `config:set-domain` 读写同一个 `config.json`。

技能通过 `resources:create-skill`、`resources:import-skill`、`resources:delete-skill` 调用 `packages/pispider/src/skills.js`；导入使用 `dialog:pick-directory` 选择源目录，删除前备份到 `$PISPIDER_HOME/backups/skills`。提示词通过 `resources:prompts`、`resources:read-prompt`、`resources:update-prompt`、`resources:reset-prompt` 调用 `packages/pispider/src/prompts.js`，写入 `$PISPIDER_HOME/prompts/<name>.md`。MCP 通过 `resources:mcp`、`resources:mcp-save`、`resources:mcp-delete`、`resources:mcp-toggle` 读写用户级 `$PISPIDER_HOME/agent/mcp.json` 和项目级 `<repo>/.pi/mcp.json`，`scope` 参数区分两者；`resources:mcp-check` 接受可选服务器名和 scope，对指定或全部 enabled 的 stdio 服务器做 MCP initialize + tools/list 握手，对 HTTP 服务器做 Streamable HTTP initialize + tools/list 握手，401/403 标记为需要登录；MCP 窗口展示返回的工具名。编辑服务器的逐工具列表由检查结果和已有 `toolExposure` 合并生成，复选框控制启用，下拉选择 `direct` / `deferred` / `codemode`，未勾选保存为 `hidden`。MCP 登录 / 登出 / 单服务器热重连通过 `resources:mcp-command` 发送 `/mcp login|logout|reconnect <name>`，发送前读 `agent:capabilities` 的命令缓存做门禁，复用 Pi MCP 扩展在 RPC 模式下的浏览器授权与回填流程。项目级配置需要在设置中信任当前项目后才会被 runtime 加载。会话重命名通过 RPC `set_session_name` 写入当前会话文件；会话窗口还接 `set_model`、`set_thinking_level`、`set_auto_compaction`、`set_auto_retry`，回退分支通过 `get_fork_messages` + `fork`，复制会话、树读取和导出 HTML 分别通过 `clone`、`get_tree`、`export_html`；最近列表删除由主进程校验路径后删除非当前 `.jsonl`，跨目录恢复把外部 `.jsonl` 校验后复制到当前会话目录再 `switch_session`，置顶状态写入 `desktop.json` 的 `pinnedSessions`，并通过 `sessions:changed` 刷新列表。设置窗口的模型“检查配置”只校验本地字段和凭据，不访问网络；“测试连接”通过 GET 模型列表验证端点和 Key，并返回模型候选；`config:test-inference` 发送一条 `max_tokens: 16` 的最小 Anthropic Messages 或 OpenAI Chat Completions 请求，验证真实推理链路，并显示返回文本。自定义 Anthropic Messages 地址保存时会规范为服务根地址，避免 SDK 拼出 `/v1/v1/messages`。

主窗口输入框底部通过 `agent:available-models` 和 `agent:thinking-levels` 打开模型 / 思考强度菜单，切换使用 `set_model` / `set_thinking_level`，只影响当前会话。模型菜单通过 `config:get-model-scope` 读取 `settings.json.enabledModels`：存在 scope 时默认只显示 scoped 模型，标题的“全部 / 作用域”只改变显示过滤，“作用域设置”负责勾选并保存，保存后重启 runtime。模型“下一个”改为调用 RPC `cycle_model`，由 Pi 在 scoped models 中循环并返回 `isScoped`；当前模型不在 scope 时 Pi 会把它补进循环列表。桌面菜单过滤 Pi 返回的 `minimal`，其余档位照常显示；缺少扩展档位时显示说明，不自行补档。设置窗口显示当前会话的 `thinkingLevels`，并读取自定义模型的 `thinkingLevelMap` / `compat.forceAdaptiveThinking`；设置页不再提供扩展档位开关，推理模型保存时默认写入 `thinkingLevelMap` 的 xhigh / max，Anthropic Messages 自动写入 `forceAdaptiveThinking`；启动 / 重载迁移时已有显式 `null` 映射保留。桌面启动和 Agent 重载前会迁移一次自定义模型配置：推理模型缺少 xhigh / max 时补默认映射，Anthropic Messages 缺少 `forceAdaptiveThinking` 时补 true，避免历史模型一直只有基础档位。权限胶囊通过 `config:set-permission` 写 `desktop.json` 的 `sessionPermissions[sessionFile]`，没有会话文件时写 `projectPermissions[repoRoot]` 作为项目默认。切换权限、切换会话、新建会话和启动恢复都会先解析目标会话模式，必要时重启 runtime 并恢复目标会话；runtime 按 `full / readonly / none` 分别不加参数、追加 `--tools read,grep,find,ls --exclude-tools mcp__*` 或 `--no-tools`。`agent_settled` / `session_start` 后把当前会话模式补写回 `sessionPermissions`，删除会话时清理对应条目。模型保存和手动重载也复用同一套 sessionFile 恢复逻辑；手动重载后 `refreshFromAgent` 会等待 `refreshAgentOptions` 完成后再读取消息，避免旧思考档位残留。自定义模型可持久化 `reasoning`、`input`、`contextWindow`、`maxTokens`、`thinkingLevelMap` 和 `compat`，设置窗口会读取已保存模型并提供推理 / 图像输入开关。助手消息的复制按钮通过主进程 `clipboard` 写入系统剪贴板；自动重试的中止按钮调用 RPC `abort_retry`。项目信任写入 `$PISPIDER_HOME/agent/desktop.json`，`agent:reload` 时以 `--approve` 启动 runtime，才会加载当前工作区的 `.pi` 资源；默认以 `--no-approve` 启动，避免 RPC 模式停在信任确认。技能、提示词和 MCP 变更不会自动重启 runtime，桌面端提供 `agent:reload` 重载入口，重载前会取当前 `sessionFile`，启动后重新 `switch_session`，避免丢失当前会话。桌面端目前已接模型、领域模式、规则、技能、提示词、MCP 配置/检查/登录/重连、项目信任、会话重命名、跨目录恢复和置顶；provider OAuth 已接 Kimi For Coding、OpenRouter 和 OpenAI 三家，Pi 的高级设置仍以 CLI 或文件编辑为主。完整的 CLI / 桌面能力差异见 [desktop-parity.md](desktop-parity.md)。

composer 支持粘贴或拖拽图片，最多 4 张，发送时通过 `agent:send-prompt` 的第三个参数传给 RPC `prompt.images`；主进程只接受 `{ type: "image", data, mimeType }` 形状并限制数量。回形针选择图片时，`files:read-images` 读取 png/jpg/gif/webp/bmp 并返回 base64，单张上限 20 MB，避免 renderer 直接访问本地文件。当前会话模型 `input` 不含 `image` 时，renderer 会在输入区上方显示带“打开设置”按钮的状态横幅，避免把不支持的图片发送给模型。用户消息里的图片 block 也会在消息列表中显示缩略图。

输入框里的 `@` 会调用主进程 `files:search`，在当前会话 `cwd` 下扫描文件名和相对路径，跳过 `node_modules`、`.git`、`dist` 等目录，最多返回 30 个候选；renderer 支持方向键、Enter/Tab 选择和点击插入相对路径。它只做路径检索，不搜索文件内容。

`!` / `!!` 直接 shell 由主进程 `shell:run` 执行，不经过 Agent 的 `bash` 工具：Windows 使用 PowerShell，macOS/Linux 使用 bash，`shell:abort` 终止当前子进程。结果只作为所属用户回合展开动作行中的 shell 行展示，不写入 Agent 上下文；`!!` 前缀会被去掉，当前与 `!` 的执行行为一致。这样桌面端不依赖 Windows 上缺失的 WSL / Git Bash，但和 CLI 的用户 shell 语义仍有差异。

## 4. Prompt 装配

`before_agent_start` 事件中，PiSpider 向：

```js
event.systemPromptOptions.sections.pispider
```

写入一个追加 section。Pi 原有的 `preamble`、`rules` 等 section 保持不变。组合顺序为：

```text
Pi 原始 System Prompt
  + Core
  + Workflow
  + 当前 Domain（auto/js/app）
  + 当前规则
  + 当前分支任务状态
  + Prompt Contract
```

默认提示文件位于 `packages/pispider/resources/prompts/`。首次运行时复制到 `$PISPIDER_HOME/prompts/`，之后优先读取用户目录中的副本，不覆盖用户编辑。

活动规则损坏时，基础提示仍然生效，并在末尾追加可见的 `Runtime Warning`。

## 5. 规则与 Skill

### 规则

- 规则正文是 Markdown，带 frontmatter；
- 位置为 `$PISPIDER_HOME/rules/<id>/RULE.md`；
- 同目录 `meta.json` 保存创建时间和元数据；
- 删除前移动到 `$PISPIDER_HOME/backups/rules/`；
- 启用状态写入 `$PISPIDER_HOME/config.json`。

### Skill

- 位置为 `$PISPIDER_HOME/skills/<id>/`；
- 通过 `resources_discover` 交给 Pi；
- 导入目录时先复制到 `$PISPIDER_HOME/state/skill-imports` 暂存并校验；
- 替换已有 Skill 前备份到 `$PISPIDER_HOME/backups/skills/`；
- 校验 kebab-case ID、`SKILL.md` 名称与目录一致、大小上限、文件数上限和符号链接；
- 第一版只支持目录导入，不支持压缩包。

## 6. 任务状态与回退

`ps_task` 的工具结果中保存 `details.pispiderTask`。每次刷新时通过：

```js
ctx.sessionManager.getBranch()
```

沿当前分支重建任务状态。因此：

- 会话回退到旧分支时，任务状态跟随分支回到当时的值；
- 原分支不被删除；
- `/ps task reset` 通过追加 `pispider-task-reset` custom entry 记录重置，不删除历史。

`/ps rewind once|round` 使用 Pi 公开的：

```js
ctx.fork(entryId, { position: "before" })
```

创建新的会话分支，不直接改写会话文件。

## 7. 安全与产品边界

PiSpider 的目标是**合法授权逆向任务的连续性**，不是移除宿主安全约束。

明确不做：

- 修改 Pi 核心包来实现产品行为；
- 宿主包补丁或 Shim；
- 加密、隐藏或不可审计的提示；
- Workspace 基线移除；
- 红队 Drill、越权资产扫描；
- 无条件执行或绕过 Pi 的安全机制。

所有提示、规则、Skill 和任务状态都可从本地文件查看和编辑。PiSpider 与 Pi 的目录隔离、上游差异和升级流程见 [pi-upstream.md](pi-upstream.md)。

## 8. 第三方与许可

- Pi：MIT，见根目录 `LICENSE`；
- dsh-purge：只借鉴通用产品思路，未复制源码、默认提示词或红队内容，详见 `packages/pispider/THIRD_PARTY_NOTICES.md`。
