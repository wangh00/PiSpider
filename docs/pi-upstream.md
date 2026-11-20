# PiSpider 与上游 Pi 的差异及升级指南

本文记录 PiSpider 相对上游 Pi 做了哪些改动、增加了哪些能力，以及上游 Pi 升级时如何同步，避免后续维护时把产品层和 Pi 核心混在一起。

## 1. 基线

- 上游基线：`@earendil-works/pi-coding-agent@1.5.2`
- 当前仓库：Pi 的 monorepo + PiSpider 产品层
- Pi 核心包：`packages/coding-agent`、`packages/agent`、`packages/ai`、`packages/tui` 等保持上游代码
- PiSpider 产品包：`packages/pispider`
- 桌面客户端：`apps/pispider-desktop` 只通过 RPC 驱动 runtime，契约同步见 [desktop-runtime-contract.md](desktop-runtime-contract.md)

PiSpider 不是 Pi 的 fork 补丁集合。它通过 Pi 的公开扩展 API 增加产品能力；唯一的运行时改造在启动器和进程环境，不在 Pi 核心源码里。

## 2. 上游 Pi 文件的处理

| 类型 | 处理方式 |
| --- | --- |
| `packages/*`、`apps/*`、`scripts/*` 等 Pi 源码 | 保留在仓库根；PiSpider 只在 `scripts/` 新增 `pispider-*` 文件 |
| `README.md` | 根目录产品入口；上游内容保留为 `PI_README.md` |
| 根 `package.json` | 名称改为 `pispider-monorepo`，保留 Pi 的 workspace、build、check、publish 脚本，新增 PiSpider 脚本 |
| 根 `package-lock.json` | 随 workspace 和包名更新 |
| `AGENTS.md` | 顶部增加 PiSpider 仓库范围，下面继续保留上游 Pi 开发规则 |
| `docs/` | PiSpider 新增，不属于上游 Pi |
| 产品扩展 | 只新增 `packages/pispider`，不修改 Pi 核心包行为 |

## 3. PiSpider 增加了什么

### 3.1 产品层

`packages/pispider` 是纯 JavaScript Pi 扩展包，通过 `package.json` 的 `pi.extensions` 加载：

```json
{
  "pi": {
    "extensions": ["./src/index.js"]
  }
}
```

它注册：

- `before_agent_start`：在 Pi 原始 system prompt 之后追加可见的 `sections.pispider`；
- `resources_discover`：把 `$PISPIDER_HOME/skills` 暴露给 Pi；
- `/ps`：产品命令入口；
- `ps_task`：分支感知的任务状态工具，支持 `reroute` 记录单点边界和替代路径；
- `session_start`、`session_tree`：刷新配置、任务状态和状态栏。

Pi 的 `preamble`、`rules` 等 section 不被替换。产品层只追加内容，不删除 Pi 的安全约束。

### 3.2 提示与工作流

默认提示位于 `packages/pispider/resources/prompts/`：

- `core.md`：产品身份、边界和可见性要求；
- `workflow.md`：Intake → Plan → Execute → Observe → Verify → Deliver；
- `js.md`：JavaScript / Web 逆向；
- `app.md`：App / 移动端逆向。

首次启动复制到 `$PISPIDER_HOME/prompts/`，之后读取用户副本，不覆盖用户编辑。Domain 由 `auto|js|app` 选择或从用户文本推断。

### 3.3 规则与 Skill

- 规则：`$PISPIDER_HOME/rules/<id>/RULE.md` + `meta.json`
- Skill：`$PISPIDER_HOME/skills/<id>/`
- 删除/替换前备份到 `$PISPIDER_HOME/backups/`
- Skill 导入校验 ID、`SKILL.md`、大小、文件数、符号链接和路径穿越
- 不把 MCP 或 Skill 当作能力前提；提示词在未安装这些资源时仍然生效

### 3.4 任务状态与回退

`ps_task` 的结果写入 `details.pispiderTask`，通过 Pi 的 `ctx.sessionManager.getBranch()` 沿当前分支重建。`/ps rewind` 使用 Pi 的 fork 能力，回退后任务状态跟随分支，原分支保留。

