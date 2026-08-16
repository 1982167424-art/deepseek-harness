# tasks/ — durable work items

English | [中文](README.zh.md)

The tasks family owns product-facing work-item state that outlives a conversation turn. It is deliberately separate from the session `todo` tool: a task board card is a Host-owned storage-domain object with its own lifecycle, audit trail, and compare-and-set discipline, not model-visible scratch state.

| Package | Role | ctx key |
|---|---|---|
| `task-board/` | Durable five-state kanban cards with activity log and Host `taskBoard.*` Remote contract | `taskBoard` |

Execution stays with the caller: the board records attempts and transitions but does not drive agent sessions. Browser consumption lives in [`dsh-client-ui-task-board`](../client/ui-task-board); `dsh-api-remotes` mounts the generated `taskBoard` Remote contribution.
