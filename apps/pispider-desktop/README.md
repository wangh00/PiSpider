# PiSpider Desktop

PiSpider 的桌面客户端。视觉和交互参考豆包 Desktop：左侧项目/最近/资源导航，中间 Agent 对话与工具调用，右侧固定为浏览器/代码查看，底部固定 composer。界面默认使用简体中文。

这一版复用同一个 PiSpider runtime、同一套提示、规则、Skill、任务状态和会话目录，不内置 `web_hook`、`js_bundle`、`node_replay` 等具体 JS 逆向工具。PiSpider 仍然是一个通用 Agent；桌面端负责窗口、输入、会话和资源操作，Agent 逻辑仍只走 RPC。MCP 窗口的预置目录来自 `catalog/catalog.json`（当前保留 Google 官方 `chrome-devtools` 和远程 HTTP 的 `context7`）：预置项默认不安装、不启动，用户点击后才进入准备流程；stdio 预置懒安装，HTTP 预置只写配置，MCP 包内 Skill 只保留在包内，不复制到用户技能目录；带启动参数的预置先弹参数窗口。`filesystem`、`memory`、`sequential-thinking` 已按必要性评估从默认目录移除，参数化能力保留给后续新增条目。当前已落地能力、剩余缺口和下一步顺序见 [docs/desktop-status.md](../../docs/desktop-status.md)。

## 启动

从仓库根目录：

```powershell
npm run pispider:desktop
```

如果 `apps/pispider-desktop/node_modules` 里还没有 Electron：

```powershell
cd apps/pispider-desktop
npm install --ignore-scripts --no-audit --no-fund --no-package-lock --workspaces=false
node node_modules/electron/install.js
```

当前固定使用 Electron `45.3.2`。Electron 的二进制不在 npm 安装阶段生成；`install.js` 会把它下载到 `node_modules/electron/dist/`。

也可以直接使用仓库根 `node_modules` 里的 Electron（workspace 安装会把 Electron hoist 到根目录）：

```powershell
cd apps/pispider-desktop
..\..\node_modules\electron\dist\electron.exe .
```

如果使用上面的独立安装，则改用 `node_modules\electron\dist\electron.exe .`。

Mermaid 运行时使用裁剪副本，生成命令：

```powershell
npm run build:mermaid
```

脚本从根 `node_modules/mermaid` 只复制入口、flowchart / sequence、ELK / dagre / swimlane / cose 布局、KaTeX 和 BPMN 图标所需的 37 个文件到 `vendor/mermaid`，约 3.44 MB；打包时应排除完整的 `node_modules/mermaid`，只带 `vendor/mermaid`。未生成裁剪副本时，renderer 会回退到完整安装的 Mermaid。

## 运行链路

```text
Electron main
  -> node scripts/run-pispider.mjs --mode rpc
  -> PiSpider launcher
  -> Pi core RPC
```

- `main.cjs` 负责启动 runtime、解析 JSONL RPC、维护请求超时、扫描会话、处理 IPC 和窗口主题。
- `preload.cjs` 只通过 `contextBridge` 暴露白名单 API；renderer 没有 Node 访问。
- `renderer/` 是无框架 DOM UI，不依赖前端构建工具。`renderer/panel.html` / `panel.js` 是规则、技能、设置、项目、MCP、会话和状态的独立子窗口。
- `main.cjs` 的 `panel:open` 为每个面板维护一个子窗口；重复点击会聚焦已有窗口，不会重复创建。
- 开发模式 runtime 使用系统 Node 启动；Electron 的 `process.execPath` 指向 `electron.exe`，开发时不能直接拿来 spawn `run-pispider.mjs`。打包模式例外：三处 Agent 子进程用 `process.execPath` 加 `ELECTRON_RUN_AS_NODE=1` 复用随包 Electron 二进制作为 Node，详见下方“打包（Windows）”。
- 桌面端设置 `PISPIDER_DESKTOP=1`、`NO_COLOR=1`，数据仍然写入 `%USERPROFILE%\.pispider`，不会读写 `~/.pi`。

## 打包（Windows）

```powershell
cd apps/pispider-desktop
npm run dist:win
```

`dist:win` 先执行 `prepare:packaged`（`scripts/prepare-packaged-runtime.mjs`）幂等重建 `build/packaged/` staging：launcher closure（`scripts/` + `packages/pispider/`）和完整 core 1.5.2 缓存副本；自检通过后再由 electron-builder 26.18.0 产出 NSIS 安装包。首次构建会下载 nsis / winCodeSign 到 electron-builder 本地缓存。

产物在 `release/`：

- `PiSpider Setup <version>.exe`：NSIS 安装包（非 oneClick、perMachine=false）；
- `win-unpacked/`：解包可运行目录，入口 `PiSpider.exe`。

