# 桌面端 UI 结构与优化方向

更新时间：2026-11-18

本文只讨论 `apps/pispider-desktop` 的界面与交互，不重复功能清单。功能状态见 [desktop-status.md](desktop-status.md)，运行时边界见 [desktop-runtime-contract.md](desktop-runtime-contract.md)。

## 1. 目标

PiSpider Desktop 不是把 CLI 塞进一个窗口，也不是配置面板集合。它要像一个本地工作台：

- 主窗口只承担一件事：和当前会话对话，并看见 Agent 正在做什么。
- 浏览器、代码更改是工作区，不是第三个设置页。
- 规则、技能、MCP、扩展、设置、项目、会话详情是低频操作，放在二次窗口，不挤占主对话。
- 视觉上安静、密度可控、状态明确；长时间使用时，重要操作始终在一个视线范围内。

## 2. 现状

已具备的结构：

- 三栏：左栏项目 / 资源入口 / 会话列表，中间对话，右栏浏览器与代码更改。
- 二次窗口：无边框圆角、遮罩模态、单窗口约束、`Esc` 关闭。
- 浅色 / 深色 token、减少动画分支、输入区模型 / Thinking / 权限弹层、斜杠命令与 `@` 文件候选。
- 扩展 UI 的 `confirm` / `input` / `editor` / `select` 已桥接为主窗口对话框。
- 右栏可切换浏览器 / 更改，浏览器有地址栏和前进后退，代码页跟随 `write` / `edit` 工具结果。

这些结构已经够用，问题主要不在“缺页面”，而在一致性、状态表达和长会话性能。

## 3. 审计结论

| 问题 | 证据 | 影响 | 优先级 |
| --- | --- | --- | --- |
| 两套视觉变量 | `styles.css` 与 `panel.css` 各自定义 `--accent`、`--bg`、字体；主窗口 accent 是 `#0f766e`，二次窗口是 `#2b8f78`；主窗口曾引用未定义的 `--font-sans` | 主窗口和二次窗口像两个产品，深色模式也不完全一致 | P0 |
| 全量重绘 | 已改为结构签名重建 + 完整虚拟滚动：只渲染视口附近约 120–176 条消息，上下占位补齐整段会话高度，原生滚动条覆盖完整会话；按消息 key + 视口偏移恢复锚点 | 离屏消息按文本 / 代码 / 工具卡分类型估算，24px 消息 margin 已计入；用户正文按列表宽度的 82% 动态扣 padding，助手正文按 82% 动态宽度，Markdown 标题 / 列表 / 代码块按块级高度累加；240 条探针首次打开估算与全量真实总高度差从 -900.8px 降到 -39.6px（约 0.02%）；高度缓存已按会话持久化并绑定布局宽高，reload 后复用匹配布局的已访问切片，窗口宽度 / 缩放 / 面板开合变化时失效重测并恢复锚点或底部 | P1 |
| CSS 追加式覆盖 | 同一文件里存在多轮“样式修正”段落、重复的 `prefers-reduced-motion`、重复的 `.composer:focus-within`；旧右栏 tab 的样式仍保留 | 改一个组件要追多层覆盖，容易回归 | P1 |
| 信息入口拥挤 | 左栏同时有项目行、5 个资源入口、搜索框和最多 80 条会话 | 会话列表被工具入口挤压，扫描成本高 | P1 |
| 状态反馈分散 | 运行状态在标题栏胶囊，队列有独立面板，资源状态在二次窗口，错误在 toast / 输入区横幅 | 多区域状态仍靠用户自己关联 | P1 |
| 响应式断点 | 1320px 以下右栏改为 absolute 覆盖层，不再占 grid 列；空态卡片 `auto-fit minmax(180px,1fr)`；线程头为标题预留 140px 右槽；二次窗口改为单行摘要并放大到 1000–1060px 宽 | 窄窗口主列 / composer 保持完整宽度，长标题不再压“会话”按钮，二次窗口不再被 hero 和拥挤表单占据首屏 | 已缓解 |
| 快捷键不可发现 | 已新增 `Ctrl+/` / `F1` 快捷键总览和 `Ctrl+Shift+P` 命令面板，覆盖输入、窗口、导航、缩放与 Pi 命令；命令面板记录最近使用 | 快捷入口已集中 | P2 |
| 空态与错误态不完整 | 多数面板有空态，但错误多为 toast，没有“重试 / 打开设置 / 检查连接”的下一步 | 首次配置和连接失败时用户不知道往哪走 | P2 |
| 渲染代码集中 | `app.js`、`panel.js`、`main.cjs` 都是单文件，分别约 90KB、75KB、90KB | 改动面大，难以做组件级测试 | P1 |
| 图标按钮无标签 | 主要图标按钮已补 `aria-label` / `title`，新增图标仍需遵守 | 键盘与读屏回归风险 | P2 |

## 4. 优化方向

### 4.1 信息架构

左栏收敛成三段：

1. 项目头：项目名、当前分支 / 路径、状态入口。
2. 主操作：新建任务、会话搜索。
3. 会话列表：置顶、今天、更早。

规则、技能、MCP、提示词等低频入口不要各占一行。可以收进一个“资源”分组或一个入口菜单，保留数量角标即可。状态页继续作为二次窗口，但标题栏胶囊要能直接打开它。

左栏底部不再展示只有一个选项的“本地工作区”身份块；改成明确的“设置 `Ctrl+,`”操作行，使用齿轮图标、文字标签和快捷键提示，避免被误认成顶部主题切换。

右栏只保留“浏览器 / 更改”两个明确 tab，标题随 tab 变化，不再使用泛化的“工作区”。窄窗口下右栏默认折叠，按钮保留在标题栏；用户手动打开时，1320px 以下右栏改为 absolute 覆盖层，底部停在 composer 上方，不再把主列压到 448 / 508px。

会话详情窗口按“概览 / 控制 / 任务”分区：概览是只读统计，控制是自动压缩、重试、导出、恢复等动作，任务是 `ps_task` 的只读投影。不要把统计、开关和危险操作混在一列按钮里。

### 4.2 视觉系统（黑白灰阶，2026-11-19 冻结）

主窗口与二次窗口共用 `renderer/tokens.css`，颜色、字体、圆角、阴影、动效变量只在这份基线里定义；两侧只覆盖布局，不各自复制一套颜色。当前设计语言：

- **基调：黑白灰阶**。亮色 `--bg #f7f7f7` / `--chat-bg #ffffff` / `--text #1a1a1a`；暗色 `--bg #121212` / `--chat-bg #181818` / `--text #ededed`。主强调色 `--accent` 为炭黑 `#111111`（暗色雪白 `#ffffff`），对比字 `--accent-contrast` 反色；不保留任何彩色品牌 accent。
- **1px hairline 边框体系**。非浮层（侧栏条目、工具卡、动作组、composer、tab、输入区、面板卡片）移除厚重 `box-shadow`，边界统一 `1px solid var(--hairline)`（亮 `rgba(0,0,0,0.06)`、暗 `rgba(255,255,255,0.08)`）；浮层（命令建议、文件候选、弹层、toast、对话框、子窗口外壳）允许保留 `var(--shadow)` / `var(--shadow-soft)` 极淡投影，边框仍为 hairline；模态遮罩统一 `var(--scrim)`。
- **主按钮**。`.new-task`、`.send-button` 与二次窗口 primary 动作用 `var(--accent)` 底 + `var(--accent-contrast)` 字；hover 切 `--accent-strong`，禁用 `opacity: 0.35`；停止态为中性透明描边。次级按钮保持中性描边 `var(--border)`，hover 中性底色变化。
- **chrome 降噪**。常驻计数（`.nav-count` / `.section-count` / `.tab-count`）与常驻 kbd / 快捷键提示为 11px、`opacity: 0.45`、`--muted`；对话框与命令面板正文内的 kbd 只做中性化，不降透明度、不缩字号。
- **语义色点缀政策**。除低饱和三系外不出现彩色：`--danger`（错误 / 危险操作 / 临界用量）、`--success`（成功 / 字符串高亮）、`--warning`（进行中 / 警告 / 数字高亮）。这些变量可在后续按需整体改为纯灰阶；代码高亮的字符串 / 数字也走对应语义色。
- **亮暗双主题**。`tokens.css` 内 `:root` 与 `:root[data-theme="dark"]` 两套基线，主窗口与子窗口同步切换；正文、次要文字与语义色在双主题下保持可读对比度。
- 其余基线：间距 4 / 8 / 12 / 16 / 24；字号 11 / 12 / 13 / 14 / 18 / 24，正文 14，元信息 11–12；圆角 8 / 12；动效 `--motion-fast` 140ms、`--motion-base` 180ms、`--motion-panel` 240ms，浮层 `--ease-standard`，侧栏 / 主区 `--ease-soft`。

