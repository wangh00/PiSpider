# PiSpider 桌面端开发状态（唯一入口）

更新时间：2026-11-20

本文是没有对话上下文的新会话接手本仓库的唯一入口：现状快照、接手指引、后续路线图、刻意不做清单。逐项能力四态对照见 [desktop-parity.md](desktop-parity.md)，验证记录见 [acceptance.md](acceptance.md)。

## a. 现状快照（截至 2026-11-20）

### 已落地能力

| 批次 | 内容 | 细节指针 |
| --- | --- | --- |
| 内置斜杠命令 | 24 个内置命令在发送前于桌面层本地拦截执行，支持带参形式与来源徽标；扩展 / 模板 / 技能命令数据来自 RPC `get_commands`，仍走 prompt 执行 | [commands.md](commands.md)「桌面内置斜杠命令」；[desktop-parity.md](desktop-parity.md) §5.1 |
| 黑白灰阶 UI | 亮 / 暗双主题；1px hairline 边框（亮 `rgba(0,0,0,0.06)`、暗 `rgba(255,255,255,0.08)`）；炭黑 / 雪白主按钮；辅助信息 11px、opacity 0.45；主窗口与二次窗口共用 `renderer/tokens.css` | [desktop-ui.md](desktop-ui.md) §4.2；截图目录 `docs/ui-refresh-2026-11-19/`（21 张，dark 11 / light 10） |
| Windows 打包 | electron-builder 26.18.0 精确锁版；NSIS 安装包 `PiSpider Setup 0.1.0.exe` 与 `win-unpacked/` 便携版；随包 launcher + core 1.5.2 runtime；三处 Agent 子进程 spawn 用 Electron 二进制 + `ELECTRON_RUN_AS_NODE=1`；最小 PATH（无系统 Node）冒烟 RPC ready；stdio MCP 读不到 npm CLI 时走中文降级 | [development.md](development.md)「打包（Windows）」 |
| 正确性补口 | 用户 / 助手 / 工具结果图片消息统一渲染；消息高度缓存版本 5 带内容指纹，正文变更即失效；独立“恢复会话”导航（`/resume` / `Ctrl+Shift+K`） | [desktop-ui.md](desktop-ui.md) §5；[acceptance.md](acceptance.md) §9 |
| 逐模型思考默认 | 模型弹层为当前模型选择启动默认档位，写入 `settings.json.modelThinkingLevels`；保存后重启 Agent 并同步当前会话，可清除回“跟随全局” | [desktop-parity.md](desktop-parity.md) §1；[acceptance.md](acceptance.md) §10 |
| 会话手动排序 | 侧栏“排序任务”模式：置顶 / 最近分组，拖动 ≡ 或 `Alt+↑/↓` 调整，展示序写入 `desktop.json.sessionOrder`，普通视图按该序展示，支持恢复默认 | [desktop-ui.md](desktop-ui.md) §5；[acceptance.md](acceptance.md) §11 |
| 高级 settings | 设置窗口“高级设置”卡：transport、HTTP proxy、shell path、defaultTools（纯名称 / `+` / `-`）、compaction 开关与 token 参数；写用户级 `settings.json`，保存后重启 Agent，逐模型压缩覆盖保留 | [desktop-parity.md](desktop-parity.md) §6；[acceptance.md](acceptance.md) §12 |
| doctor 日志导出 | 状态窗口“导出诊断”生成脱敏文本报告：应用 / 运行时信息、环境诊断、最近 400 条运行时日志（agent stderr、runtime 状态与退出事件）；移除认证原始输出并屏蔽常见密钥形态 | [desktop-parity.md](desktop-parity.md) §6；[acceptance.md](acceptance.md) §13 |
| core 版本同步 | `scripts/pispider-version.mjs --check` 校验 launcher / packaged stager / desktop CORE_VERSION 三处一致；`npm run pispider:core-version -- <x.y.z>` 一次更新三处；根 `npm run check` 与 `pispider:check` 已接入；根 / 桌面 `package.json` 补 `author` | [desktop-parity.md](desktop-parity.md) §7；[acceptance.md](acceptance.md) §14 |
| 打包版 MCP npm | 构建时随包 npm 10.9.8 + 依赖与许可证；打包版安装优先由 `PiSpider.exe`（`ELECTRON_RUN_AS_NODE=1`）执行 `resources/npm/bin/npm-cli.js`，其次系统 PATH npm，均缺失时中文降级；`chrome-devtools-mcp` 可在无 Node/npm 的 PATH 下安装并连接 | [desktop-parity.md](desktop-parity.md) §7；[acceptance.md](acceptance.md) §15 |

