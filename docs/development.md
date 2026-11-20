# 开发指南

当前桌面端状态和下一步先看 [desktop-status.md](desktop-status.md)；本页只保留环境、启动、开发和测试流程。

## 1. 环境要求

- Node.js >= 22.19.0
- npm（随 Node 安装）
- 支持 Windows、macOS、Linux
- 当前产品层不需要编译，不需要安装 `packages/pispider` 的运行时依赖

检查环境：

```bash
npm run pispider:doctor
```

输出会检查 Node 版本、平台、扩展包、Pi 启动路径、数据目录、agent 目录和 Pi 数据隔离。

## 2. 第一次启动

在仓库根目录执行：

```bash
npm run pispider
```

首次运行如果没有本地 Pi 构建，会把 `@earendil-works/pi-coding-agent@1.5.2` 安装到：

```text
$PISPIDER_HOME/runtime/core-1.5.2/
```

随后启动 Pi，并加载 `packages/pispider`。进入 PiSpider 后：

```text
/ps status
/ps help
```

如果本机已有 Pi 用户配置，可以在第一次启动前显式导入：

```bash
npm run pispider:migrate -- --dry-run
npm run pispider:migrate
```

默认只导入认证、模型、MCP、设置和用户指令文件；`--include-resources` 额外导入主题、提示模板和 Skill，`--include-extensions` 额外导入扩展代码。虽然可以运行 `npm run pispider:setup` 一次完成导入和 doctor，但导入凭据始终是显式命令，不会在启动时静默发生。

也可以使用平台包装脚本：

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

### 桌面客户端

桌面端是可选的 Electron 外壳，启动命令：

```bash
npm run pispider:desktop
```

首次需要安装应用目录内的 Electron：

```bash
cd apps/pispider-desktop
npm install --ignore-scripts --no-audit --no-fund --no-package-lock --workspaces=false
node node_modules/electron/install.js
```

调试时可以在应用目录直接启动带 CDP 端口的实例：

```powershell
.\node_modules\electron\dist\electron.exe . --remote-debugging-port=9347
```

仓库内的 `scripts/pispider-desktop-debug.mjs` 提供固定调试命令，不暴露任意 eval：

```powershell
node scripts/pispider-desktop-debug.mjs state
node scripts/pispider-desktop-debug.mjs switch-session <session.jsonl>
node scripts/pispider-desktop-debug.mjs inject-event '{"type":"debug_noop"}'
```

`send` 命令会走正常输入框并调用当前真实模型，可能产生推理费用；脚本只在带 CDP 端口的开发实例上工作，不进入正式打包产物。

打包产物启动：

- 便携版：直接运行 `apps/pispider-desktop/release/win-unpacked/PiSpider.exe`。
- 安装版：运行 `release/PiSpider Setup <version>.exe` 安装后，从开始菜单或桌面快捷方式启动。

桌面端有单实例锁：dev、便携版和安装版实例共享 `PISPIDER_HOME/agent` 下的会话、配置和 `desktop.json`，同一时间只应运行一个实例；第二次启动只会聚焦已有窗口，不另开进程。

Electron 的主进程会调用 `node scripts/run-pispider.mjs --mode rpc`，所以运行时仍然是同一套 PiSpider 和 `$PISPIDER_HOME`。开发模式不要用 Electron 的 `process.execPath` 去启动 Node 脚本；打包模式例外，见下方“打包（Windows）”。桌面端的 RPC 启动、IPC、窗口、MCP、代码页和直接 shell 都在 `main.cjs`；主窗口逻辑在 `renderer/app.js`，二次窗口在 `renderer/panel.js`。完整的界面、IPC、当前限制和下一步见 [apps/pispider-desktop/README.md](../apps/pispider-desktop/README.md) 与 [desktop-status.md](desktop-status.md)。

## 打包（Windows）

桌面端 Windows 安装包由 electron-builder 26.18.0 构建，目标为 NSIS（非 oneClick、perMachine=false）。

```powershell
cd apps/pispider-desktop
npm run dist:win
```

`dist:win` 先跑 `prepare:packaged` 幂等重建 `build/packaged/` staging（launcher closure + core runtime 缓存副本，自检通过才退出），再执行 `electron-builder --win`；staging 可随时由 `dist:win` 重新生成，无需手工保留。首次构建会把 nsis / winCodeSign 下载到 electron-builder 本地工具缓存，属正常工具缓存。

产物落在 `apps/pispider-desktop/release/`：

- `PiSpider Setup <version>.exe`：NSIS 安装包；
- `win-unpacked/`：解包后的可运行目录，`PiSpider.exe` 为入口。

随包 `resources/` 布局：

```text
resources/
  app.asar                         # 桌面 main / preload / renderer / 共享 helper
  app.asar.unpacked/
    oauth-bridge.mjs               # 桥接脚本不进 asar，供子进程直接读取
  launcher/
    scripts/run-pispider.mjs
    scripts/pispider-launcher.mjs
    packages/pispider/             # PiSpider 扩展 closure（src / resources / vendor）
  runtime/
    core-1.5.2/                    # 完整 core 缓存副本（node_modules + npmrc）
```

运行时方案（打包分支）：

- 三处 Agent 子进程 spawn 都用 `process.execPath`（随包 `PiSpider.exe`）加 `ELECTRON_RUN_AS_NODE=1` 复用 Electron 二进制作为 Node，不依赖系统 Node；`PISPIDER_CORE_CACHE` 在进程级早设，指向 `resources/runtime/core-1.5.2`。
- launcher 据此解析为 runtime 模式（`cached core 1.5.2`），直接加载随包 core CLI；只有随包缓存缺失时才回退 install 计划。冒烟在只含 Windows 系统目录的最小 PATH（无 node/npm）下验证 RPC ready，即证明未回退系统 Node。
- 版本化子目录是必要布局：electron-builder 默认排除 extraResources 源目录根级的 `node_modules`，随包依赖必须放在 `core-<version>/` 这类子目录下。