旧右栏 tab 的 CSS、重复的动画与 focus 规则在同一轮清理中删除，避免继续追加“修正段落”。

### 4.3 交互状态

输入区是桌面端最重要的组件，应该像一个 run bar，而不是一排互不相关的胶囊：

- 左到右：附件、项目、权限、模型、Thinking；发送 / 停止按钮固定在右侧。
- 流式中显示“停止”，队列中显示队列数并可展开查看；`clear_queue` 之后要有明确反馈。
- 模型 / 权限弹层支持键盘上下选择和 Escape 关闭；当前值用对勾或选中态标记，不只靠颜色。
- 权限按会话生效：弹层标题显示“当前会话工具权限”，切换后重启 runtime 并恢复本会话；切到其他会话时按该会话保存的模式重启，新建会话回落项目默认。状态页与设置页把来源标为“当前会话”或“项目默认”。
- 模型作用域：模型弹层标题的“作用域设置”打开勾选列表，保存写入 `settings.json.enabledModels` 并重启 runtime；有作用域时优先只显示 scoped 模型，标题提供“全部 / 作用域”切换；切到“全部”仍可直接选择非作用域模型，“下一个”循环始终遵守该作用域。桌面保存为精确 `provider/id`，已有精确 `:thinking` 后缀会保留；逐模型思考档位暂无独立 UI，通配模式保存时会规范成已选模型。
- 模型账号登录：设置页当前 provider 支持 OAuth 时，在 API Key 下方显示“账号登录”行，状态区分“未登录 / 当前使用 API Key / 已通过账号登录”，已登录时提供“重新登录”和“登出”。登录弹层按流程展示设备码（Kimi For Coding）或授权链接与手动回调输入（OpenRouter / OpenAI）；设备码和授权页放在独立按钮上，手动输入和“提交”保持在底栏。取消或关闭弹层会终止桥接进程；登录成功后弹层关闭并刷新设置页，状态改为已登录。
- 主界面会话用量：输入框模型名左侧显示 `context-ring`，按已用 token / 上下文窗口比例填充，环右侧显示百分比；没有上下文数据时显示空环和“—”。点击圆环打开弹层，显示上下文百分比与进度条、已用 / 窗口 tokens、输入、输出、Token 总量和成本，并提供手动刷新。数据只来自 `get_session_stats`，在每轮 `agent_settled`、`compaction_end` 和手动刷新时更新，流式期间不逐 token 刷新。上下文达到 75% / 90% 时圆环转为危险色。标题栏只保留“会话”入口，不再放上下文按钮和“复制最后回复”。
- 错误不要只弹 toast：连接失败、模型 401、MCP 需要登录，都应在输入区上方给一条可操作的横幅（重试 / 打开设置 / 登录）。
- 会话行：置顶、相对时间、当前会话指示、悬停操作；删除改成二次窗口内的确认，不再使用阻塞式 `window.confirm`。
- 消息复制：用户消息、助手回复和 shell 命令卡在右下角固定一个悬浮“复制”操作，默认透明且不占布局；鼠标进入该条消息或键盘聚焦时出现，点击复制整条纯文本。shell 卡复制 `$ command` 和输出。复制按钮不再放进消息标签，避免在标题行常驻。
- 消息 Markdown：代码块带语言标签和“复制代码”，点击后直接写系统剪贴板；语言为空时显示 `text`，不在 DOM 上重复存一份代码文本。
- 桌面级缩放：`Ctrl +` / `Ctrl -` 以 10% 步进在 70%–140% 调整，`Ctrl 0` 回到 100%；主窗口与二次窗口同步，写入 `desktop.json` 的 `zoomFactor`，重启恢复。
- MCP 操作：登录 / 重连期间主窗口显示 warning 横幅和“打开 MCP”，完成后切到 info 横幅提示“已发送请求，请在 MCP 窗口确认状态”，失败显示 error 横幅与错误文本；MCP 窗口内按钮仍同步 pending 禁用。
- MCP 预置目录：用户级服务器列表把内置目录和已安装配置合并展示；未启动项只显示“预置 / 未启动”、名称、类型和“准备并启动 / 说明”，包版本、用途说明、运行要求收在“说明”弹层，不再铺在卡片上；启动后徽标保持“预置”，状态改为“已启用 / 已安装”，操作切换为停用 / 说明 / 检查 / 编辑 / 删除 / 重连。MCP 包内自带的 Skill 只保留在包内，不复制到 `~/.pispider/skills`，说明弹层也不展示“随包技能”。卡片不展示空的检查结果，避免把“已启用”误读成“已连接”；启动完成后若 Agent 空闲会自动重载并检查连接；正在流式工作时提示结束后手动重载。HTTP 预置不执行 npm 安装，卡片仍显示接口地址与“无需本地安装”。

### 4.4 长会话性能

`renderMessages()` 已从每帧全量重建改为结构签名重建：

1. 以消息 id（没有 id 时用角色 + 时间戳）建立 `Map<id, HTMLElement>`。
2. 消息数量或顺序变化时才整体重建；流式 token 只替换当前 live 助手节点。
3. 历史工具结果 / shell 动作在 `visibleMessages()` 中按**用户回合**收口：每个 user 消息之后的连续消息作为一个回合；若其中存在 action 消息，或最后一个回合还有运行中的工具，就只生成一个最终 assistant 视图，把中间 assistant 文本和连续动作组按原顺序挂到 `_turn.steps`，运行中的工具作为末尾的 live action 组。回合卡默认收起，卡头在历史回合显示“用时 X · N 个动作”，运行中显示“正在运行 · 当前命令”；最终助手回复留在卡外可见，最终 assistant 的 thinking、中间文字、工具名、类型、摘要和参数 / 输出按原顺序收进展开层。运行中工具行的状态和实时输出直接刷新在回合卡内，`toolList` 只在回合卡不在当前切片时兜底。回合卡或卡内动作行展开 / 收起会重测当前切片并更新虚拟占位；展开状态按 turn / row key 保存，重渲染不会丢失。无工具动作的普通回合不建卡。
4. 实时工具按 `toolCallId` 增量更新，状态与输出变化时才更新 live action 行；已写入历史消息的 `toolCallId` 从实时组中过滤，避免历史回合与实时组重复。live final 文本只替换回合卡外的最终内容，保留 `turn-card` 和动作行节点；live action 行只重建末尾的 live 行列表。
5. 长会话使用完整虚拟滚动：渲染切片以 120 条为基准、上下各留 28 条 overscan，单次最多 200 条；顶部和底部 `message-virtual-spacer` 用已测高度 + 离屏估算高度补齐整段会话，原生滚动条代表完整会话，不再代表某个 120–360 条分段窗口。
6. 滚动时由 `messageIndexAtOffset()` 选出目标消息，`virtualRangeForIndex()` 生成新切片；`messageHeights` 只保存已渲染消息的真实高度。测量使用 `getBoundingClientRect().height + getComputedStyle().marginBottom`，offsets / spacers 统一按完整流高度计算，避免每条消息少算 24px。离屏消息由 `messageEstimatedHeight()` 分类型估算：用户消息按 `messageList.clientWidth * 0.82 - 26` 的动态正文宽计算连续文本行数，`24 + 41 + 行数 * 24 + 图片行 * 194`；助手正文按 `messageList.clientWidth * 0.82` 动态宽度解析 Markdown，普通段落行高 24，标题按 h1/h2/h3 的 48/36/28 高度，列表按每个条目 24 行高，块间 gap 14（标题 17），fenced code block 为 `56 + 行数 * 20`，Mermaid 代码块先按 280 估算并在 SVG 完成后重测，再加 `24 + 42` 外壳、thinking 行高 24 和错误块 34；带 `_turn` 的最终助手消息额外按 `46`（36px 回合卡头 + 10px 下边距）估算，最终 thinking 已收进卡内不另计折叠高度，展开后的中间文字和动作行以真实测量为准。`renderMarkdown()` 把连续的 `-` / `*` 列表行收成一个 `<ul>`，不再生成裸 `<li>` 或被浏览器补出的 `<br>`。切片切换和流式更新前后用消息 key + 视口偏移恢复锚点，虚拟目标落位后再次保存快照；`messageDataKey` 确保旧会话 DOM 不会在新会话 key 下写入错误滚动位置，`scrollRestorePending` 期间忽略 `rememberScrollPosition()`。会话切换和 reload 优先按 `anchorKey / anchorIndex / anchorOffset` 精确恢复，缺失时回退 `top / ratio`。
7. 高度缓存按 `sessionFile` + 当前消息布局持久化：`localStorage` 键为 `pispider-message-heights`，版本 5，每条缓存含 `layoutWidth` / `layoutZoom`，只保留最近 10 个会话、每会话最多 5000 条；消息键优先用消息 id，无 id 时用角色 + 时间戳，不再拼切片下标；缓存值改为 `{ height, signature }`（持久化为 `{ h, s }`），`signature` 是 `messageHeightSignature()` 生成的内容指纹。`resetMessageHeights()` 先按旧会话自己的 `layoutWidth` / `layoutZoom` 保存当前会话，再 seed 目标会话缓存；只有目标缓存的宽度差 ≤2px 且缩放差 ≤0.001 时才种入 `state.messageHeights`，否则保留空表并按当前布局重新测量。`syncMessageHeightLayout()` 在 `renderMessages()` 开头比较 `#messageList.clientWidth` 与 `state.messageHeightLayoutZoom`，布局变化时清空当前会话已测高度、删除该会话缓存、递增 `messageHeightVersion` 并重测当前切片；`resize` 120ms 去抖、面板 `transitionend` / 280ms 兜底、`applyZoom()` 和 `setPanel()` 都会触发重新渲染。布局变化前会记录 `anchorKey / anchorIndex / anchorOffset`，或记录“原本在底部”的意图，重新测量后再恢复锚点 / 回底；因此切换会话、reload、窗口宽度、右栏开合和缩放不会把旧布局高度与新布局混用。`measureRenderedMessages()` 在高度变化后 600ms 去抖写入，`pagehide` 立即 flush。内容指纹覆盖角色、正文 / 思考、图片 mime 与 base64 长度、工具名、命令、退出码和错误文本：消息 id 不变但正文被编辑时，`messageMeasuredHeight()` 不命中旧高度并按新内容重新估算，`messageStructureKey()` 也用同一指纹让历史消息重建；版本 5 之前的数字型缓存不会被加载。
8. `agent_end` 后不要同时刷新会话、规则、技能、MCP；资源只在 `resources:changed` 时刷新。

