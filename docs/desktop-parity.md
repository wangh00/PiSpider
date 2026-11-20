# 桌面端与 CLI 能力对照

当前桌面端的整体状态、已落地能力和下一步顺序见 [desktop-status.md](desktop-status.md)。本表只列 CLI / Pi 运行时已有、桌面端尚未接成图形操作的能力；斜杠命令的输入语法本身不单列，这里看的是命令背后的能力。`已接` / `部分` / `未接` / `不适用` 四态。

## 1. PiSpider 产品能力

| 能力 | CLI | Desktop | 状态 | 说明 |
| --- | --- | --- | --- | --- |
| 领域模式 | `/ps domain` | 设置 → 工作模式 | 已接 | `auto` / `js` / `app`，下一次对话生效 |
| 规则列表 / 新建 / 编辑 / 启用 / 停用 / 删除 | `/ps rules` | 规则窗口 | 已接 | 删除前备份 |
| 规则正文恢复默认 | `/ps rules reset <id>` | 规则窗口 → 重置 | 已接 | 恢复内置模板，保留名称和描述；执行前确认 |
| 技能列表 / 新建 / 导入 / 删除 | `/ps skills` | 技能窗口 | 已接 | 导入目录，删除前备份 |
| 提示词文件编辑 / 恢复默认 / 打开目录 | `/ps prompt files`、`reset` | 设置 → 提示词 | 已接 | 编辑 `core` / `workflow` / `js` / `app` |
| 查看最终装配后的完整提示词 | `/ps prompt show` | 设置 → 提示词 → 预览最终提示词 | 已接 | 用同一套 `composePrompt` 生成，显示字符数、启用规则和最近一次 `ps_task` 任务来源；可输入草稿消息重算领域路由 |
| 任务状态查看 | `/ps task status` | 会话窗口 → 任务状态 | 部分 | 只读展示阶段、目标、下一步等 |
| 任务状态重置 | `/ps task reset --yes` | 会话窗口 → 重置任务 | 已接 | 桌面先确认，再让 runtime 追加 `pispider-task-reset` 分支记录并清空任务状态；对话记录不删除 |
| 回退一轮 / 回到上一用户轮 | `/ps rewind once/round` | 会话窗口 → 回退上一轮 / 再回退一轮 | 已接 | `get_fork_messages` 取用户轮次，`fork` 创建新分支，原分支保留；执行前确认 |
| 回退一轮 / 回到上一用户轮（按消息选择） | `/ps rewind once/round` | 会话窗口 → 回退分支 | 已接 | 可选择任意用户消息创建分支；桌面没有 rewind 的 TUI 提示样式 |
| 重载 Agent 资源 | `/ps reload` | 顶部“重载 Agent” | 已接 | 技能 / 提示词变更后手动触发 |
| 统一状态摘要 | `/ps status` | 左栏 → 状态 | 已接 | 汇总模型、思考强度、权限、项目信任、会话、规则、技能、MCP、提示词字符数、领域模式和最近一次 `ps_task` 任务状态；项目级资源未信任时标注“未加载” |

## 2. 会话与上下文