MCP 与离线降级：

- stdio 预置 MCP 懒安装到 `~/.pispider/agent/mcp-packages/<catalog-id>`；本机读不到 npm CLI 时，目录与命令列表走可读的中文降级提示，不报错崩溃。
- 打包实例与 dev 实例共享 `PISPIDER_HOME/agent` 下的会话与配置；Electron userData profile 按 productName 隔离，localStorage / 主题互不影响。

尚未做：可执行文件与安装包代码签名、electron-updater 自动更新、macOS / Linux 目标、portable 单文件目标。根与桌面 `package.json` 已补 `author`，electron-builder 不再给出缺失作者警告。升级随包 core 用 `npm run pispider:core-version -- <x.y.z>` 同步三处 `CORE_VERSION`，根 `npm run check` 与 `npm run pispider:check` 会校验一致性。

## 3. 使用本仓库构建的 Pi

如果要从当前源码构建 Pi 并优先使用本地版本：

```bash
npm install --ignore-scripts
npm run build
npm run pispider
```

构建完成后 `packages/coding-agent/dist/bundle/cli.js` 存在，启动器会优先使用它，而不是缓存版。

只想检查产品层，不需要构建整个 Pi：

```bash
npm run pispider:check
npm run pispider:test
```

## 4. 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run pispider` | 启动 PiSpider |
| `npm run pispider -- --version` | 用同一启动链路执行 Pi 参数 |
| `npm run pispider:doctor` | 检查运行环境与 Pi 数据隔离 |
| `npm run pispider:desktop` | 启动 Codex 风格的 Electron 桌面壳 |
| `npm run pispider:migrate` | 导入既有 Pi 用户配置 |
| `npm run pispider:setup` | 导入配置并运行 doctor |
| `npm run pispider:check` | 检查 PiSpider 源文件语法 |
| `npm run pispider:test` | 运行扩展包测试 |
| `node --test scripts/pispider-launcher.test.mjs scripts/pispider-migrate.test.mjs` | 运行启动器与迁移测试 |
| `npm run build` | 构建全部 Pi workspace |
| `npm run test:scripts` | 运行 Pi 根目录脚本测试（包含 PiSpider 脚本测试） |

## 5. 修改提示

默认提示文件：

```text
packages/pispider/resources/prompts/
  core.md
  workflow.md
  js.md
  app.md
```

这些文件是包内默认值。用户目录中已有的同名文件不会被覆盖。修改包内默认值只影响新用户或执行 `/ps prompt reset` 后的结果。

开发时可以：

```text
/ps prompt show
/ps prompt files
/ps prompt reset
```

## 6. 修改命令与工具

入口：

- `packages/pispider/src/index.js`：注册事件、`/ps` 和 `ps_task`；
- `src/commands.js`：`/ps` 子命令；
- `src/tool.js`：`ps_task` 定义与参数；
- `src/prompts.js`：提示组合；
- `src/rules.js`、`src/skills.js`：数据管理。

Pi 工具参数使用普通 JSON Schema，不引入 TypeBox。新增工具时保持参数 schema、可见错误信息和备份行为一致。

## 7. 添加规则与 Skill

规则：

```text
/ps rules create my-rule "My Rule"
/ps rules edit my-rule
/ps rules use my-rule
```

Skill：

```text
/ps skills create my-skill "description"
/ps skills import D:\path\to\skill
/ps skills list
/ps reload
```

Skill 源目录必须包含 `SKILL.md`，其中 `name` 必须与目录名一致。

## 8. 测试

产品层测试不依赖构建产物：

```bash
npm run pispider:check
npm run pispider:test
node --test scripts/pispider-launcher.test.mjs scripts/pispider-migrate.test.mjs
```

桌面端没有完整的 UI 自动化测试，改主进程或 renderer 后需要实际启动 Electron 验证：主窗口、输入框发送 / 停止、模型 / 权限弹层、二次窗口、右栏浏览器和代码页。直接 shell 需要覆盖成功、非零退出码、中文输出和停止命令。

当前测试覆盖：

- Prompt 追加与 Pi 原始 section 保留；
- Domain 推断；
- 规则生命周期、备份与路径校验；
- Skill 导入、替换、失败恢复与路径安全；
- TaskState 分支重建与 reset；
- rewind 目标选择；
- 启动器的本地构建、缓存运行时、环境覆盖和安装计划；
- 可选 Computer Use 的第二个 `-e`、内置扩展存在性与缺失报错；
- Computer Use helper 路径落在 `$PISPIDER_HOME/agent/helpers`，显式路径可覆盖；
- Pi 数据目录隔离与 agent/session 路径覆盖；
- Pi 用户配置迁移、路径改写、dry-run 和不覆盖行为；
- 扩展包 manifest 与仓库边界。

## 9. 代码与提交约定

- 产品层主代码保持纯 JavaScript，不引入运行时依赖；Computer Use 是内置的第三方 TypeScript 扩展，随包提供预编译 helper，不作为 npm 依赖安装；
- 不通过修改 `packages/coding-agent` 实现产品功能；
- 新能力优先通过 Pi 公开 API；
- 对用户可见的状态、提示、规则和错误必须可审计；
- 不在代码中写入隐藏提示或秘密执行通道；
- 仓库根 `AGENTS.md` 的上游 Pi 规则继续适用于 Pi 包。