### 4.5 可访问性

- 所有图标按钮补 `aria-label` 和 `title`，装饰性图标标 `aria-hidden`。
- 焦点环统一使用 accent 半透明描边；本轮已加全局 `:focus-visible`，后续不要在各组件里重复关闭。
- 弹层支持 Escape、方向键、Tab 顺序；扩展弹层关闭后焦点回到打开前的元素；二次窗口的焦点回归由系统窗口切换处理，尚未单独验证。
- 深色模式下检查正文、元信息、危险色的对比度；不要只用颜色表达启用 / 停用。
- 继续保留 `prefers-reduced-motion`，新增动画必须接入。

### 4.6 代码组织

- 主进程拆成 `runtime-client`（JSONL RPC 与请求复用）、`config-store`（auth / settings / models / desktop.json 的唯一写入点）、`session-store`（扫描、导入、删除、置顶）、`panel-manager`、`browser-controller`。
- 渲染层拆成 `messages`、`sessions`、`composer`、`right-panel`、`dialogs`；纯函数优先，DOM 更新集中。
- 先用 JSDoc + `checkJs` 给 IPC 参数和 RPC 响应定型，再考虑迁移框架；不要为了 UI 框架重写整个壳。

## 5. 本轮已落地

- 删除主窗口右栏旧 tab 遗留的 `renderOverview`、`renderActivity`、`renderArtifacts`、`renderRules`、`renderSkills`、`renderTask` 及其状态字段。
- 补 `--font-sans` 别名，修复主窗口字体变量缺失。
- 主窗口与二次窗口补全局 `:focus-visible`。
- 删除一组已被后续规则覆盖的旧媒体查询，减少样式层叠。
- 输入框提示补充 `Ctrl+B` / `Ctrl+G`，并新增标题栏快捷键按钮与 `Ctrl+/` / `F1` 总览。
- 会话列表新增置顶按钮与置顶排序；置顶状态写入 `desktop.json`。
- 消息列表改为结构签名重建：只有消息数量 / 顺序 / 角色 / 历史消息内容指纹变化时才整体重建；流式 token 只替换当前 live 助手节点（live 消息不计入结构指纹，避免逐 token 重建）；工具卡按状态 / 内容指纹（长度 + hash）签名更新，同长度内容变化也能触发重建。已用两条临时消息验证用户节点引用不变、live 节点单独替换。
- 抽出共用 `tokens.css`：主窗口与二次窗口共用颜色、字体、圆角、阴影变量；删除两份各自复制的 `:root` / 深色块，二次窗口 accent 从 `#2b8f78` 统一到 `#0f766e`。已用 CDP 确认两个窗口计算后的 accent、字体和背景一致，设置窗口无横向溢出。
- 响应式补 1180 断点：左栏 232、右栏 340、标题目标名截断到 220；启动时 JS 在 1180 以下默认折叠右栏，已删除不会触发的 1040 CSS 规则。
- 输入区上方新增可操作状态横幅：运行时连接失败给“重试”，桌面信息读取失败给“重新加载”，模型未启用图像输入给“打开设置”；支持关闭和操作后自动隐藏。已用 CDP 验证显示、操作回调与关闭。
- 窄窗口默认折叠：启动时视口小于 1180 且上次右栏为打开状态，只把当次布局折叠，不覆盖用户的持久偏好；`panelButton` 同步 `aria-expanded` 和“打开 / 关闭上下文面板”标题。已在 1100 视口验证默认折叠、点击后可展开。
- 完整虚拟滚动：`renderMessages()` 只渲染当前视口附近的消息，列表结构为“顶部 `.message-virtual-spacer` + 渲染消息 + 底部 `.message-virtual-spacer`”；`messageHeights` 保存已渲染消息真实高度（含 24px margin），离屏消息按文本 / 代码 / 工具卡分类型估算。`renderMessages()` 以 120 条为基准、上下 28 条 overscan 选取切片，单次最多 200 条，滚动条覆盖完整会话。滚动事件经 `scheduleDomUpdate()` 合并刷新，窗口隐藏时走 `setTimeout` 路径；`messageVirtualContentTop()` 统一用列表相对滚动容器的位置计算目标偏移，避免 spacer 导致的几何偏差。已用 400 条临时会话验证：初始底部 120 条、范围 280–399、顶部占位约 23240px；`scrollTop=15000` 后渲染 176 条、范围 152–327；点“最早”为 0–175、顶部占位 0；点“最新”为 280–399、底部占位 0；普通滚动不频繁重建 DOM。1200 条会话验证：初始范围 1080–1199、`scrollTop=max`；`scrollTop=50000` 后渲染 176 条、范围 574–749、可见 index 600、顶部占位 47642px、底部占位 35259px，“共 1200 条”；点“最新”回到 1080–1199、`scrollTop=max`；点“最早”为 0–175、`scrollTop=0`。同时删除不再生成的 `.message-history` / `.message-list.dense` 旧样式。
- 长会话范围与首尾跳转：消息总数超过 120 条时，标题下只显示“共 N 条”，`title` 说明“滚动条代表完整会话，当前只渲染视口附近的消息”；右侧保留“最早 / 最新”按钮。`Ctrl+Home` 跳到最早切片并落到顶部，`Ctrl+End` 重置最新切片并回到底部，输入框聚焦时不抢快捷键。命令面板保留“跳到最早消息 / 回到最新消息”两个桌面动作；旧的“加载更早 / 加载较新”按钮和 120–360 窗口范围文案已删除。
- 模型思考强度：桌面菜单过滤 Pi 的 `minimal`，只显示“关闭 / 低 / 中 / 高 / 极高 / 最高”，不再在菜单里重复显示 raw level 文案；当前模型没有扩展档位时在菜单底部说明，不伪造极高 / 最高。设置页只显示当前会话真实档位，不再提供扩展档位开关；推理模型保存时默认声明 xhigh / max，Anthropic Messages 自动写入 `forceAdaptiveThinking`。
- 模型作用域：模型弹层标题新增“作用域设置”，列出 `get_available_models` 返回的全部模型；勾选后保存到 `settings.json.enabledModels`，重启 runtime 并保留当前会话。存在作用域时，模型菜单默认只显示 scoped 模型，标题提供“全部 / 作用域”切换；“下一个”改为调用 RPC `cycle_model`，循环遵守 scope，返回 `isScoped` 时提示“作用域内”。已用临时第二个模型验证：scope 只选一个时菜单只显示一个，切“全部”显示两个，scope 两个时循环从 `grok-4.6` 切到 `grok-4.6-alt`；清理后 `settings.json` 与 `models.json` 恢复原 SHA。
- 设置页视觉与模型名：设置页顶部改为单行摘要，集中显示当前模型、服务商、领域模式、项目信任和上下文窗口；模型卡直接以“模型”标题和当前模型开始，去掉重复 eyebrow 与“连接参数”小标题，API Key、接口地址 / 类型、能力与限额同屏；工作模式 / 项目信任并排，提示词、提示模板和文件目录独立分组，文件目录两列。主保存按钮改为强调色，测试操作收进按钮组。模型 chip、模型弹层、设置页当前模型和作用域列表统一使用真实模型 ID；自定义 provider 的占位名称回退到 `id`，不再显示“自定义模型”这类空泛标注。
- Pi 提示模板卡（2026-11-18）：设置页在 PiSpider 提示词组件下方增加“提示模板”卡，列出用户级 `agent/prompts` 与项目级 `.pi/prompts` 的 Markdown 模板，带“用户 / 项目”chip、描述与参数提示；空态卡提供新建入口，列表行提供编辑 / 删除，无效文件显示“需手动处理”。模板 ID、作用域、描述、参数提示和正文在同一个圆角弹层内编辑；删除前提示备份，删除后提示重载 Agent。文件列表只返回元数据，正文仅在编辑时读取。
- 主窗口布局收敛（2026-11-18）：`.thread-heading` 预留 140px 右槽，长标题在 1440 + 右栏展开（主列 728）时宽 532px，标题右缘 882，“会话”按钮左缘 916，保留 34px 间隔。1320px 以下右栏改为 absolute 覆盖层，1028×700 下主列 / composer 保持 796 / 740，`composer-toolbar` 的 `scrollWidth === clientWidth`；右栏底边按 composer 顶部动态留 24px，输入框和发送按钮不被遮挡。空态卡片改为 `auto-fit minmax(180px,1fr)`，1028 下三卡各 236px，不再折行。当时设置页 hero 从约 164px 压到 129.6px、模型卡从 y305 提到 y265，后续已被二次窗口去 hero 改版取代。文档同步更新到 `desktop-ui.md`、`desktop-status.md` 和 `acceptance.md`。
- 扩展与包窗口（2026-11-18）：左栏新增“扩展”入口和整行“状态”布局。窗口顶部改为单行摘要 + 四段数值条，显示项目信任和已加载扩展 / 已停用 / package 数 / 内置扩展；扩展清单按用户级、项目级、内置扩展分组，行内展示来源、相对路径、加载状态和启停 / 打开操作，停用行降低透明度。package 卡按 source、scope、安装状态、版本、过滤条件、settings 与安装路径展示，空态提供安装入口；安装 / 更新 / 移除使用同一个圆角弹层，确认按钮在命令执行期间禁用，失败时把 CLI 错误尾部留在弹层内。底部说明第三方 package 会执行代码，并提示重载 Agent 后生效。
- 主界面会话用量：`.thread-actions` 新增 `threadStatsButton` 与 `threadStatsPopover`；按钮显示“上下文 9%”，无上下文时回退到 token 总量或“用量”，达到 75% / 90% 分别切换 warn / critical 样式。弹层显示上下文进度、11k / 128k tokens、输入 63、输出 163、Token 总量 11k、成本 `$0.0000`，支持“刷新”；点击按钮打开、点击外部或 `Escape` 关闭，`aria-expanded` 同步。统计在 `refreshFromAgent()`（`agent_settled`）、`compaction_end` 和手动刷新时更新，会话切换 / 新建 / `session_start` 清空并关闭弹层。已在真实 `111` 上验证浅色、深色和 140% 缩放（视口 1028）：按钮前缀隐藏、无标题重叠，弹层未溢出；真实会话、`models.json`、`settings.json` 哈希未变。
- 虚拟滚动真实高度：删除 `120 / 88` 固定估算，新增 `MESSAGE_MARGIN_HEIGHT=24`、`MESSAGE_TEXT_LINE_HEIGHT=24`、`MESSAGE_CODE_LINE_HEIGHT=20`、`MESSAGE_CODE_BLOCK_OVERHEAD=56`、`MESSAGE_CODE_BLOCK_GAP=14`、`MESSAGE_TOOL_RESULT_HEIGHT=53`、`MESSAGE_ERROR_HEIGHT=34`；`measureRenderedMessages()` 把 computed `marginBottom` 计入真实高度，offsets / spacers 按完整流高度计算。用户和助手正文宽度改为按 `#messageList.clientWidth` 动态计算（用户扣掉气泡 padding），Markdown 按标题 / 列表 / 代码块逐块累加高度，标题 h1/h2/h3 为 48/36/28，块间 gap 14（标题 17），列表条目 24，代码块 `56 + 行数 * 20`；Mermaid 代码块先按 280 估算，SVG 完成后重测；`renderMarkdown()` 将连续列表行收成 `<ul>`。用 240 条混合探针（短用户、20–180 行代码助手、12 段中文助手、40 行工具结果、长中文用户、短助手、长英文 + 代码、thinking、错误、双代码块 + 标题 / 列表循环）验证：首次窗口 120–240、只测 120 条时估算总高度 `182048.4`，隐藏容器全量真实 `181720.9`，差 `-327.6px`；继续把助手宽度改为 82% 后估算总高度 `181800`、首次窗口差 `-39.6px`（约 0.02%），全量估算偏差 `-79.1px`；全量渲染约 372ms。渲染切片实际高度与缓存一致，锚点 `scrollTop≈29990`、窗口 `[13,189]`、index 41 在 reload 和切到真实 `111` 再切回后保持。
- 高度按会话持久化：新增 `pispider-message-heights`、版本 3、最近 10 个会话、每会话 5000 条上限；`state.messageHeights` 在切换 / reload 时先保存当前会话，再从目标会话缓存 seed，消息键优先用 id、无 id 用角色 + 时间戳。上一轮 240 条测试会话首次渲染缓存 120 条（约 5.5KB）；reload 后初始窗口 120–240、缓存 120 条全部命中。滚动到 `scrollTop=50000` 后补测中段，缓存增至 189 条；切到真实 `111` 再切回，窗口 `[51,227]`、`scrollTop=50017`、缓存 189 条命中；再次 reload 仍恢复同一窗口和位置，说明已访问切片的总高度不再因 reload 重新估算而漂移。高度缓存版本先升到 3；随后的布局失效改造升到 4（见下条），旧版本条目不会被加载，需要按新布局重新测量。
- 窗口宽度 / 缩放布局失效：缓存版本升到 4，每条记录保存 `layoutWidth` / `layoutZoom`。`syncMessageHeightLayout()` 读取 `#messageList.clientWidth`（0.1px 精度）和 `state.zoomFactor`，宽度差超过 2px 或缩放变化时清空当前会话已测高度、删除该会话缓存并重测当前切片；`renderMessages()` 开头执行同步。`window.resize` 120ms 去抖、`setPanel()` 后 280ms 和 `contextPanel` 的 `transitionend`、`applyZoom()` 返回后都触发 `scheduleRender()`；`document.visibilitychange` 回到可见时也补一次渲染。布局切换前用 `anchorKey / anchorIndex / anchorOffset` 精确保留位置，原本在底部时记录 follow-latest 意图，重新测量后回底。实测 240 条探针：在 `scrollTop=30000`、窗口 `[23,199]`、首可见 index 51、偏移 -66.3 时从 100% 缩放到 140%（列表宽 860→714），锚点仍为 index 51、偏移 -66.2；从 140% 回到 100% 仍为同一 key / index 51、偏移 -66.4；滚到底后缩放，`scrollTop` 始终等于 `scrollMax`；合成 1440→1000 视口宽度后列表宽 860→685，锚点 index 49、偏移 -1044.7 保持。面板从关闭到打开使列表宽 860→646，用禁用过渡的等价测试验证锚点 index 49 保持。reload 后 `layoutWidth=714`、缓存 176 条命中；切到真实 `111` 时因宽度 724 与缓存 860 不匹配不 seed，切回探针仍命中；真实 `111` 的 860px 缓存未被探针布局覆盖。
- 样式清理：删除主窗口遗留的 task / activity / artifact 组件规则，合并重复的 `.composer:focus-within`，删除不会触发的 1040 面板隐藏规则；虚拟滚动落地时又删除 `.message-history` / `.message-list.dense`，规则数不再作为固定验收值。
- 会话列表分组与内联删除：按“置顶 / 今天 / 昨天 / 本周 / 更早”插入分组标题；删除不再弹阻塞式 `window.confirm`，当前会话不显示删除入口，点其他行的 × 后在行内显示“删除？删除 / 取消”，取消恢复原行。已用 CDP 验证分组标题、确认态、取消路径和当前会话保护。
- 图标按钮与弹层键盘：刷新任务、设置、附件、发送、浏览器前进 / 后退 / 刷新等纯图标按钮补齐 `aria-label`；确认 / 输入 / 选择弹层支持 Tab 焦点循环，选择弹层支持上下方向键，Escape 关闭。已用 CDP 验证方向键从 A 移到 B、末尾 Tab 回到首个控件。
- 搜索命中高亮与全文搜索：`highlightText()` 先按原文小写查找，再逐段 `escapeHtml`，命中片段用 `.search-hit` 标记；左栏查询通过 `sessions:search` 交给主进程读取会话 JSONL，匹配标题、ID、目录、用户 / 助手消息正文，支持 `re:` 正则、引号短语和多 token；结果行显示 snippet、匹配字段标签和“相关度 / 最近”排序。搜索时不再渲染分组标题；单字母 token 不参与高亮，避免 `inspect a file` 把每个 `a` 都染色。已用 CDP 验证标题命中、消息正文命中、`re:insp.*file`、非法正则错误、`relevance` / `recent` 切换和 `inspect a file` 的 2 处高亮。
- MCP 逐工具启停列表：编辑弹层用检查结果和已有 `toolExposure` 合并工具行，每行复选框 + `direct` / `deferred` / `codemode` 下拉；取消勾选禁用下拉并保存为 `hidden`。已用 CDP 验证 `deferred` / `hidden` 回显、勾选后下拉启用、`collectMcpToolExposure()` 输出 `{ echo: "direct", ping: "deferred" }`。
- MCP 批量检查（2026-11-18）：MCP 窗口打开时自动检查当前作用域全部服务器，顶部只保留“添加服务器 / 重载 Agent / 检查连接”；“刷新”和窗口级“重连 MCP”已移除，检查按钮在检查期间显示“检查中…”并禁用，完成后刷新摘要“N / M 已连接”、数值条和每台服务器的状态 / 工具 / 错误。已用两台临时服务器验证：一台停用显示“已停用”，一台不可达 HTTP 服务器显示 `error / fetch failed`，顶部为 `0 / 1 已连接`，窗口无横向溢出；临时配置已删除。
- 压缩说明（2026-11-18）：会话窗口顶部“压缩上下文”改为先打开确认弹层，包含可选多行“压缩说明”和默认策略提示，确认按钮“开始压缩”；非空说明通过 `compact` 的 `customInstructions` 传给 Pi，留空则使用默认策略。压缩期间顶部按钮显示“压缩中...”，完成后刷新会话统计。已验证弹层文案、输入框和取消路径；测试拦截时没有写入真实会话。
- 窗口状态持久化：`windowState` 保存位置、尺寸和最大化；启动恢复，屏幕外坐标回退为居中，关闭时同步补写。已实测重启恢复 1440×920、最大化恢复 1920×1040、恢复普通窗口后写回 `maximized:false`。
- 扩展弹层焦点回归：打开时记录当前焦点，关闭后 `focus()` 还原；已用 CDP 验证确认框打开后焦点进入弹层、关闭后回到原按钮。
- 长会话滚动与回到最新：`renderMessages()` 只在 `scrollOnRender` 或距底部 100px 内自动跟随；用户上滚后流式输出不会改变当前切片和视口，只更新底部占位高度。“回到最新”会重置到最新切片并回底；原本远离底部时直接回底。已用 400 条临时会话验证历史切片内注入 `message_start` / `message_update` / `message_end` 不移动视口；点击“回到最新”恢复最新切片和 `scrollTop=max`。1200 条会话在 `scrollTop=50000` 时注入流式事件，窗口保持 628–803、`scrollTop` 保持 50000、DOM 176 条。
- 会话滚动记忆：以 `sessionFile` 为键保存 `top / ratio / atBottom / atLatest / anchorKey / anchorIndex / anchorOffset`（最多 120 个会话），切换会话时先记录当前位置，再恢复目标会话；`atLatest` 直接回到最新切片，历史位置优先按消息 key + 视口偏移精确恢复，缺失时回退 `top / ratio`。已用 400 条会话验证 `scrollTop=10000`、可见 index 117、偏移 14.28 的快照在 reload 后恢复为 index 117、偏移 14；1200 条会话在 index 648、偏移 -62 时切到真实会话再切回，仍为 index 648、偏移 -62。
- 会话切换端到端：1200 条临时会话没有快照时首次打开为最新切片（1080–1199）并落到底部；保存 index 648 的锚点后切到 `111` 再切回，恢复同一消息和同一视口偏移；reload 也按锚点恢复。`refreshFromAgent()` 用代际标记丢弃过期响应，`sessionFile` 变化时重置虚拟切片；恢复期间 `scrollRestorePending` 阻止 `normalizeMessageWindow()` 跟随底部，避免历史锚点被最新切片覆盖。
- 队列逐条查看：`queue_update` 的 `steering` / `followUp` 数组保存在 renderer，`N 条排队` 按钮打开排队面板，按“插话 / 排队”分标签展示，每项可复制；`清空排队` 仍调用 `clear_queue` 并把全部文本放回输入框。Pi 当前没有 `get_queue` / 单条删除 RPC，因此这是只读查看 + 复制的降级原型，逐条删除仍等上游。
- 资源入口为两列网格：规则 / 技能 / MCP / 扩展占两行，状态作为整行入口放在下方，避免第 5 项留下空网格；数量角标分别维护规则、技能、MCP 和非内置扩展数量。
- 动效统一：`tokens.css` 新增 `--motion-fast` / `--motion-base` / `--motion-panel` 和 `--ease-standard` / `--ease-soft`；主窗口浮层、侧栏、主区、代码页和二次窗口统一引用。主窗口与二次窗口各自只保留一条全局 `prefers-reduced-motion` 规则（动画 1ms、过渡 1ms、滚动 auto），删除三段分散的组件级 reduced-motion。CDP 确认两侧窗口 `panel-enter` / `sidebar-in` 时长均为 240ms、token 读到 `240ms`。
- MCP 状态横幅：`runMcpServerCommand` 在能力门禁和 `/mcp` prompt 前后广播 `mcp:command-state`，主窗口按 `pending` / `sent` / `error` 显示 warning / info / error 横幅，均带“打开 MCP”动作；已用 CDP 验证三种文案、色调和跳转。
- 代码块复制：`renderMarkdown` 为每个 fenced code block 生成 header（语言标签 + “复制代码”），消息列表用事件委托读取 `<code>` 文本并写系统剪贴板；已验证 `js` 标签、按钮和剪贴板 `const x = 1;`。
- Markdown 扩展（2026-11-18）：`renderMarkdown` 从单段正则改为块解析，支持标题 h1–h6、段落、无序 / 有序列表、引用、表格（含左 / 中 / 右对齐）、删除线、行内代码、链接和 fenced code block；常见语言按关键字 / 字符串 / 数字 / 注释做轻量高亮，未知语言退回纯文本。表格外层 `.markdown-table-wrap` 横向滚动，引用块用左侧强调线，代码块复制按钮保留。已用 CDP 渲染样例验证 `<h1>`、`<ul>`、`<ol>`、`<blockquote>`、`<table>`、`<hr>`、`.code-block`、表格对齐、`tok-keyword` / `tok-string` / `tok-number` / `tok-comment`，并截图确认浅色布局。
- Mermaid 图表（2026-11-18）：桌面端本地依赖 `mermaid@12.3.0`，代码块语言为 `mermaid` 时生成专用卡，header 保留“查看源码 / 复制代码”，图表输出区初始为“正在渲染图表…”。渲染器在第一次遇到 Mermaid 块时才动态 `import` 本地 ESM：优先 `../vendor/mermaid/mermaid.esm.min.mjs` 裁剪运行时，未生成时回退应用目录 `../node_modules`，再回退 workspace 根 `../../../node_modules`。`npm run build:mermaid` 从根 `mermaid` 复制入口、flowchart / sequence、ELK / dagre / swimlane / cose 布局、KaTeX 和 BPMN 图标共 37 个文件到 `vendor/mermaid`，约 3.44 MB；完整 Mermaid 解包约 123.6 MB，打包时只带 vendor。`securityLevel: "strict"`、`htmlLabels: false`、`suppressErrorRendering: true`，主题使用 `base` 并读取 `--chat-bg` / `--panel-soft` / `--text` / `--border` / `--muted` / `--accent-soft` / `--font-ui` 等 token。`useMaxWidth: false` 保留 SVG 自然宽度，避免窄容器把中文标签缩到 6px；超宽图由 `.mermaid-output` 横向滚动；sequence 关闭 `mirrorActors` 和序号，避免底部重复参与者。源码默认折叠，点击“查看源码”展开为 `.mermaid-source`；渲染失败显示 `.mermaid-error` 并自动展开源码；主题切换时清空状态并重渲染。`mermaidDiagramKind` 只允许 flowchart / graph / flowchart-elk 和 sequenceDiagram，其他类型直接提示“当前离线版本只包含 flowchart / sequence”。虚拟滚动下只在当前切片渲染，SVG 完成后重新测量高度并恢复锚点或回底。
- 工具卡分区（2026-11-18）：实时工具卡新增 `.tool-kind` 类型标签，折叠体拆成“参数”和“实时输出 / 结果”两个 `.tool-section`，各自使用 `.tool-output` 可滚动 `<pre>`；历史工具结果消息也改为“输出”分区，不再把所有文本塞进一个 pre-wrap 容器。`bash` / `read` / `edit` / `write` / `grep` / `find` / `ls` / `ps_task` 分别显示命令 / 读取 / 编辑 / 写入 / 搜索 / 查找 / 目录 / 任务。已用 CDP 构造 `bash` 和 `read` 卡验证 2 个参数 / 结果分区、类型标签和输出换行。
- 分享到 Gist（2026-11-18）：会话窗口动作区新增“分享到 Gist”，打开 `shareDialog` 确认弹窗，说明会上传当前会话 HTML、需要 `gh auth login`，并提示可用 `PISPIDER_GH_BIN` 指定可执行文件。确认后主进程 `agent:share` 先 `gh auth status` 检查登录，再 `export_html` 到临时目录、`gh gist create --public=false` 创建私有 Gist，解析 `gistUrl` / `gistId`，生成 `https://pi.dev/session/<gistId>` viewer URL；成功态显示预览链接和 Gist 地址，提供“打开预览 / 复制链接 / 复制 Gist”，失败时保留弹窗和错误信息。`PI_SHARE_VIEWER_URL` 可覆盖 viewer 基址。已验证无 `gh` 时的错误提示，以及 fake `gh` 下的成功弹窗、viewer URL 和 Gist URL；真实 GitHub 上传未在当前机器验证。
- 应用级缩放：主进程新增 `app:get-zoom` / `app:set-zoom`，缩放值限制 0.7–1.4 并写入 `desktop.json`；`Ctrl +` / `Ctrl -` / `Ctrl 0` 已接。已验证 120% 时主窗口 1440→1200、二次窗口 760→691，重启后仍为 120%，最后恢复 100%。
- 按会话滚动位置：`switchSession()` 先保存当前会话的 `anchorKey / anchorIndex / anchorOffset` 和 `top / ratio`，`refreshFromAgent()` 用旧 / 新 `sessionFile` 判断是恢复目标会话还是保留当前阅读位置；`renderMessages()` 在恢复期间不自动滚底。切回历史位置时先用 `anchorIndex` 设置虚拟切片，再按锚点或比例设置滚动位置；`atLatest` 直接取最新切片，避免流式新增后最新消息被旧切片挡住；位置同时写入 localStorage。
- 快捷键总览：新增 `#shortcutsDialog`，`Ctrl+/` 或 `F1` 打开，`Esc` 关闭；按“输入与发送 / 工作区与窗口 / 导航与弹层 / 输入辅助”分组列出 19 条快捷键，标题栏与输入区提示旁均可点击打开。弹层打开时拦截其他全局快捷键，关闭后焦点回到打开前的控件。
- 会话搜索：输入过滤后可直接用 `↑↓` 在结果间移动，当前项有高亮；`Enter` 打开当前项，未移动时打开第一项，`Esc` 清空搜索并退出输入框。查询非空时左栏显示匹配总数和“相关度 / 最近”排序按钮，切换排序会重新请求；搜索中按 `Enter` 会被忽略，避免打开过期结果。
- 命令面板：新增 `#commandPalette`，`Ctrl+Shift+P` 或输入区“命令”按钮打开；顶部搜索框过滤 20 个桌面动作（会话、工作区、资源、设置、视图、帮助）和 Pi 运行时返回的斜杠命令，技能命令单独分组。`↑↓` 选择、`Enter` 执行、`Esc` 关闭；执行 Pi 命令时把 `/name ` 插入输入框，执行桌面动作时直接调用现有函数。42 项时卡片高度 618px，列表内部滚动，无横向溢出。执行过的命令写入 localStorage `pispider-command-history`，最多 8 条，下次打开时以“最近使用”分组置顶。
- 二次窗口视觉统一（2026-11-18，改版前）：把设置页的 hero / 指标卡 / 分区卡抽成通用 `panelHeroHtml` / `panelMetricsHtml` / `panelCardHtml`；原 `settings-hero` / `settings-eyebrow` / `settings-chip` 改为通用 `panel-*`，设置页视觉不变。状态页改为 `RUNTIME STATUS` hero + 规则 / 技能 / MCP / 提示词四指标 + 工作区 / 环境 / 任务分区；会话页改为 `SESSION` hero + 输入 / 输出 / Token / 成本四指标 + 会话信息 / 任务 / 控制分区，会话标题从会话列表读取真实名称，上下文 chip 只保留一位小数；规则页改为 `RULE LIBRARY` hero + 空态卡 / 规则列表，空态仍保留新建入口。状态页不再在分区卡里重复 hero 的模型 / Thinking / 权限行，MCP 没有配置时显示“未配置”。以上布局已被下条“二次窗口去 hero 与尺寸放大”取代。
- 状态页环境诊断（2026-11-18）：状态窗口底部新增“环境诊断”卡，打开窗口后自动检查并在卡内更新，按钮从“运行诊断”切到“重新检查”。每行用 8px 状态点和标签 / 值两列排布，分别显示运行时版本、模型认证、Pi packages、配置文件、项目资源和工具权限；状态点区分正常、待处理、失败和信息，底部给出检查时间与“核心 CLI 可执行”。没有默认模型、核心 CLI 缺失或配置格式错误时保留可读原因，不弹出阻塞弹层。
- 技能 / MCP / 项目窗口统一（2026-11-18，改版前）：技能页使用 `SKILL LIBRARY` hero + 空态卡 / `panel-resource-list` 列表，保留新建和导入入口；MCP 页使用 `MCP SERVERS` hero + 服务器 / 启用 / 已连接 / 工具四指标，作用域切换放在列表上方，服务器列表改为分区卡，配置、检查错误和说明各自成卡，空态卡保留“添加服务器”；项目页使用 `PROJECT RUNTIME` hero + PiSpider / Electron / Node / 平台四指标 + 路径卡。空态和列表布局已用 mock 数据目测，浅色 / 深色均可读，未修改用户技能或 MCP 配置。以上布局已被下条“二次窗口去 hero 与尺寸放大”取代。
- 二次窗口去 hero 与尺寸放大（2026-11-18）：`panelHeroHtml()` 不再渲染 eyebrow / 大标题 / 说明段落，改为单行 `.panel-summary`（状态点 + 状态文案 + `·` 分隔事实 chip）；`panelMetricsHtml()` 改为无阴影四列 `.panel-stat-strip`，只保留数值和标签。所有页面去掉与窗口标题重复的 hero 和注释性 note，重新挑选 chips 避免和数值条重复。`panelMeta` 从右侧操作区移到标题旁，标题和“0 条规则 · 未启用”同一行。窗口尺寸改为规则 / 技能 1000×700、设置 1060×820、MCP / 扩展 1060×800、项目 940×680、会话 940×780、状态 1000×800，按主窗口中心定位并用当前显示器 `workArea` 夹取宽高。设置模型卡去掉重复 eyebrow 和分组小标题，文件目录改两列；MCP 卡片只展示前 10 个工具并显示 `+N`，主 CTA 改为描边按钮；规则 / 技能 / MCP 空态隐藏顶部重复的新建按钮。检查：`npm run pispider:check` 通过，`npm run pispider:test` 44 项 43 通过 / 1 跳过，launcher / migrate 14 项通过；重启后实际打开规则、设置、MCP、状态、扩展、项目、技能、会话窗口并截图确认摘要条、数值条和标题 meta 正常。
- MCP 预置说明收进弹层（2026-11-18）：预置卡片只保留名称、`stdio · codemode`、`预置 / 未启动`；操作按钮移到卡头右侧，与名称同一行，依次为“准备并启动 / 说明”，不再单独占一行。包版本、用途说明和运行要求从卡片移到“说明”弹层。弹层显示 `chrome-devtools-mcp@1.13.0`、Google 官方用途说明和 Chrome 运行要求，底部说明首次启动安装、之后复用本地版本；只有一个“关闭”按钮，取消按钮隐藏。CDP 实测卡片 `.mcp-meta` 数量从 4 降到 0，操作区在 `.mcp-top` 内且右对齐（left 878.5 / right 1016），两个按钮同高 29.4px；点击“说明”打开 `chrome-devtools 说明` 弹层，宽 620px、高约 321px，关闭路径正常。
- MCP 顶部操作精简（2026-11-18）：MCP 窗口头部从 6 个按钮收敛为“添加服务器 / 重载 Agent / 检查连接”。“刷新”只重读列表并触发同一轮检查，和“检查连接”重叠；“重连 MCP”本质也是重启 Agent 后检查，已并入“重载 Agent”，重载完成后自动执行 `checkAllMcp(true)`；“打开 MCP 目录”与配置卡的 `mcp.json` 打开入口重复，已隐藏。CDP 实测可见按钮为 3 个，`refreshButton` / `openDirButton` 隐藏，`reconnectMcpButton` 已从 DOM 移除；空服务器时“检查连接”提示“没有启用的 MCP 服务器”。
- MCP catalog manifest（2026-11-19）：预置目录从 `mcp-catalog.cjs` 硬编码迁到 `apps/pispider-desktop/catalog/catalog.json`，manifest 顶层为 `version / mcp`；MCP 条目使用嵌套 `package: { name, version, bin }`，保留 `label / description / homepage / exposure / args / env / prerequisite`。加载器逐条校验，重复 id / name、非法 exposure、空字符串、非字符串数组都进入 diagnostics，不阻断其他有效条目。随后只改 manifest 增加第二项 `@modelcontextprotocol/server-sequential-thinking@2.2.0`，MCP 窗口直接变为“2 个服务器 / 2 个预置”，无需改加载器或卡片代码。MCP 包内 Skill 保留在包内，不复制到 `~/.pispider/skills`，技能窗口只列出用户技能目录中的条目。桌面 `package.json.files` 已列入 `catalog/**/*` 和 `mcp-catalog.cjs`，测试会检查这两项仍在打包白名单。CDP 实测 `listMcp("user")` 返回 `catalogErrors: []`、两项预置卡；MCP 窗口显示“2 个服务器 / 0 启用 / 2 预置 / 0 已连接”。
- 预置 MCP 参数化（2026-11-19，随后收敛）：manifest 的 MCP 条目新增 `inputs`（`text` / `directory`），`args` / `env` 支持 `${WORKSPACE}`、`${PISPIDER_HOME}`、`${PISPIDER_AGENT_DIR}`、`${HOME}`、`${PATH_SEP}` 和 `${input.<id>}`；目录输入会展开 `~`、按工作区解析相对路径并 `fs.statSync` 校验存在。有输入项的预置点“准备并启动”打开参数弹层，标题为“启动 <name>”，顶部一句“启动参数会写入 MCP 配置”，下方字段显示标签、默认值和说明；必填为空时阻止提交。验证阶段曾把面板扩到 4 张预置卡，filesystem 默认目录显示 `E:\mygit\SpiderBuddy`，实际启动后显示“已连接 · 16 个工具”，memory 显示 9 个工具，均通过 Electron Node 24（`ELECTRON_RUN_AS_NODE=1`）运行。按必要性评估后，`filesystem`、`memory`、`sequential-thinking` 已从默认目录移除，当前保留 `chrome-devtools` 和 Context7；`inputs`、参数弹层和“说明”弹层仍保留，供后续新增预置使用。
- MCP 生态可用性第一轮（2026-11-19）：manifest 的 MCP 条目新增 `transport`（`stdio` / `http`）、`url`、`headers`，`url` / `headers` 同样支持 `${input.<id>}` 等占位符；HTTP 预置不要求 `package`，也不支持随包技能声明。加载器支持 `transport` 省略时按 `url` 推断，`catalogServerSummary` 用真实类型和接口地址生成虚拟卡；`listMcpServers` 对已写入配置的 HTTP 预置不再用 npm 安装状态覆盖 `installed`，改用独立 `configured` 字段驱动检查 / 编辑 / 删除 / 重连等配置操作。加入 Context7 后，MCP 窗口显示 `2 个服务器 / 2 预置 / 0 启用`，两张卡都只保留“准备并启动 / 说明”；Context7 的说明弹层显示接口地址和“无需本地安装”。点击 Context7 的“准备并启动”时卡片显示“配置中”，跳过 npm 安装，写入 `url` 配置，空闲时自动重载；CDP 实测约 4 秒后摘要变为 `1 / 1 已连接`，卡片显示“已启用”“已连接 · 2 个工具”，工具为 `resolve-library-id` / `query-docs`，配置写入 `~/.pispider/agent/mcp.json`。截图 `pispider-context7-connected.png`。