其余已落地能力（会话控制、模型 / 思考档位 / 会话权限、规则 / 技能 / 提示词 / MCP / 扩展管理、浏览器与代码页、上下文用量、provider OAuth 三家等）的逐项对照见 [desktop-parity.md](desktop-parity.md) §1–§6；UI 已落地清单见 [desktop-ui.md](desktop-ui.md) §5。

### 版本基线

| 项 | 基线 | 备注 |
| --- | --- | --- |
| Electron | 45.3.2 | `apps/pispider-desktop/package.json` devDependencies 精确锁版 |
| electron-builder | 26.18.0 | 同上 |
| Mermaid 裁剪运行时 | 12.3.0 | `vendor/mermaid`，仅保留 flowchart / sequence |
| Pi core | 1.5.2 | CORE_VERSION 三处：`scripts/pispider-launcher.mjs`、`apps/pispider-desktop/scripts/prepare-packaged-runtime.mjs`、`apps/pispider-desktop/packaged-runtime.cjs`；由 `npm run check:core-version` 校验一致 |
| 本机 Node / npm | Node v22.23.2 / npm 10.9.8（本机实测） | engines 要求 `>=22.19.0`，满足；打包实例不依赖系统 Node |
| 桌面测试 | 43/43 通过 | `apps/pispider-desktop` node 测试，最近记录 2026-11-20 |
| 扩展包测试 | 45 tests / 44 pass / 1 skipped / 0 fail | `pispider:test`，最近记录 2026-11-20 |

### 产物与 staging

- 安装包与便携版位于 `apps/pispider-desktop/release/`：`PiSpider Setup 0.1.0.exe`（152,994,543 字节）、`win-unpacked/PiSpider.exe`（250,056,704 字节）；应用图标 `apps/pispider-desktop/build/icon.ico`（六尺寸）。
- 打包 staging `apps/pispider-desktop/build/packaged/` 已清理；执行 `cd apps/pispider-desktop; npm run dist:win` 会经 `prepare:packaged` 幂等重建后再出包。
- 仓库已完成版本控制：`main` 分支初始化并推送到 `https://github.com/wangh00/PiSpider`（2026-11-20）；`release/`、`node_modules`、`dist/` 等仍在 `.gitignore` 内，不进入仓库。

## b. 新会话接手指引

### 阅读顺序

1. `AGENTS.md` — 仓库边界、代码质量、命令、依赖与 Git 硬规则。
2. 本文（`docs/desktop-status.md`）。
3. [desktop-parity.md](desktop-parity.md) — 桌面端与 CLI / runtime 逐项能力四态对照。
4. [development.md](development.md) — 环境准备、启动、打包、测试流程。
5. [desktop-ui.md](desktop-ui.md) — UI 信息架构、视觉基线与性能方向。
6. [commands.md](commands.md) — `/ps` 命令、`ps_task`、数据目录与环境变量速查。
7. [acceptance.md](acceptance.md) — 验证记录；先读最新条目（§15 打包版 MCP npm 方案，2026-11-20；§14 CORE_VERSION 同步与 author，2026-11-20；§13 doctor 日志导出，2026-11-20；§12 高级 settings，2026-11-20；§11 会话手动排序，2026-11-20；§10 逐模型默认思考档位，2026-11-20；§9 正确性补口与版本控制，2026-11-20），历史条目不作为现状依据。

补充参考：[architecture.md](architecture.md)（分层与 RPC 链路）、[desktop-runtime-contract.md](desktop-runtime-contract.md)（RPC 契约）、[apps/pispider-desktop/README.md](../apps/pispider-desktop/README.md)（Electron 运行链路与 IPC）。

### 环境事实

- 本机 Windows；Shell 为 PowerShell 7，Bash 工具不可用，命令示例按 PowerShell 写法。
- 仓库路径：`E:\mygit\SpiderBuddy`。
- 产品数据目录：`%USERPROFILE%\.pispider`（`$PISPIDER_HOME`）；Pi 配置 / 认证 / 模型 / 会话在其 `agent/` 子目录，与 `~/.pi` 隔离。复用既有 Pi 配置必须显式执行 `npm run pispider:migrate`，启动时不会静默复制凭据。
- 启动器通过 `PI_CODING_AGENT_DIR` / `PI_CODING_AGENT_SESSION_DIR` 指向上述隔离目录；环境变量全表见 [commands.md](commands.md)「环境变量」。

### 启动矩阵