| 能力 | Desktop | 状态 | 说明 |
| --- | --- | --- | --- |
| 新建会话 | 新建任务 | 已接 | `new_session` |
| 最近会话切换 | 最近列表 | 已接 | 扫描 `$PISPIDER_HOME/agent/sessions` |
| 会话搜索 | 最近列表搜索框 | 已接 | 主进程扫描会话 JSONL，匹配标题、ID、目录、用户消息和助手消息正文；支持 `re:` 正则、引号短语、多 token 与“相关度 / 最近”排序，结果带 snippet 和匹配字段标签；单文件上限 8 MB，最多返回 80 条 |
| 会话重命名 | 会话窗口 → 重命名 | 已接 | 调用 `set_session_name`，主列表收到 `session_info_changed` 后刷新 |
| 会话删除 / 自定义排序 | 最近列表每项的删除按钮、置顶按钮 | 部分 | 删除非当前会话；当前会话需先切换；置顶排序已接，拖拽自定义排序未接 |
| 跨目录恢复会话 | 会话窗口 → 从其他目录恢复 | 已接 | 选择外部 `.jsonl`，校验后复制到当前 `sessions/`，再通过 `switch_session` 打开；同名文件自动加时间戳，不覆盖原文件 |
| 会话用量 / 成本 / token | 输入框模型名左侧上下文圆环 + 会话窗口 | 已接 | 输入框圆环按已用 token 比例填充并显示百分比，点击打开弹层显示上下文百分比 / 进度条、输入 / 输出 / Token 总量 / 成本，并支持手动刷新；会话窗口保留同一份统计。数据来自 `get_session_stats`，每轮结束和压缩结束后刷新，流式期间不逐 token 刷新。 |
| fork / clone / tree | 会话窗口 → 回退分支 / 复制会话 / 会话树 | 部分 | 已接 `get_fork_messages` + `fork`、`clone`、`get_tree`；树节点支持“从此分支 / 复制 / 标记”，标记通过 `/ps label` 写入 session label entry；节点删除/排序未接 |
| 手动压缩上下文 | 会话窗口 → 压缩上下文 | 已接 | 调用 `compact`；点击后先弹出可选“压缩说明”，非空时作为 `customInstructions` 传给 Pi，留空使用默认策略 |
| 自动压缩 / 自动重试 | 会话窗口 → 自动压缩 / 自动重试 / 中止重试 | 已接 | 自动压缩使用 `set_auto_compaction`；自动重试使用 `set_auto_retry`，状态从 `settings.json` 的 `retry.enabled` 读取；`abort_retry` 已接按钮 |
| 导出 HTML / JSONL | 会话窗口 → 导出 HTML / 导出 JSONL | 已接 | `export_html` 交给系统打开；JSONL 直接复制当前会话文件，不修改原会话，导出成功后可打开文件 |
| 分享会话 / 消息复制 | 会话窗口 → 分享到 Gist；每条用户 / 助手消息右下角的悬浮「复制」 | 部分 | 每条用户消息和助手回复都可复制该条纯文本，按钮默认隐藏、鼠标悬停或键盘聚焦时出现；顶部不再常驻“复制最后回复”，最后一条助手回复通过 `/copy` 命令复制。`/share` 已接 GitHub 私有 Gist 路径：导出 HTML 后调用 `gh gist create --public=false`，生成 `https://pi.dev/session/<gistId>` 预览链接；需要本机 `gh` 登录，`PISPIDER_GH_BIN` 可指定路径；Pi 的 Radius artifact 和分享目的地设置未接 |

## 3. 模型、推理与认证

| 能力 | Desktop | 状态 | 说明 |
| --- | --- | --- | --- |
| 默认 provider / 模型 ID / API Key | 设置 → 模型 | 已接 | 写 `auth.json` / `settings.json` / `models.json`，重启 runtime |
| 自定义兼容端点 | 设置 → 模型 | 已接 | 支持 OpenAI 兼容等协议 |
| 当前会话快速切模型 / 循环模型 | 输入框底部模型胶囊 | 已接 | 已接 `set_model` 和 `cycle_model`；模型多于 1 个时菜单标题显示“下一个”，循环遵守 Pi 的 scoped models；当前配置只有 1 个模型，循环按钮不显示 |
| 模型列表 / 搜索 / 作用域 | 输入框底部模型弹层 | 已接 | 输入框模型菜单使用 `get_available_models`，支持按名称 / provider / id 搜索；作用域通过“作用域设置”编辑，写入 `settings.json.enabledModels` 并重启 runtime；有作用域时菜单默认只显示 scoped 模型，可切“全部”。桌面保存为精确 `provider/id`，已有精确 `:thinking` 后缀会保留；逐模型思考档位暂无 UI |
| 思考等级 / 循环思考等级 | 输入框底部思考强度 | 部分 | 已接 `set_thinking_level` 和 `get_available_thinking_levels`；菜单隐藏 `minimal`，显示“关闭 / 低 / 中 / 高 / 极高 / 最高”，多于 1 档时标题显示“下一个”循环 |
| OAuth 登录 / 登出 | 设置 → 模型 → 账号登录 | 已接 | Kimi For Coding（设备码）、OpenRouter（浏览器回调 + 授权码兜底）、OpenAI（ChatGPT 登录）；通过独立桥接进程调用 Pi `ModelRuntime.login/logout`，凭据写 `auth.json`，成功后重启 runtime 并恢复当前会话 |
| 凭据检查 / 连接测试 | 设置 → 检查配置 / 测试连接 / 测试推理 | 部分 | 可检查字段和 Key，通过 GET 模型列表验证端点和 Key，并用最小请求验证真实推理；测试推理会消耗少量额度 |