- 内置斜杠命令与变更日志对话框（2026-11-19）：输入框 `/` 建议项每条带来源徽标，按 `builtin / extension / prompt / skill` 标注「内置 / 扩展 / 模板 / 技能」，徽标样式沿用 `tokens.css` 变量；内置命令排在 RPC 命令之前，同名时内置优先。`/changelog` 在主窗口弹只读对话框，结构与样式沿用快捷键对话框（遮罩模态、`Esc` / 关闭按钮 / 遮罩点击关闭、焦点回归），正文用既有 `renderMarkdown` 渲染运行时 CHANGELOG，标题附带版本号；读取失败时 toast 提示。内置命令在发送和 `Ctrl+Enter` 插话两条路径上都先本地拦截，不发给模型；未知命令 toast 报错并保留输入。
- 逐模型默认思考档位（2026-11-20）：模型弹层在“思考强度”之后新增“该模型启动默认”选择行，选项为“跟随全局”加当前可用档位；保存时调用 `config:set-model-thinking-default`，主进程校验 `off/minimal/low/medium/high/xhigh/max` 后写入 `settings.json.modelThinkingLevels`（键为精确 `provider/modelId`），删除时把空对象一并移除。保存后主进程重启 Agent 并保留当前会话；渲染层再调用 `set_thinking_level` 把当前会话同步到该档位，清除则不改当前会话。模型行 meta 会附加“默认高”等标记，`getModelScope` 响应同时返回 `modelThinkingLevels`，启动时随 `refreshAgentOptions()` 一次拉取。若旧配置里有 `minimal` 或当前模型不支持的档位，下拉会保留一个同值选项，避免静默显示成“跟随全局”。CDP 实测：`faux/model-a` 预置 `medium` 时下拉值为 `medium`、选项 7 项、模型行显示“默认中”；写 `high` 后 `getModelScope` 返回 `{"faux/model-a":"high"}`，`settings.json` 持久化为相同结构；写 `null` 后 `modelThinkingLevels` 整体删除，非法档位返回“思考档位无效”。
- 图片消息渲染与高度指纹（2026-11-20）：`renderAssistantContent()` 按 block 顺序渲染 `image` block，连续图片收进 `.message-images` 条；用户消息改用同一 `renderMessageImageStrip()`，工具结果在 `.tool-body` 末尾追加“图片”分区，只有图片时摘要显示“N 张图片”。图片是 data URL `<img>`，不做 `innerHTML` 拼接；`load` / `error` 后触发一次 `refreshActionGroupLayout()` 重测高度，避免解码前把虚拟占位估算留成 0 高。高度缓存升到版本 5，值从数字改为 `{height, signature}`：`messageHeightSignature()` 覆盖角色、正文 / 思考 head+tail、图片 mime 与 base64 长度、工具名、命令、退出码和错误文本，`messageStructureKey()` 对非 live 消息也带同一指纹，因此 id 不变但正文被编辑时会重绘并重新测量，live 流式消息仍不进入结构指纹。CDP 实测：助手消息 1 张图且顺序为文本 / 图片 / 文本，工具结果 2 张图并显示“2 张图片”；同一 id 文本从 `hello` 改为 `hello changed content` 后 `messageMeasuredHeight` 从缓存 100 回落到估算 90，`messageStructureKey` 随内容变化。
- 恢复会话导航（2026-11-20）：新增 `#sessionPicker` 模态（复用命令面板卡片样式），`/resume` 与 `Ctrl+Shift+K` 打开；输入框按标题、路径、cwd、最近消息预览做多 token 过滤，列表按置顶 / 最近分组，当前会话标“当前”；`↑↓` 循环选择、`Enter` 切换、`Esc` / 遮罩点击关闭并归还焦点。`openSessionPicker()` 打开后会刷新一次 `listSessions()`，切换仍走既有 `switchSession()`（含滚动位置保存与高度缓存重置）。CDP 实测：`/resume` 打开后焦点在 `sessionPickerInput`，`Ctrl+Shift+K` 同样打开，`Esc` 关闭；注入两条会话后按 `beta` / `alpha alpha` 过滤结果正确，分组为“置顶会话 / 最近会话”，方向键从 Beta 移到 Alpha。
- 会话手动排序（2026-11-20）：侧栏标题新增 `#sortSessionsButton`（双箭头图标），点击进入“排序任务”模式，顶部显示“拖动 ≡ 调整顺序，自动保存”以及“恢复默认 / 完成”。排序视图按“置顶会话 / 最近会话”两组渲染，每行左侧有可拖动的 `≡` 手柄和组内序号，隐藏置顶 / 删除按钮；`dragstart` 记录路径，`dragover` 按目标行上下半区决定插入前 / 后并加 `drop-before` / `drop-after` 高亮，`drop` 调 `reorderSessionOrder()`，`dragend` 清空拖拽态。手柄支持 `Alt+↑/↓` 键盘步进。每次调整先本地更新 `state.sessionOrder` 并重绘，再调 `sessions:set-order` 写入 `desktop.json.sessionOrder`（空数组删除字段），失败回滚并 toast。主进程 `listSessions()` 改为“置顶优先 → 手动序索引 → 更新时间降序”，未在手动序中的会话排在后面；排序上限 500 条，且只接受 sessionDir 内路径。搜索框有内容时禁止进入排序并 toast，进入搜索也会退出排序。CDP 实测：三会话默认分组“今天 2 / 置顶 1”，进入排序后分组“置顶会话 1 / 最近会话 2”、3 个手柄、序号 1/1/2，初始序 `b,a,c`；`reorderSessionOrder(a,c,true)` 后本地与磁盘均为 `b,c,a`，列表行序同步；`moveSessionByStep(a,-1)` 后变 `b,a,c` 并落盘；`resetSessionOrder()` 后本地与磁盘均为 `[]`；有搜索词时进入排序被拦截。真实临时会话文件下 `setSessionOrder([c,a,b])` 后 `listSessions()` 依次返回 c、a、b，清空后回到默认顺序。
- 高级设置卡（2026-11-20）：设置页在“工作模式 / 项目信任”之后新增 `advanced-card`，两列表单包含传输协议、HTTP 代理、Shell 路径，下面是默认工具多行输入和上下文压缩区（自动压缩、预留 tokens、保留最近 tokens）。`config:get-advanced` 返回用户级 `settings.json` 的值与文件路径；`config:set-advanced` 校验代理必须是 `http(s)` URL、Shell 路径不含换行、工具列表不能把纯名称与 `+名称` / `-名称` 混用且修饰项不支持通配符、token 必须是非负安全整数，写入后重启 Agent 并保留当前会话。保存时保留 `compaction.modelOverrides`，空代理 / Shell / 工具列表删除对应字段；传输协议即使选 `auto` 也显式写入以覆盖项目级值。CDP 实测：初始卡显示 `auto / 16384 / 20000`；写入 `websocket`、`http://127.0.0.1:7890`、PowerShell 路径、`+grep/-write`、关闭压缩 `12000/9000` 后 `settings.json` 一致且 `restarted=true`；UI 改 `sse`、`read/bash/grep` 后单击保存 1.1 秒完成并落盘；非法代理、混用工具、通配修饰项、负 token、非法 transport 均返回对应中文错误；手工注入 `compaction.modelOverrides` 后再保存，覆盖项仍在。

