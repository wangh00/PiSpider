# 验收与测试

当前桌面端状态见 [desktop-status.md](desktop-status.md)；本页记录已经执行过的验证和仍未完成的人工验收。

## 1. 自动化验证

```bash
npm run pispider:doctor
npm run pispider:check
npm run pispider:test
node --test scripts/pispider-launcher.test.mjs scripts/pispider-migrate.test.mjs
```

当前结果来自 2026-11-13 至 2026-11-18 的实际执行记录。它是验收证据，不是持续集成结果；改动后需要重新运行命令和对应桌面操作。

| 范围 | 结果 |
| --- | --- |
| 扩展包语法检查 | 通过 |
| 扩展包测试 | 44 项：43 通过、0 失败、1 跳过 |
| 启动器测试 | 10 项：10 通过 |
| 配置迁移测试 | 4 项：4 通过 |
| 启动器真实运行 | 首次安装缓存 Pi 1.5.2（123 个包，约 13 秒），退出码 0 |
| 首次运行目录 | 创建 `agent/`、`agent/sessions/` 和 `runtime/core-1.5.2/` |
| Pi 数据隔离冒烟 | 使用独立 `PISPIDER_HOME`，agent 路径未落在 `~/.pi` |
| Computer Use 加载 | RPC 命令列表同时出现 `ps` 和 `computer-use`，说明两个 `-e` 入口均加载 |
| Computer Use helper | 安装到 `$PISPIDER_HOME/agent/helpers/pi-computer-use/windows-bridge.exe`，`~/.pi` 下无副本 |
| Windows helper 诊断 | `accessibility: true`、`screenRecording: true`、`protocolVersion: 4` |
| Windows roots | `listRoots` 返回桌面窗口根，包含资源管理器、DoubaoWork 等 |
| 符号链接拒绝用例 | Windows 当前权限不允许创建符号链接，跳过 |

合计：58 项测试，57 通过、1 跳过、0 失败。跳过只影响“实际创建符号链接”的平台路径，代码中的拒绝逻辑仍保留。

## 2. 启动与隔离冒烟

使用缓存的 Pi 1.5.2 与独立 `PISPIDER_HOME`：

```powershell
$env:PISPIDER_HOME = Join-Path $env:TEMP "pispider-smoke-rename"
npm run pispider -- --help
```

判定标准：

- 退出码 0；
- 首次运行安装 `@earendil-works/pi-coding-agent@1.5.2` 到 `$PISPIDER_HOME/runtime/core-1.5.2/`；
- 创建 `agent/` 和 `agent/sessions/`；
- agent 目录不在 `~/.pi` 下；
- 没有 CLI 启动、语法或模块错误；扩展注册本身由扩展包测试覆盖。

本机结果：退出码 0，缓存目录和 `agent/sessions` 均创建；`run.ps1` 与 `run.cmd` 分别执行 `--version` 都以退出码 0 结束。命令行帮助仍显示上游 `pi` 名称，这是保留 Pi 原生 CLI 的结果；产品入口、命令、数据目录和扩展包名称是 PiSpider。

### 桌面壳冒烟（2026-11-15）

```powershell
npm run pispider:desktop
```

已验证：