## 4. MCP、扩展、包与资源

| 能力 | Desktop | 状态 | 说明 |
| --- | --- | --- | --- |
| MCP server 添加 / 删除 / 列表 / 状态 | MCP 窗口 → 用户级 / 项目级 | 已接 | 已接用户级 `agent/mcp.json` 和项目级 `.pi/mcp.json` 的列表、增删改、启停、逐服务器检查和 stdio / HTTP 连接检查；已展示 tools/list 返回的工具名；项目级需要信任当前项目；OAuth 登录/登出已通过 `/mcp` 扩展命令接入 |
| 内置 MCP 预置目录 / 懒安装 | MCP 窗口 → 用户级 → 预置卡片 → 准备并启动 | 已接 | 预置清单在 `apps/pispider-desktop/catalog/catalog.json`，由 `mcp-catalog.cjs` 校验并归一化；当前保留 `chrome-devtools-mcp@1.13.0` 和远程 HTTP `context7`（`https://mcp.context7.com/mcp`）；`filesystem`、`memory`、`sequential-thinking` 已按必要性评估移除。MCP 条目支持 `transport`（`stdio` / `http`）、`package`、`url`、`headers`；HTTP 预置不要求 package，也不支持随包技能声明。未启动时卡头左侧显示名称、类型、状态，右侧同一行显示“准备并启动 / 说明”，包版本、接口地址、用途和运行要求在说明弹层，不写 `mcp.json`、不安装。参数化基础设施保留：MCP 条目可声明 `text` / `directory` 输入，`args` / `env` / `url` / `headers` 支持 `${WORKSPACE}`、`${PISPIDER_HOME}`、`${PISPIDER_AGENT_DIR}`、`${HOME}`、`${PATH_SEP}` 和 `${input.<id>}`，目录输入启动前展开 `~`、按工作区解析并校验存在；当前预置没有输入，后续带输入的条目先弹参数窗口。点击后 stdio 预置 npm 安装到 `agent/mcp-packages`、写入 `managedBy` / `catalogId`；HTTP 预置跳过安装，直接写入 `url` / `headers`。MCP 包内自带的 Skill 只保留在包内，不复制到 `~/.pispider/skills`。准备成功后 Agent 空闲时自动重载并检查，流式工作时提示手动重载；预置 MCP 用 Electron 自带 Node 24 启动；项目级不显示预置目录；manifest 无效条目会在面板“目录 / 检查错误”中显示。桌面 `package.json.files` 已把 `catalog/**/*` 和加载器列入打包白名单。 |
| 用户技能目录 | 技能窗口 → 新建 / 导入 / 删除 | 已接 | 只管理 `~/.pispider/skills/<id>` 下的用户技能；MCP 包内 Skill 不复制、不显示为预置项 |
| MCP 重连 / 启用 / 禁用 / exposure | MCP 窗口 | 已接 | 启停、单服务器检查、检查连接、工具名展示、服务器级 `exposure`（codemode / deferred / direct / hidden）和逐工具启停列表已接；打开 MCP 窗口会自动检查当前作用域的全部服务器，也可手动“检查连接”；逐工具行由检查结果与已有 `toolExposure` 合并生成，复选框 + `direct` / `deferred` / `codemode` 下拉，未勾选保存为 `hidden`；单服务器热重连通过 `/mcp reconnect <name>` 接入；窗口级“重连 MCP”已移除，其重启和重检查职责并入“重载 Agent” |
| MCP OAuth 登录 / 登出 | MCP 窗口 → 服务器卡片 → 登录 / 登出 | 已接 | 通过 RPC `prompt("/mcp login|logout <name>")` 调用 Pi MCP 扩展；浏览器打开授权页，主窗口弹出输入框接收回填的 redirect URL；仅对无 Authorization 头的 HTTP 服务器显示 |
| 扩展（extension）加载 / 管理 | 左栏 → 扩展 | 已接 | 列出用户级 `agent/extensions`、项目级 `.pi/extensions` 自动发现文件、`settings.json` 显式路径和 4 个内置扩展；显示启用 / 停用 / 待项目信任 / 文件缺失状态；启停写入 `+path` / `-path` / `-builtin:<name>`，重载 Agent 后生效 |
| Pi package 安装 / 列表 / 移除 / 更新 / 过滤 | 左栏 → 扩展 → Pi packages | 已接 | 读取用户级 / 项目级 `settings.json.packages`，显示 source、scope、安装状态、版本、过滤条件；安装、更新、移除通过 Pi core CLI 执行，项目级写入 `.pi/settings.json`；不替代 `pi list` 的完整诊断输出 |
| 提示模板（prompt template） | 设置 → 提示模板 | 已接 | 用户级 `agent/prompts` 与项目级 `.pi/prompts`；列表、新建、编辑、删除（带备份）；模板以 `/name` 出现在命令面板，重载 Agent 后生效 |
| 自定义主题文件 | 只有浅色 / 深色切换 | 部分 | 没有主题目录、主题选择和导入 |
| 项目信任 / `.pi` 资源加载确认 | 设置窗口 → 项目信任 | 已接 | 切换“不加载 / 信任当前项目”，runtime 重载时带 `--no-approve` / `--approve` |
| 扩展 UI（确认 / 输入 / 编辑器 / 选择） | 主窗口对话框 | 部分 | `confirm` / `input` / `editor` / `select` 已桥接，`notify` / `setStatus` / `setWidget` / `set_editor_text` 已接；`custom` 和 TUI 专属 UI 在 RPC 模式不可用 |

