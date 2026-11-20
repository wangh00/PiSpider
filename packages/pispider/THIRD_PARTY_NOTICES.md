# 第三方来源说明

## Pi

PiSpider 以 [`earendil-works/pi`](https://github.com/earendil-works/pi) 的 monorepo 为运行底座，使用其公开扩展 API。Pi 源码位于本仓库根目录，许可证见根目录 `LICENSE`（MIT）。PiSpider 不修改 Pi 核心包。

## dsh-purge

PiSpider 第一版借鉴了 [`mmparko/dsh-purge`](https://github.com/mmparko/dsh-purge) 的以下**通用产品思路**：

- 规则库的列表、启用、创建与删除；
- Skill 目录的校验、导入、备份与替换；
- 会话回退交互；
- 配置状态与生效时机；
- 只管理自有数据目录。

dsh-purge 使用 MIT License。PiSpider 第一版没有复制其源代码、默认提示词、红队模块或宿主补丁实现；`packages/pispider/` 下的代码为独立实现。

明确未迁移：

- 宿主包补丁或 Shim；
- 加密、隐藏或不可审计的提示注入；
- Workspace 基线移除；
- 红队 Drill 与资产扫描；
- 无条件执行或绕过宿主安全约束。

如后续直接复制 dsh-purge 的具体代码或界面结构，应在仓库中补充 MIT 许可文本、版权声明和逐项来源记录。

## pi-computer-use

PiSpider 在 `packages/pispider/vendor/pi-computer-use/` 内置了
[`injacency/pi-computer-use`](https://github.com/injaneity/pi-computer-use) 0.5.1 的运行文件，
作为可选扩展通过 `PISPIDER_COMPUTER_USE=1` 加载。它不通过 npm 依赖安装，也不执行上游
`postinstall`；Windows/Linux helper 安装到 PiSpider 自己的 agent 目录。

上游项目使用 MIT License：

```text
MIT License

Copyright (c) 2026 Zane Chee

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

本地化改动仅限：移除 npm `postinstall` 和发布脚本配置；`PI_CODING_AGENT_DIR` 优先于 `~/.pi`
作为 helper 默认目录。扩展逻辑与工具定义保持上游实现。逐项文件记录见
`vendor/pi-computer-use/VENDORED.md`。