- `apps/pispider-desktop/node_modules/electron/dist/electron.exe` 存在，版本 `v45.3.2`；
- 根脚本能启动 Electron，窗口标题为 `PiSpider`，默认 1440×920；
- 主进程用系统 Node 启动 `node scripts/run-pispider.mjs --mode rpc`，不再错误地使用 Electron 的 `process.execPath`；
- RPC `get_state` 成功，右侧面板可用；右栏只有 `浏览器` / `代码` 两个 tab；
- 内置浏览器通过 `<webview>` 加载 `https://example.com/`；
- `Ctrl+N` 会调用 `new_session`，session id 变化；
- 点击左栏 `规则` 会打开独立窗口 `PiSpider · 规则`，显示真实空列表；`技能`、`设置`、`项目`、`会话` 走同一套 `panel:open`；
- 右栏 `代码` 通过 `打开项目文件` 读取仓库内 `README.md`，显示文件 tab、面包屑 `SpiderBuddy > README.md`、行号、162 行内容和只读状态；`代码` 计数同步为 1；
- composer 只有一个发送/停止按钮，标题栏右侧不再出现停止按钮；
- 主窗口和规则窗口都有入场动画；主窗口右栏用宽度、透明度和位移过渡开合；规则窗口标题右侧显示 `0 条规则 · 未启用`，没有标题下副标题；
- 主对话区改为白底，侧栏和右栏保持浅色层次；线程头不再显示仓库路径和模型副标题，账号卡不再重复模型状态，启动时不再自动弹“未配置模型”提示；
- 规则/技能空态去掉说明段落，无描述的资源不再显示“无描述”，设置里的模型卡片也不再重复“未配置”徽章；
- 二次窗口已改成无系统边框、透明背景的圆角窗口壳（22px 圆角 + 阴影 + 自定义标题栏），规则、设置窗口视觉一致；自定义标题栏支持最小化和关闭；
- 主窗口字号从 10–12px 级别整体上调：正文 14px，导航 13.5px，代码 12.5px；设置子窗口正文 14px、标题 23px、表单 13.5px；
- 设置子窗口已有模型配置表单：服务商、模型 ID、API Key、自定义端点地址和协议；保存会写 `auth.json` / `settings.json` / `models.json`，并重启 runtime；
- 用临时自定义端点（`pispider-custom` / `test-model` / `http://127.0.0.1:9999/v1`）验证了保存链路：三份配置文件写入正确，runtime 重启后 `get_state` 显示 `pispider-custom / test-model`，主窗口底部账号卡同步显示“自定义模型”（2026-11-17 起改为回退显示实际模型 id）；测试后已恢复本机空 `auth.json`，删除临时 `settings.json` / `models.json`；
- 规则窗口已不再是只读列表：用临时规则 `ui-test-rule` 验证了新建、编辑 `RULE.md`、启用（`config.json` 的 `activeRule` 更新，标题显示“当前 ui-test-rule”）、删除（先移动到 `~/.pispider/backups/rules`，当前规则清空）；测试规则和备份已删除；
- 规则重置已验证：临时规则 `ui-reset-test` 先写入 `CUSTOM BODY`，点击规则卡片的“重置”并在确认框提交后，正文恢复为内置模板，名称和描述保留；测试规则和备份已删除。
- 设置窗口的“工作模式”已验证自动识别 → JavaScript → 自动识别，`config.json` 的 `domain` 随选择更新；
- 技能窗口已验证新建、从目录导入、删除；导入和删除前均经过 `~/.pispider/backups/skills` 备份，测试技能和备份已删除；
- 设置窗口的“提示词”区域列出 4 个组件，编辑 `workflow.md` 后可通过读取接口确认内容变化，恢复默认后与内置内容一致；测试后已恢复默认。
- 逐条消息复制与上下文圆环已验证（2026-11-18 CDP）：会话 `111` 的用户消息和助手回复各有一个“复制”按钮，按钮固定在各自消息右下角，默认 `opacity:0` / `pointer-events:none`，不占布局；鼠标移入消息后变为 `opacity:1` / `pointer-events:auto`，鼠标移出恢复隐藏，键盘聚焦同样可见。点击后系统剪贴板分别为 `111` 和完整助手回复；顶部 `thread-actions` 只剩“会话”按钮，不再有“复制最后回复”。输入框模型名左侧显示 20px 上下文圆环和 `6%`，圆环填充按 11k / 200k token 比例计算，位于 `grok-4.6` 模型按钮左侧；点击圆环打开会话用量弹层，显示 6% 进度条、11k / 200k tokens、输入 63、输出 163、Token 11k 和 `$0.0000`，再次点击圆环 / 外部点击 / Escape 关闭，环的颜色在 75% / 90% 后转为危险色。宽 1440 窗口下顶栏和输入框无横向溢出。
- 主窗口布局收敛已验证（2026-11-18 CDP）：1440 窗口 + 右栏展开（主列 728）时，长会话标题容器 532px，标题右缘 882，“会话”按钮左缘 916，保留 34px 槽位，不再重叠；右栏收起时长标题同样与按钮留 34px。1028×700（约等于 1440 宽窗口在 140% 缩放后的布局宽度）+ 右栏：`.app-body` 变为 `232px 796px` 两列，右栏 `position:absolute` / 340px 覆盖主列，从线程头下方开始，标题和“会话”按钮保持可见；主列和 composer 保持 796 / 740，`composer-toolbar` 的 `scrollWidth === clientWidth`（716）；右栏底边按 composer 顶部动态停在 549px，composer 顶部 573px，输入框和发送按钮完整可见。空态卡片改为 `auto-fit minmax(180px,1fr)`，1028 下三卡各 236px，不再折行。当时设置页 760×760：hero 从约 164px 压到 129.6px，模型卡从 y305 提到 y265，API Key、接口地址 / 类型和上下文窗口进入首屏；页面无横向溢出。该设置页尺寸和 hero 已随后续“二次窗口去 hero 与尺寸放大”改版被 1060×820 单行摘要和平面模型卡取代。主窗口标题、右栏和设置页改动通过 `node --check`。
- 运行中 steer 已验证 IPC 存在；空闲时调用会排队，已用 `clear_queue` 清理，真正的 `Ctrl+Enter` 插话需要一次流式任务，未用真实模型反复烧额度。
- 模型菜单搜索已验证：输入 `grok` 后只保留匹配模型，清空搜索恢复列表；模型选择仍走原有 `set_model` 路径。
- 模型 / Thinking 循环已验证：当前只有 1 个模型，模型循环按钮按预期隐藏；Thinking 标题“下一个”可从 `off` 切到 `high`，随后已恢复 `off`。
- MCP 服务器级 exposure 和逐工具 exposure 已验证：临时保存 `exposure-test` 为 `direct`，列表读取仍为 `direct`；`tool-exposure-test` 保存 `{"demo_tool":"hidden"}` 后列表可读，清空后恢复为 `null`；删除后用户级 `mcp.json` 已清理为不存在。HTTP 请求头清空逻辑也做了代码修复并通过 `set -> clear -> {}` 验证。
- 会话树节点操作已验证：会话 111 的树对话框渲染 5 组节点操作，“复制”按钮可点击；`从此分支` 走 `fork`，原会话保留。标签测试在会话副本上进行：`/ps label` 写入“测试标记”后树节点可读，清空后标签消失，测试后切回会话 111 并删除副本。
- 外部编辑器已验证：通过 `PISPIDER_EDITOR` 指向临时测试脚本，直接调用 `editText` 返回 `hello\nEDITOR-LINE`；在输入框写入 `draft-text` 后派发 `Ctrl+G`，编辑器关闭后输入框变为 `draft-text\nEDITOR-LINE`。测试结束已恢复正常启动，未保留测试编辑器环境变量。
- 最终提示词预览已验证：设置窗口点击“预览最终提示词”弹出预览框，初始显示 6617 字符、未启用规则、无任务状态；输入草稿 `reverse this JavaScript bundle and find the API` 后点击“重算”，字符数变为 8221，输出包含 `JavaScript / Web` 领域段，说明草稿文本参与了领域路由。
- 状态 / 会话 / 规则二次窗口视觉统一已验证（2026-11-18 CDP，改版前）：状态页显示 `RUNTIME STATUS` hero、规则 / 技能 / MCP / 提示词四指标，以及工作区 / 环境 / 任务三张分区卡；MCP 未配置显示“未配置”，工作区卡显示 `111 · 3 条消息` 和项目路径。会话页显示 `SESSION` hero，标题为真实会话名 `111`，chip 为 `grok-4.6` / `思考 关闭` / `3 条消息` / `上下文 5.7%` / `01a1e227`，指标卡为输入 63、输出 163、Token 11,362、成本 `$0.0000`。规则页空态显示 `RULE LIBRARY` hero、`下一条消息生效` chip、`暂无规则` 状态胶囊和带“新建规则”按钮的空态卡；用 mock 两条规则验证列表、启用徽章和停用 / 编辑 / 重置 / 删除 / 打开文件操作行，未写入用户规则目录。浅色与深色均截图确认可读；设置页在类名改为 `panel-*` 后仍保持原视觉。以上 hero / 指标卡布局已被同日“去 hero 与尺寸放大”改版取代。
- 技能 / MCP / 项目二次窗口视觉统一已验证（2026-11-18 CDP，改版前）：技能页空态显示 `SKILL LIBRARY` hero、`SKILL` 标记和新建 / 导入按钮；mock 两条技能验证有效 / 无效行、删除 / 打开目录和列表间距。MCP 页空态显示 `MCP SERVERS` hero、服务器 / 启用 / 已连接 / 工具指标、用户级 / 项目级切换和带“添加服务器”的空态卡；mock 两个服务器及检查结果验证 `1 / 1 已连接`、工具 chip、登录 / 登出 / 重连操作、配置 / 检查错误 / 说明三张卡。项目页显示 `PROJECT RUNTIME` hero、PiSpider `0.1.0`、Electron `45.3.2`、Node `24.22.2`、平台 `win32` 指标，以及工作区 / 配置文件 / Agent 目录路径卡。MCP 深色截图可读，测试未写入用户技能或 MCP 配置，测试后恢复浅色并关闭二次窗口。以上 hero / 指标卡布局已被同日“去 hero 与尺寸放大”改版取代。
- 旧版空 `auth.json` / 未配置 provider 的状态已不再作为当前基线；当前模型配置链路见下方“测试连接”和“真实推理测试”记录。
- 扩展 UI 的 `confirm` / `input` / `editor` / `select` 桥已通过 Electron CDP 注入临时确认框验证：弹窗显示标题、消息和取消/确认按钮，确认后关闭并把响应写回 runtime；未用真实第三方扩展完成端到端验收。
- 会话窗口已读取 `get_session_stats` 并显示输入/输出、Token、成本、上下文；`compact` 按钮已触发 RPC，当前无模型时返回 `Nothing to compact (session too small)`，按钮状态会恢复。
- 排队 UI 已用临时 `queue_update` 状态验证：数量显示和“清空排队”按钮会随排队数出现/隐藏；未在真实流式会话中验证清空后恢复文本。
- MCP 窗口已用临时 `ui-test-mcp` 验证添加对话框、写入 `agent/mcp.json`、侧栏计数刷新和删除接口；`检查连接` 用临时 stdio 假服务器和临时 HTTP 假服务器验证了 initialize + tools/list 握手，HTTP 成功后显示“已连接 · 1 个工具”；测试后已清理测试配置和假服务器。
- 项目信任已在设置窗口验证 `ask → trust` 写入 `agent/desktop.json`，重载 runtime 后进程参数包含 `--approve`；测试后已恢复默认并删除测试文件。
- 会话窗口的“重命名”已在临时新会话中验证：写入 `set_session_name` 后状态和会话面板同步；会话控制里的 Thinking 与自动压缩开关也已验证 RPC 状态变化；空会话的回退分支入口显示“没有可回退的用户消息”。
- 非当前会话删除已用临时 `.jsonl` 文件验证 IPC 删除；最近列表的删除按钮和空态已通过 DOM 检查，但空会话不落盘，按钮只有在真实会话出现后才可见。
- 用一条手工构造的两消息临时会话验证：树读取返回用户消息、助手消息和 Thinking 节点，`get_fork_messages` 返回用户消息，`fork` 生成空分支，`clone` 生成带 2 条消息的新会话，`export_html` 生成约 291 KB 的 HTML 文件；导出路径已在主进程转换为绝对路径。侧栏删除按钮也在临时会话下点击验证，列表从 2 条降到 1 条。测试文件和导出 HTML 已删除。
- 会话 JSONL 导出已验证：会话窗口存在“导出 JSONL”；主进程复制当前会话文件到指定路径，不修改原会话。用用户会话 `2026-11-16T02-20-26-461Z_01a1e227-dfdc-77be-956d-9c1cd6c380bb.jsonl` 验证，导出文件 46,928 字节、6 行，SHA-256 与原文件一致；测试导出文件已删除，原会话保留。空会话点击导出会提示“当前会话还没有保存，先发送一条消息再导出”。
- 任务重置已验证：会话窗口点击“重置任务”弹出确认框；取消时不执行。复制一个临时会话后调用 `resetTask`，RPC 返回 `prompt: handled`，临时会话文件追加 `pispider-task-reset` 标记（7 行），原会话未被修改；临时会话已删除。
- 自动重试开关已验证：初始从 `settings.json` 读取为开启，点击关闭后 runtime 设置变为关闭，再恢复开启。
- 模型“检查配置”在无 Key 时返回“缺少 API Key”。
- 用真实自定义端点验证“测试连接”：`https://www.orangecc.cc` + `anthropic-messages` + `grok-4.6` 返回 8 个模型，设置窗口显示模型候选。
- 自定义模型元数据已验证：保存 `reasoning: true` 后 runtime `get_state` 返回 `reasoning: true`，`get_available_thinking_levels` 从只有 `off` 变为 `off/minimal/low/medium/high`；同时保存了 `contextWindow: 128000`、`maxTokens: 16384`。
- 模型思考强度默认扩展已验证（2026-11-17 CDP）：重启应用后 `ensureDefaultThinkingLevels()` 自动把当前自定义推理模型的 `models.json` 从 425 字节迁移为 602 字节，写入 `thinkingLevelMap: {xhigh: "xhigh", max: "max"}` 和 `compat.forceAdaptiveThinking: true`；runtime 返回 `off/low/medium/high/xhigh/max` 六档，无需任何设置开关或保存动作。
- 设置页最终回归（2026-11-17 CDP）：设置页显示“思考强度：关闭 / 低 / 中 / 高 / 极高 / 最高”，`#modelExtendedThinking` 和 `#modelThinkingPreview` 均已移除，旧 xhigh / max / adaptive 控件不存在；`body` 宽度 760 / 滚动宽度 760，无横向溢出。关闭二次窗口后主窗口恢复可交互。模型菜单实际文本为“关闭 / 低 / 中 / 高 / 极高 / 最高”，不含“最小”，也不显示 raw level 文案。
- 设置页保存路径已验证（2026-11-17 CDP）：在无扩展开关的模型表单直接点击“保存并重启 Agent”，提示“模型已保存，Agent 已重启”；`models.json` 仍为 602 字节并保留 xhigh / max 与 `forceAdaptiveThinking`，runtime 仍返回六档，真实会话 `111` 仍为 8 行 / 47193 字节。
- 设置页错误提示清理仍保留在 `panel.js` 的保存 catch：`String(error.message || error).replace(/^Error invoking remote method '[^']+': Error: /, "")`。本轮移除了扩展档位开关和“Anthropic Messages 启用 xhigh/max 必须勾选自适应思考”的专用校验；主进程保存改为推理模型默认写入扩展映射。
- 桌面调试脚本已验证：`node scripts/pispider-desktop-debug.mjs help`、`state`、`wait 5000`、`switch-session` 和 `inject-event '{"type":"debug_noop"}'` 均能通过 CDP 执行；`switch-session` 返回 `111`、`[0,2]`、`top=0`，`inject-event` 不改变状态。`send` 命令未用真实 provider 执行，避免产生推理调用。
- 手动重载思考强度刷新已验证（2026-11-17 CDP）：在默认扩展档位模型上调用 `window.pispider.reloadAgent()`，重载完成后 `state.thinkingLevels` 为 `off/low/medium/high/xhigh/max`、当前思考强度为 off、会话仍为 `111` 的 3 条消息；`refreshFromAgent` 现在等待 `refreshAgentOptions` 完成后再读取消息，避免旧档位残留。重载未修改真实会话文件，仍为 8 行 / 47193 字节。
- 根 `npm run check` 未通过：当前 `node_modules` 缺少 `@biomejs/wasm-nodejs`，命令在 biome 阶段启动前退出，未执行到 tsc；这是工作区依赖缺少，不是本轮桌面代码错误。`npm run pispider:check`、`npm run pispider:test` 和 launcher / migrate 测试均已通过。
- 真实推理测试已验证：设置窗口点击“测试推理”，主进程向 `https://www.orangecc.cc/v1/messages` 发送一条 `max_tokens: 16` 的最小 Anthropic Messages 请求，返回助手文本“正常”，面板显示“推理测试成功”。该按钮会消耗少量推理额度。
- 真实模型发送已验证（2026-11-17 CDP）：用临时会话通过桌面调试接口发送“请只回复：桌面测试通过。不要调用工具。”，模型为 `pispider-custom/grok-4.6`，收到助手文本“桌面测试通过。”，消息数为 3（system / user / assistant），流式与渲染链路正常。测试后已切回真实 `111`，删除临时会话及其高度 / 滚动缓存；真实会话仍为 8 行 / 47193 字节、SHA256 `D752F0...`。
- 设置页视觉与模型名已验证（2026-11-17 CDP）：设置页显示“当前工作区”摘要卡、`grok-4.6` 模型 chip、`pispider-custom` 服务商、领域模式、项目信任和 `上下文 200k`；模型卡当前模型为 `grok-4.6`，provider 显示“兼容端点”；工作模式 / 项目信任并排，提示词和文件目录独立分组。设置页正文不含“自定义”字样，`body` 宽 760、`panel-body` 滚动宽 743，无横向溢出；模型弹层标题为 `grok-4.6`、元信息为 `pispider-custom`，主窗口模型 chip 为 `grok-4.6`。
- Pi 提示模板已验证（2026-11-18 CDP）：设置页显示“提示模板”卡，列出 7 个项目级模板（`cl` / `deslop` / `dup` / `is` / `pr` / `sa` / `wr`），带“项目”chip、描述和参数提示；列表返回项不含正文，只有元数据。通过 UI 新建用户级 `desktop-smoke`，编辑描述后删除，备份写入 `$PISPIDER_HOME/backups/prompt-templates`；另用 `user-smoke` 验证重载 Agent 后 `get_commands` 返回 `source: "prompt"` 的 `user-smoke`，说明模板已进入命令面板。测试后模板文件和备份已清理，项目模板未改动；设置页无横向溢出，编辑弹层可滚动。
- Pi 扩展与 package 已验证（2026-11-18 CDP）：扩展窗口显示 4 个项目扩展（`import-repro.ts` / `prompt-url-widget.ts` / `redraws.ts` / `tps.ts`）、4 个内置扩展和项目未信任状态，指标为“已加载扩展 0 / 已停用 0 / Pi packages 0 / 内置扩展 4/4”；项目未信任时项目扩展行标注“待信任项目”，主窗口左栏扩展数为 4。项目级 `redraws.ts` 启停实际写入 `.pi/settings.json` 的 `{"extensions":["-extensions/redraws.ts"]}`，再启用写回 `+extensions/redraws.ts`，测试后删除该文件恢复原状。本地 fixture package 通过 UI 安装后清单显示 1 个 package、相对 source 和绝对 install path；移除按钮最初错误地使用 settings 中的相对 source，修正为 `removeSource` 绝对路径后 UI 移除成功并回到空态。测试后的 `settings.json` 已按原始 LF 内容恢复，SHA256 为 `554192B9186E50B698D34E5BBD6D700B595CE4A2C906AE34BCD7532CD4E140D7`；临时 fixture 已删除，真实会话和 `models.json` 未改动。
- 状态页环境诊断已验证（2026-11-18 CDP）：`window.pispider.getDiagnostics()` 返回 Pi `1.5.2`、Node `24.22.2`、Electron `45.3.2`，认证 `ready · api_key`，`pi list` 为 `No packages installed.`，`settings/models/auth` 均存在，项目 `.pi/settings.json` 和 `.pi/mcp.json` 不存在，项目信任 `ask`，当前会话权限 `full`。状态窗口底部显示“环境诊断”卡和六个带状态点的行，检查时间 `2026/11/18 10:15:19`，底部“核心 CLI 可执行”；自动检查和“重新检查”按钮均走 `system:diagnostics`，没有弹出阻塞弹层，窗口无横向溢出。返回对象不含 API Key 或其他凭据内容。
- Provider OAuth 启动 / 取消已验证（2026-11-18 CDP）：设置页选择 Kimi For Coding 后显示“账号登录 / Kimi Code（订阅）/ 未登录”，点击登录弹出“登录 Kimi For Coding”，显示设备码和 `https://www.kimi.com/code/authorize_device?...` 授权页；OpenRouter 显示授权链接、`授权码 / 回调地址` 输入和中文提示；OpenAI 显示 ChatGPT 授权链接与手动回调输入。三家均能在弹层内取消，关闭后没有残留 `oauth-bridge` 进程。
- OpenRouter 手动授权码错误路径已验证（2026-11-18 CDP）：在弹层输入 `invalid-test-code` 提交后，桥接进程返回 `OpenRouter OAuth key exchange failed (HTTP 400): Invalid code`，弹层停留在“账号登录未完成”并显示“关闭”，没有误报登录成功。
- Provider OAuth 登出已验证（2026-11-18 临时 auth）：用临时 `auth.json` 写入假的 `openrouter` OAuth 凭据，桥接 `logout` 返回 `ok`，临时文件从 `{ openrouter: {...} }` 变为 `{}`；真实用户凭据未使用。
- 待账号回归：Kimi For Coding、OpenRouter、OpenAI 的真实授权完成和登录后推理尚未执行，需要对应账号在浏览器里完成一次授权；当前已验证到设备码 / 授权链接生成、手动码提交、错误回显和取消清理。
- 项目级 package 信任校验已验证（2026-11-18 IPC）：项目信任为 `ask` 时调用 `installPackage({ source: "C:\\Users\\Admin\\AppData\\Local\\Temp\\pispider-trust-fixture", scope: "project" })` 被主进程拒绝，错误为“项目级 package 需要先在设置中信任项目”；没有启动 Pi package CLI，也没有写入项目 settings。临时 fixture 已删除。
- MCP 批量检查已验证（2026-11-18 CDP）：在用户级 `mcp.json` 写入两台临时服务器，一台停用 stdio、一台不可达 HTTP。打开 MCP 窗口后自动执行检查，顶部显示 `0 / 1 已连接`，数值条为服务器 2 / 启用 1 / 已连接 0 / 工具 0；停用服务器显示“已停用”，HTTP 服务器显示 `error` 和 `fetch failed`。顶部操作区“检查连接”存在，手动点击后按钮恢复、数值条保持；窗口无横向溢出。临时 `mcp.json` 已删除，用户的 MCP 配置未被保留。
- 压缩说明弹层已验证（2026-11-18 CDP）：会话窗口点击“压缩上下文”打开弹层，标题“压缩上下文”、确认按钮“开始压缩”，含可选多行说明和“留空时使用 Pi 默认压缩策略”提示；取消后弹层关闭，真实会话文件修改时间和大小未变化。`compact` 主进程已支持非空 `customInstructions` 透传，界面调用参数已静态核对。
- 会话循环切换已验证：会话窗口点击“下一档思考强度”，`medium` 切换到 `high`，面板提示“思考强度已切换为高”；当前自定义 provider 只有一个模型，点击“下一个模型”返回“没有可循环的模型”，没有改写当前模型。
- 输入框底部控制已验证：模型胶囊弹出 1 个可用模型和 5 档 Thinking，点击“高”后胶囊显示“高”，提示“Thinking 已切换为高”；测试后恢复 `medium`。权限胶囊切到“只读”后 runtime 命令行变为 `--mode rpc --no-approve --tools read,grep,find,ls --exclude-tools mcp__*`，切回“全部允许”后恢复为 `--mode rpc --no-approve`；`禁用工具` 模式调用 `--no-tools`，runtime 仍能启动并返回状态，测试后已恢复“全部允许”。当前会话文件在重启后保留。
- 单会话权限已验证（2026-11-18 IPC + 进程命令行）：真实会话切到“只读”后 `desktop.json.sessionPermissions[sessionFile]` 写为 `readonly`，runtime 变为 `--mode rpc --no-approve --tools read,grep,find,ls --exclude-tools mcp__*`；“禁用工具”模式写为 `none` 并追加 `--no-tools`；切回“全部允许”后恢复为 `--mode rpc --no-approve`。每次切换都恢复同一会话文件。
- 权限启动恢复已验证（2026-11-18 重启应用）：真实会话保持“只读”时重启桌面，runtime 仍以只读参数启动，`getPermission()` 返回 `readonly · session`，输入框权限胶囊显示“只读”；随后已恢复“全部允许”。
- 新建会话权限已验证（2026-11-18 IPC）：从 `full` 会话执行 `new_session` 后，`getPermission()` 返回新会话路径和 `full`，未沿用上一会话的任何覆盖；空会话未落盘，切回真实会话后列表仍只有真实会话。
- 跨会话权限已验证（2026-11-18 IPC）：复制真实会话为临时会话并切过去，临时会话默认 `full`；设为 `readonly` 后切回真实会话，runtime 恢复 `full` 参数；再切到临时会话，runtime 重新带上只读参数。删除临时会话后 `sessionPermissions` 条目同步移除，临时文件和测试映射已清理；真实会话保持 `full`、3 条消息。
- 会话窗口去重已验证：打开会话窗口后只有自动压缩、自动重试、复制、会话树、导出和中止重试；`sessionModelSelect` / `sessionThinkingSelect` 不再存在，提示模型、Thinking、权限到输入框底部切换。
- 代码页空态已验证：当前项目没有 `.git`，代码 tab 显示“项目最近修改”和 40 个文件，首项为 `apps/pispider-desktop/renderer/styles.css`；点击后在查看器中打开 `styles.css`，显示 2400 行。Git 仓库下会优先使用 `git status` 的更改列表。
- 浏览器导航已验证：打开 `https://example.com/` 后地址栏同步，后退可用、前进禁用；访问 `https://example.com/index.html` 后再点后退，地址回到 `https://example.com/`，前进按钮变为可用；刷新/停止按钮由同一按钮切换图标和标题。
- MCP 项目级已验证：项目级列表路径为 `E:\mygit\SpiderBuddy\.pi\mcp.json`；保存 `ui-smoke-project` 后列表出现该服务器，删除后数量回到 0，测试文件已清理；MCP 窗口切到项目级后显示该路径和“需要先信任当前项目”的空态提示。
- 二次窗口模态已验证：打开“规则”后主窗口遮罩显示、`body` 进入 `panel-modal` 状态；直接触发左栏“技能”不会产生第二个窗口；点击遮罩后规则窗口关闭、遮罩恢复隐藏。
- 会话窗口“中止重试”已接 RPC `abort_retry`；自动重试开关仍读取全局 `retry.enabled`。
- 真实 prompt 验证：此前 `baseUrl` 带 `/v1` 时 runtime 返回 `404 404 page not found`；改为服务根地址后，RPC prompt 收到 assistant 文本“正常”。桌面端模型面板已同步提示 Anthropic 地址不要带 `/v1`，保存时会自动去掉。
- 图片附件已验证：向 composer 拖入 8×8 PNG 后显示缩略图和移除按钮，移除后附件区隐藏；主进程 `files:read-images` 对 `packages/ai/test/data/red-circle.png` 返回 1 张 `image/png`（3420 字节 base64），预览正常，非图片路径返回空列表；未实际操作系统文件选择对话框。发送链路把图片作为 RPC `prompt.images` 传入，当前模型 `input: ["text"]` 时会在发送前提示先开启“图像输入”，未用真实视觉模型发送图片。
- `@` 文件搜索已验证：输入 `@app` 后弹出 30 个候选，方向键移到 `apps/pispider-desktop/renderer/app.js`，Enter 选择后输入框变为 `@apps/pispider-desktop/renderer/app.js `，候选面板关闭；扫描跳过 `node_modules`、`.git`、`dist` 等目录。
- 斜杠命令面板已验证：`get_commands` 返回 22 个命令；输入 `/` 后面板显示全部命令，输入 `/ps` 过滤为 3 个（`/ps`、`/skill:jsr-reverse`、`/skill:spider-king`），点击首项后输入框变为 `/ps `，面板关闭；未实际发送命令。
- 会话回退入口已验证：会话窗口存在“回退上一轮 / 再回退一轮”按钮，点击后弹出确认对话框，标题和说明正确，取消后不执行 fork；实际回退仍走已验证的 `get_fork_messages` + `fork` 接口，未在当前用户会话上执行。
- MCP 逐服务器检查已验证：临时 stdio 假服务器返回 `ping`、`echo` 两个工具，点击服务器卡片里的“检查”后状态显示“已连接 · 2 个工具”，并显示两个工具名；测试配置和假服务器已删除。
- MCP 重连入口已验证（旧版，窗口级入口已移除）：MCP 窗口曾同时显示“检查连接”和“重连 MCP”；没有启用的服务器时点击“重连 MCP”直接提示“没有启用的 MCP 服务器，无需重连”，不会重启 runtime。配置了启用服务器时会先弹出圆角确认框；用临时启用的 stdio 服务器验证了确认框文案，点击取消不会重启，测试配置已删除。该窗口级入口已并入“重载 Agent”，单服务器“重连”仍保留。
- 用临时两消息会话验证助手回复“复制”：按钮存在于消息标签，点击后系统剪贴板内容为 `这是一段可以复制的回复。`；测试会话已删除。
- 直接 shell 已验证：输入 `!! echo pispider-shell-test` 后主进程用本机 PowerShell 执行，工具卡片显示命令、`pispider-shell-test` 和 `exit 0`；测试不写入会话文件，测试后已切回用户会话。`!! Start-Sleep -Seconds 10` 执行中点击发送/停止按钮会调用 `shell:abort`，卡片显示“已取消”，按钮恢复发送图标。当前直接 shell 是桌面本地执行，不进入 Agent 上下文。
- MCP 单服务器命令已验证（2026-11-16 CDP）：`get_commands` 包含 `mcp`；`runMcpCommand("bad name!", "reconnect")` 被主进程拒绝为“MCP 服务器名称无效”；`runMcpCommand("pispider_no_such_server", "reconnect")` 返回 `{ ok: true, disposition: "handled" }`，未知服务器错误由扩展通知承担，runtime 未崩溃。
- 会话跨目录恢复已验证（2026-11-16 CDP）：手工构造包含 `session` 头和一条用户消息的临时 `.jsonl`，`importSessionPath` 返回 `imported: true` 并复制到当前 `sessions/`；再次导入同名文件生成 `_imported-<时间戳>.jsonl`，不覆盖首个副本；无 `session` 头的文件返回“所选文件不是有效的 Pi 会话文件”。测试副本和临时目录已删除，原会话保留。
- 会话置顶已验证（2026-11-16 CDP）：`toggleSessionPin` 写入 `desktop.json` 的 `pinnedSessions`，`listSessions` 返回 `pinned: true` 且置顶项排第一；DOM 显示 `session-row pinned`、星标 `★`、标题“取消置顶”；再次切换后恢复 `☆` 和置顶项为空。
- 增量渲染已验证（2026-11-16 CDP）：注入两条临时消息，首帧生成两个节点；只修改 live 助手文本后，用户节点引用不变、live 节点被替换且文本从 `a` 更新为 `ab`，说明流式 token 不再全量重建。测试后已恢复真实消息并清理状态。
- 共用视觉 token 已验证（2026-11-16 CDP）：主窗口和设置窗口的 `--accent` 均为 `#0f766e`，字体均为 `Inter, "Segoe UI", ...`，背景均为 `rgb(246, 245, 241)`；设置窗口 `scrollWidth === innerWidth`，无横向溢出。切到深色后两个窗口的 `--accent` 均为 `#5fc7b6`、`--bg` 均为 `#171715`，设置窗口壳背景为 `rgb(23, 23, 21)`；测试后已恢复浅色。
- 状态横幅已验证（2026-11-16 CDP）：注入 warning 横幅后显示图标、文本和“执行”按钮；点击按钮触发回调并隐藏横幅；再次显示后点击关闭按钮隐藏。运行时失败、桌面信息失败和模型图像输入三种触发路径已接入。
- 1180 响应式断点已验证（2026-11-16 CDP）：把主窗口视口临时缩到 1100 后 `matchMedia('(max-width: 1180px)')` 为 true，`.app-body` 变为 `232px minmax(0, 1fr) auto`；测试后重启窗口恢复 1440 视口，媒体查询恢复 false。
- 窄窗口右栏默认折叠已验证（2026-11-16 CDP）：保存的右栏偏好为 `open` 时，1100 视口启动后 `state.panelOpen` 为 false、`#appBody` 带 `panel-hidden`、按钮 `aria-expanded=false` 且标题为“打开上下文面板”；点击按钮后右栏展开、`aria-expanded=true`，`localStorage` 仍为 `open`，说明只折叠本次布局、不覆盖偏好。
- 历史记录说明：下面 141–146 条记录的是 120–360 分段窗口阶段；完整虚拟滚动已在后续条目替代这些行为，旧记录保留作为回归对照。
- 长会话滑动窗口已验证（2026-11-17 CDP，旧分段窗口历史）：注入 1200 条临时消息，初始只渲染最近 120 条，窗口为 `[1080,1200]`、DOM 120，顶部显示“加载更早的 120 条（剩余 1080 条）”；初始窗口落到底部，`scrollTop=max`；上翻后为 `[960,1200]` DOM 240，再上翻为 `[840,1200]` DOM 360，之后为 `[720,1080]` DOM 360；窗口不再无限增长，`content-visibility` 生效。400 条测试连续上翻 `[280,400]` → `[160,400]` → `[40,400]` → `[0,360]`，`fake-280` 的视口 top 始终为 80；点击顶部按钮依次落到 `[160,400]` / `[40,400]` / `[0,360]` 且 `scrollTop=0`，点击底部按钮回补为 `[40,400]`、`scrollTop=58476`；连续派发 scroll 事件由 140ms `windowShiftLock` 合并，只翻一页；滚到底自动回补为 `[40,400]`、DOM 360；测试后恢复真实 `111` 会话 3 条消息。
- 长会话快照与流式边界已验证（2026-11-17 CDP）：历史窗口 `[40,400]`、`top=5000` 的快照恢复后窗口和位置都不变；`atLatest=true` 的 400 条快照在追加到 410 条后恢复为 `[50,410]`，最新 `fake-409` 在 DOM 中可见。在 `[40,400]` 历史窗口内注入 `message_start` / `message_update` / `message_end`，窗口和 `top=5000` 不变，只把底部按钮更新为“加载较新的 1 条（剩余 1 条）”；测试后恢复真实 `111` 会话。
- 会话切换端到端已验证（2026-11-17 CDP）：临时 400 条会话没有快照时首次打开为 `[280,400]`、`scrollTop=max`；保存 `[40,400]`、`top=5000`、`atLatest=false` 后切到真实 `111` 再切回，恢复 `[40,400]`、`top=5000`、`atLatest=false`；切回 `111` 为 `[0,2]`、`top=0`、范围提示隐藏。测试中定位并修复 `session_start` 与 `switchSession` 并发刷新导致旧 `[0,2]` 窗口扩展成 `[40,400]` 的问题：`refreshFromAgent` 增加代际标记丢弃过期响应，`sessionFile` 变化时重置窗口，无快照时重置为最新 120 条。临时会话文件已删除，`desktop.json.lastSessionPath` 恢复为 `111`。
- 流式事件边界已验证（2026-11-17 CDP，注入与 runtime 相同形状的 `message_start` / `message_update` / `message_end`）：历史 `[40,400]`、`top=5000` 收到新增消息后仍保持 `[40,400]`、`top=5000`、`atLatest=false`，底部显示“加载较新的 1 条（剩余 1 条）”；`scrollToLatest()` 得到 `[281,401]` 后，在底部收到流式新增扩展为 `[281,402]`、`scrollTop=max`、`atLatest=true`；历史窗口底部 `[40,400]`、总数 402 时收到新增，窗口保持 `[40,400]`、`atLatest=false`，底部“较新”计数变为 3。本次未调用真实付费 provider，验证的是 renderer 事件契约；真实模型流仍未单独跑。
- 长会话范围与首尾跳转已验证（2026-11-17 CDP）：400 条时标题下显示“显示 281–400 / 共 400 条”，`Ctrl+Home` 后窗口变 `[0,360]`、范围“显示 1–360 / 共 400 条”、`scrollTop=0`；`Ctrl+End` 后恢复 `[280,400]`、`scrollTop=max`；输入框聚焦时 `Ctrl+Home` 不改变窗口。`scrollToLatest()` 从最新窗口顶部触发仍保持 `[280,400]` 并回底，不再经过顶部触发上翻。命令面板新增两个动作（桌面动作总数为 20），快捷键总览为 19 条；测试后恢复真实 `111` 会话，范围提示因只有 2 条非 system 消息而隐藏。
- 长会话可见导航已验证（2026-11-17 CDP）：临时 400 条会话在 `[280,400]` 时范围行右侧显示“最早 / 最新”两个按钮；点击“最早”得到 `[0,360]`、`scrollTop=0`，点击“最新”得到 `[280,400]`、`scrollTop=max`；切回真实 `111` 后临时会话文件已删除，真实会话仍为 8 行 / 47193 字节。
- 完整虚拟滚动已验证（2026-11-17 CDP，400 条）：初始底部只渲染 120 条、范围 280–399、`scrollTop=33382=max`，顶部 spacer 约 23240px，标题显示“共 400 条”；设 `scrollTop=15000` 并派发 scroll 后渲染 176 条、范围 152–327，测量后 `scrollTop≈14512`、`scrollMax≈32497`，锚点保留；点“最早”得 0–175、`scrollTop=0`、顶部 spacer 0，第一条消息距容器顶 30px；点“最新”得 280–399、`scrollTop=28504=max`、底部 spacer 0；`scrollTop=10000` 得 92–267、可见首条 index 112，无旧“加载更早”按钮。
- 完整虚拟滚动已验证（2026-11-17 CDP，1200 条）：初始范围 1080–1199、`scrollTop=99782=max`、DOM 120；设 `scrollTop=50000` 并派发 scroll 后渲染 176 条、范围 574–749、可见 index 600、偏移约 1，顶部 spacer 47642px、底部 spacer 35259px，“共 1200 条”；点“最新”回到 1080–1199、`scrollTop=96716=max`、底部 spacer 0；点“最早”得 0–175、`scrollTop=0`；`scrollRestorePending` 时 `normalizeMessageWindow()` 不再跟随底部；`document.hidden=true` 下刷新改走 `scheduleDomUpdate()` 的 `setTimeout` 路径。
- 虚拟滚动锚点恢复已验证（2026-11-17 CDP）：400 条会话在 `scrollTop=10000`、可见 index 117、偏移 14.28 时保存快照，reload 后恢复 `scrollTop=9908`、可见 index 117、偏移 14；1200 条会话在 index 648、偏移 -62 时切到真实 `111` 再切回，恢复 index 648、偏移 -62，reload 同样恢复 index 648。测试中确认程序化 `scrollTop` 不触发 scroll 事件时需手动派发事件；应用真实滚动不受影响。
- 虚拟滚动流式边界已验证（2026-11-17 CDP，注入与 runtime 相同形状的 `message_start` / `message_update` / `message_end`）：1200 条会话在 `scrollTop=50000`、范围 628–803 时注入新增消息，运行后仍为 628–803、`scrollTop=50000`、DOM 176，消息总数变为 1202；在底部注入时切片扩展为 1081–1200、`scrollTop=max`。未调用真实付费 provider，验证的是 renderer 事件契约。
- 模型作用域已验证（2026-11-17 CDP）：临时在 `models.json` 增加第二个模型后重启，模型菜单的“作用域设置”列出两个模型；只勾选 `grok-4.6` 保存后 `settings.json.enabledModels` 写入 `["pispider-custom/grok-4.6"]`，runtime 重启并保留真实 `111` 会话；菜单默认只显示 1 个模型，标题按钮从“全部”切回后显示 2 个；作用域设为两个模型时，临时会话中“下一个”通过 RPC `cycle_model` 从 `grok-4.6` 切到 `grok-4.6-alt`，提示“已切换到 自定义模型 Alt（作用域内）”；单模型作用域下循环提示“当前作用域内没有可循环的下一个模型”。测试后已清空作用域、删除临时会话并恢复 `models.json`，三个真实文件哈希与测试前一致：`models.json` `FF148DB9...`、`settings.json` `554192B9...`、真实会话 `D752F046...`。
- 主界面会话用量已验证（2026-11-17 CDP）：真实 `111` 上按钮显示“上下文 9%”，`title` 为“上下文 9% · 11k / 128k tokens · Token 11k · 成本 $0.0000”；点击后弹层显示上下文 9%、11k / 128k tokens、输入 63、输出 163、Token 总量 11k、成本 `$0.0000`，文本与 `get_session_stats` 返回一致。点击刷新后数值和 label 保持不变；点击外部关闭、再次点击打开、`Escape` 关闭均通过，`aria-expanded` 同步 false / true / false。浅色和深色主题均已目测弹层、进度条和统计行；140% 缩放（视口 1028）下按钮自动隐藏“上下文”前缀、显示 9%（宽 34px），标题与按钮不重叠，弹层 302×274 位于视口内。验证后恢复 100% 和浅色主题；真实 `111` 仍为 3 条消息、8 行 / 47193 字节，`models.json` / `settings.json` / 会话文件 SHA256 保持 `FF148D...` / `554192...` / `D752F0...`。
- 虚拟滚动真实高度已验证（2026-11-17 CDP，1200 条混合会话）：消息按短用户 / 20–200 行代码助手 / 12 段中文助手 / 40 行工具结果 / 长中文用户 / 短助手循环。最新窗口 1080–1200、DOM 120、`scrollTop=563484=max`、`scrollHeight=564161`、`listHeight=564133`、顶部 spacer 507836px、`offsetTotal=564089.8` 加 42px 上下 padding 后与 `listHeight` 差约 1.2px；渲染切片实际流高度（`getBoundingClientRect().height + computed marginBottom`）与 `messageHeights` 缓存 `maxDiff≤0.1`，样本 user 89.1、代码助手 1198.1、长中文助手 797.9、工具卡 77、长用户 570.6、短助手 90.1。真实渲染探针中 user 89.1/89、userLong 137.2/137、assistantShort 152.2/152、assistantOne 90.1/90、thinking 114.1/114、tool 77/77、code20 598.1/598、code100 2198.1/2198、code200 4198.1/4198；长英文段落 `word `×60 实际 138.2 / 估算 162，保守约 24px。滚动到 `scrollTop=300017` 后窗口 611–787，快照 `anchorIndex=640`、`anchorOffset=4`；reload 和切到真实 `111` 再切回都恢复窗口 611–787、首可见 640、偏移 4，`scrollTop=300017`。修复了虚拟目标落位后未重新保存锚点、以及切换会话时旧 DOM 把新会话快照写成 `top=0` 的问题；`messageDataKey` 和 `scrollRestorePending` 现在阻止错误会话快照覆盖。最早 / 最新跳转分别为 `[0,176]` / `scrollTop=0`、`[1080,1200]` / `scrollTop=max`；reload 后 `scrollMax` 因离屏估算仍有约百 px 级变化，但锚点恢复不受影响。
- 按会话高度缓存已验证（2026-11-17 CDP，240 条混合会话）：首次在最新窗口 `[120,240]` 渲染并测量 120 条，`state.messageHeights` 与会话缓存均为 120 条，`localStorage pispider-message-heights` 约 5480 bytes；reload 后仍为窗口 `[120,240]`、`scrollTop=151028=max`、缓存 120 条命中。滚动到 `scrollTop=50000` 后补测中段，窗口 `[51,227]`、缓存增至 189 条；切到真实 `111` 再切回，恢复窗口 `[51,227]`、`scrollTop=50017`、`scrollMax=151071`、缓存 189 条；再次 reload 仍为 `[51,227]`、`scrollTop=50017`、`scrollMax=151071`、缓存 189 条，说明已访问切片的总高度不再随 reload 重新估算而漂移。测试消息键全部唯一（240/240），缓存按消息 id 或角色 + 时间戳保存，不依赖切片下标。
- 高度估算校准与 Markdown 列表已验证（2026-11-17 CDP，240 条十类循环探针）：初始窗口 `[120,240]`、已测 120 条时估算总高度 `182048.4`，隐藏容器全量真实 `181720.9`，差 `-327.6px`；把用户正文宽度改为 `listWidth * 0.82 - 26`、助手正文改为 `listWidth * 0.82`，Markdown 标题 / 列表 / 代码块按块级高度累加（代码块 overhead 56、块 gap 14、错误块 34）后，估算总高度 `181800`、首次打开差 `-39.6px`（约 0.02%），全量估算偏差 `-79.1px`，全量渲染约 372ms。分类汇总实际 / 估算：短用户 2137.9/2136、代码助手 50591.6/50640、12 段中文助手 19149/19104、工具结果 1848/1848、长用户 10806/10776、短助手 2161.9/2160、长英文 + 代码 25061.3/25104、thinking 2737.9/2736、错误助手 14207.6/14256、双代码块 + 标题 / 列表 53019.8/53040。`renderMarkdown('## 标题\n\n- 第一项\n- 第二项\n- 第三项\n\n说明。')` 输出 `<h2>标题</h2><ul><li>第一项</li><li>第二项</li><li>第三项</li></ul><p>说明。</p>`，不再有裸 `<li>` / `<br>`。锚点 `scrollTop=29990`、窗口 `[13,189]`、index 41 在 reload 和切到真实 `111` 再切回后保持；`scrollToLatest()` 恢复 `[120,240]`、`scrollTop=max`。测试后需删除探针会话、Temp helper 并恢复真实 `111`。
- 宽度 / 缩放布局失效已验证（2026-11-17 CDP，240 条临时探针）：高度缓存版本 4 记录 `layoutWidth` / `layoutZoom`，仅当宽度差 ≤2px 且缩放差 ≤0.001 时种入缓存。在 `scrollTop=30000`、窗口 `[23,199]`、列表宽 860、首可见 index 51 / 偏移 -66.3 时缩放到 140%（列表宽 714）：锚点仍为 index 51、偏移 -66.2；从 140% 回到 100% 仍为 index 51、偏移 -66.4。滚到底后缩放到 140%，`scrollTop=146407.86`、`scrollMax=146408`；从 140% 回 100% 后 `scrollTop=142167=max`。合成视口 1440→1000 宽度后列表宽 860→685，锚点 index 49、偏移 -1044.7 保持；重新加载后 `layoutWidth=714`、缓存 176 条命中、锚点 index 51 保持。切到真实 `111` 时列表宽 724，其 860px 缓存未被种入；切回探针仍使用自己的布局缓存。面板关闭→打开（禁用过渡的等价测试）使列表宽 860→646，锚点 index 49、偏移 -1045.1 保持。测试后需删除探针会话、Temp helper 与探针高度缓存，并恢复真实 `111` / 100% 缩放。本轮只重测 240 条探针，未重跑 1200 条混合会话，也没有在 714 / 685 等新宽度下用隐藏容器对全量真实总高度做对比；宽度变化只保证了当前切片重测、锚点 / 底部跟随和缓存布局字段。页面在测试期间始终 `document.visibilityState="hidden"`，CSS width transition 不推进，面板 240ms 动画未在可见窗口下跑过；面板用例用禁用 transition + 手动 `renderMessages()` 做等价验证。10px 级的滚动条宽度差会被当作新布局并保守清空当前会话已测高度，而不是混用旧布局高度。
- 思考强度菜单已验证（2026-11-17 CDP，文案改动后重启）：模型弹层标题为“思考强度”，文本为“关闭 / 低 / 中 / 高”，不再出现 `minimal`，每个档位也不再显示 `off/low/medium/high` 的 raw id；当前模型只有基础档位时显示“当前模型还没有“极高 / 最高”档位”说明。
- 测试命令：`node --check apps/pispider-desktop/renderer/app.js`、`node --check apps/pispider-desktop/renderer/panel.js`、`node --check apps/pispider-desktop/main.cjs`、`node --check apps/pispider-desktop/preload.cjs` 通过；`npm run pispider:check` 通过；`npm run pispider:test` 44 项中 43 通过、1 跳过（符号链接创建不可用）；`node --test scripts/pispider-launcher.test.mjs scripts/pispider-migrate.test.mjs` 14 项全通过（2026-11-18 扩展 / package 接入后复跑）。
- 启动恢复上次会话已验证（2026-11-16 CDP）：重启 Electron 后 `get_state.sessionFile` 指向 `2026-11-16T02-20-26-461Z_01a1e227-dfdc-77be-956d-9c1cd6c380bb.jsonl`，`get_messages` 和 UI 都恢复 3 条消息，`desktop.json` 写入 `lastSessionPath`。
- 启动恢复失效路径已验证（2026-11-16 CDP）：把 `lastSessionPath` 临时改成不存在的 `missing-session.jsonl` 后重启，runtime 回退到最近更新的已保存会话 `111`，UI 恢复 3 条消息；`desktop.json` 的 `lastSessionPath` 被修正回真实会话路径。
- 启动恢复损坏文件已验证（2026-11-16 CDP）：把 `lastSessionPath` 指向临时写入的非法 `.jsonl` 后重启，`switch_session` 失败后回退到最近会话 `111`（3 条消息），会话列表仍只有 `111`；临时文件已删除，`lastSessionPath` 已修正回真实路径。
- 新建会话不覆盖启动记录已验证（2026-11-16 CDP）：`new_session` 返回新的内存会话路径，但文件尚未落盘时 `listSessions` 没有新增文件，`desktop.json.lastSessionPath` 仍指向 `111`；重新 `switch_session` 到 `111` 后恢复 3 条消息。主进程在 `agent_settled` 时会重新读取 `get_state`，文件落盘后才记录新路径。
- 样式清理已验证（2026-11-16 重载）：删除 task / activity / artifact 组件规则、合并 `.composer:focus-within`、删除 1040 死规则后，`styles.css` 规则数从 474 降到 456；加入会话分组和行内确认样式后为 463，主窗口重载无 CSS 解析错误，网格和 composer 边框正常。
- 会话列表分组与行内删除已验证（2026-11-16 CDP）：单会话显示“今天”分组和计数，当前会话行不显示删除入口；注入一个临时非当前会话后，点 × 会在行内出现“删除？ / 删除 / 取消”，点取消恢复原行，`state.sessions` 回到 1 且当前会话未被删除；`sessionGroupLabel` 对置顶、今天、2020 年旧会话分别返回“置顶 / 今天 / 更早”。
- 工具卡内容指纹已验证（2026-11-16 CDP）：`contentFingerprint("ab")` 为 `2:3105`，`contentFingerprint("ac")` 为 `2:3106`，同长度不同内容得到不同签名，避免旧实现“输出长度相同就不重建”的漏更新。
- 图标 aria 与弹层键盘已验证（2026-11-16 CDP）：`refreshSessionsButton` / `settingsButton` / `attachButton` / `sendButton` / 浏览器前进后退刷新均返回非空 `aria-label`；打开测试选择弹层后方向键从 A 移到 B，焦点在最后一个控件时按 Tab 回到首个控件，关闭后 `extensionDialog.hidden=true`、`state.activeExtensionDialog` 为空。
- 运行时能力探测已验证（2026-11-16 CDP）：Electron 重启后 `window.pispider.getCapabilities()` 返回 `capabilities.commands` 前 12 项为 `ps`、`llama`、`mcp`、`skill:ast-deobfuscate`、`skill:ast-deobfuscation`、`skill:docx`、`skill:env-patch`、`skill:find-crypto-entry`、`skill:hello_js_reverse_skill`、`skill:humanizer`、`skill:js-env-patcher`、`skill:js-reverse-automation`，`hasMcp=true`；`/mcp` 命令门禁按此缓存判断。
- MCP 逐工具启停列表已验证（2026-11-16 CDP）：在 MCP 二次窗口注入检查结果 `demo`（工具 `ping` / `echo`）和已有 `toolExposure`，编辑弹层渲染两行：`ping` 勾选且模式 `deferred`、`echo` 未勾选且下拉禁用；`collectMcpToolExposure()` 返回 `{echo:"hidden", ping:"deferred"}`；勾选 `echo` 后下拉启用、输出 `{echo:"direct", ping:"deferred"}`。用临时 `__ui_probe` HTTP 服务器验证 `saveMcp` 写回 `toolExposure`，读取一致后删除。
- 窗口状态持久化已验证（2026-11-16 Win32 / CDP）：最大化后 `desktop.json.windowState.maximized=true` 且保留普通 bounds；重启后窗口以 1920×1040 最大化打开；取消最大化后写回 `maximized:false`。移动窗口后立即 `WM_CLOSE`，关闭时同步补写新坐标；把 `windowState` 改成屏幕外 `9999,9999` 后重启，窗口回退为可见的 1440×920 并重新写入 `x=240,y=60`。第二次启动 Electron 进程在 5 秒内退出，`9347` 仍只有主窗口目标，单实例锁生效。
- 搜索命中高亮已验证（2026-11-16 CDP）：`state.search='11'` 后 `renderSessions()` 生成 2 个 `.search-hit`，`.session-group-head` 数量为 0，标题仍为 `111`；清空搜索后恢复分组。
- 扩展弹层焦点回归已验证（2026-11-16 CDP）：聚焦一个会话按钮后打开临时确认弹层，两个 `requestAnimationFrame` 后焦点在弹层内；关闭后焦点回到原按钮。
- 队列面板已验证（2026-11-16 CDP）：注入 `queue_update` 的 `steering=["alpha"]`、`followUp=["beta","gamma"]` 后，队列按钮显示“3 条排队”，面板按“插话 / 排队”渲染三项；`aria-expanded=true`，关闭按钮恢复隐藏；点击单项“复制”后系统剪贴板内容为 `copy-me`。测试后面板状态已重置。
- 回到最新已验证（2026-11-16 CDP）：注入 80 条临时消息并把滚动位置置顶，“回到最新”按钮出现；点击后 1.2 秒内回到底部（剩余距离 29px，低于 180px 阈值），按钮自动隐藏；随后恢复用户会话的 3 条消息。
- 动效与资源入口已验证（2026-11-16 CDP）：`--motion-panel` 为 `240ms`，主窗口 `sidebar-in` 与二次窗口 `panel-enter` 实际时长均为 `0.24s`；两侧窗口各只剩 1 条 `prefers-reduced-motion` 规则。资源入口为 2×2，四格宽 110px，侧栏无横向溢出。
- MCP 状态横幅已验证（2026-11-16 CDP）：`pending` 显示 warning“正在登录…”，`sent` 显示 info“已发送登录请求，请在 MCP 窗口确认状态”，`error` 显示 error 与错误文本；三种状态均带“打开 MCP”，点击后打开对应二次窗口。实际 IPC 也已验证：`runMcpCommand("pispider-banner-test", "reconnect")` 返回 `disposition: "handled"`，主窗口横幅更新为“已发送重连请求”，会话消息数保持 3。
- 代码块复制已验证（2026-11-17 CDP）：Markdown `js` 代码块渲染语言标签与“复制代码”，点击后系统剪贴板为 `const x = 1;`；临时消息已移除，用户会话恢复 3 条。
- 应用级缩放已验证（2026-11-17 CDP）：120% 时主窗口 `innerWidth` 1440→1200、设置窗口 760→691，`desktop.json.zoomFactor=1.2`；重启后主窗口仍为 1200、`getZoom=1.2`，最后恢复 100% 并写回 `zoomFactor=1`。
- 按会话滚动位置已验证（2026-11-17 CDP）：临时 80 条消息滚动到 `top=600` 后切到其他会话，再切回恢复到 `600`；“回到最新”按钮仍能平滑回底并隐藏。测试消息和测试会话键已清理，用户会话恢复 3 条、标题 `111`。
- 快捷键总览已验证（2026-11-17 CDP）：`Ctrl+/` / `F1` 打开 4 组 19 条快捷键，焦点进入关闭按钮，卡片 625px 无横向溢出；弹层打开时 `Ctrl+B` 不切换工作区，`Esc` 关闭后焦点回到“快捷键”按钮。
- 命令面板已验证（2026-11-17 CDP）：`Ctrl+Shift+P` 打开 42 项（20 个桌面动作、22 个 Pi 命令），搜索 `docx` 命中 `/skill:docx`，回车插入 `/skill:docx ` 并聚焦输入框；`Ctrl+B` 在面板打开时不生效，`Esc` 关闭，卡片无横向溢出，草稿已清空。执行“搜索任务”后重新打开，`pispider-command-history` 记录该项并以“最近使用”分组置顶。
- 会话搜索键盘导航已验证（2026-11-17 CDP）：输入 `111` 过滤为 1 项，`↓` 后高亮索引 0，`Enter` 切换回同一会话；搜索清空后会话仍为 3 条消息、标题 `111`。
- 会话全文搜索已验证（2026-11-18 CDP）：调用 `window.pispider.searchSessions('111','relevance')` 返回 `ok:true`、`total:1`、名称 `111`、score 0；`searchSessions('inspect a file','relevance')` 命中当前会话的助手消息，`matchField` 为“助手消息”，snippet 含 `inspect a file, fix code, or start a reverse-engineering target.`；`re:insp.*file` 同样返回 1 条；`re:[` 返回 `ok:false` 和 `正则表达式无效：Invalid regular expression: /[/i: Unterminated character class`。UI 输入 `inspect a file` 后摘要为 `1 个匹配`，结果行显示 snippet、`助手消息` 标签和 2 个 `.search-hit`；输入 `re:[` 显示 `.search-error`；点击“最近”后排序按钮 `.active` 为“最近”。多结果排序用两个临时会话验证：`sortprobe` 的标题命中为“sortprobe Beta”，正文命中为“Alpha task”；`relevance` 返回“sortprobe Beta / Alpha task”，`recent` 返回“Alpha task / sortprobe Beta”，临时 `.jsonl` 已删除。
- Markdown 扩展与工具卡已验证（2026-11-18 CDP）：`renderMarkdown` 对样例输出 `<h1>`、`<ul>`、`<ol>`、`<blockquote>`、`<table>`、`<hr>` 和 `.code-block`，表格列对齐为 left / right；代码块 `js` 生成 `tok-keyword` / `tok-string` / `tok-number` / `tok-comment`，`textContent` 仍保留原始 `const x = 1;`。`renderToolCard` 对 `bash` 卡生成“命令”类型、2 个 `.tool-section` 和参数 / 结果 `<pre>`；`renderToolResultMessage` 对 `read` 生成“读取”类型和独立“输出”区。浅色截图确认标题、列表、表格、引用、代码高亮和折叠工具卡在 1440 宽窗口下无横向溢出；临时预览消息已移除，真实会话恢复 2 条消息。
- Mermaid 图表已验证（2026-11-18 CDP）：`flowchart LR` 样例渲染后 `.mermaid-block` 状态为 `rendered`、`.mermaid-output svg` 数量 1、源码 `hidden=true`，按钮为“查看源码”；`useMaxWidth:false` 时 SVG 为 `626×184`，中文节点标签在 1440 宽窗口下可读，浅色截图确认 header 与图表无横向溢出。点击“查看源码”后源码区 `hidden=false`、按钮变“隐藏源码”；切到深色主题后图表状态仍为 `rendered`、SVG 1 个、源码恢复折叠，深色截图确认节点边框、连线与文字对比度正常。非法语法 `not a diagram` 使状态变为 `error`，`.mermaid-error` 显示原因、源码自动展开；包含 `sequenceDiagram` 与 `flowchart` 的两段消息均渲染为 `rendered`，共 2 个 SVG、0 个错误。测试后移除 `ps-mermaid-test`，恢复浅色主题和真实会话 2 条消息。随后用 3 条消息的真实临时会话验证：切换后 2 个 `.mermaid-block` 均为 `rendered`、2 个 SVG；`location.reload()` 后当前会话恢复为 3 条消息，2 个图表仍为 `rendered`，说明启动恢复链路也走通。最后切回真实 `111` 并删除临时会话，侧栏恢复 1 个会话、消息 2 条。另验证“复制代码”按钮：Mermaid 源码 `flowchart LR\n  A[复制测试] --> B[结束]` 点击后系统剪贴板为完整源码；临时消息已移除。
- Mermaid 裁剪运行时已验证（2026-11-18 CDP）：`npm run build:mermaid` 生成 `vendor/mermaid`，37 个运行时文件 + `manifest.json`，总计 3,609,130 bytes（约 3.44 MB）；manifest 记录 `mermaid@12.3.0`、入口 `mermaid.esm.min.mjs`、`diagrams: ["flowchart", "sequence"]` 和全部文件大小。首次裁剪只含 0.89 MB 依赖图时，`flowchart` 因缺少 ELK 布局报 `Failed to fetch dynamically imported module: elk-...`；加入 ELK / dagre / swimlane / cose / KaTeX / BPMN 图标后，`flowchart` 与 `sequenceDiagram` 均 `rendered`、2 个 SVG、0 个错误。renderer 优先导入 vendor，`pie` 样例被 `mermaidDiagramKind` 拦截，状态 `error` 并提示“当前离线版本只包含 flowchart / sequence，无法渲染 pie 图表”。重启桌面后再次渲染 `flowchart LR`，状态仍为 `rendered`、SVG 1 个，确认冷启动也走 vendor。测试消息已移除，真实会话保持 2 条消息。
- 分享到 Gist 已验证（2026-11-18 CDP）：无 `gh` 环境下打开会话窗口“分享到 Gist”，`shareDialog` 显示“分享会话 / 创建私有 Gist”和上传、登录、`PISPIDER_GH_BIN` 说明；点击创建后弹窗保留，显示“未安装 GitHub CLI（gh）。先安装 https://cli.github.com/，再运行 gh auth login。”，提交按钮恢复可用。用 `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` 编译的 fake `gh`（`auth status` 返回 0，`gist create` 输出 `https://gist.github.com/abcdef123456`）作为 `PISPIDER_GH_BIN` 重启后，点击“创建私有 Gist”进入成功态：标题“分享成功”，预览链接 `https://pi.dev/session/abcdef123456`，Gist 地址 `https://gist.github.com/abcdef123456`，按钮“完成”，无错误色；说明导出 HTML、创建私有 Gist、解析 URL 和生成 viewer URL 的链路走通。fake `gh` 不是真实上传，真实 GitHub 账号下的私有 Gist 创建仍待有 `gh` 环境补验；fake 文件和临时 HTML 目录未进入仓库。
- MCP 内置预置目录已验证（2026-11-18 CDP）：删除测试安装后重新启动，MCP 用户级列表显示 `chrome-devtools` 虚拟卡片，状态“预置 / 未启动”，`mcp.json` 不存在，`agent/mcp-packages` 和 `skills/chrome-devtools` 均不存在；点击“准备并启动”后 npm 安装 `chrome-devtools-mcp@1.13.0` 到 `agent/mcp-packages/chrome-devtools`，当时还复制 `skills/chrome-devtools`（该行为后续移除），写入 `mcp.json` 的 `enabled:true`、`managedBy:"pispider"`、`catalogId:"chrome-devtools"`，面板显示“预置 / 已启用 / 已安装 / 随包技能已复制（后续移除） / 尚未检查”。此过程不自动重载 Agent，主窗口仍为会话 `111`、2 条消息；随后“检查连接”对 stdio 服务器做 MCP 握手，返回 `connected` 和 33 个工具（含 `click`、`navigate_page`、`evaluate_script`、`take_screenshot` 等）。测试安装和配置已清理，默认保持预置未启动。实现过程中修复了 Windows 下 `cmd.exe /c npm install --prefix` 的路径引号问题，改为优先用 `npm-cli.js` 直连 Node。
- 二次窗口去 hero 与尺寸放大已验证（2026-11-18 CDP）：重启应用加载最新 `main.cjs` 后逐页打开，实际尺寸为规则 / 技能 `1000×700`、设置 `1060×820`、MCP / 扩展 `1060×800`、项目 `940×680`、会话 `940×780`、状态 `1000×800`。八页 `.panel-body` 均 `scrollWidth === clientWidth`（横向溢出 0）；纵向设置 `1522px`、扩展 `625px`、状态 `275px`、会话 `68px`，通过窗口内滚动查看，其余页无纵向溢出。页面不再渲染 `.panel-hero`，规则页为标题“规则”与“0 条规则 · 未启用”同排 + 单行“暂无规则”摘要 + 空态卡，空态卡内保留唯一“新建规则”按钮；MCP 页标题旁为“1 个服务器 · 用户级”，页面顶部为“1 个预置可选 | 用户级”摘要和四列数值条；项目页标题旁为 `SpiderBuddy`，顶部摘要为“已连接 | 本地桌面”；设置页标题区 `panelMeta` 为空、模型卡从首屏开始，模型、服务商、领域、项目信任、上下文窗口均进入摘要条。最终 `rules` / `project` 窗口截图保存为 `pispider-panel-rules-final.png` 和 `pispider-panel-project-final.png`。`npm run pispider:check` 通过；`npm run pispider:test` 44 项中 43 通过、1 跳过；`node --test scripts/pispider-launcher.test.mjs scripts/pispider-migrate.test.mjs` 14 项通过。
- MCP 预置说明弹层与卡头操作已验证（2026-11-18 CDP）：重载 MCP 面板后，`chrome-devtools` 预置卡只显示 `chrome-devtools`、`stdio · codemode`、`预置`、`未启动`；`.mcp-meta` 数量为 0，不再显示包版本、用途说明和运行要求。`.mcp-actions` 已移入 `.mcp-top`，与名称同一行并且右对齐（left 878.5 / right 1016），按钮为“准备并启动 / 说明”，两个按钮同高 29.4px。点击“说明”打开 `chrome-devtools 说明` 弹层，正文为 Google 官方用途说明、`包 chrome-devtools-mcp@1.13.0`、`运行要求 Google Chrome 或 Chrome for Testing` 和首次安装说明；当时的说明弹层还展示随包技能行，后续已移除。弹层宽 620px、高约 321px，只有“关闭”按钮，取消按钮隐藏。点击“关闭”后 `dialog.open=false`，无残留错误；卡头截图保存为 `pispider-mcp-inline-actions-final.png`，弹层截图保存为 `pispider-mcp-info-dialog.png`。`node --check renderer/panel.js` 通过，面板重载后无脚本错误。
- MCP 顶部操作精简已验证（2026-11-18 CDP）：MCP 窗口头部可见按钮只剩“添加服务器 / 重载 Agent / 检查连接”，`refreshButton` 和 `openDirButton` 均为 `hidden=true`，`reconnectMcpButton` 已从 DOM 移除；配置卡保留 `mcp.json` 的“打开”。点击“重载 Agent”后 runtime 重启并保留当前会话，随后自动执行一次 `checkAllMcp(true)`，按钮恢复可用；当前 0 个启用服务器时提示“没有启用的 MCP 服务器”，不再出现“已检查 0 个服务器”。面板无横向溢出（1058 / 1058），截图保存为 `pispider-mcp-header-simplified.png`。`node --check renderer/panel.js` 通过。
- 用户 shell 上下文语义已验证（2026-11-18 CDP）：输入框 `! Write-Output UI_INPUT_OK` 通过实际 `sendPrompt` 发送后，输入框清空，`state.messages` 新增 `role:"bashExecution"`，`command:"Write-Output UI_INPUT_OK"`、`output:"UI_INPUT_OK\n"`、`exitCode:0`、`excludeFromContext:false`，`state.tools` 无残留临时卡；`!! echo BASH_CONTEXT_NO` 记录为 `excludeFromContext:true`。`! Start-Sleep -Seconds 6; Write-Output ABORT_TEST_3` 在运行中调用 `abortShell` 后记录 `cancelled:true`、`output:""`，状态回到 `shellRunning:false`。首次真实测试暴露 Pi 在 Windows 默认找到 WSL `bash.exe` 导致命令失败；在 `packages/pispider/src/index.js` 增加仅 `win32` + `PISPIDER_DESKTOP=1` 生效的 `user_bash` PowerShell operations 后，同一 `!` 命令返回 `BASH_CONTEXT_YES\n`、`exitCode:0`，Pi 仍负责 `recordBashResult()`。`bashExecution` 卡按“Shell / 命令 / 输出”渲染，展开后每个卡片有 2 个 `.tool-output`；`.message-tool` 卡片统一宽度 705px，无横向溢出。PowerShell 包装在命令末尾按 `$LASTEXITCODE` 退出，`! cmd /c exit 7` 记录 `exitCode:7`；验证消息已从会话 JSONL 清理，主窗口恢复 3 条消息、0 个 shell 卡。
- Windows Agent shell 统一已验证（2026-11-19 CDP）：临时会话中 `state.messages` 的 system `sections.tools` 为 `read / edit / write / ps_task / powershell`，`bash` 已被移除，`powershell` 为 `Execute PowerShell commands`；发送“只回复 OK”后 agent 正常结束，临时会话已切回 `111` 并删除。另一次真实调用中，模型按提示调用 `powershell` 执行 `Write-Output AGENT_PWSH_OK`，工具结果 `AGENT_PWSH_OK\r\n`、`isError:false`，最终回复 `AGENT_PWSH_OK`，证明 Agent 的 shell 不再落到 WSL stub。
- MCP live state 已验证（2026-11-19 CDP）：新增 ExtensionAPI `registerMcpStatusProvider()`、`AgentSession.getMcpLiveStatus()` 与 RPC `mcp_status`，内置 MCP 扩展发布实际连接快照。临时写入用户级 `mcp.json`，启动一个只提供 `ping` 的 stdio 测试服务器后重启桌面端，`window.pispider.checkMcp("", "user")` 返回 `live:true`、`state:"connected"`、`tools:["ping"]`、`transport:"stdio"`、`scope:"global"`、`errors:[]`。MCP 窗口摘要显示“1 / 1 已连接”和“Agent 实时”chip，服务器卡显示“已连接 · 1 个工具”和 `ping`，截图保存为 `pispider-mcp-live.png`。测试后删除 `mcp.json`、关闭面板并重载 Agent，再次检查返回 `live:true`、`servers:[]`，测试进程与临时文件已清理。`packages/coding-agent` MCP 测试 55 项全部通过，其中新增 live state 断言覆盖 `connected / enabled / tools / transport / exposure / source`。`npm run build` 重建本地 bundle 后桌面端实测通过。
- MCP catalog manifest 已验证（2026-11-19 CDP）：`catalog/catalog.json` 顶层为 `version / mcp`，MCP 条目归一化为 `packageName / version / binName / mcpArgs`；`listMcp("user")` 返回 `catalogErrors: []`、`catalogPath` 指向 app 内 `catalog.json`，`chrome-devtools` 预置卡显示“预置 / 未启动”，服务器 summary 不再包含 `skills` 字段。MCP 包内 Skill 保留在包内，不复制到 `~/.pispider/skills`；技能窗口只读取用户技能目录，`listSkills()` 返回 `[]`，标题为“0 个技能”，不再显示“预置技能”卡。真实调用 `startMcpCatalog("chrome-devtools", "user")` 后 `installedVersion` 为 `1.13.0`、返回结果没有 `installedSkills`，`agent/mcp-packages/chrome-devtools` 存在，`skills/chrome-devtools` 不存在、`skills` 目录条目数为 0；随后删除配置和临时安装，恢复 2 个预置 / 0 启用 / 0 已配置。最终技能面板截图保存为 `pispider-skills-no-presets.png`。新增 `apps/pispider-desktop/test/catalog.test.mjs` 覆盖 manifest 字段、HTTP 模板、参数解析、无效条目 diagnostics 和拒绝 MCP 自带 Skill 声明，7 项全部通过；`node --check` 覆盖 `mcp-catalog.cjs`、`main.cjs`、`preload.cjs`、`renderer/panel.js`。
- 第二个预置 MCP 已验证（2026-11-19 CDP）：只编辑 `catalog.json` 增加 `sequential-thinking`（`@modelcontextprotocol/server-sequential-thinking@2.2.0`）后重启，`listMcp("user")` 直接返回 `chrome-devtools` 和 `sequential-thinking` 两张预置卡，`catalogErrors` 仍为空；MCP 窗口显示“2 个服务器 / 0 启用 / 2 预置 / 0 已连接”，截图保存为 `pispider-catalog-two.png`。通过 `startMcpCatalog("sequential-thinking")` 真实懒安装成功：`started: "sequential-thinking"`、`needsReload: true`，服务器 args 指向安装目录内 `dist/index.js`，`installedVersion: "2.2.0"`，无随包技能；随后 `deleteMcp` 并删除 `mcp-packages/sequential-thinking` 和 `mcp.json`，恢复默认未安装 / 未启动。桌面 `package.json.files` 已加入 `catalog/**/*` 和 `mcp-catalog.cjs`，新增测试检查打包白名单；catalog 测试 6 项全部通过。
- 预置 MCP 参数化与 filesystem / memory 已验证（2026-11-19 CDP）：`listMcp("user")` 返回 4 项、`catalogErrors: []`，顺序为 `chrome-devtools / filesystem / memory / sequential-thinking`，filesystem 的 `inputs[0]` 为 `id: "workspace"`、`kind: "directory"`、`default: "E:\\mygit\\SpiderBuddy"`、`required: true`。点击 filesystem 的“准备并启动”打开参数弹层，标题“启动 filesystem”，默认目录已解析为项目路径；提交后安装 `@modelcontextprotocol/server-filesystem@2.4.0` 到 `agent/mcp-packages/filesystem`，`mcp.json` 写入 `command: electron.exe`、`args: [dist/index.js, E:\\mygit\\SpiderBuddy]`、`env.ELECTRON_RUN_AS_NODE: "1"`、`packageVersion: "2.4.0"`。重载 Agent 后“检查连接”返回 `connected` 和 16 个工具（`read_file`、`write_file`、`list_directory`、`search_files` 等），MCP 面板显示“1/1 已连接”，截图保存为 `pispider-catalog-filesystem-live.png`。memory 无需输入，启动后写入 `MEMORY_FILE_PATH` 并连接 9 个工具（`create_entities`、`search_nodes`、`read_graph` 等）。两项均通过 Electron Node 24 运行，证明系统 Node 22 不满足 `engines.node >= 24` 时仍可启动。`apps/pispider-desktop npm test` 9 项全部通过；本轮验证后清理两项测试安装和 `mcp.json`，恢复预置未安装 / 未启动。截图保存为 `pispider-catalog-inputs.png`、`pispider-catalog-filesystem-dialog.png`、`pispider-catalog-filesystem-started.png`。随后按必要性评估收敛：`filesystem`、`memory`、`sequential-thinking` 已从默认目录移除，当时只保留 `chrome-devtools`；参数化代码和参数弹层保留，测试改为合成条目覆盖 inputs / 目录校验 / managed server 生成，桌面 catalog 测试 7 项通过。
- MCP 状态实时推送已验证（2026-11-19 CDP）：`registerMcpStatusProvider(provider, subscribe)` 增加可选订阅，内置 MCP 扩展把自己的 `subscribe` 传入；`ExtensionRunner.subscribeMcpStatus()` 合并快照并用 `queueMicrotask` 合并同一 tick 的多次变化；`AgentSession` 订阅后发出 `mcp_status_changed`，`dispose()` / `_buildRuntime()` 退订旧 runner，RPC 事件流自动转发。桌面主进程只把该事件转发给 MCP 子窗口，`panel.js` 原地更新状态行、摘要和“已连接”数值。用真实 `chrome-devtools-mcp@1.13.0` 懒安装后，点击“准备并启动”时卡片状态行显示“安装中”、按钮显示“准备中…”，安装完成卡片变为“已启用”并显示“需重载 Agent”；不点“检查连接”，直接从面板调用 `reloadAgent()` 后收到 `starting → connecting → connecting → connected` 四次 `mcp_status_changed`，卡片依次显示“正在启动 / 连接中 / 已连接 · 33 个工具”，摘要变为“1 / 1 已连接 + Agent 实时”；`/mcp reconnect chrome-devtools` 同样收到 `connecting → connected`，逐事件读取 DOM 分别为“连接中”和“已连接 · 33 个工具”。截图保存为 `pispider-mcp-status-push.png`。`packages/coding-agent` MCP 测试 56 项通过（新增 `streams MCP live state changes as session events` 用关闭 transport 触发 `disconnected` 事件），`npm run check`、`npm run build` 通过。测试后清理 `mcp.json`、`agent/mcp-packages/chrome-devtools` 和历史上复制的 `skills/chrome-devtools`，恢复预置未安装 / 未启动；后续版本已停止把 MCP 包内 Skill 复制到用户技能目录。
- MCP 生态可用性第一轮已验证（2026-11-19 CDP）：`catalog.json` 的 MCP 条目新增 `transport / url / headers`，Context7 以 `transport:"http"`、`url:"https://mcp.context7.com/mcp"`、`exposure:"direct"` 加入，`listMcp("user")` 返回 `chrome-devtools` 和 `context7` 两项、`catalogErrors: []`；Context7 虚拟卡显示 `http · direct`、`预置`、`未启动`，不再出现检查 / 编辑 / 删除等配置操作。点击“准备并启动”后跳过 npm 安装，`~/.pispider/agent/mcp.json` 写入 `url`、`description`、`exposure:"direct"`、`enabled:true`、`managedBy:"pispider"`、`catalogId:"context7"`；Agent 空闲时自动重载，约 4 秒后面板摘要变为 `1 / 1 已连接`，卡片显示“已启用”“已连接 · 2 个工具”，工具为 `resolve-library-id` / `query-docs`。随后再启动 Chrome DevTools，stdio 安装分支仍正常，自动重载后摘要变为 `2 / 2 已连接`，两张卡分别显示 `33` 和 `2` 个工具，`checkMcp` 返回 `errors:[]`。截图保存为 `pispider-ecosystem-presets.png`、`pispider-context7-connected.png` 和 `pispider-ecosystem-two-connected.png`。`apps/pispider-desktop/test/catalog.test.mjs` 扩到 8 项并覆盖 HTTP `url` / `headers` 模板与受管配置生成。验证后清理 `mcp.json` 并重启，恢复两张预置未启动。
- MCP 预置编辑与占位符回归已验证（2026-11-19 CDP）：`catalogContext()` 改为优先使用 `paths.agentDir`，`${PISPIDER_AGENT_DIR}` 在自定义 agent 目录下解析正确；`saveMcpServer()` 编辑受管预置时保留 `managedBy / catalogId / packageName / packageVersion`，真实调用 `startMcpCatalog("context7", "user")` 后编辑，`source` 仍为 `catalog` 且四个受管字段未丢；预置归属改为 `managedBy` 与 `catalogId` 同时匹配；无效技能目录在 `listSkills()` 返回值中带 `path`，技能卡“打开目录”可用；`readMcpConfig()` 对顶层 `null` / 数组和 `mcpServers` 非对象返回清晰错误。`apps/pispider-desktop npm test` 9 项全部通过，`npm run pispider:test` 45 项中 44 通过、1 跳过，launcher / migrate 14 项通过，`npm run check` 通过。验证后删除临时 `mcp.json`，恢复 2 个预置 / 0 配置 / 0 启用。
- 动作组折叠已验证（2026-11-19 CDP）：`visibleMessages()` 把连续 `toolResult` / `bashExecution` 聚合成 synthetic `actionGroup`，当前 `111` 会话的 50 条原始消息渲染为 32 个 `.message` 节点和 14 个 `.action-group`，共 30 个 `.action-row`（含 1 / 2 / 3 / 4 动作组），默认 `open=false`。组标题为“已执行 2 个动作”，行摘要可从对应 assistant `toolCall` 参数取到 powershell 命令和 read 路径；展开后第一组显示命令参数与输出分区，折叠态截图保存为 `pispider-action-groups-final2.png`，展开态保存为 `pispider-action-groups-expanded.png`。另用 `handleToolStart` 模拟实时 `powershell`，`toolList` 生成 1 个实时动作组，标题为“正在运行 Get-ChildItem …”，结束后 `agent_settled` 清理，`toolList` 为空；再把历史 `toolCallId` 注入 `handleToolStart`，实时组仍为 0，确认历史与实时不重复。模拟工具未写入会话。`node --check renderer/app.js` 通过。
- 按用户回合收口已验证（2026-11-19 CDP）：`visibleMessages()` 按 `role:"user"` 划分回合，只把存在 action 或运行中工具的回合收成一个最终 assistant 视图；当前 `111` 会话的 50 条原始消息从 32 个消息节点进一步收敛为 4 个 `.message`、1 个 `.turn-card` 和 30 个 `.action-row`，默认 `open=false`。卡头为“用时 2 分 3 秒 · 30 个动作”，最终回答留在卡外；最终 assistant 的 thinking 也移入回合卡展开层，折叠态高度从 545.9px 降到 521.9px。展开后包含 1 个 `.turn-thinking`、8 条中间 assistant 文字和 30 条动作行，动作行仍可继续展开查看参数 / 输出。卡头实测 `summary` 36px、`margin-bottom` 10px，`MESSAGE_TURN_HEADER_HEIGHT` 对齐为 46。另用真实的直播消息形态模拟（`state.messages` 只有 user + 带 toolCall 的 assistant，`state.tools` 有 1 个 running 工具，不写入会话）：DOM 为 6 个 `.message`、1 个 `.turn-card`，卡头“正在运行 · Get-ChildItem”，卡内 1 条 live action 行，`#toolList` 实时组为 0，避免重复。把工具改为 done 并更新 partial output 后，节点和 `turn-card` 引用保持不变，卡头保持“正在运行 · Get-ChildItem”，live action 行原地刷新。再构造带 `toolResult` 的临时 live 回合，live 文本从“第一段”改为“第二段更长的实时内容”后文本更新且 `messageRenderStructure` 保持不变，确认只替换 live 节点而不是整段重建。折叠态截图保存为 `pispider-turn-collapse-final4.png`，展开态保存为 `pispider-turn-expanded-final3.png`。`node --check renderer/app.js`、`apps/pispider-desktop npm test` 9 项、`npm run pispider:test` 45 项中 44 通过 1 跳过、launcher / migrate 14 项、`npm run check` 2575 文件均通过。
- 内置斜杠命令补齐已验证（2026-11-19，静态核对 + node 测试，未启动桌面进程）：渲染层新增 `renderer/slash-commands.js` 纯函数注册表（24 个内置命令，名单与上游 `BUILTIN_SLASH_COMMANDS` 一致），`app.js` 在发送与 `Ctrl+Enter` 插话两条路径上先本地拦截内置命令，动作路由到既有 UI 入口或 preload 通道；命令建议项带来源徽标（内置 / 扩展 / 模板 / 技能），`/changelog` 主窗口只读对话框渲染运行时 CHANGELOG。主进程 / preload 新增 `agent:last-assistant-text`、`app:quit`、`app:get-changelog` 通道，`agent:export-html` 增加可选 `outputPath`；新增 `slash-helpers.cjs` 纯 helper（HTML 导出路径校验、changelog 候选定位与读取）。未知命令 toast 报错并保留输入，路径形态与多行文本按普通 prompt 发送，扩展 / 模板 / 技能命令仍走 RPC。检查结果：根 `npm run check` 通过（biome 2575 文件、`tsc --noEmit`、browser-smoke 全过，此前缺 `@biomejs/wasm-nodejs` 的工作区依赖问题本轮未复现）；`npm run pispider:check` 通过；`npm run pispider:test` 45 项中 44 通过、1 跳过、0 失败；`node --test scripts/pispider-launcher.test.mjs scripts/pispider-migrate.test.mjs` 14 项全部通过；`apps/pispider-desktop npm test` 33 项全部通过、0 失败。本轮未在真实 Electron 运行时手测对话框焦点循环与遮罩点击关闭，按约束未启动 / 重启 / 杀掉桌面进程，也未读写真实 `$PISPIDER_HOME` 会话数据。
- 黑白灰阶 UI 真实视觉验证（2026-11-19 CDP）：亮 / 暗双主题逐张截图复核矩阵——主窗口整窗、命令建议面板（含来源徽标）、模型胶囊弹层、快捷键总览对话框、changelog 对话框、命令面板（`Ctrl+Shift+P`）、设置子窗口、会话子窗口，外加 success / warning toast；另补拍暗色 MCP 子窗口复核 `--soft` 变量映射。共 21 张 PNG，目录 `docs/ui-refresh-2026-11-19/`，命名 `{light|dark}-{surface}.png`。逐张目检：无蓝 / 青 / 暖彩色装饰残留，1px hairline 边框层次清晰，主按钮炭黑 / 雪白正确，计数与常驻 kbd 明显弱化，暗色无漏改亮色块，正文对比度可读。验证中修复 3 类缺陷：`panel.css` 三处未定义 `var(--soft)` 映射到 `--panel-soft` / `--code-bg`；`styles.css` 补中性链接规则 `a` / `a:visited` / `a:hover`（changelog 链接原落浏览器默认蓝紫）；`panel.js` 删除末尾 `localStorage pispider-theme` 主题覆盖（暗色子窗口被顶回亮色的根因）。检查结果：根 `npm run check` 通过（biome 2575 文件、`tsc --noEmit`、browser-smoke）；`npm run pispider:check` 通过；`npm run pispider:test` 45 项中 44 通过、1 跳过、0 失败；`node --test scripts/pispider-launcher.test.mjs scripts/pispider-migrate.test.mjs` 14 项全部通过；`apps/pispider-desktop npm test` 33 项全部通过、0 失败。状态安全：验证全程只开只读 UI 面，未发送 prompt、未执行 mutating 命令、未切换会话、未改设置，命令面板截图后清空输入框；结束时内存主题与 `localStorage pispider-theme` 均恢复 `light`，真实会话 JSONL 哈希未变；调试实例经 `CloseMainWindow` 优雅关闭（触发 `before-quit` 保存），再按普通方式重新拉起，原会话恢复。`.status-banner.warning` 改造前即挂 danger 系变量，本轮未改归属，留待决定是否切 `--warning`。