## 5. 工具、输入与队列

| 能力 | Desktop | 状态 | 说明 |
| --- | --- | --- | --- |
| 工具 allowlist / exclude / 禁用内置工具 | 输入框权限胶囊 | 部分 | 每个会话可选“全部允许 / 只读 / 禁用工具”；只读使用 `--tools read,grep,find,ls --exclude-tools mcp__*`，禁用使用 `--no-tools`；细粒度 allowlist 仍需改配置 |
| Windows 桌面 Agent shell | Agent 工具集 | 已接 | `PISPIDER_DESKTOP=1` 且 active tools 含 `bash` 时，PiSpider 扩展在 `session_start` / `before_agent_start` 把 `bash` 替换为 `powershell`，系统提示引导模型使用 PowerShell；只读 / 禁用工具模式不触发。用户 `!` / `!!` 仍由 `user_bash` 扩展走 PowerShell，Pi 负责记录 |
| 消息与工具结果渲染 | 消息列表 | 已接 | Markdown 支持标题、段落、无序 / 有序列表、引用、表格、删除线、链接、行内代码、fenced code block 和常见语言关键字 / 字符串 / 数字 / 注释高亮；每个用户回合内的工具结果 / shell 动作、运行中的工具和中间助手文字按原顺序收进一个可折叠回合卡，卡头显示“用时 X · N 个动作”或“正在运行 · 当前命令”，最终回复留在卡外可见，展开后逐条显示工具类型、摘要、参数、实时输出 / 结果和状态；Mermaid 代码块由裁剪后的本地 `mermaid@12.3.0` 运行时懒加载渲染，只保留 flowchart / sequence（含 flowchart-elk），失败时显示错误并展开源码，其他图类型给出明确不支持提示；打包只带 `vendor/mermaid`，排除完整 `node_modules/mermaid` |
| 权限作用域 | 输入框权限胶囊 | 已接 | 按会话文件路径写入 `desktop.json` 的 `sessionPermissions`，缺失时回退 `projectPermissions[repoRoot]`；切换会话时按目标会话权限重启 runtime |
| `codemode` / `tool_search` | MCP 窗口 → 工具暴露 | 已接 | 服务器级 `exposure` 下拉和逐工具启停列表已接；未发现工具时提示先检查，未知工具仍可手动编辑 `mcp.json`。MCP 窗口通过 RPC `mcp_status` 读取扩展实际连接状态、失败原因和已发现工具；打开、检查后仍可全量刷新，连接中 / 已连接 / 失败等变化由 `mcp_status_changed` 会话事件推送并原地更新 |
| MCP live state | MCP 窗口 | 已接 | RPC `mcp_status` 返回 `servers / errors`：每个服务器含 `state`、`enabled`、`tools`、`hasResources`、`error`、`source`、`scope`、`transport`、`exposure`；面板显示“Agent 实时”或“离线检查”，配置已保存但 runtime 未加载的服务器显示“需重载 Agent”。扩展通过 `registerMcpStatusProvider` 的可选 `subscribe` 上报变化，`AgentSession` 转成 `mcp_status_changed` 事件，主进程推给 MCP 子窗口；重载 / 重连时无需手动检查。Agent 未运行时回退到本地 stdio / HTTP probe |
| 排队 steer（运行中改方向） | 输入框底部提示 / Ctrl+Enter | 部分 | 运行中按 `Ctrl+Enter` 调用 RPC `steer` 插话；普通 Enter 仍按 `followUp` 排队；逐条队列查看已接，逐条删除未接 |
| 排队消息查看 / 清空 / 恢复到输入框 | 数量按钮 + 排队面板 + 清空按钮 | 部分 | 有 `queue_update` 数量、“N 条排队”面板、按插话 / 排队分组查看和逐项复制；清空调用 `clear_queue` 并把全部文本放回输入框；逐条删除需要上游 `get_queue` / `remove_queue_item` |
| `@` 文件搜索 / 补全 | 输入框 `@` 弹出项目文件候选 | 部分 | 输入框 `@` 会扫描当前项目并插入相对路径，支持方向键、Enter/Tab 选择；不搜索文件内容 |
| 斜杠命令面板 / 命令输入 | 输入框 `/` 弹出命令 | 已接 | 24 个 TUI 内置命令在桌面本地拦截执行（见下表）；扩展、提示模板和技能命令通过 RPC `get_commands` 列出，仍经 prompt 原样执行；支持名称/描述过滤、方向键、Enter/Tab 插入，命令参数仍需手输后发送 |
| 图片粘贴 / 拖入 / 发送 | 输入框粘贴 / 拖拽 / 回形针选图 | 部分 | 支持最多 4 张图片，发送为 RPC `prompt.images`；模型需开启图像输入；支持 png/jpg/gif/webp/bmp，单张上限 20 MB |
| 用户直接执行 `!` / `!!` shell | 输入框 `!` / `!!` | 已接 | 输入 `!` / `!!` 后通过 RPC `bash` 交给 Pi runtime 执行，结果记录为 `bashExecution` 消息并进入所属用户回合的展开动作行，可停止（`abort_bash`）。`!` 进入 Agent 上下文，`!!` 带 `excludeFromContext: true` 记录但不进入上下文。Windows 桌面且 `PISPIDER_DESKTOP=1` 时，PiSpider 扩展接管 `user_bash`，用 PowerShell 执行并仍由 Pi `recordBashResult()` 记录；macOS/Linux 走 Pi 默认 bash。 |
| 外部编辑器（`Ctrl+G`） | 无 | 输入框 `Ctrl+G` | 已接 | 把当前草稿写入临时 Markdown，使用 `PISPIDER_EDITOR` / `VISUAL` / `EDITOR`，Windows 默认记事本，macOS 默认 TextEdit；编辑器关闭后回填输入框 |

