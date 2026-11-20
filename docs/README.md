# PiSpider 开发文档

本目录是 PiSpider 单仓库的产品与开发入口。当前主线是桌面端通用 Agent 客户端，`web_hook`、`js_bundle`、`node_replay` 暂不实现。

| 文档 | 内容 |
| --- | --- |
| [desktop-status.md](desktop-status.md) | 桌面端当前状态、已落地能力、剩余缺口和下一步顺序 |
| [architecture.md](architecture.md) | 仓库分层、扩展装配、数据流、桌面端 RPC 链路和安全边界 |
| [development.md](development.md) | 环境准备、启动、构建、桌面开发、测试和常用命令 |
| [desktop-parity.md](desktop-parity.md) | 桌面端与 CLI/Pi 运行时能力对照、缺口和优先级 |
| [desktop-ui.md](desktop-ui.md) | 桌面端 UI 审计、优化方向、性能与可访问性路线 |
| [desktop-runtime-contract.md](desktop-runtime-contract.md) | 桌面端 RPC 契约、能力归属、Pi 架构同步和收敛阶段 |
| [../apps/pispider-desktop/README.md](../apps/pispider-desktop/README.md) | Electron 桌面端的运行链路、IPC、界面和当前限制 |
| [acceptance.md](acceptance.md) | 自动化验证、桌面操作验收、人工验收和已知限制 |
| [commands.md](commands.md) | `/ps` 命令、`ps_task` 工具和数据目录速查 |
| [cross-platform.md](cross-platform.md) | Windows / macOS / Linux 启动方式、路径和环境变量 |
| [pi-upstream.md](pi-upstream.md) | PiSpider 相对上游 Pi 的改动、共存隔离和升级同步流程 |
| [computer-use.md](computer-use.md) | 可选内置 Computer Use 的启用、工具、helper 和平台验证 |
| [../PRODUCT_PLAN.md](../PRODUCT_PLAN.md) | 产品定位、当前阶段和长期方向 |

维护规则：

- 当前状态以 [desktop-status.md](desktop-status.md) 为准，逐项能力以 [desktop-parity.md](desktop-parity.md) 为准。
- 行为或验收结果变化时，同时更新状态、parity 和 acceptance，避免文档只描述旧版本。
- 旧的双目录迁移已经完成，历史迁移文档已删除；仓库结构以 [architecture.md](architecture.md) 为准。
- 上游 Pi 的原始说明保留在根目录 [PI_README.md](../PI_README.md)，贡献和安全文档分别在 [CONTRIBUTING.md](../CONTRIBUTING.md) 与 [SECURITY.md](../SECURITY.md)。
