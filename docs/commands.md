# 命令与数据速查

## `/ps` 命令

| 命令 | 作用 |
| --- | --- |
| `/ps status` | 查看 Home、Domain、规则、Skill、Prompt 大小、任务阶段和分支 entry 数 |
| `/ps domain auto\|js\|app` | 切换 Domain 模式 |
| `/ps rules list` | 列出规则和启用状态 |
| `/ps rules use <id>` | 启用规则 |
| `/ps rules create <id> [name]` | 创建可见规则骨架 |
| `/ps rules edit <id>` | 在编辑器中修改规则 |
| `/ps rules delete <id>` | 备份后删除规则 |
| `/ps rules reset [id]` | 清除活动规则，或重置规则正文 |
| `/ps skills list` | 列出 Skill 和校验状态 |
| `/ps skills import <path> [id]` | 从本地目录导入 Skill |
| `/ps skills create <id> [desc]` | 创建 Skill 骨架 |
| `/ps skills delete <id>` | 备份后删除 Skill |
| `/ps prompt show` | 查看完整追加提示 |
| `/ps prompt files` | 查看提示文件路径和大小 |
| `/ps prompt reset [names]` | 恢复提示默认内容 |
| `/ps rewind once\|round` | 回退到上一用户输入或再往前一轮 |
| `/ps task status\|reset` | 查看或重置当前分支任务状态 |
| `/ps reload` | 让 Pi 重新发现 Skill 等资源 |
| `/ps help` | 命令帮助 |

## 桌面内置斜杠命令

输入框中以 `/` 开头的单段文本会先由桌面层解析：命中内置命令时在本地执行，不发给模型；扩展、提示模板和技能命令仍来自 RPC `get_commands`，不被本地拦截，经 prompt 原样执行。

| 命令 | 中文描述 | 参数形式 | 桌面落地行为 |
| --- | --- | --- | --- |
| `/settings` | 打开设置窗口 | 无参 | 打开设置二次窗口 |
| `/model` | 选择模型 | `<provider/model>` | 无参打开输入框模型胶囊菜单；有参切换到指定 `provider/model`；格式非法时 toast 报错并提示格式 |
| `/tree` | 查看会话树并切换分支 | 无参 | 打开会话窗口，toast 提示会话树位置 |
| `/thinking` | 设置思考强度 | `<level>` | 无参打开思考强度菜单；有参切换档位（`off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`）；非法档位 toast 报错 |
| `/scoped-models` | 编辑模型循环切换范围 | 无参 | 打开模型作用域编辑器 |
| `/export` | 导出会话（默认 HTML，可指定 `.html` / `.jsonl` 路径） | `[路径]` | 无参导出 HTML；`.jsonl` 结尾导出 JSONL；`.html` 结尾导出到指定绝对路径；其他扩展名 toast 报错；成功后 toast 显示导出路径 |
| `/import` | 导入 JSONL 会话 | `[路径]` | 无参弹出文件选择对话框；有参从指定路径导入 |
| `/share` | 分享会话到 GitHub Gist | 无参 | 分享到私有 Gist，成功后 toast 展示预览链接 |
| `/bug` | 反馈问题 | `[描述]` | 在浏览器打开 GitHub issue 新建页，body 预填描述与平台 / Electron / Node / 工作区信息 |
| `/copy` | 复制最后一条助手回复 | 无参 | 复制最后一条助手回复到剪贴板；没有可复制回复时 toast 提示 |
| `/name` | 设置会话名称 | `<名称>` | 有参重命名当前会话；无参打开会话窗口并提示重命名入口 |
| `/session` | 查看会话信息与统计 | 无参 | 打开状态 / 会话信息窗口 |
| `/changelog` | 查看变更日志 | 无参 | 主窗口内弹只读对话框，用 Markdown 渲染运行时 CHANGELOG；读取失败 toast 提示 |
| `/hotkeys` | 查看键盘快捷键 | 无参 | 打开快捷键总览对话框 |
| `/fork` | 从历史用户消息分叉新会话 | 无参 | 打开会话窗口并提示分叉入口 |
| `/clone` | 复制当前会话 | 无参 | 复制当前会话，完成后刷新会话列表 |
| `/trust` | 设置项目信任 | 无参 | 打开设置窗口并提示项目信任位置 |
| `/login` | 配置模型提供商登录 | `[provider]` | 打开设置窗口认证区域；`provider` 仅用于提示文案，不在主窗口直接写认证 |
| `/logout` | 退出模型提供商登录 | `[provider]` | 打开设置窗口并提示要退出的提供商；不在主窗口直接删除认证，避免误删 |
| `/new` | 新建会话 | 无参 | 复用既有新建会话流程 |
| `/compact` | 手动压缩会话上下文 | `[压缩说明]` | 调用 `compact`，非空说明作为 `customInstructions` 传入；Agent 运行中 toast 阻止；成功 / 失败 toast 后刷新状态 |
| `/resume` | 切换或恢复其他会话 | 无参 | 打开独立“恢复会话”导航：搜索标题 / 路径 / 最近消息，`↑↓` 选择、`Enter` 切换；也可用 `Ctrl+Shift+K` |
| `/reload` | 重载 Agent（扩展 / 技能 / 规则等） | 无参 | 复用顶部“重载 Agent”流程，重载完成由既有事件 toast 并刷新 |
| `/quit` | 退出 PiSpider | 无参 | 退出应用，走既有 `before-quit` 清理路径 |