未完成：

- CLI / Pi 与桌面端的完整能力差距和补齐顺序见 [desktop-parity.md](desktop-parity.md)；
- 真实 RPC prompt 已返回 assistant 文本，桌面会话可正常展示；长回复的流式事件、排队和停止按钮仍需在真实长对话中补验；
- 代码面板目前支持会话 `write` / `edit` 改动和手动打开项目文件，还没有接全量 Git 工作区 diff；
- 技能和提示词变更需要手动点击“重载 Agent”；不会自动重置当前会话；
- MCP OAuth 登录/登出与单服务器热重连已通过 `/mcp` 扩展命令接入；逐工具启停列表已接并验证写回，运行时逐工具状态订阅仍未暴露；项目级 `.pi/mcp.json` 已支持列表、读写、启停和逐服务器检查，需要信任项目并重载 Agent 才会加载；
- 模型支持 API Key 和自定义端点；模型搜索、模型 / Thinking 循环、模型作用域已接；provider OAuth 已接 Kimi For Coding、OpenRouter、OpenAI，真实账号授权完成和登录后推理仍待回归；测试连接和真实推理测试已接；
- 未做安装器、自动更新和应用图标。

## 3. 配置迁移验证

`scripts/pispider-migrate.test.mjs` 使用临时目录验证：