### 3.5 启动器与运行时隔离

`scripts/run-pispider.mjs` 是统一入口，启动顺序：

1. `PISPIDER_CORE_CLI` 指定的 CLI；
2. `packages/coding-agent/dist/bundle/cli.js`，当前仓库构建产物；
3. `$PISPIDER_HOME/runtime/core-1.5.2/` 缓存；
4. 缺失时安装 `@earendil-works/pi-coding-agent@1.5.2` 到该缓存目录。

启动 Pi 子进程前，启动器会覆盖以下上游环境变量，把 Pi 的全局状态锁在 PiSpider 目录：

| 上游变量 | PiSpider 运行时的值 |
| --- | --- |
| `PI_CODING_AGENT_DIR` | `$PISPIDER_HOME/agent`，或 `PISPIDER_AGENT_DIR` |
| `PI_CODING_AGENT_SESSION_DIR` | `$PISPIDER_HOME/agent/sessions`，或 `PISPIDER_SESSION_DIR` |
| `PI_PACKAGE_DIR` | 从子进程环境中删除，避免继承用户已有 Pi 安装的包目录 |

因此：

- 独立安装的 Pi 继续使用 `~/.pi/agent`；
- PiSpider 使用 `~/.pispider/agent`；
- 两者不共享 `~/.pi` 下的认证、模型配置、MCP、主题或会话；
- Pi 上游仍会把 `~/.agents/skills` 作为用户 Skill 根目录加载；这部分不属于 `~/.pi`，如需彻底隔离需后续显式加 `--no-skills` 或调整资源发现策略；
- PiSpider 仍可读取当前工作目录的 `AGENTS.md` 等上下文文件，这是 Pi 的项目上下文机制，不是全局配置共享。

### 3.6 Pi 用户配置迁移

如果本机已经安装 Pi，可把 Pi 的用户配置导入 PiSpider：

```bash
npm run pispider:migrate
```

默认导入：

- `auth.json`
- `oauth.json`
- `models.json`
- `mcp.json`
- `keybindings.json`
- `settings.json`
- `AGENTS.md` / `AGENTS.override.md` / `CLAUDE.md`
- `SYSTEM.md` / `APPEND_SYSTEM.md`

需要额外导入主题、提示模板和 Skill：

```bash
npm run pispider:migrate -- --include-resources
```

需要导入 Pi 扩展代码时：

```bash
npm run pispider:migrate -- --include-extensions
```

规则：

- 只写入 PiSpider 的空目标文件，不覆盖已有文件；
- 不复制 `sessions/`、`bin/`、`tools/` 等运行状态；
- 迁移 `settings.json` 中的旧 agent 路径时改写为 PiSpider 的目标路径；
- 不复制符号链接；
- `--dry-run` 只报告计划，不写文件。

迁移通过显式命令执行，不在首次启动时静默复制凭据。`npm run pispider:setup` 等于 `pispider:migrate --optional` 加 `pispider:doctor`：没有找到 Pi 配置时跳过导入，不影响首次启动。

### 3.7 仓库与文档

- 根目录是唯一开发入口；
- 三平台脚本：`run.ps1`、`run.cmd`、`run.sh`；
- 文档：架构、开发、桌面端状态、能力对照、验收和本文；
- 测试：产品包测试、启动器测试、配置迁移测试。

### 3.8 可选内置 Computer Use

