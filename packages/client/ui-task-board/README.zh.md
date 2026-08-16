# @deepseek-ai/dsh-client-ui-task-board

[English](README.md) | 中文

任务看板插件，浏览器半边：五列看板浮层作为 `shell.overlay` 座位的 `task-board` 条目（order 40）贡献，另在 `sidebar.footer.action` 放一个打开按钮。浮层渲染 `initialized`、`running`、`review`、`completed`、`failed` 五列，卡片带类型与尝试次数角标，提供本地搜索与类型筛选、新建表单，以及展示全部存储字段、当前状态合法工作流动作和只追加活动日志的详情抽屉。拖拽排序落地为同列 `move`；拖到另一列会被 Host 拒绝，因为换列是工作流转移。

一个 `TaskBoardController` 支撑浮层与打开按钮。它以单次 `taskBoard.list` 读取镜像整个看板，串行化变更使排队操作总是对照已提交修订号，并从回复携带的权威卡片收敛 `revision-conflict`。转发的 `task-board/updated` 事件重读看板与打开的抽屉，封住丢帧可能留下的修订缺口；连接重置会刷新已加载的看板，而冷看板保持冷。文案位于 `taskBoard` locale 命名空间（英文与中文）。

`/client` 导出为插件本体（`apply`/`inject`）、`TaskBoardOverlay` 与 `TaskBoardOpener` 组件、`TaskBoardController` 类以及注入面类型。

## 模型体验

无。看板是 `ctx.taskBoard` 之上的 sidecar，从不进入 Session 日志、模型上下文或遥测；任何标题、需求或转移都不会被模型看到。

#### KV Cache 影响

无；任何看板变更都不触碰历史尾部。

## 已知限制与暂缓事项

- **仅创建的表单** — 抽屉读取全部字段但只编辑状态；改标题或重写需求走 Host Remote 契约，字段编辑器延迟。
- **仅列内拖拽** — 跨列移动按设计以 `move-target-invalid` 拒绝；抽屉的转移按钮是换列的唯一途径。
- **变更触发整板刷新** — 转发事件重读完整看板而非修补指名卡片；在 `maxTasks` 规模下这是每次通知一个有界请求。