- 认证、设置等核心文件复制到目标；
- `settings.json` 中旧 Pi agent 路径改写为 PiSpider 目标路径；
- `sessions/` 不被复制；
- 已存在的目标文件不被覆盖；
- 资源与扩展默认不复制，使用 `--include-resources` / `--include-extensions` 才复制；
- `--dry-run` 不创建目标文件；
- 源目录缺失时在写入前失败。

## 4. 人工验收清单

以下项目需要真实、授权的 JS/App 样例，当前尚未完成：

- [ ] JS 样例完成 Intake → Plan → Execute → Observe → Verify → Deliver；
- [ ] App 样例完成同一闭环；
- [ ] `/ps status` 在真实交互会话中显示正确；
- [ ] `/ps rules create / use / edit / reset` 在真实会话中生效；
- [ ] `/ps skills import` 后 `/ps reload` 能让 Pi 发现 Skill；
- [ ] `/ps rewind once/round` 创建新分支且原分支保留；
- [ ] 回退后 `ps_task` 状态与分支一致；
- [ ] 单点受限时 `ps_task action=reroute` 保留计划、证据和下一步；
- [ ] 模型请求中实际包含 `pispider` section（请求级 Provider 验证）。

## 5. 平台验证

| 平台 | 验证状态 |
| --- | --- |
| Windows PowerShell / cmd | 已执行自动化、doctor 和 CLI 启动冒烟 |
| Windows Git Bash | 未执行：本机 WSL 未安装，找不到真实 bash |
| macOS | 未在真实机器执行 |
| Linux | 未在真实机器执行 |