### 5.1 内置斜杠命令覆盖

TUI 内置命令共 24 个，桌面层在发送前本地拦截；下表按命令列出落地状态，能力背后的缺口仍以上方各表为准。

| 命令 | Desktop 落地 | 状态 | 备注 |
| --- | --- | --- | --- |
| `/settings` | 打开设置二次窗口 | 已接 | |
| `/model` | 无参打开模型胶囊菜单；有参 `provider/model` 走 `set_model` | 已接 | 格式非法 toast 报错 |
| `/tree` | 打开会话窗口查看会话树 | 部分 | 树节点删除 / 排序未接，见 fork / clone / tree 行 |
| `/thinking` | 无参打开思考强度菜单；有参 `set_thinking_level` | 部分 | 菜单隐藏 `minimal`；逐模型思考档位暂无 UI |
| `/scoped-models` | 打开模型作用域编辑器 | 已接 | |
| `/export` | 无参导出 HTML；`.jsonl` / `.html` 路径导出 | 已接 | 可选绝对路径，其他扩展名报错 |
| `/import` | 文件对话框或指定路径导入 JSONL | 已接 | |
| `/share` | 分享到 GitHub 私有 Gist | 部分 | Pi 的 Radius artifact 和分享目的地设置未接 |
| `/bug` | 浏览器打开 GitHub issue 新建页，预填描述与环境信息 | 已接 | |
| `/copy` | 复制最后一条助手回复到剪贴板 | 已接 | 无回复时 toast 提示 |
| `/name` | 有参 `set_session_name`；无参打开会话窗口提示重命名 | 已接 | |
| `/session` | 打开状态 / 会话信息窗口 | 已接 | |
| `/changelog` | 主窗口只读对话框渲染运行时 CHANGELOG | 已接 | 找不到文件时 toast 提示 |
| `/hotkeys` | 打开快捷键总览对话框 | 已接 | |
| `/fork` | 打开会话窗口提示分叉入口 | 部分 | 树节点删除 / 排序未接 |
| `/clone` | 复制当前会话并刷新列表 | 已接 | |
| `/trust` | 打开设置窗口提示项目信任位置 | 已接 | |
| `/login` | 打开设置窗口认证区域 | 已接 | `provider` 仅用于提示文案；真实账号授权完成待回归 |
| `/logout` | 打开设置窗口提示退出提供商 | 已接 | 不在主窗口直接删除认证，避免误删 |
| `/new` | 复用既有新建会话流程 | 已接 | |
| `/compact` | 调用 `compact`，非空说明作为 `customInstructions` | 已接 | Agent 运行中阻止 |
| `/resume` | 聚焦左栏会话搜索框切换 / 恢复 | 已接 | |
| `/reload` | 复用顶部“重载 Agent”流程 | 已接 | |
| `/quit` | 退出应用，走既有 `before-quit` 清理路径 | 已接 | |