## 6. 路线图

P0（下一轮）：

1. 队列逐条删除：等 Pi 暴露 `get_queue` / `remove_queue_item`，或先做“清空后重建”的显式确认原型。


P1：

1. 左栏信息架构继续收敛：资源入口已压成 2×2，仍有项目行 / 搜索 / 会话分组需要进一步降噪。
2. 会话列表增加按项目筛选，当前按置顶 / 手动序 / 时间分组。
3. 状态反馈聚合：主界面已有会话用量入口，但运行状态、队列、MCP pending 和错误横幅仍分散在标题栏 / 输入区 / 二次窗口，下一步收敛到统一运行状态入口。
4. 完整虚拟滚动、真实高度和按会话持久化已落地并压测；240 条混合探针首次打开总高度差已从 `-900.8px` 校准到 `-39.6px`（约 0.02%）。窗口宽度 / 缩放 / 面板开合已按布局失效并保留锚点，10px 级滚动条宽度差按新布局保守清空。图片消息与内容变更后的缓存失效已由版本 5 内容指纹补齐。本轮未在 714 / 685 等新宽度下做全量真实总高度对比，离屏仍按新宽度估算，后续可补这项基准。

P2：

1. 组件级渲染测试与截图基线。
2. 主题导入、紧凑 / 舒适密度。