启动器通过 Node 参数数组、`path` 和环境变量实现跨平台；平台相关逻辑有单元测试。真实 macOS/Linux 运行仍需补验。

## 6. 已知限制

- 没有真实模型 Provider 的请求级验证，因此“section 已进入模型请求”只验证到 Pi 扩展 API 层；
- 真实交互会话中的 `/ps` 命令没有逐条人工执行；
- Computer Use 已作为可选内置扩展通过加载、helper 安装、`diagnostics` 和 `listRoots` 验证，但尚未完成 `observe_ui` → `act_ui` 的端到端交互验收；
- 指定浏览器操控、站点与本地 Node 联调尚未实现；
- 桌面端已配置并验证自定义 provider；仍只能通过本地 Electron 启动，尚未打包成安装器，也尚未做自动更新和应用图标；
- 第一版 Skill 只支持目录导入；
- 没有本地 Web 控制台；
- `pispider` section 的请求级验证仍只到 Pi 扩展 API 和真实 prompt 层；未抓取 Provider 原始请求确认注入位置；
- 主界面会话用量只在轮结束 / 压缩结束 / 手动刷新时更新，流式期间不逐 token 刷新；快速增长的上下文需等本轮结束才反映到按钮。
- 产品层不修改 Pi 核心，也不实现隐藏提示、宿主补丁、Workspace 基线移除或红队模块。

