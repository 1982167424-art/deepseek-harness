# @deepseek-ai/dsh-task-board

[English](README.md) | 中文

持久、可审计、可重试的五状态任务看板（`ctx.taskBoard`）。一张卡片经八条受守卫的转移走过 `initialized → running → review → completed | failed` 五列，卡片行内保存只追加的活动记录，并以每卡片修订号 compare-and-set 调解并发编辑。持久化依托 storage-domain：整个看板是一个 `task_board` 域，页面刷新或宿主冷重启都会收敛到同一组卡片、日志与修订号。执行本身留给调用方——`start` 与 `retry` 记录尝试并移动卡片，而为 `agent` 卡片驱动 agent 会话属于本包刻意不拥有的延迟编排。[任务看板 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-16-durable-five-state-task-board.md) 拥有该设计边界。

公开的请求、视图与失败类型从包根和 `@deepseek-ai/dsh-task-board/types` 导出；[`src/types.ts`](src/types.ts) 是其来源。

## 配置

| 键 | 含义 | 默认值 |
|---|---|---|
| `maxTasks` | 看板接受的卡片数量上限。 | `500` |
| `maxTitleBytes` | 单个标题接受的 UTF-8 字节上限。 | `240` |
| `maxTextBytes` | 其他自由文本字段接受的 UTF-8 字节上限。 | `10000` |

一张卡片至多引用 16 张参考图片；该上限是固定协议常量，不是部署旋钮。必填文本须含至少一个非空白字符；接受的文本原样存储而不做修剪，空白的可选字段存储为缺席。

```yaml
- id: task-board
  name: '@deepseek-ai/dsh-task-board'
  config:
    maxTasks: 500
    maxTitleBytes: 240
    maxTextBytes: 10000
```

服务注入 `storageDomain`。其持久域为 `task_board`（版本 0），`tasks` 表以不透明 `TaskId` 为键、每卡片一行；行内携带卡片、修订号与顺序以及活动日志，因此卡片与其审计历史在域的写链上原子提交。

## 工作流

| 动作 | 来源 | 去向 | 计一次尝试 |
|---|---|---|---|
| `start` | `initialized` | `running` | 是 |
| `stop` | `running` | `initialized` | 否 |
| `submit` | `running` | `review` | 否 |
| `approve` | `review` | `completed` | 否 |
| `reject` | `review` | `running` | 否 |
| `fail` | `running` | `failed` | 否 |
| `retry` | `failed` | `running` | 是 |
| `reopen` | `completed` | `initialized` | 否 |

驳回把卡片送回 `running` 在同一张卡上继续修订：看板的延续单位是任务，不是新副本。`attempts` 统计进入 `running` 的次数，因此在 `start` 与每次 `retry` 时递增。每次转移向卡片活动日志追加一条记录；`list` 按列序、列内序、创建序返回卡片。

## Compare-and-set 与排序

每个实质性变更携带调用方最后观察到的修订号（`ifRevision`）。不匹配返回 `revision-conflict` 并附权威当前卡片，输掉竞争方可直接从回复收敛，无需二次读取。修订号匹配的空操作原样返回已存卡片。列内拖拽排序走 `move` 的 `beforeTaskId`；跨列移动以 `move-target-invalid` 拒绝，因为换列是工作流转移而非拖拽。存储的分数 `order` 字段为相邻卡片留出间隔，并在间隔坍缩时重整。

## 服务与 Host Remote 契约

同样七个 `TaskBoardService` 方法由 `TypertRemoteService` 与 `@Remote` 发布；Host 端点名自 `taskBoard.list` 起至 `taskBoard.remove`。每个方法返回判别式业务联合：`{ ok: true, value }` 或 `{ ok: false, error }`。运维性存储失败以 rejection 抛出，不会伪装成业务错误。

| 方法 | 请求 | 成功 `value` | 拒绝 `error.code` |
|---|---|---|---|
| `list` | — | `TaskBoardListValue { tasks }` | — |
| `get` | `TaskBoardGetRequest { id }` | `TaskDetail { task, events }` | `task-not-found` |
| `create` | `TaskBoardCreateRequest` | 已提交 `TaskView` | `board-full`、`text-blank`、`field-too-long`、`reference-images-too-many` |
| `update` | `TaskBoardUpdateRequest { id, ifRevision, … }` | 已提交 `TaskView` | `task-not-found`、`revision-conflict`、`text-blank`、`field-too-long` |
| `transition` | `TaskBoardTransitionRequest { id, action, ifRevision, note? }` | 已提交 `TaskView` | `task-not-found`、`revision-conflict`、`invalid-transition` |
| `move` | `TaskBoardMoveRequest { id, beforeTaskId, ifRevision }` | 已提交 `TaskView` | `task-not-found`、`revision-conflict`、`move-target-invalid` |
| `remove` | `TaskBoardRemoveRequest { id }` | `TaskBoardRemoveValue { absent: true }` | `task-not-found` |

每次提交的变更都发出 Host `task-board/updated` 事件，指名被触碰的卡片 id；`@deepseek-ai/dsh-api-remotes` 将其原样转发给客户端。`remove` 幂等：移除已缺席的卡片返回稳定的 `{ absent: true }` 后置条件。

## 模型体验

### 本地任务看板状态

#### 模型可见内容

无。`ctx.taskBoard` 不注册工具、提示词段落、模型可见上下文或 Session 事件；卡片留在 Host 拥有的 storage-domain 伴随存储中，除非某个另行文档化的 Consumer 显式暴露它们。

#### Token 影响

零。本包的标题、需求、转移、备注、时间戳或失败都不会进入模型请求。

#### KV Cache 影响

独立。列出或变更看板不触碰任何模型请求前缀，不会令原本可复用的 provider 缓存条目失效。

## 已知限制与暂缓事项

- **Agent 编排延迟** — `agent` 卡片记录其预设与工作目录，但没有任何东西从看板驱动 subagent 会话。把 `start`/`retry` 接到 subagent seam 是另行拥有的未来工作。
- **Compare-and-set 单进程** — 修订号检查在单个服务实例内串行；storage-domain 不提供跨进程条件写，多个 Host 进程写同一存储根仍可能丢失更新。
- **无按列限额** — `maxTasks` 约束整个看板；列级在制品限额延迟到有消费方定义策略后再做。
- **顺序重整是惰性的** — 分数 `order` 间隔只在持续交错插入触发同一变更内的重整路径后才坍缩。
- **受信调用方边界** — 七个 Remote 方法不携带经认证的操作者身份；在加入授权之前，部署只能通过受信或另行认证的边界暴露 Host 网关。
