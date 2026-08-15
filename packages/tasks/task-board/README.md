# @deepseek-ai/dsh-task-board

English | [中文](README.zh.md)

Durable, auditable, retryable five-state task board (`ctx.taskBoard`). One card walks `initialized → running → review → completed | failed` through eight guarded transitions, keeps an append-only activity log inside its stored row, and reconciles concurrent editors with per-card revision compare-and-set. Durability rides the storage-domain seam: the whole board is one `task_board` domain, so a page refresh or a cold harness restart reconciles to the same cards, logs, and revisions. Execution stays with the caller — `start` and `retry` record attempts and move the card, while driving an agent session for an `agent` card is deferred orchestration this package deliberately does not own. The [task-board Agent Note](../../../.agents/notes/implemented/architecture/2026-08-16-durable-five-state-task-board.md) owns the design boundary.

Public request, view, and failure types are exported from the package root and `@deepseek-ai/dsh-task-board/types`; [`src/types.ts`](src/types.ts) is their source.

## Configuration

| key | meaning | default |
|---|---|---|
| `maxTasks` | Maximum number of cards the board accepts. | `500` |
| `maxTitleBytes` | Maximum UTF-8 byte length accepted for one title. | `240` |
| `maxTextBytes` | Maximum UTF-8 byte length accepted for one other free-text field. | `10000` |

A card names at most 16 reference images; the bound is a fixed protocol constant, not a deployment knob. Required text must contain at least one non-whitespace character; accepted text is stored verbatim rather than trimmed, and blank optional fields are stored as absent.

```yaml
- id: task-board
  name: '@deepseek-ai/dsh-task-board'
  config:
    maxTasks: 500
    maxTitleBytes: 240
    maxTextBytes: 10000
```

The service injects `storageDomain`. Its durable domain is `task_board` (version 0), with one `tasks` table row per card keyed by an opaque `TaskId`; the row carries the card, its revision and order, and the activity log, so a card and its audit history commit atomically on the domain's write chain.

## Workflow

| action | from | to | counts an attempt |
|---|---|---|---|
| `start` | `initialized` | `running` | yes |
| `stop` | `running` | `initialized` | no |
| `submit` | `running` | `review` | no |
| `approve` | `review` | `completed` | no |
| `reject` | `review` | `running` | no |
| `fail` | `running` | `failed` | no |
| `retry` | `failed` | `running` | yes |
| `reopen` | `completed` | `initialized` | no |

A rejection returns the card to `running` for continued revision on the same card: the board's unit of continuation is the task, not a fresh copy. `attempts` counts entries into `running`, so it advances on `start` and on every `retry`. Each transition appends one record to the card's activity log; `list` returns cards in column order, then in-column order, then creation order.

## Compare-and-set and ordering

Every material mutation carries the revision the caller last observed (`ifRevision`). A mismatch returns `revision-conflict` with the authoritative current card, so a lost race reconciles from the reply itself without a second read. A matching-revision no-op returns the stored card unchanged. In-column drag reorder goes through `move` with `beforeTaskId`; a cross-column move is rejected with `move-target-invalid`, because changing column is a workflow transition, not a drag. The stored fractional `order` field spaces adjacent cards and is renormalized when spacing collapses.

## Service and Host Remote contract

The same seven `TaskBoardService` methods are published by `TypertRemoteService` and `@Remote`; the Host endpoint names are `taskBoard.list` through `taskBoard.remove`. Every method returns a discriminated business union: `{ ok: true, value }` or `{ ok: false, error }`. Operational storage failures reject instead of being mislabeled as business errors.

| Method | Request | Success `value` | Rejected `error.code` |
|---|---|---|---|
| `list` | — | `TaskBoardListValue { tasks }` | — |
| `get` | `TaskBoardGetRequest { id }` | `TaskDetail { task, events }` | `task-not-found` |
| `create` | `TaskBoardCreateRequest` | committed `TaskView` | `board-full`, `text-blank`, `field-too-long`, `reference-images-too-many` |
| `update` | `TaskBoardUpdateRequest { id, ifRevision, … }` | committed `TaskView` | `task-not-found`, `revision-conflict`, `text-blank`, `field-too-long` |
| `transition` | `TaskBoardTransitionRequest { id, action, ifRevision, note? }` | committed `TaskView` | `task-not-found`, `revision-conflict`, `invalid-transition` |
| `move` | `TaskBoardMoveRequest { id, beforeTaskId, ifRevision }` | committed `TaskView` | `task-not-found`, `revision-conflict`, `move-target-invalid` |
| `remove` | `TaskBoardRemoveRequest { id }` | `TaskBoardRemoveValue { absent: true }` | `task-not-found` |

Every committed mutation emits the Host `task-board/updated` event naming the touched card ids; `@deepseek-ai/dsh-api-remotes` forwards it verbatim to clients. `remove` is idempotent: removing an already-absent card returns the stable `{ absent: true }` postcondition.

## Model Experience

### Local task-board state

#### What the model sees

Nothing. `ctx.taskBoard` registers no tool, prompt section, model-facing context, or Session event; cards stay in a Host-owned storage-domain sidecar unless a separately documented Consumer explicitly exposes them.

#### Token effect

Zero. No title, requirement, transition, note, timestamp, or failure from this package enters a model request.

#### KV Cache effect

Independent. Listing or mutating the board does not touch a model request prefix and cannot invalidate an otherwise reusable provider cache entry.

## Known Limitations and Deferred Work

- **Agent orchestration is deferred** — an `agent` card records its preset and workspace, but nothing drives a subagent session from the board. Wiring `start`/`retry` to the subagent seam is separately owned future work.
- **Compare-and-set is single-process** — revision checks serialize inside one service instance; multiple Host processes writing one storage root can still lose updates because storage-domain exposes no cross-process conditional write.
- **No per-column limits** — `maxTasks` bounds the whole board; column-level work-in-progress limits are deferred until a consumer defines the policy.
- **Order renormalization is lazy** — fractional `order` spacing collapses only after sustained interleaved inserts trigger a renormalize pass inside the same mutation.
- **Trusted caller boundary** — the seven Remote methods carry no authenticated actor identity; a deployment must expose the Host gateway only through its trusted or separately authenticated boundary until authorization is added.