## 7. Windows 打包验收（2026-11-20）

### 构建

- `cd apps/pispider-desktop && npm run dist:win` 构建成功（exit 0）；electron-builder 26.18.0，NSIS 非 oneClick、perMachine=false，Electron 45.3.2 / Node 24.22.2。
- 产物（`apps/pispider-desktop/release/`）：
  - `PiSpider Setup 0.1.0.exe`：152,994,543 字节（约 145.9 MiB）；
  - `win-unpacked/`：510,055,386 字节（约 486.4 MiB），15,715 个文件；入口 `PiSpider.exe` 250,056,704 字节；
  - 随包 `resources/runtime/core-1.5.2/`：115,331,268 字节，15,552 个文件，与本机 core 缓存副本一致；
  - 随包 `resources/launcher/`：15,978,689 字节，89 个文件；
  - 应用图标 `build/icon.ico`：14,497 字节（六尺寸）。
- 未执行 NSIS 安装器。

### 打包实例只读冒烟

- 冒烟前备份 `%USERPROFILE%\.pispider\agent\desktop.json` 到 scratch；基线 SHA256 `48CB6C135F09AA5375E50111ADC67D07CE05BA91F11FF60FD79D7B5137C2C270`，910 字节；当时无 dev Electron 实例运行。
- 以最小 PATH（仅 `C:\Windows\System32`、`C:\Windows`、`C:\Windows\System32\WindowsPowerShell\v1.0`，无 node/npm 目录；剥离 `npm_execpath` / `npm_node_execpath` / `PISPIDER_NODE` / `PISPIDER_CORE_CACHE` / `NODE_OPTIONS`）启动 `win-unpacked/PiSpider.exe --remote-debugging-port=9348`。
- CDP 只读验证：`getState` success（模型 / 会话状态可读）、`getCommands` success（含 `ps` / `llama` / `mcp` 与用户 Skill）、`listSessions` 读到既有会话；全程未发 prompt，未改会话、配置或主题。
- 进程树取证：主进程 → runner 子进程（`resources/launcher/scripts/run-pispider.mjs --mode rpc --no-approve`）→ core 子进程（`resources/runtime/core-1.5.2/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js -e resources/launcher/packages/pispider --mode rpc --no-approve`），均以随包 `PiSpider.exe` 为可执行文件；最小 PATH 下 RPC ready 即证明未回退系统 Node。
- 通过 CDP `quitApp` 优雅退出，打包进程树清零；`desktop.json` 从备份恢复，SHA256 与基线一致（910 字节）；sessions 目录无新增落盘会话。冒烟前无 dev 实例，故无需恢复 dev 会话。

