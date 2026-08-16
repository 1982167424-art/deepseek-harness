# Agent Note: 持久五状态任务看板

Status: implemented

[English](2026-08-16-durable-five-state-task-board.md) | 中文

## Problem

session 的 `todo_write` 工具提供的是模型可见的、活在单次对话内的草稿状态。产品工作项需要恰恰相反的东西：一个人类从侧边栏打开的看板，可以跨轮次与重启编辑、审核、重试并审计——而这一切都不进入模型上下文、Session 日志或遥测。这种状态需要自己的生命周期纪律（卡片不能从 `initialized` 直接跳到 `completed`）、自己的审计轨迹（谁在何时以什么备注移动了什么），以及浏览器客户端、第二个标签页和重启后的 Host 同时触碰同一张卡片时的并发方案。

既有的 `jobs` 注册表是进程内的后台执行，不是持久产品状态；`message-feedback` sidecar 拥有的是逐消息评分，不是工作流。仓库中没有东西拥有一个持久、受守卫、可重试的工作项对象。

## Decision

`@deepseek-ai/dsh-task-board` 拥有 `ctx.taskBoard`，把整个看板存为一个 storage-domain `task_board` 域（版本 0），单一 `tasks` 表以不透明 `TaskId` 为键。一行携带卡片、其 `revision`、列内分数 `order` 以及完整的只追加活动日志，因此卡片与其审计历史在域的写链上原子提交，冷重启收敛到相同状态。行在读取时经 zod 校验并带结构不变量（`seq` 自 1 连续、日志以 `created` 开头、`updatedAt` 不早于 `createdAt`）。

工作流是封闭的五列八动作图——`start`、`stop`、`submit`、`approve`、`reject`、`fail`、`retry`、`reopen`——编码为一张声明式转移表，`countsAttempt` 标志标记两次进入 `running` 的动作。`reject` 把卡片从 `review` 送回同一张卡的 `running`：延续单位是任务，不是新副本。表外来源状态的动作以 `invalid-transition` 返回，不触碰存储。

并发是每卡片 compare-and-set。每个实质性变更携带调用方最后观察到的 `ifRevision`；不匹配返回 `revision-conflict` 并附权威当前卡片，输掉竞争方可从回复直接收敛，无需二次读取。修订号匹配的空操作原样返回已存卡片。列内拖拽排序走 `move` 的 `beforeTaskId` 锚点；跨列目标返回 `move-target-invalid`，因为换列是工作流转移而非拖拽。分数 `order` 间隔在交错插入使其坍缩时惰性重整。

服务通过 `TypertRemoteService` 与 `@Remote` 发布七个 Host Remote 方法（`taskBoard.list/get/create/update/transition/move/remove`），每个返回判别式业务联合。每次提交的变更发出指名被触碰 id 的 Host `task-board/updated` 事件；`dsh-api-remotes` 将其加入转发事件 allowlist，浏览器镜像因此跨标签页与重连收敛。`dsh-client-ui-task-board` 是浏览器消费方：一个 `TaskBoardController` 以单次 `list` 读取镜像看板，在已提交修订号之后串行化变更，从回复收敛冲突，并在每个转发事件后重读。浮层贡献 `shell.overlay` 条目与 `sidebar.footer.action` 打开按钮；文案位于 `taskBoard` locale 命名空间。

执行被刻意不拥有：`start` 与 `retry` 记录尝试并移动卡片，为 `agent` 卡片驱动 agent 会话（其预设与工作目录是存储字段）属于延迟编排。部署策略是显式 `Config`——`maxTasks`、`maxTitleBytes`、`maxTextBytes`——在加载时校验；参考图片上限是固定协议常量。

## Alternatives considered

**复用 `todo_write` 或 `jobs` 注册表。** 被拒绝，因为 todo 状态是单次会话内模型可见的草稿，jobs 是进程内执行记录；两者都没有受守卫的生命周期、持久审计轨迹或面向产品的编辑面。

**从 Session 事件或投影推导看板。** 因与 message-feedback 选择 sidecar 相同的理由被拒绝：可编辑的产品元数据会变成规范性的对话邻接历史，fork 会重放它，删除需要墓碑。看板是 storage-domain 对象，不是 Session 内容。

**每卡片状态枚举加自由更新。** 被拒绝，因为不受守卫的 `update` 能把卡片从 `initialized` 直接改到 `completed`，绕过审核；声明式转移表让工作流可机械执行且自文档化。

**带自动转移的跨列拖拽。** 被拒绝，因为把拖拽静默映射为 `submit` 或 `approve` 会把审核语义藏进排序操作；抽屉的显式转移按钮是换列的唯一途径。

**独立事件溯源活动表。** 被拒绝，因为它放弃了卡片与审计记录的原子提交，并给每次 `get` 增加一次联结；日志活在行内，受同一写链约束。

## Consequences

代价：变更多付一次修订号往返，浏览器镜像在每个转发事件后重读整板——由 `maxTasks` 界定，这是对丢帧简单且无缺口的答案。修订号 compare-and-set 只在单个服务实例内成立；同一存储根上的多个 Host 进程仍可能丢失更新，看板不声称跨进程线性化。活动日志在行内无修剪增长。还没有任何东西为 `agent` 卡片驱动 agent 执行，因此看板记录意图与结果，但不记录执行中的工作本身。

收益：一个带机械守卫生命周期的产品工作项面、每卡片原子审计轨迹、重启即恢复的持久性、自带收敛的冲突回复，以及一个文案双语、状态从不触碰模型上下文的浏览器看板——把 message-feedback sidecar 确立的分离，从一次评分扩展到完整工作流。