| 方式 | 命令 / 入口 | 说明 |
| --- | --- | --- |
| 开发模式（Electron） | 仓库根 `npm run pispider:desktop` | 映射 `npm run start --workspace=pispider-desktop`（`electron .`）；首次需按 development.md §2 安装应用目录内 Electron |
| 便携版 | `apps/pispider-desktop/release/win-unpacked/PiSpider.exe` | 解包目录，随包 launcher + core runtime；已做只读 CDP 冒烟 |
| 安装版 | `apps/pispider-desktop/release/PiSpider Setup 0.1.0.exe` 安装后启动 | NSIS 非 oneClick、可选安装目录；安装器本身尚未执行实测，仅冒烟过便携版 |
| CLI 对照 | 仓库根 `npm run pispider` | 非桌面入口，用于对照 CLI 行为 |

**单实例告诫**：CLI 与桌面共用同一份 `$PISPIDER_HOME` 配置与会话目录（含 `agent/desktop.json`），但不是同一进程；同一时间只应跑一个实例，避免并发写同一会话或配置文件造成覆盖。桌面第二实例启动会聚焦已有窗口。

### 检查与测试命令（五项）

最近一次记录见 acceptance.md §7（2026-11-20）；改动后应复跑：

| # | 命令 | 最近记录结果 |
| --- | --- | --- |
| 1 | 根目录 `npm run check` | exit 0 |
| 2 | 根目录 `npm run pispider:check` | exit 0 |
| 3 | 根目录 `npm run pispider:test` | 45 tests / 44 pass / 1 skipped / 0 fail |
| 4 | 根目录 `node --test scripts/pispider-launcher.test.mjs scripts/pispider-migrate.test.mjs` | 14/14 pass |
| 5 | `cd apps/pispider-desktop; npm test` | 43/43 pass |

桌面端没有完整 UI 自动化测试；改主进程或 renderer 后需实际启动 Electron 覆盖主窗口、输入框发送 / 停止、二次窗口与对应面板读写（[development.md](development.md) §8）。

### CDP 调试脚本

`scripts/pispider-desktop-debug.mjs` 是 dev-only 调试脚本，不进入打包产物；只暴露固定 renderer 操作，不提供任意 eval。

前置：在 `apps/pispider-desktop` 下以带 CDP 端口的实例启动：

```powershell
.\node_modules\electron\dist\electron.exe . --remote-debugging-port=9347
```

端口由环境变量 `PISPIDER_DEBUG_PORT` 覆盖，默认 9347；脚本从仓库根运行。根 npm 映射：`npm run pispider:desktop:debug` → `node scripts/pispider-desktop-debug.mjs`。

| 命令 | 作用 |
| --- | --- |
| `state` | 打印当前模型、思考档位、消息窗口和滚动状态 |
| `switch-session <session.jsonl>` | 切换到指定会话文件并打印结果状态 |
| `send <text>` | 把文本放入输入框并走正常 UI 路径发送；会调用当前真实模型，可能产生推理费用 |
| `inject-event <json>` | 向 renderer `handleEvent()` 喂一条 wire 级 Agent 事件 |
| `wait [timeout-ms]` | 等待 renderer 退出流式状态 |
| `help` | 显示帮助 |

### 仓库硬规则（指针）

以下为摘要，完整条文与例外以 `AGENTS.md` 为准：

- 产品代码只在 `packages/pispider` 与 `apps/pispider-desktop`；不修改 Pi core 包，产品功能走公开扩展 API。
- 外部依赖在 `package.json` 精确锁版；安装 / 水合用 `--ignore-scripts`，不跑生命周期脚本（除非明确允许）。
- 不主动 commit；lockfile 改动需 `PI_ALLOW_LOCKFILE_CHANGE=1` 才能提交。
- 提示、规则、Skill 和任务状态保持可见、可编辑、可审计；不写隐藏提示或绕过安全检查。

## c. 后续方向路线图

排序总述：P0 = 数据安全与高频核心体验正确性；P1 = 功能完整性与打包可维护性；P2 = 视觉打磨与对外分发基础设施。逐项阻塞判定与代码佐证见 [desktop-parity.md](desktop-parity.md) §7 与 [acceptance.md](acceptance.md)。

### P0：数据安全与高频核心体验

| # | 事项 | 状态 | 说明 |
| --- | --- | --- | --- |
| P0-1 | 建立版本控制 | 已完成（2026-11-20） | `.git` 已初始化，远程 `https://github.com/wangh00/PiSpider`，`main` 已推送 |
| P0-2 | 队列逐条删除 / 恢复 | 剩余 | 上游阻塞：RPC 仅有 `clear_queue`，缺 `get_queue` / `remove_queue_item` |
| P0-3 | UI 遗留正确性：图片消息渲染、内容变更但 id 不变时的缓存失效 | 已完成（2026-11-20） | 用户 / 助手 / 工具结果图片统一渲染；高度缓存升到版本 5 并带内容指纹，正文变更后自动失效重测 |
| P0-4 | `/resume` 独立会话导航 | 已完成（2026-11-20） | 独立“恢复会话”弹层，支持标题 / 路径 / 预览搜索、`↑↓` 与 `Enter` 切换；快捷键 `Ctrl+Shift+K` |