仍未覆盖、需上游或后续版本补齐的项：

- 队列逐条删除：需要上游新增 `get_queue` / `remove_queue_item` RPC（见排队两行）。
- `/share` 的 Radius artifact 路径与分享目的地设置。
- 会话树节点删除 / 排序；逐模型思考档位 UI。
- `/resume` 独立会话导航：当前复用会话搜索框聚焦，尚未接独立导航入口。

## 6. 运维与高级设置

| 能力 | Desktop | 状态 | 说明 |
| --- | --- | --- | --- |
| Pi 高级 settings | 只覆盖模型 / 领域 / 提示词 / 会话思考强度、自动压缩和自动重试 | 部分 | proxy、transport、shell、tool 选择等仍要手改 |
| doctor / 诊断日志 | 状态 → 环境诊断 | 部分 | 通过 Pi core CLI 检查版本、当前 provider / model 的认证状态、`pi list` 的 package 声明，并汇总 Node / Electron、配置文件、项目资源与权限；不提供日志导出、网络诊断或 `pi doctor` 的完整检查项 |
| Pi / 包更新 | 无 | 部分 | Windows x64 NSIS 安装包 `PiSpider Setup <version>.exe` 已由 electron-builder 26.18.0 构建产出（非 oneClick、perMachine=false），安装流程本身尚未执行安装冒烟；`win-unpacked/PiSpider.exe` 经最小 PATH + CDP 只读冒烟验证；应用图标接入 `build/icon.ico`。未做：代码签名、自动更新、macOS / Linux 目标、portable 单文件目标；Pi / 包自身更新仍无入口 |
| print / JSON / RPC / SDK 模式 | 不适用 | 不适用 | 桌面本身通过 RPC 驱动 runtime，不需要给用户暴露这些 CLI 输出模式 |
| TUI 键位 / terminal 配置 | 不适用 | 不适用 | 桌面使用自己的快捷键，不复制终端 TUI |