随包 `resources/` 布局：

```text
resources/
  app.asar                         # main / preload / renderer / 共享 helper
  app.asar.unpacked/oauth-bridge.mjs
  launcher/                        # scripts + packages/pispider closure
  runtime/core-1.5.2/              # 完整 core 缓存副本（node_modules + npmrc）
```

打包运行时方案：

- 打包分支三处 spawn 用 `process.execPath` + `ELECTRON_RUN_AS_NODE=1`，复用随包 Electron 二进制作为 Node；`PISPIDER_CORE_CACHE` 进程级早设指向 `resources/runtime/core-1.5.2`，launcher 解析为 runtime 模式（`cached core 1.5.2`），不回退系统 Node。
- 随包依赖必须放在版本化子目录下：electron-builder 默认排除 extraResources 源目录根级的 `node_modules`。
- MCP stdio 预置懒安装到 `~/.pispider/agent/mcp-packages/<catalog-id>`；读不到 npm CLI 时目录与命令列表走可读中文降级。
- 打包实例与 dev 实例共享 `PISPIDER_HOME/agent` 会话与配置；Electron userData profile 按 productName 隔离，localStorage / 主题互不影响。

未做：代码签名、electron-updater 自动更新、macOS / Linux 目标、portable 单文件目标。

## 第一次使用

桌面端和 CLI 共用同一个 PiSpider 配置。启动后右侧默认打开 `浏览器`；左栏 `项目` / `规则` / `技能` / `MCP` / `状态` / `设置` 会打开独立窗口显示路径和资源列表。

如果显示 `No model configured`，打开左下角的设置入口（`Ctrl+,`），在“模型”区域选择服务商、填写 API Key 和模型 ID，然后点“保存并重启 Agent”。保存会同步写入：

- `%USERPROFILE%\.pispider\agent\auth.json`：API Key 或 OAuth 凭据；
- `%USERPROFILE%\.pispider\agent\settings.json`：默认 provider / model；
- `%USERPROFILE%\.pispider\agent\models.json`：自定义端点的 provider 配置。

内置服务商（DeepSeek、OpenAI、Anthropic、OpenRouter、Moonshot、Kimi For Coding、Z.AI）使用 Pi 的模型目录；自定义端点使用 OpenAI 兼容接口，也可以选择其他协议。Provider OAuth 已接入设置页：Kimi For Coding（设备码）、OpenRouter（浏览器回调 + 授权码兜底）、OpenAI（ChatGPT 登录）。登录通过独立桥接进程调用 Pi `ModelRuntime.login/logout`，不复制 provider 协议；MCP OAuth 已在 MCP 窗口接入。

## 当前桌面能力