### P1：功能完整与打包维护

| # | 事项 | 阻塞依赖 | 理由 / 判定 |
| --- | --- | --- | --- |
| P1-5 | `/share` Radius artifact 与分享目的地设置（Gist 路径已接） | 部分上游阻塞：Radius 分享路径上游未接；目的地字段 `sessionShareDestination` schema 已存在，目的地选择 UI 可桌面写配置 | 分享链路完整性 |
| P1-6 | 会话树节点删除 / 排序 | 排序已完成（2026-11-20）；节点删除上游阻塞：RPC 与 session-manager 均无 entry 删除 / 重排 API | 侧栏“排序任务”模式拖动或 `Alt+↑/↓` 调整，展示序持久化到 `desktop.json.sessionOrder`；整文件删除已是桌面自有文件操作 |
| P1-7 | 逐模型思考档位 UI | 无（已完成 2026-11-20） | 模型弹层内选择当前模型启动默认档位，写 `settings.json.modelThinkingLevels`，保存后重启并同步当前会话；可清除 |
| P1-8 | 高级 settings：proxy / transport / shell / 细粒度 allowlist / compaction 参数 | 无（已完成 2026-11-20） | 设置窗口“高级设置”卡读写用户级 `settings.json`；保存校验 proxy / transport / shell / defaultTools / compaction，成功后重启 runtime 并保留会话；`compaction.modelOverrides` 原样保留，项目级同名键仍可覆盖 |
| P1-8b | MCP 单工具运行态订阅 | 上游阻塞：服务器级 `mcp_status_changed` live state 已端到端落地；`McpLiveServerStatus` 只含工具名数组，无单工具运行 / 可用状态字段 | 补齐后 MCP 面板可展示逐工具运行态 |
| P1-9 | CORE_VERSION 1.5.2 三处同步升级流程 + 两个 `package.json` 缺失 `author` 的构建警告 | 无（已完成 2026-11-20） | 新增 `scripts/pispider-version.mjs`：`--check` 比对三处并接入根 `check` / `pispider:check`，`--set` 由 `npm run pispider:core-version -- <x.y.z>` 调用；根与桌面 package.json 已补 `author: wangh00` |
| P1-10 | 打包版 stdio 预置 MCP 的 npm 方案 | 无（已完成 2026-11-20） | A+B：构建时随包 npm 10.9.8（含依赖与 LICENSE），安装优先 `resources/npm/bin/npm-cli.js` + `ELECTRON_RUN_AS_NODE=1`，系统 PATH npm 兜底；无 Node/npm 的 PATH 下已实测安装 `chrome-devtools-mcp@1.13.0` 并连接 33 个工具 |
| P1-11 | doctor 日志导出 | 无（已完成 2026-11-20） | 状态窗口“导出诊断”写脱敏文本报告，含应用 / 运行时信息、环境诊断和最近 400 条 runtime 日志；导出前移除 auth 原始输出并做密钥形态屏蔽 |

### P2：打磨与外部分发

| # | 事项 | 阻塞依赖 | 理由 / 判定 |
| --- | --- | --- | --- |
| P2-12 | 动效统一、自定义主题导入 | 无；桌面可独立做 | 视觉打磨 |
| P2-13 | 代码签名与自动更新（electron-updater） | 外部阻塞：证书 / publish 服务 | 对外分发基础设施 |
| P2-14 | macOS / Linux 包与 portable 单文件目标 | 需对应平台构建环境；桌面可独立做 | 跨平台分发；当前仅 Windows x64 NSIS + win-unpacked |

## d. 刻意不做清单

当前阶段明确不做以下事项，口径以 [PRODUCT_PLAN.md](../PRODUCT_PLAN.md) §6「非目标」为准，本节仅列摘要：

- 不做独立逆向工具内核、执行沙箱和复杂证据平台；
- 不做本地 Web 控制台，桌面壳优先；
- 不实现底层 `web_hook`、`js_bundle`、`node_replay`；待桌面壳与通用 Agent 稳定后再评估 JS 逆向专用工具；
- 不把 PiSpider 做成 Pi 的 fork 补丁集合。

边界补充（根 `README.md` §边界）：不支持宿主补丁、隐藏提示注入、Workspace 基线移除、越狱、红队 Drill 或无边界执行；所有提示、规则、Skill 和状态保持可见、可编辑、可审计。

---

维护约定：行为或验收结果变化时，同步更新本文、[desktop-parity.md](desktop-parity.md) 与 [acceptance.md](acceptance.md)；不在文档记录 API Key、完整凭据或用户会话内容；测试使用临时会话与临时配置，结束后清理。
