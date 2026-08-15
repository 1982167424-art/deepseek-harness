# tasks/ — 持久工作项

[English](README.md) | 中文

tasks 族拥有超出单轮对话生命周期的、面向产品的工作项状态。它与 session 的 `todo` 工具刻意分离：任务看板卡片是 Host 拥有的 storage-domain 对象，带有自己的生命周期、审计轨迹与 compare-and-set 纪律，而不是模型可见的草稿状态。

| 包 | 角色 | ctx 键 |
|---|---|---|
| `task-board/` | 持久五状态看板卡片，带活动日志与 Host `taskBoard.*` Remote 契约 | `taskBoard` |

执行留给调用方：看板记录尝试与转移，但不驱动 agent 会话。浏览器消费方位于 [`dsh-client-ui-task-board`](../client/ui-task-board)；`dsh-api-remotes` 挂载生成的 `taskBoard` Remote 贡献。