### 自动化检查

| 检查 | 结果 |
| --- | --- |
| 根 `npm run check` | exit 0 |
| `npm run pispider:check` | exit 0 |
| `npm run pispider:test` | 45 tests，44 pass，1 skipped（符号链接用例），0 fail |
| `node --test scripts/pispider-launcher.test.mjs scripts/pispider-migrate.test.mjs` | 14/14 pass |
| `apps/pispider-desktop && npm test` | 43/43 pass |

### 本轮修复（限桌面层 / 配置 / 文档）

- 对齐随包 runtime 缓存根布局：core 缓存以版本化子目录 `runtime/core-1.5.2/` 进入随包布局；`packaged-runtime.cjs` 的 `coreCacheRoot` 指向该版本子目录。原因：electron-builder 默认排除 extraResources 源目录根级 `node_modules`，根级平铺会丢光随包依赖。
- 同步更新 `packaged-runtime.test.mjs` 缓存根断言；prepare 脚本 staging 自检路径随布局对齐。

### 遗留项

- 可执行文件与安装包代码签名；electron-updater 自动更新；macOS / Linux 构建目标；portable 单文件目标；`package.json` 暂无 `author` 字段（构建仅警告）。

## 8. 文档梳理与一致性核对（2026-11-20）

本轮只改文档，未改代码，未做 git 操作；历史验收记录按规则只追加、不改写。测试数字引用 §7 最近一次记录，本轮未复跑根 `npm run check` / doctor / Electron 启动。

