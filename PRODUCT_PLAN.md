# PiSpider 产品与实施框架

更新时间：2026-11-17

## 1. 产品定位

PiSpider 是构建在 Pi 之上的 JavaScript / App 逆向 Agent 工作台。数据采集是下游分支，不是当前核心。

当前阶段的重点不是继续堆逆向工具，而是把桌面客户端做成能稳定控制通用 Agent 的工作台：

- 能对话、切换模型和 Thinking、控制会话；
- 能管理规则、技能、提示词、MCP 和项目权限；
- 能在右栏查看浏览器和当前项目代码；
- 能接入扩展和工具，但不复制 Pi 核心逻辑。

## 2. 当前阶段

当前处于“桌面壳补齐”阶段：

1. 已落地三栏桌面壳、二次窗口、会话控制、模型配置、MCP 配置 / 检查 / 登录 / 热重连 / 逐工具启停、规则 / 技能 / 提示词管理、附件、`@`、斜杠命令面板、浏览器和代码页。MCP 窗口还带内置预置目录，当前为 `chrome-devtools` 和 `context7`：默认只显示包信息，用户点击后才懒安装 / 写配置，MCP 包内 Skill 只保留在包内，不复制到用户技能目录，作为“用户不用自己找工具”的生态入口。
2. 已补 UI 一致性、二次窗口去 hero 与尺寸放大（统一标题元信息同排、单行摘要和数值条）、长会话增量渲染与完整虚拟滚动、切片切换 / 锚点恢复、按会话高度持久化并绑定布局宽高（窗口宽度 / 缩放 / 面板开合失效重测）、动态正文宽度与 Markdown 块级高度估算、列表正常化、“共 N 条”提示与 `Ctrl+Home` / `Ctrl+End` 首尾跳转、会话切换滚动恢复、启动恢复上次会话、搜索命中高亮、会话全文搜索 / `re:` 正则 / snippet / 相关度排序、Markdown 表格 / 有序列表 / 引用 / 删除线 / 代码高亮、Mermaid 裁剪运行时（flowchart / sequence，约 3.44 MB）与源码切换 / 错误回退、工具动作行参数与输出分区（按用户回合收进可折叠回合卡）、窗口状态持久化与单实例、长会话“回到最新”、`atLatest` 滚动快照、排队消息只读面板和模型作用域、会话窗口分享到 GitHub 私有 Gist（`gh` 前置检查、HTML 导出、viewer URL）；240 条混合探针首次打开总高度差约 0.02%。思考强度菜单隐藏 `minimal`，只显示“关闭 / 低 / 中 / 高 / 极高 / 最高”，推理模型默认声明 xhigh / max，Anthropic Messages 自动启用自适应思考，设置页不再有扩展档位开关；正在补动效统一、队列逐条删除（需上游 RPC）、会话树节点删除 / 排序、Pi Radius 分享路径等日常可用性缺口。
3. 暂不实现 `web_hook`、`js_bundle`、`node_replay`；先做通用 Agent，桌面壳稳定后再考虑 JS 逆向专用工具。

详细状态和下一步见 [docs/desktop-status.md](docs/desktop-status.md)，逐项差异见 [docs/desktop-parity.md](docs/desktop-parity.md)，UI 方向见 [docs/desktop-ui.md](docs/desktop-ui.md)，RPC 契约见 [docs/desktop-runtime-contract.md](docs/desktop-runtime-contract.md)。

## 3. 分层

```text
Pi Core
  packages/agent, ai, coding-agent, tui, ...
        │ 公开 Extension API / Session / Prompt / Skill / Fork
        ▼
PiSpider Product Layer
  packages/pispider
        │
        ├── 可见领域提示
        ├── 规则 / 技能 / 提示词资源
        ├── /ps 与 ps_task
        └── 可选 Computer Use
        │
        ▼
Desktop Shell
  apps/pispider-desktop
        │ JSONL RPC
        ▼
PiSpider Runtime
  scripts/run-pispider.mjs --mode rpc
```

