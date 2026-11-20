# PiSpider 产品扩展包

这是 PiSpider monorepo 内的 Pi 本地扩展包，位于 `packages/pispider`。根目录是统一启动和开发入口，不需要再把它当作独立的顶层项目。

它不修改 Pi 核心，通过公开扩展 API 提供：

- 默认注入、可见、可编辑的 JS/App 逆向领域提示；
- 可审计的本地规则库；
- 带校验、备份和回滚的 Skill 管理；
- 基于 Pi 原生 fork 的会话回退；
- 跟随会话分支恢复的任务状态；
- 统一的 `/ps` 命令与状态入口；
- 可选加载的内置 Computer Use 扩展（默认关闭）。

## 从根目录启动

```bash
npm run pispider:doctor
npm run pispider:setup
npm run pispider
```

平台脚本：

```powershell
.\run.ps1
```

```bat
run.cmd
```

```bash
bash ./run.sh
```

进入 Pi 后：

```text
/ps status
/ps help
```

开发时也可以直接让 Pi 加载本包：

```bash
pi -e packages/pispider
```

首次运行会创建 `$PISPIDER_HOME`。默认位置：

- Windows：`%USERPROFILE%\.pispider`
- macOS / Linux：`$HOME/.pispider`

## 可选内置 Computer Use