### 改动文件清单

| 文件 | 改动 | 说明 |
| --- | --- | --- |
| `docs/desktop-status.md` | 重写为 160 行四部分（现状快照 / 接手指引 / 冻结路线图 / 刻意不做指针） | 由状态文档重写轮完成；本轮核对其路线图、指针与启动矩阵 |
| `docs/desktop-parity.md` | 7 处 | MCP P1 行分层改写；安装器行区分“已构建产出”与“未执行安装冒烟”；§5.1 补 `/resume` 缺口；§7 建议顺序重写对齐冻结 P0/P1/P2 并标注阻塞依赖；附排序理由总述 |
| `docs/development.md` | 3 处 | 补便携版 / 安装版启动方式；补单实例告诫；补强 `build/packaged/` staging 由 `dist:win` 幂等可再生说明 |
| `PRODUCT_PLAN.md` | 3 处过时条目修正 + 1 处扫尾残留清除 | 移除已落地的“权限作用域”缺口；MCP 分层改写；未做清单移除已落地的安装器 / 图标 / lockfile；扫尾清除 L58 已落地的单会话权限缺口表述 |
| `README.md` | 核对无改动 | 无安装器 / 自动更新 / 图标 / 打包状态断言；非目标边界口径准确 |

### 路线图摘要（与 `desktop-status.md` §c、`desktop-parity.md` §7 一致）

**P0：数据安全与高频核心体验**

1. 建立版本控制：仓库无 `.git`，需用户决策初始化或确认副本来源；非技术阻塞。
2. 队列逐条删除 / 恢复：上游阻塞，RPC 仅有 `clear_queue`，缺 `get_queue` / `remove_queue_item`。
3. UI 遗留正确性：图片消息渲染、内容变更但 id 不变时的缓存失效；桌面可独立做。
4. `/resume` 独立会话导航：现状仅复用会话搜索框聚焦；桌面可独立做。

**P1：功能完整与打包维护**

5. `/share` Radius artifact 与分享目的地设置（Gist 路径已接）：部分上游阻塞，Radius 分享路径上游未接，目的地字段 schema 已存在。
6. 会话树节点删除 / 排序：节点删除上游阻塞（无 entry 删除 / 重排 API）；排序桌面可独立做；整文件删除已是桌面自有文件操作。
7. 逐模型思考档位 UI：桌面可独立做，schema `modelThinkingLevels` 与会话级 `set_thinking_level` 已有。
8. 高级 settings（proxy / transport / shell / 细粒度 allowlist / compaction）：桌面可独立做，走配置文件 + 重启 runtime；缺 RPC 写入口属可选上游增强。
8b. MCP 单工具运行态订阅：上游数据缺口；服务器级 `mcp_status_changed` live state 已端到端落地，`McpLiveServerStatus.tools` 仅工具名数组。
9. CORE_VERSION 三处同步升级流程 + 两个 `package.json` 缺失 `author` 警告：桌面可独立做。
10. 打包版 stdio 预置 MCP 的 npm 方案：随包 npm-cli 或维持降级，体积权衡；桌面可独立做。
11. doctor 日志导出：桌面可独立做。

**P2：打磨与外部分发**

12. 动效统一、自定义主题导入：桌面可独立做。
13. 代码签名与自动更新：外部阻塞（证书 / publish 服务）。
14. macOS / Linux 包与 portable 单文件目标：需对应平台构建环境。

### 修正的过时声明要点

- MCP：服务器级连接 live state（RPC `mcp_status` 快照 + `mcp_status_changed` 推送原地更新）已接；此前“只有配置层 `toolExposure` 和桌面自定义检查”的表述删除；单工具运行时状态订阅仍缺上游数据。
- 打包与图标：NSIS 安装包 `PiSpider Setup <version>.exe`、`win-unpacked/PiSpider.exe` 与 `build/icon.ico` 已落地；未做项仅代码签名、自动更新、macOS / Linux 目标、portable；NSIS 安装流程本身尚未执行安装冒烟，仅便携版经最小 PATH + CDP 只读冒烟。
- 权限作用域：单会话权限已接并验收，不再列入缺口。
- 斜杠命令：24 个内置命令在桌面层发送前本地拦截执行，计入桌面测试 43/43；扩展 / 模板 / 技能命令仍走 RPC `get_commands` + prompt。
- 测试口径：桌面 `npm test` 43/43；扩展包 `pispider:test` 45 tests / 44 pass / 1 skipped / 0 fail；launcher + migrate 14/14（§7 最近记录）。

### 扫尾核对结论

- 路线图一致性：`desktop-status.md` 与 `desktop-parity.md` 的 P0/P1/P2 事项、顺序、阻塞依赖标注一致；`desktop-ui.md` §6 为 UI 视角本地路线，未按冻结表重排。
- 指针核对：status 阅读顺序（AGENTS.md → status → parity → development → desktop-ui → commands → acceptance）各目标章节存在；commands.md「桌面内置斜杠命令」「环境变量」、development.md §2 / 打包章节、desktop-ui.md §4.2 / §5 均对应得上。
- 启动矩阵：development.md 与 status 一致——开发 `npm run pispider:desktop`、便携版 `release/win-unpacked/PiSpider.exe`、安装版 `release/PiSpider Setup <version>.exe`、CLI 对照 `npm run pispider`；单实例告诫一致（共享 `PISPIDER_HOME/agent` 与 `desktop.json`，同一时间只跑一个实例）。
- 路径 / 命令抽查：两个 release 产物、`build/icon.ico`、`scripts/pispider-desktop-debug.mjs`、三处 CORE_VERSION 文件、四个桌面测试文件、截图目录 `docs/ui-refresh-2026-11-19/` 均存在；根 npm 脚本映射（`pispider:desktop` / `pispider:desktop:debug` / `pispider:doctor` / `pispider:migrate` / `pispider:setup` / `pispider:check` / `pispider:test`）齐全。
- 保留未改：审计判定仍准确的缺口声明（队列 RPC 缺口、Radius 路径、树节点删除、逐模型档位、高级 settings 手写、doctor 日志导出、签名 / 自动更新 / mac-Linux / portable、`author` 警告）；acceptance 历史条目（含旧测试数字与打包前记录）按规则不改写。

## 9. 正确性补口与版本控制（2026-11-20）

### 版本控制

- 在 `E:\mygit\SpiderBuddy` 初始化 `main` 分支，按显式路径暂存 4724 个文件（`node_modules/`、`apps/pispider-desktop/release/`、`dist/`、`.artifacts/` 均被 `.gitignore` 排除），基线提交 `b14f660 feat: import PiSpider monorepo baseline`。
- 远程 `origin` 指向 `https://github.com/wangh00/PiSpider.git`，`git push -u origin main` 成功（exit 0）。
- 本轮后续代码与文档改动拆成 focused commit 推送；未使用 `git add -A`，未改写历史。

### 改动文件

| 文件 | 改动 |
| --- | --- |
| `apps/pispider-desktop/renderer/app.js` | 图片 block 渲染（助手 / 用户共用 strip、工具结果“图片”分区）、图片解码后重测高度；高度缓存版本 5 `{height, signature}`；`messageHeightSignature()` + 非 live 消息结构指纹；`#sessionPicker` 打开 / 过滤 / 渲染 / 键盘选择 / 关闭逻辑，`/resume` 与 `Ctrl+Shift+K` 接入 |
| `apps/pispider-desktop/renderer/index.html` | 新增 `#sessionPicker`（复用命令面板卡片样式）；快捷键总览补 `Ctrl+Shift+K` |
| `apps/pispider-desktop/README.md` | 补 `/resume` 独立导航与 20 条快捷键 |
| `docs/commands.md` | `/resume` 行改为独立导航说明 |
| `docs/desktop-status.md` | 已落地能力补“正确性补口”；P0 表标注 P0-1 / P0-3 / P0-4 已完成；版本控制说明更新 |
| `docs/desktop-parity.md` | 消息渲染行补图片 block；`/resume` 与 §7 P0 顺序更新 |
| `docs/desktop-ui.md` | §4.4 缓存说明改为版本 5 内容指纹；§5 追加两条落地记录；§6 风险项更新 |

### 图片渲染与高度指纹（P0-3）

- 助手消息按 block 顺序渲染文本 / 思考 / 图片；连续图片收进一个 `.message-images`，文本再出现时新建下一条；用户消息复用同一 `renderMessageImageStrip()`；工具结果在折叠卡内追加“图片”分区，只有图片时摘要为“N 张图片”。
- 图片使用 data URL `<img>`（不经 `innerHTML`），`load` / `error` 后触发一次高度重测，避免解码前零高估算被写入虚拟占位。
- 高度缓存 `MESSAGE_HEIGHT_CACHE_VERSION = 5`，`state.messageHeights` 值改为 `{height, signature}`；持久化格式为 `{h, s}`，旧版本数字缓存不加载。`messageHeightSignature()` 覆盖角色、`_turn`、正文 / 思考 head+tail、图片 mime 与 base64 长度、工具名、命令、退出码、错误文本和 toolCall 参数；`messageMeasuredHeight()` 仅在签名一致时采用旧高度。
- `messageStructureKey()` 对非 live 消息附带同一签名，live 流式消息保持空签名，避免逐 token 全量重建。

### 恢复会话导航（P0-4）

- `#sessionPicker` 复用命令面板视觉；`openSessionPicker()` 打开后刷新一次 `listSessions()`，输入按标题 / 路径 / cwd / preview 多 token 过滤；列表按“置顶会话 / 最近会话”分组，当前会话显示“当前”；`↑↓` 循环、`Enter` 切换、`Esc` / 遮罩关闭并归还焦点。
- `/resume` 不再聚焦左栏搜索框，改走 `openSessionPicker()`；新增 `Ctrl+Shift+K` 全局快捷键与命令面板“恢复会话”动作；左栏搜索框的全文本搜索能力保持不变。
- 切换仍复用既有 `switchSession()`：保存滚动位置、重置切片与高度缓存、必要时重启 runtime。

### 检查

| # | 命令 | 结果 |
| --- | --- | --- |
| 1 | 根 `npm run check` | exit 0（biome 2575 文件、pinned/runtime/ts-imports/entry-graphs/install-lock、tsc、browser-smoke） |
| 2 | `npm run pispider:check` | exit 0 |
| 3 | `npm run pispider:test` | 45 tests / 44 pass / 1 skipped / 0 fail |
| 4 | `node --test scripts/pispider-launcher.test.mjs scripts/pispider-migrate.test.mjs` | 14/14 pass |
| 5 | `cd apps/pispider-desktop; npm test` | 43/43 pass |

### CDP 验证

在隔离环境启动开发版 Electron：`--remote-debugging-port=9348`、`--user-data-dir=.artifacts/ui-userdata`、`PISPIDER_HOME=.artifacts/ui-home`，不触碰用户 `~/.pispider` 会话与配置；验证后停止进程并删除临时目录。结果：

- 助手消息：`.message-images img` 数量 1，子节点顺序为 `message-label → 文本 → 图片 → 文本 → 复制`。
- 工具结果：2 张图片均渲染，“图片”分区存在，摘要为“2 张图片”。
- 高度指纹：同一 id 文本 `hello` 改为 `hello changed content` 后，`messageMeasuredHeight` 从缓存值 100 回落到估算 90；`messageHeightSignature` 与 `messageStructureKey` 均变化。
- 会话导航：`/resume` 打开后焦点为 `sessionPickerInput`；`Ctrl+Shift+K` 同样打开；`Esc` 关闭。注入 Alpha / Beta 两条会话后：`beta` 过滤只剩 Beta，`alpha alpha` 多 token 过滤只剩 Alpha，分组为“置顶会话 / 最近会话”，方向键从 Beta 移到 Alpha。

### 未验证 / 遗留

- 未在隔离实例里执行真实的跨会话切换（会启动 runtime 并写临时会话）；切换链路沿用既有 `switchSession()`，未改。
- 队列逐条删除仍等上游 `get_queue` / `remove_queue_item`，本轮未动。
- 打包产物未重建：`release/win-unpacked` 与安装包仍是改版前的 asar；需要新安装包时执行 `cd apps/pispider-desktop; npm run dist:win`。
- 当前运行中的便携版实例仍是旧渲染代码；开发版 `npm run pispider:desktop` 启动后即加载本轮改动。



