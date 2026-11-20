# 内置 Computer Use

PiSpider 内置了上游 [`injacency/pi-computer-use`](https://github.com/injaneity/pi-computer-use)
0.5.1 的运行文件，位置是 `packages/pispider/vendor/pi-computer-use/`。它默认不加载，也不作为
npm 依赖安装。

## 为什么内置

上游包有三个问题不适合直接作为 PiSpider 的固定依赖：

- `postinstall` 默认把 helper 安装到 `~/.pi/agent`，会破坏 PiSpider 与 Pi 的目录隔离；
- `peerDependencies` 可能让 npm 重装一套 Pi 相关包；
- 当前 Windows 环境没有 Rust/Cargo，必须使用 npm tarball 里的预编译 helper，不能依赖源码构建。

因此 PiSpider 复制了运行所需的扩展源码、安装脚本、`prebuilt/` 和 `native/`，并移除了
`postinstall`。完整来源与本地改动见
[`vendor/pi-computer-use/VENDORED.md`](../packages/pispider/vendor/pi-computer-use/VENDORED.md)。

## 开启

默认关闭。开启后启动器会追加第二个 `-e`：

```text
-e packages/pispider/vendor/pi-computer-use/extensions/computer-use.ts
```

Windows PowerShell：

```powershell
$env:PISPIDER_COMPUTER_USE = "1"
npm run pispider
```

Windows cmd：

```bat
set PISPIDER_COMPUTER_USE=1 && npm run pispider
```

macOS / Linux：

```bash
PISPIDER_COMPUTER_USE=1 npm run pispider
```

关闭时不要设置该变量，或设置为 `0` / `false`。

## 提供的能力

开启后注册 11 个工具：

- `find_roots`
- `observe_ui`
- `search_ui`
- `expand_ui`
- `inspect_ui`
- `act_ui`
- `read_text`
- `wait_for`
- `launch_browser`
- `navigate_browser`
- `evaluate_browser`

同时注册 `/computer-use` 命令，用于查看当前配置来源。

这些工具会读取桌面 UI、截屏、移动鼠标或发送键盘输入，属于真实系统操作。PiSpider 不会因为
开启扩展就绕过 Pi 的安全约束；具体动作仍应来自用户明确授权的任务。

## 数据路径

```text
$PISPIDER_HOME/
  agent/
    extensions/pi-computer-use.json   # 全局扩展配置
    helpers/pi-computer-use/
      windows-bridge.exe             # Windows，首次使用安装
      linux-bridge                   # Linux，首次使用安装
```

项目级配置仍是当前工作目录的 `.pi/computer-use.json`。PiSpider 启动器设置：

| 变量 | 默认值 |
| --- | --- |
| `PI_COMPUTER_USE_WINDOWS_HELPER_PATH` | `$PISPIDER_HOME/agent/helpers/pi-computer-use/windows-bridge.exe` |
| `PI_COMPUTER_USE_LINUX_HELPER_PATH` | `$PISPIDER_HOME/agent/helpers/pi-computer-use/linux-bridge` |

vendored helper 的默认目录也优先读取 `PI_CODING_AGENT_DIR`，所以即使直接加载扩展，也不会
回落到 `~/.pi`。用户显式设置上述 helper 路径时，启动器保留用户值。

## 平台

| 平台 | helper | 依赖 | 状态 |
| --- | --- | --- | --- |
| Windows x64 | `prebuilt/windows/windows-bridge.exe` | UI Automation、GDI 截屏、SendInput | 已验证 diagnostics 和 listRoots |
| Linux x64 / arm64 | `prebuilt/linux/{x64,arm64}/linux-bridge` | AT-SPI2；X11 支持窗口捕获和 XTEST | 未实机验证；Wayland 能力有限 |
| macOS x64 / arm64 | `prebuilt/macos/universal/pi-computer-use.app` | Accessibility、ScreenCaptureKit、Vision OCR | 未实机验证；首次使用需授权 |

Windows helper 协议版本为 4，使用本地 JSON-lines 子进程，不监听网络端口。

## 验证

```bash
npm run pispider:doctor
PISPIDER_COMPUTER_USE=1 npm run pispider:doctor
PISPIDER_COMPUTER_USE=1 npm run pispider -- --version
```

开启后 doctor 应显示：

```text
[OK] Computer Use extension: ...\vendor\pi-computer-use\extensions\computer-use.ts
[OK] Core launcher: cached core 1.5.2 + computer-use
[OK] Computer Use helper: ...\helpers\pi-computer-use\windows-bridge.exe (installed)
```

如果 helper 尚未安装，doctor 只给出 WARN；首次交互会话会通过
`scripts/setup-helper.mjs --runtime` 安装。也可以手动安装：

```powershell
$env:PI_CODING_AGENT_DIR = "$env:USERPROFILE\.pispider\agent"
node packages/pispider/vendor/pi-computer-use/scripts/setup-helper.mjs --runtime
```

## 当前验证结果

- 两个 `-e` 入口同时加载：Pi RPC 命令列表同时出现 `ps` 和 `computer-use`；
- Windows helper 安装到 `$PISPIDER_HOME/agent/helpers/pi-computer-use/windows-bridge.exe`；
- `~/.pi\agent\helpers\pi-computer-use` 不存在；
- helper `diagnostics` 返回 `accessibility: true`、`screenRecording: true`、`protocolVersion: 4`；
- `listRoots` 能枚举桌面窗口；
- 尚未完成 `observe_ui` → `act_ui` 的端到端交互验收。

## 升级上游

1. 从 npm tarball 取新版 `extensions/`、`src/`、`scripts/setup-helper.mjs`、`prebuilt/`、`native/`；
2. 更新 `vendor/pi-computer-use/package.json`，保留 `private: true`，不要恢复 `postinstall`；
3. 重新应用 `PI_CODING_AGENT_DIR` 优先的 helper 默认路径改动；
4. 更新 `VENDORED.md`、`THIRD_PARTY_NOTICES.md` 和本文件；
5. 跑 `npm run pispider:check`、`npm run pispider:test`、启动器测试和 doctor + RPC 冒烟。

## 故障排查

- `Computer Use extension` FAIL：检查 `packages/pispider/vendor/pi-computer-use/extensions/computer-use.ts` 是否存在。
- `Core launcher` 显示 `+ computer-use` 但工具未出现：确认启动器确实传入了第二个 `-e`，并查看 Pi 启动错误。
- helper WARN：运行一次交互会话，或手动执行上面的 setup 命令。
- `Cannot update helper ... still running`：关闭占用 helper 的 Pi 会话后重试。
- macOS 无法观察窗口：检查系统设置中的 Accessibility 和 Screen Recording 权限。