`packages/pispider/vendor/pi-computer-use/` 内置了上游
[`injacency/pi-computer-use`](https://github.com/injaneity/pi-computer-use) 0.5.1 的运行文件，
不需要单独 `npm install`。它默认不加载；只有显式开启时才由启动器追加第二个 `-e` 入口：

```powershell
$env:PISPIDER_COMPUTER_USE = "1"
npm run pispider
```

```bat
set PISPIDER_COMPUTER_USE=1 && npm run pispider
```

```bash
PISPIDER_COMPUTER_USE=1 npm run pispider
```

开启后提供 11 个 `computer-use` 工具：`find_roots`、`observe_ui`、`search_ui`、`expand_ui`、
`inspect_ui`、`act_ui`、`read_text`、`wait_for`、`launch_browser`、`navigate_browser`、
`evaluate_browser`，以及 `/computer-use` 命令。

Windows/Linux helper 安装到：

```text
$PISPIDER_HOME/agent/helpers/pi-computer-use/
```

不会写入 `~/.pi`。Windows 首次使用会释放预编译的 `windows-bridge.exe`；macOS 使用扩展内置的签名 helper，并需要
Accessibility 与 Screen Recording 权限。扩展配置文件仍在 `$PISPIDER_HOME/agent/extensions/pi-computer-use.json`，
项目级配置为当前工作目录的 `.pi/computer-use.json`。

## 目录

```text
packages/pispider/
  package.json               # pi.extensions 指向 ./src/index.js
  resources/prompts/         # core/workflow/js/app 默认提示
  src/
    index.js                 # 事件、命令、工具注册
    config.js                # domain 与 activeRule
    prompts.js               # Prompt Composer
    rules.js                 # 规则库
    skills.js                # Skill 管理
    rewind.js                # fork 回退
    task-state.js            # 分支任务状态
    tool.js                  # ps_task
    commands.js              # /ps
  vendor/pi-computer-use/    # 可选内置 Computer Use 扩展与预编译 helper
  test/                      # node:test 测试
  README.md
  THIRD_PARTY_NOTICES.md
```

## 提示装配

在 `before_agent_start` 中向 Pi 的：

```js
event.systemPromptOptions.sections.pispider
```

追加一个 section。Pi 原有 `preamble`、`rules` 等 section 保持不变。组合顺序：

```text
Pi 原始 System Prompt
  + Core
  + Workflow
  + 当前 Domain
  + 当前规则
  + 当前分支任务状态
  + Prompt Contract
```

可用 `/ps prompt show` 查看完整内容。

“不拒绝逆向”的准确含义是**合法授权任务的连续性**：不因主题词本身拒绝；单点受阻时指出具体边界并转向相邻的安全分析路径。它不包含删除宿主约束、隐藏提示、越狱或无边界执行。

## `/ps` 命令

| 命令 | 作用 |
| --- | --- |
| `/ps status` | 查看 Home、Domain、规则、Skill、Prompt 和任务状态 |
| `/ps domain auto\|js\|app` | 切换 Domain 模式 |
| `/ps rules list` | 列出规则 |
| `/ps rules use <id>` | 启用规则 |
| `/ps rules create <id> [name]` | 创建规则骨架 |
| `/ps rules edit <id>` | 在编辑器中修改规则 |
| `/ps rules delete <id>` | 备份后删除规则 |
| `/ps rules reset [id]` | 清除活动规则，或重置规则正文 |
| `/ps skills list` | 列出 Skill 与校验状态 |
| `/ps skills import <path> [id]` | 从本地目录导入 Skill |
| `/ps skills create <id> [desc]` | 创建 Skill 骨架 |
| `/ps skills delete <id>` | 备份后删除 Skill |
| `/ps prompt show` | 查看完整追加提示 |
| `/ps prompt files` | 查看提示文件路径和大小 |
| `/ps prompt reset [names]` | 恢复提示默认内容 |
| `/ps rewind once\|round` | 回到上一用户输入或再往前一轮 |
| `/ps task status\|reset` | 查看或重置当前分支任务状态 |
| `/ps reload` | 重新发现 Skill 等资源 |
| `/ps help` | 命令帮助 |

## `ps_task`

阶段：`intake`、`plan`、`execute`、`observe`、`verify`、`done`、`blocked`。

动作：`plan`、`note`、`reroute`、`stage`、`complete`、`status`、`reset`。

`reroute` 记录单点边界、相邻替代路径和下一步，保持计划与证据，不把任务重置。

状态保存在 tool result 的 `details.pispiderTask` 中，按当前会话分支重建。

## 数据布局

```text
$PISPIDER_HOME/
  config.json
  prompts/{core,workflow,js,app}.md
  rules/<id>/RULE.md + meta.json
  skills/<id>/SKILL.md
  backups/rules/
  backups/skills/
  state/skill-imports/
  agent/                     # Pi 配置、认证、模型、会话（与 ~/.pi 隔离）
    helpers/pi-computer-use/ # 可选 Computer Use 的本地 helper
  runtime/core-1.5.2/        # 启动器缓存的 Pi 运行时
```

## 与 Pi 共存

PiSpider 启动 Pi 子进程时会设置 `PI_CODING_AGENT_DIR`、`PI_CODING_AGENT_SESSION_DIR` 到 `$PISPIDER_HOME/agent`，所以本机独立安装的 Pi 仍使用 `~/.pi`，两边互不覆盖。需要把已有 Pi 配置带到 PiSpider 时：

```bash
npm run pispider:migrate -- --dry-run
npm run pispider:migrate
```

默认不复制会话，不覆盖已有文件，扩展代码需要 `--include-extensions`。没有 Pi 配置时可运行 `npm run pispider:setup`，它会跳过导入并继续 doctor。产品层和上游 Pi 的完整差异见 [docs/pi-upstream.md](../../docs/pi-upstream.md)。

## Skill 安全约束

- ID 仅允许 kebab-case；
- `SKILL.md` 必须包含匹配目录名的 `name` 和非空 `description`；
- 单 `SKILL.md` 上限 256 KiB，单文件上限 2 MiB，总大小上限 50 MiB，最多 200 个文件；
- 拒绝符号链接；
- 只导入到 `$PISPIDER_HOME/skills/<id>`；
- 替换已有 Skill 前备份；
- 失败时清理暂存目录并尝试恢复原 Skill；
- 跳过 `.git`、`node_modules`、`__MACOSX`。

第一版只支持目录导入，不支持压缩包。

## 开发与测试

从仓库根目录：

```bash
npm run pispider:doctor
npm run pispider:check
npm run pispider:test
node --test scripts/pispider-launcher.test.mjs scripts/pispider-migrate.test.mjs
```

当前扩展包覆盖 34 项测试：33 通过、0 失败、1 个符号链接用例因 Windows 当前权限跳过。启动器 10 项、配置迁移 4 项，合计 48 项测试：47 通过、1 跳过。

## 第一版未包含

- 指定浏览器操控、站点与本地 Node 联调；
- JS/App 专用原生分析工具或执行沙箱；
- 压缩包 Skill 导入；
- 本地 Web 控制台；
- 红队模块、宿主包补丁、隐藏提示注入、Workspace 基线移除。

Computer Use 已作为**可选内置扩展**提供，默认关闭；它不是第一版的默认工具面。

## 文档与边界

- [架构](../../docs/architecture.md)
- [开发指南](../../docs/development.md)
- [跨平台](../../docs/cross-platform.md)
- [可选内置 Computer Use](../../docs/computer-use.md)
- [验收](../../docs/acceptance.md)
- [产品与实施框架](../../PRODUCT_PLAN.md)
- [第三方来源说明](THIRD_PARTY_NOTICES.md)