## 7. 建议顺序

**已落地**

- 扩展 UI 桥：`confirm` / `input` / `editor` / `select` 对话，`notify` / `setStatus` / `setWidget` / `set_editor_text` / `setTitle`。
- MCP 配置：左侧 `MCP` 窗口支持用户级 `agent/mcp.json` 和项目级 `.pi/mcp.json`，支持 stdio/HTTP 添加、编辑、删除、启停、逐服务器检查和 stdio / HTTP 握手检查；检查成功会显示 tools/list 返回的工具名。项目级需要信任当前项目后才会被 runtime 加载。
- 提示词组件：`core` / `workflow` / `js` / `app` 编辑、恢复默认、最终提示词预览。
- Pi 提示模板：设置窗口列出用户级 `agent/prompts` 和项目级 `.pi/prompts` 的 Markdown 模板，支持新建、编辑、删除（备份到 `$PISPIDER_HOME/backups/prompt-templates`）；创建 `user-smoke` 后重载 Agent，`get_commands` 返回 `source: "prompt"` 的 `user-smoke`，删除并清理测试备份。
- 浏览器导航：右栏浏览器增加后退、前进、刷新/停止和地址栏同步。
- 队列：显示数量、清空并放回输入框；停止会先清空排队再 abort。
- 会话：输入框模型名左侧显示上下文圆环与用量弹层，会话窗口保留同一份统计；提供手动压缩、重命名、回退分支、回退上一轮 / 再回退一轮、复制会话、会话树、导出 HTML、导出 JSONL、自动压缩、自动重试和中止重试；最近列表支持删除非当前会话。模型、思考强度和权限统一在输入框底部，会话窗口不再重复控件。
- 输入框：输入 `/` 弹出命令面板；24 个内置命令在桌面本地拦截执行，扩展 / 模板 / 技能命令数据来自 RPC `get_commands`，支持过滤、方向键、Enter/Tab 插入；RPC 命令仍通过 prompt 执行。
- 输入框底部控制：模型胶囊直接打开模型和思考强度菜单，权限胶囊按当前会话切换“全部允许 / 只读 / 禁用工具”。权限切换会重启 runtime 并恢复当前会话，切换会话时按目标会话权限重启；只读模式使用 `--tools read,grep,find,ls --exclude-tools mcp__*`，禁用工具模式使用 `--no-tools`。
- 直接 shell：输入框 `!` / `!!` 由桌面主进程在本机 shell 执行，结果进入所属用户回合的展开动作行并支持停止；`!!` 会去掉前缀后执行。当前不写回 Agent 上下文。
- 回复：用户和助手消息都可在悬停 / 聚焦时从消息右下角复制；顶栏不再提供“复制最后回复”。
- 模型配置：设置窗口新增“检查配置”“测试连接”和“测试推理”；测试连接请求模型列表验证端点和 Key，支持点击发现的模型填入模型 ID；测试推理发送一条最小请求并显示模型返回文本，会消耗少量推理额度。Anthropic Messages 的接口地址会自动规范为服务根地址，避免 SDK 拼出 `/v1/v1/messages`。已保存模型以列表展示，可编辑推理模型、图像输入、上下文窗口和最大输出。
- 项目信任：设置窗口可切换“不加载 / 信任当前项目”，信任后 runtime 带 `--approve`，下次重载生效。
- 二次窗口：规则 / 技能 / 设置 / MCP / 扩展 / 项目 / 会话 / 状态统一为标题与元信息同排、单行状态摘要、四列数值条和分区卡；规则 / 技能 / MCP 空态收起顶部重复按钮。窗口放大到 1000–1060px 宽并相对主窗口居中，按显示器可用区域收缩；设置页模型卡去掉重复 eyebrow 和“连接参数”，文件目录两列；MCP 已连接工具只展示前 10 个并显示 `+N`。

