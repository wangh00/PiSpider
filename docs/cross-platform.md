# 跨平台说明

## 1. 支持矩阵

| 平台 | 启动方式 | 状态 |
| --- | --- | --- |
| Windows PowerShell | `.\run.ps1` 或 `npm run pispider` | 已实际验证 |
| Windows cmd | `run.cmd` 或 `npm run pispider` | 已实际验证 |
| Windows Git Bash | `bash ./run.sh` | 未验证：本机只有 WSL 占位程序，WSL 未安装 |
| macOS | `bash ./run.sh` 或 `npm run pispider` | 逻辑与路径已覆盖，未在真实 macOS 上执行 |
| Linux | `bash ./run.sh` 或 `npm run pispider` | 逻辑与路径已覆盖，未在真实 Linux 上执行 |

跨平台共同要求：Node.js >= 22.19.0，npm 可用。

桌面客户端同样跨平台，入口是 `npm run pispider:desktop`。Windows 使用 Electron 的 `titleBarOverlay` 放置原生窗口按钮；macOS 使用 `hiddenInset`；Linux 回退到普通窗口装饰。桌面主进程会优先用 `PISPIDER_NODE` 或 `npm_node_execpath` 找到系统 Node，再启动 `scripts/run-pispider.mjs --mode rpc`。

## 2. 启动器如何选择 Pi

`scripts/run-pispider.mjs` 使用 Node 原生命令和参数数组，不依赖 PowerShell、cmd 或 shell 拼接：

1. `PISPIDER_CORE_CLI` 环境变量；
2. `packages/coding-agent/dist/bundle/cli.js`；
3. `$PISPIDER_HOME/runtime/core-1.5.2/` 缓存；
4. 缺失时在缓存目录执行 npm 安装。

启动子进程时，`PI_CODING_AGENT_DIR` 和 `PI_CODING_AGENT_SESSION_DIR` 会被指向 PiSpider 的目录，保证与独立安装的 Pi 隔离。

这样做避免在 monorepo 根直接 `npx` 时解析到尚未构建的本地同名 workspace 包。

## 3. 数据目录

默认：

- Windows：`%USERPROFILE%\.pispider`
- macOS / Linux：`$HOME/.pispider`

可用环境变量覆盖：

```powershell
$env:PISPIDER_HOME = "E:\data\pispider"
```

```bash
export PISPIDER_HOME="$HOME/data/pispider"
```

默认目录结构：

```text
$PISPIDER_HOME/
  config.json
  prompts/ rules/ skills/ backups/ state/
  agent/              # 与 ~/.pi 隔离的 Pi 配置、认证和会话
    helpers/pi-computer-use/ # 可选 Computer Use 的本地 helper
  runtime/core-1.5.2/
```

如果本机有既有 Pi 配置，可用：

```bash
npm run pispider:migrate -- --dry-run
npm run pispider:migrate
```

跨平台路径都由 Node `path` 拼接，迁移脚本在 Windows 和 POSIX 上使用同一套逻辑。

## 4. 相关环境变量

| 变量 | 作用 |
| --- | --- |
| `PISPIDER_HOME` | 规则、Skill、提示、任务数据和 Pi agent 目录的根 |
| `PISPIDER_AGENT_DIR` | 覆盖 Pi 的配置、认证、模型和全局资源目录，默认 `$PISPIDER_HOME/agent` |
| `PISPIDER_SESSION_DIR` | 覆盖会话目录，默认 `$PISPIDER_HOME/agent/sessions` |
| `PISPIDER_CORE_CACHE` | 覆盖 Pi 运行时的缓存目录 |
| `PISPIDER_CORE_SPEC` | 覆盖默认安装的 Pi npm 包版本；自定义值使用独立缓存目录 |
| `PISPIDER_CORE_CLI` | 指向一个 Pi CLI 文件，优先于本地构建和缓存 |
| `PISPIDER_COMPUTER_USE` | 设为 `1`/`true` 时加载内置 Computer Use 扩展；默认关闭 |
| `PI_COMPUTER_USE_WINDOWS_HELPER_PATH` | Windows helper 路径；启动器默认指向 `$PISPIDER_HOME/agent/helpers/pi-computer-use/windows-bridge.exe` |
| `PI_COMPUTER_USE_LINUX_HELPER_PATH` | Linux helper 路径；启动器默认指向 `$PISPIDER_HOME/agent/helpers/pi-computer-use/linux-bridge` |

`PI_CODING_AGENT_DIR`、`PI_CODING_AGENT_SESSION_DIR` 是 Pi 上游变量，由启动器内部设置；用户不需要把它们指向 `~/.pi`。

## 5. 路径与脚本

- 仓库内路径使用 Node `path` 拼接，不写死分隔符；
- `run.sh`、`test.sh`、`pi-test.sh` 使用 LF；
- `run.cmd`、`*.bat` 使用 CRLF，`.gitattributes` 已固定；
- 路径包含空格时，Node 启动器仍以参数数组传递；
- 在 macOS/Linux 上可执行权限未随 Windows 工作区保留，建议用 `bash ./run.sh` 或先 `chmod +x run.sh`。

## 6. Windows 特有限制

- 当前 Windows 权限无法创建符号链接，因此“拒绝符号链接”的测试用例被跳过；代码中的 `lstat` 检查和拒绝逻辑仍存在；
- 如果 `pispider` 目录被后台进程作为工作目录占用，Windows 可能拒绝移动或删除该目录；这不影响正常运行，但开发时应避免从包目录启动常驻进程；
- 首次缓存安装需要访问 npm registry；之后启动不重复安装。

## 7. 本地 Pi 构建

只有需要修改或调试 Pi 核心时才需要：

```bash
npm install --ignore-scripts
npm run build
```

Pi 的 TUI 原生模块按平台构建，可选命令：

```bash
npm run build:native:win32
npm run build:native:darwin
npm run build:native:linux
```

构建产物在 `packages/coding-agent/dist/`，已被 `.gitignore` 忽略。

## 8. Computer Use 平台差异

内置 `pi-computer-use` 默认关闭，开启方式：

```powershell
$env:PISPIDER_COMPUTER_USE = "1"
npm run pispider
```

- Windows：使用内置的 `prebuilt/windows/windows-bridge.exe`，协议版本 4；依赖 UI Automation 和 GDI 截屏。首次使用复制到 `$PISPIDER_HOME/agent/helpers/pi-computer-use/`。
- Linux：使用 `prebuilt/linux/{x64,arm64}/linux-bridge`，依赖 AT-SPI2；X11 支持窗口捕获和 XTEST，Wayland 能力有限。
- macOS：使用 `prebuilt/macos/universal/pi-computer-use.app`，需要 Accessibility 和 Screen Recording 权限；首次使用可能触发系统授权。
- 当前 Windows 环境没有 Rust/Cargo，不能从源码重建 helper，必须使用内置预编译文件。macOS/Linux 实机仍需补验。