产品层不修改 Pi 核心包；桌面端不复制 Agent 逻辑，只通过 RPC 驱动 runtime。CLI 和桌面共用 `$PISPIDER_HOME` 数据目录，但不是同一进程。

## 4. 当前优先级

**P0：可用性**

- UI：长会话消息 / 工具卡增量渲染、主窗口与二次窗口共用视觉 token、窄窗口右栏默认折叠、完整虚拟滚动（只渲染视口附近约 120–176 条，上下占位补齐整段会话）、消息 key + 视口偏移锚点、`atLatest` 滚动快照、会话切换滚动恢复与无快照默认最新切片、按会话高度持久化、动态正文宽度与 Markdown 块级估算、`共 N 条` 提示与 `Ctrl+Home` / `Ctrl+End` 首尾跳转、会话分组与行内删除、搜索命中高亮与键盘打开、会话全文搜索 / `re:` 正则 / snippet / 相关度排序、Markdown 表格 / 有序列表 / 引用 / 删除线 / 代码高亮、Mermaid 裁剪运行时（flowchart / sequence，约 3.44 MB）与源码切换 / 错误回退、按用户回合收口的回合卡与动作行参数 / 输出分区、图标 aria 和弹层键盘导航、MCP 逐工具启停列表、“回到最新”、按会话滚动位置、快捷键总览、命令面板与最近使用、资源入口 2×2、动效 token 与全局 reduced-motion、代码块复制、输入框模型名左侧上下文圆环与用量弹层、逐条用户 / 助手消息复制、应用级缩放已接。
- 会话树节点删除 / 树内排序；跨目录恢复、置顶排序、启动恢复上次会话、label 和“从此分支 / 复制”已接；`/share` 已接 GitHub 私有 Gist，Radius 路径未接。
- 队列逐条删除；运行中 steer 已接（`Ctrl+Enter`），排队消息已支持分组查看、逐项复制和全部清空，单条删除等上游 `get_queue`。
- 模型作用域已接（读写 `settings.json.enabledModels`，菜单默认按 scope 过滤、可切全部，循环走 `cycle_model`）；provider OAuth 已接 Kimi For Coding、OpenRouter、OpenAI 三家；模型 / 思考强度循环和搜索已接。
- MCP OAuth、单服务器热重连、逐工具启停、主窗口 pending / 已发送 / 失败横幅已接；服务器级连接 live state 已接（RPC `mcp_status` 快照 + `mcp_status_changed` 推送原地更新），逐工具运行时状态订阅仍未暴露。
- 主窗口位置 / 尺寸 / 最大化持久化、屏幕外回退和单实例锁已接。

**P1：日常体验**

- Pi Radius artifact 分享、分享目的地设置。
- 扩展 / Pi package / 提示模板管理。

**P2：平台化**

- 高级 settings、主题导入、诊断日志。
- 自动更新、代码签名、macOS / Linux 目标、portable 单文件目标。

## 5. 验收标准

桌面端每个功能至少满足：

- 能通过界面完成，不要求用户手改配置文件；
- 状态变化能在窗口或工具卡片中看到；
- 失败时有可读错误，不静默失败；
- 涉及 runtime 设置的变更能保留当前会话；
- 测试使用临时配置 / 临时会话，结束后清理。

产品层继续遵守：

- 提示、规则、Skill 和状态可审计；
- 不实现隐藏提示、宿主补丁、Workspace 基线移除或越界执行；
- 不通过修改 Pi 核心包实现产品功能。

## 6. 非目标

- 当前不做独立逆向工具内核、执行沙箱和复杂证据平台；
- 当前不做本地 Web 控制台，桌面壳优先；
- 当前不做底层 `web_hook`、`js_bundle`、`node_replay`；
- 不把 PiSpider 做成 Pi 的 fork 补丁集合。