## 7. 验收清单

- 1080×720 下三栏都不出现横向滚动，主对话正文宽度不低于 420px。
- 流式输出 60 秒不出现明显掉帧；虚拟滚动在 1200 条会话中连续滚动、首尾跳转和会话切换都不重建整段历史，DOM 消息节点不超过 200。
- 1200 条混合长消息会话中，渲染切片的真实高度（含 24px margin）与缓存差 ≤1px；reload、切换会话、首尾跳转后锚点消息和视口偏移保持，偏差不超过 1px。
- 高度缓存按会话命中：240 条会话首次渲染缓存 120 条；reload、切到 `111` 再切回后窗口和 `scrollTop` 保持，缓存条数只增不减，已访问切片的总高度不因离屏估算变化；版本 4 缓存只接受与当前 `layoutWidth` / `layoutZoom` 匹配的测量值，宽度差 >2px 或缩放变化时当前会话重新测量，旧布局缓存不会被种入。
- 240 条混合探针首次打开估算总高度与全量真实总高度差 ≤100px（实测 `-39.6px`）；窗口宽度变化后用户 / 助手估算宽度跟随 `#messageList` 调整，已测高度按新布局失效并重新测量，锚点 key / 视口偏移不跳变。
- 浅色 / 深色下正文、次要文字、危险色对比度可读。
- 所有图标按钮有可读标签；键盘可以完成发送、停止、打开右栏、关闭弹层。
- 二次窗口打开时主窗口不可误操作，`Esc` 可关闭；扩展弹层关闭后焦点回到打开前的控件。
- 空态至少给出一个下一步动作；连接 / 模型 / MCP 错误有重试入口。
- 主界面会话用量在 1080×720 下不遮挡标题，弹层不出界；无上下文数据时回退为 token 总量或“用量”；浅色 / 深色下进度条和统计行可读。