`packages/pispider/vendor/pi-computer-use/` 内置上游
[`injaneity/pi-computer-use`](https://github.com/injaneity/pi-computer-use) 0.5.1 的扩展源码、
预编译 helper 和安装脚本，MIT 许可，来源与版权见
`packages/pispider/THIRD_PARTY_NOTICES.md`。启用和平台细节见
[computer-use.md](computer-use.md)。

它不是 npm 依赖，也不进入 `packages/pispider/package.json` 的 `dependencies`：

- 上游 `postinstall` 会写 `~/.pi`，与 PiSpider 的隔离目标冲突，已从 vendored `package.json` 移除；
- 上游 peerDependencies 可能让 npm 重装一套 Pi 包，PiSpider 通过 Pi 的 `-e` 加载，不需要这些依赖；
- 预编译 helper 来自 npm tarball，当前 Windows 环境没有 Rust/Cargo，不能走源码构建。

加载方式：

```text
默认：不加参数，只加载 packages/pispider/src/index.js
开启：PISPIDER_COMPUTER_USE=1
      pi -e packages/pispider -e packages/pispider/vendor/pi-computer-use/extensions/computer-use.ts
```

启动器负责第二个 `-e`，并设置：

| 环境变量 | 值 |
| --- | --- |
| `PI_COMPUTER_USE_WINDOWS_HELPER_PATH` | `$PISPIDER_HOME/agent/helpers/pi-computer-use/windows-bridge.exe` |
| `PI_COMPUTER_USE_LINUX_HELPER_PATH` | `$PISPIDER_HOME/agent/helpers/pi-computer-use/linux-bridge` |

vendored helper 的默认目录也改为优先读取 `PI_CODING_AGENT_DIR`，避免直接加载扩展时回落到
`~/.pi`。扩展自带配置仍使用 Pi 的 `getAgentDir()`，因此落在
`$PISPIDER_HOME/agent/extensions/pi-computer-use.json`。

## 4. 文件改动地图

| 路径 | 归属 | 说明 |
| --- | --- | --- |
| `packages/coding-agent/` | 上游 Pi | 不改产品行为 |
| `packages/pispider/` | PiSpider | 扩展入口、提示、规则、Skill、任务、命令 |
| `packages/pispider/vendor/pi-computer-use/` | 第三方内置 | 可选 Computer Use 扩展与预编译 helper，MIT |
| `scripts/run-pispider.mjs` | PiSpider | 启动器，注入隔离环境 |
| `scripts/pispider-launcher.mjs` | PiSpider | CLI/缓存/安装计划解析，按需追加 Computer Use 扩展 |
| `scripts/pispider-doctor.mjs` | PiSpider | 环境、路径、隔离和可选扩展检查 |
| `scripts/pispider-migrate.mjs` | PiSpider | 导入 Pi 用户配置 |
| `run.ps1` / `run.cmd` / `run.sh` | PiSpider | 平台入口 |
| `docs/` | PiSpider | 产品文档 |
| `package.json` | 混合 | 保留 Pi 脚本，加入 PiSpider 脚本 |
| `PI_README.md` | 上游 Pi | 原始 Pi README 存档 |

## 5. 上游 Pi 升级流程

### 5.1 先确定升级目标

在 `scripts/pispider-launcher.mjs` 中固定：

```js
export const CORE_VERSION = "1.5.2";
export const CORE_SPEC = `@earendil-works/pi-coding-agent@${CORE_VERSION}`;
```

升级时只改这两个常量，然后刷新锁文件和缓存。不要在运行时从 `latest` 动态取版本。

### 5.2 同步上游源码

1. 取得目标版本的 Pi monorepo 或 npm 包；
2. 对比 `packages/coding-agent`、`packages/agent`、`packages/ai`、`packages/tui` 的变更；
3. 保留 PiSpider 新增文件：`packages/pispider`、`scripts/pispider-*`、`docs/`、根启动脚本；
4. 重新生成本仓库的 `package.json` / `package-lock.json` 差异，不要覆盖产品脚本；
5. 不把上游的 `README.md` 覆盖产品 `README.md`，上游 README 继续放 `PI_README.md`；
6. 升级 `pi-computer-use` 时重新取 npm tarball 的 `extensions/`、`src/`、`scripts/setup-helper.mjs`、`prebuilt/`、`native/`，更新 `VENDORED.md`，再按原规则移除 `postinstall`、保留 `PI_CODING_AGENT_DIR` 默认路径。

如果使用 Git 同步，建议把产品文件放在独立提交中，升级提交只包含上游包和锁文件，便于回滚。

### 5.3 升级后必须检查的 Pi 契约

| 契约 | 检查位置 | 关注点 |
| --- | --- | --- |
| 扩展 manifest | `packages/coding-agent` 的 package schema | `pi.extensions` 是否仍接受 `./src/index.js` |
| `before_agent_start` | `packages/coding-agent/src` 事件定义 | `systemPromptOptions.sections`、`promptGuidelines` 是否保留 |
| `resources_discover` | 扩展 API | 返回 `skillPaths` 是否仍有效 |
| 命令 API | `pi.registerCommand` | 命令 handler 参数和 UI 方法是否变化 |
| 工具 API | `pi.registerTool` | `details`、`execute` 参数和分支上下文是否变化 |
| 会话分支 | `ctx.sessionManager.getBranch()` | task state 重建依赖的结构是否变化 |
| fork/rewind | `ctx.sessionManager` / Pi fork | `/ps rewind` 依赖的分支 API 是否变化 |
| 全局目录 | `PI_CODING_AGENT_DIR`、`PI_CODING_AGENT_SESSION_DIR` | 环境变量名或优先级是否变化 |
| 配置文件 | `~/.pi/agent/*` | auth、settings、models、mcp、keybindings 布局是否变化 |
| 项目资源 | `<cwd>/.pi` | 项目 trust 和资源发现是否变化 |
| Computer Use 扩展 | `packages/pispider/vendor/pi-computer-use/` | 上游版本、扩展 API、helper 协议、`getAgentDir()` 行为是否变化 |
| 工具名/命令名 | Pi 保留名 | `ps_task`、`/ps`、`computer-use` 是否与新增内置命令冲突 |
| RPC 命令 | `packages/coding-agent/src/modes/rpc/rpc-types.ts` | 桌面使用的 `prompt`、`switch_session`、`fork`、`get_tree`、`get_commands` 等字段是否变化 |
| RPC 事件 | `rpc-mode.ts` / `agent-session.ts` 事件定义 | `session_start`、`message_*`、`tool_execution_*`、`queue_update`、`extension_ui_request` 是否新增或改名 |
| 扩展命令 | `packages/coding-agent/src/extensions/*` | `/mcp login|logout|reconnect`、`/ps label`、`/ps task reset` 的参数与 RPC 可用性是否变化 |
| 桌面 IPC 契约 | `apps/pispider-desktop/preload.cjs` | 新增 IPC 是否只调用 RPC 或已登记的本地服务；禁止新增未归属的文件写入 |

### 5.4 升级后执行

```bash
npm install --ignore-scripts
npm run build
npm run pispider:check
npm run pispider:test
node --test scripts/pispider-launcher.test.mjs scripts/pispider-migrate.test.mjs
npm run pispider:doctor
npm run pispider -- --help
```

如果只想用已发布 Pi，不构建本地源码：

```bash
npm run pispider:doctor
npm run pispider -- --version
```

首次运行会按 `CORE_SPEC` 安装到 `$PISPIDER_HOME/runtime/core-<version>/`；旧缓存不会被自动删除，可手动清理。

### 5.5 兼容性判定

- 通过：扩展加载、`/ps status`、`ps_task`、规则/Skill、rewind、提示 section 注入、数据目录隔离全部正常。
- 需要适配：Pi 改了事件签名、系统提示 section 结构、命令/工具 API、agent dir 环境变量或配置文件布局。
- 不可直接合并：Pi 把产品层需要的扩展能力移除，或上游改变了包名/入口路径。此时先调整启动器和扩展 manifest，再升级缓存版本。

## 6. 明确没有改动的部分

PiSpider 没有：

- 修改 Pi 的安全策略或删除 Pi 的系统约束；
- 隐藏提示、隐藏规则或秘密执行通道；
- 宿主二进制补丁、Workspace 基线移除、越狱或红队模块；
- 复制 Pi 会话到产品层；
- 在 `~/.pi` 下写入 PiSpider 数据；
- 把 `pi-computer-use` 写成 npm 依赖，或恢复其上游 `postinstall`；
- 要求用户先安装 MCP 或某个 Skill 才能获得基础逆向提示。

## 7. 升级记录模板

每次升级 Pi 时，在 `PRODUCT_PLAN.md` 增加一条记录：

```text
Pi 基线：1.5.2 -> x.y.z
缓存目录：runtime/core-x.y.z
扩展契约变化：无 / 具体变化
适配改动：文件与原因
验证结果：测试数量、冒烟结果、未验证平台
```