补充规则：

- 未知命令：既不在内置表、也不在 RPC 命令表时，toast「未知命令 /xxx，输入 / 查看可用命令」，保留输入内容不发送；判断前会先等待 RPC 命令加载完成。
- 路径形态不算命令：`/etc/hosts` 这类含 `/` 或 `.` 的路径、多行文本、数字开头或非法 token 都按普通 prompt 原样发送。
- 插话路径同样拦截：`Ctrl+Enter` 插话时先走同一套命令解析，内置命令本地执行，不当插话文本发出。
- 内置命令带图片附件时 toast「命令不能附加图片」，不执行。

## `ps_task` 工具

| 参数 | 作用 |
| --- | --- |
| `action: "plan"` | 记录目标、范围、计划、下一步 |
| `action: "note"` | 记录观察、证据、来源、下一步 |
| `action: "reroute"` | 记录单点边界和替代路径，任务继续，不重置 |
| `action: "stage"` | 切换阶段 |
| `action: "complete"` | 记录结果并进入完成状态 |
| `action: "status"` | 查看当前任务 |
| `action: "reset"` | 重置当前分支任务状态 |

`reroute` 使用 `boundary` 说明具体受限动作，用 `fallbacks` 记录相邻分析路径，用 `nextAction` 指定下一步。它不会清空计划、证据或会话分支。

阶段：`intake`、`plan`、`execute`、`observe`、`verify`、`done`、`blocked`。

状态保存在 tool result 的 `details.pispiderTask` 中，并按当前 Pi 分支重建。

## 数据目录

```text
$PISPIDER_HOME/
  config.json
  prompts/
    core.md
    workflow.md
    js.md
    app.md
  rules/<id>/RULE.md
  rules/<id>/meta.json
  skills/<id>/SKILL.md
  backups/rules/
  backups/skills/
  state/skill-imports/
  agent/                     # Pi 配置、认证、模型和会话（与 ~/.pi 隔离）
    sessions/
    helpers/pi-computer-use/ # 可选 Computer Use 的本地 helper
  runtime/core-1.5.2/        # 首次启动时缓存的已发布 Pi
```

默认位置：

- Windows：`%USERPROFILE%\.pispider`
- macOS / Linux：`$HOME/.pispider`

## 环境变量

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `PISPIDER_HOME` | `~/.pispider` | 产品数据根目录 |
| `PISPIDER_AGENT_DIR` | `$PISPIDER_HOME/agent` | Pi 全局配置、认证、模型和资源目录 |
| `PISPIDER_SESSION_DIR` | `$PISPIDER_HOME/agent/sessions` | Pi 会话目录 |
| `PISPIDER_CORE_CACHE` | `$PISPIDER_HOME/runtime/core-1.5.2` | Pi 运行时实际缓存目录 |
| `PISPIDER_CORE_SPEC` | `@earendil-works/pi-coding-agent@1.5.2` | 要安装的 Pi 版本 |
| `PISPIDER_CORE_CLI` | 自动 | 直接指定 Pi CLI 文件 |
| `PISPIDER_COMPUTER_USE` | 关闭 | 设为 `1`/`true` 时加载内置 Computer Use 扩展 |

启动器内部会把 `PI_CODING_AGENT_DIR` 和 `PI_CODING_AGENT_SESSION_DIR` 指向上述 PiSpider 目录，并删除继承的 `PI_PACKAGE_DIR`。不要把用户自己的 Pi 配置写进 `~/.pi` 后再期待 PiSpider 读取；需要复用时运行 `npm run pispider:migrate`，没有 Pi 配置时可用 `npm run pispider:setup` 跳过导入并继续 doctor。

## 配置字段

`config.json` 主要字段：

- `domain`：`auto`、`js`、`app`
- `activeRule`：当前启用的规则 ID 或 `null`
- `version`：配置版本
- `createdAt`、`updatedAt`：时间戳

## Domain 自动判断

`auto` 会从用户文本中识别：

- JS/Web：JavaScript、Node、webpack、sourcemap、浏览器、前端等；
- App：Android、iOS、APK、DEX、Frida、Flutter、应用逆向、移动端、`app` 等；
- 无强信号时使用通用逆向工作流。

不再依赖手动选择 Skill 或 MCP 才获得基础领域提示。