- `新建任务`：创建新会话。
- `最近`：扫描 `~/.pispider/agent/sessions`，置顶会话排在最前；列表按置顶 / 今天 / 昨天 / 本周 / 更早分组，删除为行内二次确认，当前会话不显示删除入口；顶部“排序任务”按钮切到手动排序模式，按置顶 / 最近分组显示 `≡` 手柄，可拖动或 `Alt+↑/↓` 调整，顺序自动写入 `desktop.json.sessionOrder`，普通视图按该序展示，“恢复默认”清空排序；搜索由主进程读取会话 JSONL，支持标题、ID、目录、用户 / 助手消息正文、`re:` 正则、引号短语和多 token，结果带 snippet、匹配字段与“相关度 / 最近”排序，命中文本高亮；单文件上限 8 MB，最多返回 80 条。
- 窗口状态：主窗口位置、尺寸和最大化写入 `desktop.json` 的 `windowState`，启动恢复；`resize` / `move` / `maximize` / `unmaximize` 250ms 防抖写回，关闭时同步补写；坐标不在任何显示器可见区域时回退为居中。单实例锁保证第二次启动只聚焦已有窗口。
- 启动恢复上次会话：切换会话或一轮运行结束后把当前会话路径写入 `desktop.json` 的 `lastSessionPath`；进程启动后自动打开。没有记录或路径失效时取最近更新的已保存会话，仍没有才回退到空会话。新建会话在文件尚未落盘时不覆盖旧记录。
- 会话置顶：每项右侧星标写入 `desktop.json` 的 `pinnedSessions`，重启后保留。
- 会话排序：`desktop.json` 的 `sessionOrder` 保存手动展示序；`listSessions` 先按置顶分组，再按该序、最后按更新时间排序，排序模式内拖动或 `Alt+↑/↓` 即自动保存。
- 会话切换：调用 Pi RPC `switch_session`。
- 主界面会话用量：输入框模型名左侧显示上下文圆环，按已用 token 比例填充，并在环右侧显示百分比；点击圆环打开会话用量弹层，显示上下文百分比与进度条、已用 / 窗口 tokens、输入、输出、Token 总量和成本，并提供手动刷新；数据来自 `get_session_stats`，每轮结束和压缩结束后更新，流式期间不逐 token 刷新。上下文达到 75% / 90% 时圆环转为危险色。
- 消息流：监听 `message_start` / `message_update` / `message_end`，支持文本、thinking 和工具调用。
- 增量渲染：消息列表按结构签名重建，流式 token 只替换当前 live 助手节点；每个用户回合内如果出现工具结果 / shell 动作或仍在运行的工具，就把中间助手文字和动作按原始顺序收进一个可折叠回合卡。卡头在历史回合显示“用时 X · N 个动作”，运行中显示“正在运行 · 当前命令”；最终助手回复留在卡外直接可见，最终 assistant 的思考过程、中间文字和动作按原顺序收进展开层，展开后逐条查看工具名、类型、摘要、参数和输出。运行中的工具行直接更新在回合卡里，不再另外重复一份实时工具组。
- 长会话虚拟滚动：只渲染视口附近约 120–176 条消息，顶部和底部 `.message-virtual-spacer` 用已测高度和文本 / 代码 / 回合卡分类型估算补齐整段会话，原生滚动条代表完整会话；滚动时按目标偏移切换切片，单次最多 200 条。用户 / 助手正文宽度按 `#messageList` 动态计算，Markdown 标题 / 列表 / 代码块按块级高度累加，列表渲染为正常 `<ul>`。已测高度按会话持久化到 `localStorage`（最近 10 个会话、每会话最多 5000 条，版本 5 记录 `layoutWidth` / `layoutZoom` 和内容指纹），reload / 切换后复用与当前布局及内容匹配的已访问切片；窗口宽度、应用缩放或右栏开合改变列表宽度时，旧布局高度失效并重测当前切片，布局变化前记录锚点或底部意图，重测后恢复。240 条混合探针首次打开总高度差已从 `-900.8px` 校准到 `-39.6px`。消息总数超过 120 条时标题下显示“共 N 条”，旁侧提供“最早 / 最新”按钮；`Ctrl+Home` / `Ctrl+End` 跳到最早 / 最新切片。切片切换和流式更新前后按消息 key + 视口偏移恢复锚点。
- 会话切换与滚动恢复：切换会话前按 `sessionFile` 记录当前切片、锚点和位置，切回时优先按 `anchorKey / anchorIndex / anchorOffset` 精确恢复；第一次打开没有快照的长会话从最新切片开始并落底，不会因加载期滚动触发错误切片。`refreshFromAgent` 用代际标记丢弃过期响应，避免 `session_start` 与 `switchSession` 并发刷新用旧切片覆盖新会话。
- 模型思考强度：桌面菜单过滤 Pi 的 `minimal`，只显示“关闭 / 低 / 中 / 高 / 极高 / 最高”，也不在每项下重复 raw level 文案；设置页只读显示当前会话实际可用档位。模型弹层的“该模型启动默认”可为当前模型写入 `settings.json.modelThinkingLevels`（键为精确 `provider/modelId`），保存后重启 Agent 并同步当前会话，选择“跟随全局”可清除。推理模型保存时默认声明 xhigh / max，写入 `models.json` 的 `thinkingLevelMap`；Anthropic Messages 自动写入自适应思考（effort），避免 Pi 把极高 / 最高折叠成 high。设置页不再有扩展档位开关。
- 模型菜单：只显示 Pi 返回的可用档位；当前模型只有基础档位时，菜单底部提示“当前模型还没有‘极高 / 最高’档位”，不会把极高 / 最高伪装成可用项。
- 模型作用域：模型弹层的“作用域设置”列出全部可用模型，勾选后写入 `settings.json.enabledModels` 并重启 runtime；有作用域时菜单默认只显示 scoped 模型，标题可切“全部 / 作用域”，“下一个”调用 RPC `cycle_model` 并遵守 scope。桌面按模型列表保存为精确 `provider/id`；已有精确 `:thinking` 后缀会保留，通配模式在保存时会规范成已选模型；逐模型默认思考档位在同一弹层内单独设置。
- 窄窗口：启动时视口小于 1180 且右栏偏好为打开时，本次布局默认折叠右栏；用户仍可点标题栏按钮展开，偏好不被覆盖。1320px 以下手动展开右栏时改为 absolute 覆盖层，底边停在 composer 上方，不再挤压主对话和输入框。
- 可访问性：纯图标按钮带 `aria-label`；确认 / 输入 / 选择弹层支持 Tab 焦点循环，选择弹层支持上下方向键，Escape 关闭。
- 视觉 token：`renderer/tokens.css` 是主窗口和二次窗口共用的颜色、字体、圆角、阴影来源；`styles.css` / `panel.css` 只保留布局和组件规则。
- 状态横幅：输入区上方显示可操作状态，运行时连接失败给“重试”，桌面信息读取失败给“重新加载”，模型未启用图像输入给“打开设置”；可关闭，操作后自动隐藏。
- 回合卡与动作行：监听 `tool_execution_start` / `update` / `end`；历史工具结果 / shell 动作和中间助手文字按用户回合收进一个可折叠回合卡，运行中的工具也直接作为卡内动作行，卡内动作行逐条显示工具名、类型标签、摘要、参数和实时输出 / 结果，`bash` / `read` / `edit` / `write` / `grep` / `find` / `ls` / `ps_task` 有对应中文类型，输出区可滚动；已写入历史消息的工具不再在实时行里重复显示，`toolList` 只在回合卡未出现在当前渲染切片时兜底显示。
- 右侧面板：`浏览器`、`代码`。1320px 以下展开时用覆盖层，底边按 composer 高度动态留白。浏览器是 `<webview>`，带后退、前进、刷新/停止和地址栏同步，可以输入 `http://` / `https://` 地址；代码面板来自当前会话里的 `write` / `edit` 工具，也可以通过 `打开项目文件` 读取仓库内文件，显示文件 tab、面包屑、行号、完整文件内容或文本差异。没有工具修改时，代码空态会列出 `git status` 的更改；当前目录不是 Git 仓库时，回退为按修改时间排序的项目最近文件列表，点击可直接打开。
- 左侧只保留 `项目`、`资源`、`最近` 三个区域；规则、技能和 MCP 数量直接显示在侧栏，`状态` 入口在资源区。
- 左栏的 `规则`、`技能`、`设置`、`项目` 和会话信息不再占用右侧面板，分别打开独立子窗口。同一时间只允许一个二次窗口：打开后主窗口出现灰色遮罩并阻止点击，点击遮罩或按 `Esc` 会关闭窗口；再次点左栏功能不会叠加新窗口。子窗口使用无系统边框的透明窗口壳、圆角容器和自定义标题栏；`规则` 子窗口支持新建、编辑、启用/停用、重置正文和删除规则，重置恢复内置模板并保留名称和描述，删除前会移动到 `~/.pispider/backups/rules`；`技能` 子窗口支持新建模板、从目录导入、删除和打开目录，删除前备份到 `~/.pispider/backups/skills`；技能文件变更后由顶部“重载 Agent”生效。子窗口和主窗口同步主题。
- 二次窗口布局（2026-11-18）：规则 / 技能 1000×700、设置 1060×820、MCP / 扩展 1060×800、项目 940×680、会话 940×780、状态 1000×800，按显示器可用区域收缩并相对主窗口居中。标题和元信息同排，右侧操作区独占；正文留白改为 18 / 26px；原先的大 hero 改为单行状态摘要（状态点 + 行内事实），四指标卡改为无阴影数值条。设置页模型卡去掉重复 eyebrow 和“连接参数”，文件目录两列；MCP 预置卡片只展示前 10 个工具并显示 `+N`，主 CTA 为描边按钮；规则 / 技能 / MCP 空态时隐藏顶部重复的新建按钮。
- 规则是保存在 `~/.pispider/rules/<id>/RULE.md` 的可复用提示约束，带 id/name/description frontmatter；当前只启用一条，启用后在下一次 Agent 对话中注入。规则不是 Skill：规则约束行为，Skill 提供工作流能力。
- `MCP` 子窗口支持用户级和项目级配置：用户级读写 `~/.pispider/agent/mcp.json`，项目级读写当前工作区的 `.pi/mcp.json`；支持 stdio / HTTP 服务器添加、编辑、删除、启停、服务器级工具暴露（codemode / deferred / direct / hidden）、逐工具启停列表和逐服务器检查。MCP 窗口顶部只保留“添加服务器 / 重载 Agent / 检查连接”，不再放“刷新”“重连 MCP”“打开 MCP 目录”；外部修改配置后点“检查连接”重新读取并握手，重载 Agent 后也会自动补一次检查，配置卡保留 `mcp.json` 的“打开”。内置预置目录读取 `apps/pispider-desktop/catalog/catalog.json`，加载器按条校验并归一化，当前保留 Google 官方 `chrome-devtools-mcp@1.13.0` 与远程 HTTP MCP `context7`（`https://mcp.context7.com/mcp`，匿名可用）；`filesystem`、`memory`、`sequential-thinking` 已按必要性评估从默认目录移除。未启动时只显示名称、类型、安装状态，以及同一行右侧的“准备并启动 / 说明”；包版本、运行要求和接口地址收在“说明”弹层里，不把这些说明堆在卡片上。MCP 条目仍支持 `inputs`（`text` / `directory`）和 `${WORKSPACE}`、`${PISPIDER_HOME}`、`${PISPIDER_AGENT_DIR}`、`${HOME}`、`${PATH_SEP}`、`${input.<id>}` 占位符，目录输入会展开 `~`、按工作区解析相对路径并校验存在，供以后新增带参数的预置使用；有输入项的预置点“准备并启动”先打开参数弹层，必填项为空时阻止提交。点击“准备并启动”后，stdio 预置执行 npm 安装到 `~/.pispider/agent/mcp-packages/<catalog-id>`，写入带 `managedBy` / `catalogId` 的受管条目；HTTP 预置跳过 npm 安装，直接写入 `url` / `headers` 配置。MCP 包内自带的 Skill 只保留在包内，不复制到 `~/.pispider/skills`，也不在技能窗口生成预置卡片。安装 / 写配置成功后若 Agent 空闲会立即重载并检查连接，正在流式工作时则提示结束后手动重载。预置 MCP 用 Electron 自带 Node 24 启动，系统 Node 仍是 Agent runtime。预置项不会自动安装或自动启动，只有用户点击后才进入准备流程；项目级作用域不显示预置目录；manifest 单条无效只进入 diagnostics，面板“目录 / 检查错误”会显示；新增预置只需编辑 `catalog.json`。逐工具列表由最近一次检查结果和已有 `toolExposure` 合并生成，复选框控制启用，下拉选择 `direct` / `deferred` / `codemode`，未勾选保存为 `hidden`；没有发现工具时提示先检查，仍可手动编辑 `mcp.json`。`检查连接` 直接读取 Agent runtime 的 RPC `mcp_status`，显示 MCP 扩展实际连接状态、失败原因和已发现工具，摘要标为“Agent 实时”；配置已保存但 runtime 未加载时显示“需重载 Agent”。只有 Agent 未运行或 runtime 不支持该 RPC 时，才回退到本地 stdio / HTTP `initialize + tools/list` 探测，并标为“离线检查”；HTTP 返回 401/403 时显示“需要登录”。`登录` / `登出` / `重连` 通过 RPC `prompt` 调用 `/mcp login|logout|reconnect <name>`；登录会打开浏览器授权页，并在主窗口弹出输入框接收回填 URL；重连只作用于指定服务器。MCP 命令发送前会读运行时能力探测缓存，命令列表缺少 `mcp` 时给出可读的不支持错误，未检查时放行由 runtime 报真实错误。`重载 Agent` 在 MCP 窗口会重启 Agent、保留当前会话并自动检查启用服务器；单服务器“重连”仍通过 `/mcp reconnect <name>` 保留，不再提供窗口级“重连 MCP”按钮。项目级配置需要先在设置里信任当前项目，再重载 Agent。登录 / 登出 / 重连发送期间主窗口会显示 pending 横幅，发送完成显示“已发送…请在 MCP 窗口确认状态”，失败显示错误文本；三种状态都可直接跳到 MCP 窗口。MCP 扩展通过 `registerMcpStatusProvider(provider, subscribe)` 在连接状态变化时通知 runtime，`AgentSession` 发出 `mcp_status_changed` 事件，主进程只把该事件转发给 MCP 子窗口；面板收到后原地更新状态行和“已连接”数值，无需再点“检查连接”。
- `设置` 子窗口的“项目信任”可以在“不加载 / 信任当前项目”之间切换；信任会写入 `~/.pispider/agent/desktop.json`，runtime 下次启动带 `--approve`，加载当前工作区的 `.pi` 设置、扩展、MCP 和 Skill。
- 设置子窗口的“工作模式”区域可以切换领域模式（自动识别 / JavaScript / App），并显示当前规则；“模型”区域配置服务商、API Key、模型 ID，自定义端点额外提供接口地址和协议，并提供本地“检查配置”、联网“测试连接”和真实“测试推理”。当前 provider 支持 OAuth 时，API Key 下方会出现“账号登录”行：Kimi For Coding 显示设备码，OpenRouter / OpenAI 显示授权链接和手动回调输入；登录弹层可取消，成功后重启 Agent 并恢复当前会话，登出删除本地凭据。测试连接通过 GET 模型列表验证端点和 Key，成功后可点击返回的模型填入模型 ID；“测试推理”发送一条最小请求，会消耗少量推理额度。Anthropic Messages 地址保存时会自动去掉末尾 `/v1`，避免 SDK 拼成 `/v1/v1/messages`。保存会写 `auth.json` / `settings.json` / `models.json`，重启 runtime 后会恢复当前会话，主窗口通过 `model:changed` 重新连接。
- 设置子窗口的“高级设置”区域读写用户级 `settings.json`：传输协议（auto / sse / websocket / websocket-cached）、HTTP 代理、Shell 路径、默认工具列表（纯名称替换默认集合，`+名称` / `-名称` 增删，不能混用）以及自动压缩开关、预留 / 保留 token 参数；保存时校验代理协议、工具列表和 token 整数，写入后重启 Agent 并保留当前会话，`compaction.modelOverrides` 不覆盖。项目级 `.pi/settings.json` 的同名键仍可能覆盖用户级值。
- 设置子窗口的“提示词”区域列出 `core` / `workflow` / `js` / `app`，可以直接编辑、恢复默认和打开目录；修改后由顶部“重载 Agent”生效。“预览最终提示词”复用 `composePrompt`，显示实际字符数、启用规则和最近一次 `ps_task` 任务来源，可输入草稿消息重算领域路由。
- `状态` 子窗口汇总模型、思考强度、当前项目权限、项目信任、会话、规则、技能、MCP、提示词字符数、领域模式和最近一次 `ps_task` 的阶段 / 目标 / 下一步；项目级资源未信任时会标注“未加载”。环境诊断区可运行检查并“导出诊断”，生成包含应用 / 运行时信息、环境诊断和最近运行时日志的脱敏文本报告；导出前去掉认证原始输出并屏蔽常见 API Key / Bearer / token 形态。
- `ps_task` 的 `details.pispiderTask` 保留在 `会话` 子窗口的任务状态区域；不再在右侧面板堆叠任务/活动/产物 tab。
- `会话` 子窗口读取 `get_session_stats`，显示输入/输出、Token 总量、成本和上下文用量；顶部提供“压缩上下文”“重命名”“回退分支”按钮，分别调用 RPC `compact`、`set_session_name`、`get_fork_messages` + `fork`。窗口内提供“回退上一轮 / 再回退一轮”，走 `get_fork_messages` + `fork`，执行前确认，原分支保留在会话树；还包含自动压缩、全局自动重试、中止重试、复制会话、会话树（节点支持从此分支 / 复制 / 标记）、导出 HTML、导出 JSONL（复制当前会话文件）、从其他目录恢复会话和重置任务（`/ps task reset --yes`，保留对话）。跨目录恢复会把外部 `.jsonl` 校验后复制到当前会话目录，再调用 `switch_session` 打开；同名文件自动加时间戳，不覆盖源文件。模型、思考强度、当前项目权限统一在输入框底部切换，不再在会话窗口重复一套控件。
- 最近会话列表的每一项支持置顶、删除和手动排序；当前会话不能删除，需要先切换。删除只移除对应 `.jsonl` 文件。
- 主对话中每条用户消息和助手回复都带“复制”按钮，按钮固定在消息右下角，默认隐藏，鼠标进入该条消息或键盘聚焦时出现；复制该条消息的纯文本到系统剪贴板。不再提供顶部“复制最后回复”按钮。Markdown 代码块带语言标签和“复制代码”按钮；正文支持标题、无序 / 有序列表、引用、表格、删除线、链接、行内代码和 fenced code block，常见语言有轻量语法高亮，表格可横向滚动；Mermaid 代码块由裁剪后的本地 `mermaid@12.3.0` 运行时懒加载渲染，只保留 flowchart / sequence（含 flowchart-elk），源码默认折叠、可切换显示，渲染失败时显示错误并展开源码；其他 Mermaid 图类型会明确提示当前离线运行时未包含。
- 运行时能力探测：runtime ready 后缓存 `get_commands` 的命令名，`window.pispider.getCapabilities()` 可读取；runtime 退出时清空。当前实测包含 `ps`、`llama`、`mcp`。
- 扩展 UI：`extension_ui_request` 的 `confirm` / `input` / `editor` / `select` 会显示在主窗口对话框；`notify` / `setStatus` / `setWidget` / `set_editor_text` / `setTitle` 也做桥接；弹层关闭后焦点回到打开前的元素。
- 附件：系统文件选择器选择图片时读取为附件，非图片路径追加到 prompt；输入框支持 `@` 文件搜索、粘贴或拖拽图片，最多 4 张，发送时作为 RPC `prompt.images` 传入，模型需在设置窗口开启“图像输入”。输入框输入 `/` 会通过 RPC `get_commands` 打开命令面板，支持名称/描述过滤、方向键、`Enter` / `Tab` 插入；命令仍通过正常 prompt 执行。
- 主题：浅色 / 深色，标题栏 overlay 跟随主题，二次窗口同步。
- 字号：主窗口正文 14px，代码查看器 12.5px；子窗口正文 14px、标题 23px，表单元件 13.5px，解决早期 10–12px 过密的问题。
- 发送/停止：composer 右侧只有一个按钮；未流式时发送上箭头，流式时显示停止方块。停止会先 `clear_queue` 把排队文本放回输入框，再调用 `abort`。运行中普通 Enter 按 `followUp` 排队；运行中 `Ctrl+Enter` 调用 RPC `steer` 插话。composer 下方有“N 条排队”按钮，点开可按插话 / 排队分组查看和逐项复制；`清空排队` 会把全部文本放回输入框。Pi 当前没有逐条删除 RPC，因此不伪造单条删除。`Ctrl+N` 新建任务，`Ctrl+B` 开合右栏，`Ctrl+G` 打开外部编辑器编辑当前草稿。
- 长会话滚动：只在发送、切换会话或原本就在窗口底部时自动跟随；用户向上滚动阅读时不会被流式输出强行拉回，历史窗口内新增消息只更新底部占位高度、不改变视口。滚动区域顶部有 sticky“回到最新”按钮，点击会重置到最新切片并回到底部；从远离底部的位置直接回底，避免平滑滚动经过切片边界，到底后按钮自动隐藏。
- 滚动位置：每个会话单独记住阅读位置，切走再切回时恢复；同一会话后台刷新也不会把位置拉到底部。快照记录 `top / ratio / atBottom / atLatest / anchorKey / anchorIndex / anchorOffset`，恢复时优先按锚点定位，缺失时回退 `top / ratio`，`atLatest` 直接取最新切片；位置保存在 renderer localStorage，重启后恢复。
- 快捷键：标题栏和输入区提示旁都有“快捷键”入口；`Ctrl+/` / `F1` 打开按输入、窗口、导航分组的 20 条快捷键，`Esc` 关闭。`Ctrl+Home` / `Ctrl+End` 在非输入控件聚焦时跳到最早 / 最新消息窗口。
- 命令面板：输入区“命令”按钮或 `Ctrl+Shift+P` 打开；搜索 20 个桌面动作和 Pi 斜杠命令，`↑↓` 选择、`Enter` 执行、`Esc` 关闭；最近执行过的命令以“最近使用”置顶。
- 会话搜索：输入后可用 `↑↓` 移动结果、`Enter` 打开当前项，`Esc` 清空并退出搜索框；查询非空时显示匹配总数和“相关度 / 最近”排序，`re:` 前缀按正则搜索，非法正则会在搜索区显示错误。`/resume` 或 `Ctrl+Shift+K` 打开独立“恢复会话”导航，可按标题 / 路径 / 预览过滤，`↑↓` 选择、`Enter` 切换、`Esc` 关闭。
- 窗口缩放：`Ctrl +` / `Ctrl -` 以 10% 步进在 70%–140% 调整，`Ctrl 0` 回到 100%；主窗口与二次窗口同步，缩放值写入 `desktop.json.zoomFactor`，重启恢复。
- 直接 shell：输入框以 `!` 或 `!!` 开头时，通过 RPC `bash` 交给 Pi runtime 执行，结果记录为 `bashExecution` 并进入所属回合的展开动作行，可用发送/停止按钮中断；`!!` 会去掉前缀后执行，记录带 `excludeFromContext: true`，不进入 Agent 上下文。Windows 桌面由 PiSpider 扩展接管 `user_bash`，用 PowerShell 执行，Pi 仍负责记录与上下文语义；macOS/Linux 走 Pi 默认 bash。Windows 桌面的 Agent 工具集也会把 `bash` 替换为 `powershell`，避免 Agent 命令落到 WSL stub；只读 / 禁用工具模式不替换。
- 外部编辑器：输入框按 `Ctrl+G` 会把当前草稿写入临时 Markdown，按 `PISPIDER_EDITOR` / `VISUAL` / `EDITOR` 启动编辑器（Windows 默认记事本，macOS 默认 TextEdit），关闭后回填输入框；Unix 没有配置编辑器时会提示设置环境变量。
- 模型配置：设置窗口支持本地“检查配置”、GET 模型列表“测试连接”和真实“测试推理”；测试推理会消耗少量推理额度。二次窗口改版后，设置页在 1060×820 下直接从模型卡开始，标题与元信息同排，原来的大 hero 改为单行状态摘要；模型卡去掉重复的 `MODEL` eyebrow 和“连接参数”小标题，API Key、接口地址 / 类型、能力与限额同屏，文件与目录改为两列。已保存模型支持推理 / 图像输入元数据、上下文窗口、最大输出；推理模型默认写入 xhigh / max 映射，Anthropic Messages 自动启用“自适应思考（effort）”，设置页没有扩展档位开关。
- 输入框底部：模型胶囊点击后弹出模型和思考强度菜单，切换只影响当前会话；旁边的权限胶囊按当前项目保存“全部允许 / 只读 / 禁用工具”，切换会重启 Agent 并保留当前会话。只读模式使用 `--tools read,grep,find,ls --exclude-tools mcp__*`，禁用工具使用 `--no-tools`。

