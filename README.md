# PiSpider

PiSpider 是一个构建在 Pi 之上的 **JavaScript / App 逆向 Agent 工作台**。数据采集是它的下游分支，不是产品核心。

当前仓库是完整的 PiSpider monorepo：根目录既是开发入口，也是 Pi workspace 根；PiSpider 产品层位于 `packages/pispider`，不修改 Pi 核心包。

当前开发主线是桌面端通用 Agent 客户端：先把 Codex / 豆包 Desktop 风格的窗口、输入、会话和资源管理做稳，再考虑 `web_hook`、`js_bundle`、`node_replay`。当前状态、缺口和下一步见 [桌面端开发状态](docs/desktop-status.md)。

## 当前能力

- 默认生效、可见、可编辑的 JS/App 逆向领域提示；
- 可审计的本地规则库；
- 带校验、备份和回滚的 Skill 管理；
- 基于 Pi 原生 fork 的会话回退；
- 跟随会话分支恢复的任务状态；
- 可选加载的内置 Computer Use 扩展（默认关闭，不单独安装 npm 依赖）；
- Codex Desktop 风格的可选桌面客户端（`apps/pispider-desktop`，RPC 壳，不重复实现 Agent）；
- 模型思考强度菜单隐藏 `minimal`，推理模型默认声明 xhigh / max 扩展档位；
- 桌面模型作用域：菜单可勾选 scoped models，写入 `settings.json.enabledModels`，默认只显示作用域模型并支持“全部 / 作用域”切换；
- 跨 Windows、macOS、Linux 的统一启动链路；
- 完整开发、架构、跨平台和验收文档。

“不拒绝逆向”的准确含义是**合法授权逆向任务的连续性**：不因主题词本身中断任务，遇到单点边界时解释限制并转向相邻的安全分析路径；不移除 Pi 安全约束，不实现隐藏提示或越界执行。

## 仓库结构

```text
PiSpider/
  package.json                 # workspace、构建、测试、PiSpider 脚本
  run.ps1 / run.cmd / run.sh   # 平台启动入口
  packages/
    coding-agent/              # Pi 核心，作为底座使用
    pispider/                  # PiSpider 产品扩展包
      vendor/pi-computer-use/  # 可选内置 Computer Use 扩展
    ...                        # Pi 其他 workspace 包
  apps/                        # Pi 上游实验应用
  scripts/                     # Pi 与 PiSpider 脚本
  docs/                        # 架构、开发、跨平台、Pi 上游差异、验收、命令文档
  PRODUCT_PLAN.md              # 产品与实施框架
  PI_README.md                 # 上游 Pi README
```

## 快速启动

要求 Node.js >= 22.19.0。

```bash
npm run pispider:doctor
npm run pispider
```

如果本机已经安装并配置过 Pi，首次启动前可以导入它的用户配置：

```bash
npm run pispider:setup
```

默认只导入认证、模型、MCP、设置和用户指令文件；需要同时导入主题、提示模板和 Skill 时使用 `npm run pispider:migrate -- --include-resources`。扩展代码需要显式使用 `--include-extensions`。导入目标为空时才写入，不覆盖 PiSpider 已有文件，也不复制 Pi 的会话历史。如果本机没有 Pi 配置，`pispider:setup` 会跳过导入并继续运行 doctor。

也可以使用平台脚本：

```powershell
# Windows PowerShell
.\run.ps1
```

```bat
:: Windows cmd
run.cmd
```

```bash
# macOS / Linux / Git Bash
bash ./run.sh
```

首次运行如果没有本地 Pi 构建，会把 `@earendil-works/pi-coding-agent@1.5.2` 安装到 `$PISPIDER_HOME/runtime/core-1.5.2/`，之后复用缓存。不会在 monorepo 根直接依赖 `npx` 解析同名 workspace 源码包。

进入 PiSpider 后执行：

```text
/ps status
/ps help
```

可选开启内置 Computer Use：

```powershell
$env:PISPIDER_COMPUTER_USE = "1"
npm run pispider
```

默认不加载，避免 11 个 computer-use 工具进入所有会话的工具面。开启后 helper 安装到
`$PISPIDER_HOME/agent/helpers/pi-computer-use/`，不会写入 `~/.pi`。详见
[产品扩展包说明](packages/pispider/README.md)。

## 桌面客户端

`apps/pispider-desktop` 是一个 Electron 外壳，视觉参考豆包 Desktop / Codex Desktop：左侧导航、中间对话、右侧上下文面板。它不复制 Agent 逻辑，只通过 JSONL RPC 驱动同一套 PiSpider runtime。