**P0：数据安全与高频核心体验**

1. 建立版本控制：仓库目录暂无 `.git`，三轮大量改动缺少兜底；需用户决策初始化仓库或确认工作副本来源。桌面可独立做（非技术阻塞）。
2. 队列逐条删除 / 恢复：当前为只读查看、逐项复制和全部清空降级；阻塞于上游 `get_queue` / `remove_queue_item` RPC 缺口。
3. UI 遗留正确性：图片消息渲染、内容变更后的缓存失效。桌面可独立做，详见 [desktop-ui.md](desktop-ui.md)。
4. `/resume` 独立会话导航：当前复用会话搜索框聚焦；桌面可独立做。

**P1：功能完整与打包维护**

1. `/share` Radius artifact 与分享目的地设置（Gist 路径已有）：目的地配置字段上游 schema 已存在；Radius artifact 生成 / 发布路径阻塞上游。
2. 会话树节点删除 / 排序：排序桌面可独立做（展示序持久化 `desktop.json`，复用置顶模式，不写上游会话文件）；分支节点删除阻塞上游 entry 变更 API / RPC；整文件删除是桌面自有文件操作。
3. 逐模型思考档位 UI：桌面可独立做；上游 schema 已有 `modelThinkingLevels`，会话级 `set_thinking_level` RPC 已有，写配置后重启 runtime。
4. 高级 settings（proxy / transport / shell / 细粒度 allowlist / compaction 参数）：桌面可独立做；上游 schema 字段已具备，缺 RPC 写入口，走配置文件 + 重启 runtime 既有模式，注意 schema 校验与重启生效时机。
5. MCP 单工具运行态订阅：服务器级连接 live state 已接（RPC `mcp_status` 快照 + `mcp_status_changed` 推送原地更新）；单工具运行时状态订阅仍缺上游数据，`McpLiveServerStatus.tools` 仅为工具名数组，无单工具运行 / 可用状态字段。
6. CORE_VERSION 三处同步升级流程（`scripts/pispider-launcher.mjs`、`scripts/prepare-packaged-runtime.mjs`、`packaged-runtime.cjs`）与 `package.json` 缺失 `author` 警告：桌面可独立做（打包维护性）。
7. 打包版 stdio 预置 MCP 的 npm 方案：随包 npm-cli 或维持现有 npm CLI 缺失降级，属体积权衡；桌面可独立做。
8. doctor 日志导出：桌面可独立做。

**P2：打磨与外部分发**

1. 动效统一、自定义主题导入：桌面可独立做。
2. 代码签名与自动更新：阻塞于外部证书 / publish 服务。
3. macOS / Linux 包与 portable 单文件目标：需对应平台构建环境；桌面可独立做（环境依赖）。

排序理由：P0 = 数据安全 + 高频核心体验正确性；P1 = 功能完整性与打包可维护性；P2 = 视觉打磨与对外分发基础设施。

刻意不做：内置 `web_hook` / `js_bundle` / `node_replay` 仍留给桌面壳完成之后；当前只按通用 Agent + MCP/Computer Use 的路线补齐。