## 调试

桌面应用以 `--remote-debugging-port=9347` 启动时，可以用仓库内的固定调试脚本读取状态或切换会话：

```powershell
node scripts/pispider-desktop-debug.mjs state
node scripts/pispider-desktop-debug.mjs switch-session <session.jsonl>
node scripts/pispider-desktop-debug.mjs inject-event '{"type":"debug_noop"}'
```

脚本只提供固定命令，不暴露任意 eval；`send` 会走正常输入框路径并调用当前真实模型，可能产生推理费用。脚本不进入正式打包产物。

## 未完成

完整的 CLI / Pi 能力对照和优先级见 [docs/desktop-parity.md](../../docs/desktop-parity.md)。当前主要缺口：

- 扩展 UI 的 TUI 专属能力（`custom`、终端输入等）还没有接入；MCP 已有用户级 / 项目级配置管理、逐服务器检查、工具名展示、stdio / HTTP 检查、服务器级 exposure、逐工具启停列表、OAuth 登录/登出、单服务器热重连和 `chrome-devtools` 内置预置目录；MCP live state 已通过 RPC `mcp_status` 读取实际连接和工具，并通过 `mcp_status_changed` 会话事件推送到 MCP 子窗口，预置准备成功后空闲时自动重载，重载 / 重连时自动经历 starting / connecting / connected / failed，不再依赖手动“检查连接”；逐工具运行时状态订阅还未暴露；内置目录目前保留 `chrome-devtools` 和远程 HTTP `context7`，并已支持 stdio / HTTP 两种预置 transport；`filesystem`、`memory`、`sequential-thinking` 因与 Pi 原生能力重叠或必要性较低，已从默认目录移除。参数化 inputs / 占位符和参数弹层仍保留，后续按同一 `catalog.json` 结构增加真正需要外部连接的预置。Windows 安装包已接入 electron-builder 26.18.0；打包文件白名单见 `package.json.files` 与 `electron-builder.yml`。项目信任入口已接。
- 会话分支已接 label、会话 tree 的“从此分支 / 复制”、rename、删除非当前会话、置顶排序、从其他目录恢复、回退分支、回退上一轮 / 再回退一轮、复制会话、tree 查看、导出 HTML / JSONL、模型 / 思考强度 / 自动压缩 / 自动重试 / 中止重试切换；tree 节点删除未接，侧栏会话列表手动排序已接。
- 模型：默认配置、API Key、自定义端点、已保存模型、本地检查、模型列表探测和真实推理测试已接；输入框模型菜单搜索、模型 / 思考强度循环、作用域编辑已接；provider OAuth 已接 Kimi For Coding、OpenRouter、OpenAI 三家，其他 provider 仍可用 CLI `/login`。
- 文件选择器会把非图片路径追加到 prompt；选择 png/jpg/gif/webp/bmp 时读取为图片附件，输入框 `@` 会检索当前项目文件并插入相对路径；`/share` 已在会话子窗口接入 GitHub 私有 Gist 路径：导出当前会话 HTML 后调用 `gh gist create --public=false`，再生成 `https://pi.dev/session/<gistId>` 预览链接；需要本机安装 `gh` 并已 `gh auth login`，可用 `PISPIDER_GH_BIN` 指定可执行文件路径，`PI_SHARE_VIEWER_URL` 可覆盖预览基址；Pi 的 Radius artifact 路径和分享目的地设置尚未接。
- Electron / Mermaid 依赖已写入 `apps/pispider-desktop/package.json`，并反映到根 `package-lock.json` 的 workspace 条目；`mermaid` 是开发依赖，打包时只带 `vendor/mermaid` 裁剪运行时。当前 Electron 二进制通过根 `node_modules/electron/dist` 使用。Windows NSIS 安装包与应用图标已接；自动更新、代码签名、macOS / Linux 目标和 portable 未做；Mermaid 裁剪已完成。
- 真实 prompt 已验证：自定义 Anthropic Messages 端点使用服务根地址时能返回 assistant 文本；`baseUrl` 带 `/v1` 会触发 `/v1/v1/messages` 404。模型配置 UI 已用真实 Key 验证写入、连接测试和 runtime 重启链路。
- 还没有代码签名、自动更新、macOS / Linux 目标和 portable 单文件包。