```powershell
npm run pispider:desktop
```

第一次运行前如果 Electron 还没安装，按 [桌面客户端说明](apps/pispider-desktop/README.md) 在应用目录安装。桌面端与 CLI 共用 `~/.pispider` 配置；没有配置 provider 时，打开左栏底部的设置，在“模型”区域填写服务商、API Key 和模型 ID，保存后会自动重启 runtime。规则、技能、提示词和领域模式也都可以在左栏的规则/技能窗口和设置窗口里管理；技能与提示词保存后点击“重载 Agent”生效。MCP 登录 / 登出 / 单服务器热重连在 MCP 窗口按服务器操作，逐工具启停用勾选列表写入 `toolExposure`；会话支持启动恢复上次会话、置顶排序、搜索命中高亮和从其他目录恢复 `.jsonl`。窗口位置 / 尺寸 / 最大化会持久化，屏幕外坐标自动回退，第二次启动只聚焦已有窗口；窄窗口启动时右栏默认折叠，长会话使用完整虚拟滚动（只渲染视口附近约 120–176 条，上下占位按已测高度和分类型估算补齐整段会话，用户 / 助手宽度随列表动态变化，已测高度按会话持久化并绑定布局宽高，窗口宽度 / 缩放 / 面板开合变化时自动失效重测，reload 后按当前布局复用已访问切片；240 条混合探针首次打开总高度差约 0.02%），消息超过 120 条时标题下显示“共 N 条”，`Ctrl+Home` / `Ctrl+End` 和命令面板可跳到最早 / 最新切片，滚动区域提供“回到最新”，输入框模型名左侧显示上下文圆环并可展开会话用量弹层，排队消息可分组查看和复制；MCP 登录 / 登出 / 重连会在主窗口显示 pending / 已发送 / 失败横幅；Markdown 代码块支持语言标签和一键复制；`Ctrl +` / `Ctrl -` / `Ctrl 0` 可缩放整个桌面工作台；每个会话单独记住滚动位置和虚拟切片，切换会话时按锚点恢复；第一次打开的会话从最新切片落底；`Ctrl+/` / `F1` 打开快捷键总览；`Ctrl+Shift+P` 打开命令面板并置顶最近使用；会话搜索支持 `↑↓` / `Enter` 打开。

当前桌面壳不包含内置 `web_hook`、`js_bundle`、`node_replay`。这一阶段先把通用 Agent 的客户端和会话/任务/产物链路做通，后续再接入 JS 逆向专用工具。

## 本地开发

```bash
npm run pispider:check
npm run pispider:test
node --test scripts/pispider-launcher.test.mjs scripts/pispider-migrate.test.mjs
```

如果要使用当前仓库源码构建的 Pi：

```bash
npm install --ignore-scripts
npm run build
npm run pispider
```

构建产物存在时，启动器会自动优先使用 `packages/coding-agent/dist/bundle/cli.js`。

## 数据目录

默认：

- Windows：`%USERPROFILE%\.pispider`
- macOS / Linux：`$HOME/.pispider`

可用 `PISPIDER_HOME` 覆盖。目录结构：

```text
$PISPIDER_HOME/
  config.json
  prompts/
  rules/
  skills/
  backups/
  state/
  agent/              # Pi 的运行配置、认证、模型和会话，和 ~/.pi 完全隔离
  runtime/core-1.5.2/ # 首次启动缓存的 Pi 运行时
```

Pi 自身的默认目录 `~/.pi` 不会被 PiSpider 读写。详细说明见 [Pi 上游差异与升级](docs/pi-upstream.md)。

## 文档

- [开发文档入口](docs/README.md)
- [桌面端开发状态](docs/desktop-status.md)
- [架构](docs/architecture.md)
- [开发指南](docs/development.md)
- [桌面端能力对照](docs/desktop-parity.md)
- [桌面端 UI 优化方向](docs/desktop-ui.md)
- [桌面端运行时契约与 Pi 架构同步](docs/desktop-runtime-contract.md)
- [跨平台说明](docs/cross-platform.md)
- [Pi 上游差异与升级](docs/pi-upstream.md)
- [可选内置 Computer Use](docs/computer-use.md)
- [桌面客户端说明](apps/pispider-desktop/README.md)
- [验收与测试](docs/acceptance.md)
- [命令与数据速查](docs/commands.md)
- [产品与实施框架](PRODUCT_PLAN.md)

## 边界

PiSpider 不支持宿主补丁、隐藏提示注入、Workspace 基线移除、越狱、红队 Drill 或无边界执行。所有提示、规则、Skill 和状态都保持可见、可编辑、可审计。
