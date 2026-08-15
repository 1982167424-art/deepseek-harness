# @deepseek-ai/dsh-client-ui-task-board

English | [中文](README.zh.md)

Task board plugin, browser half: a five-column kanban overlay contributed as the `task-board` entry (order 40) of the `shell.overlay` seat, plus one opener button in `sidebar.footer.action`. The overlay renders the `initialized`, `running`, `review`, `completed`, and `failed` columns with per-card kind and attempt chips, local search and kind filter, a compose form, and a detail drawer showing every stored field, the workflow actions legal for the current status, and the append-only activity log. Drag reorder lands as a same-column `move`; dropping onto another column is refused by the Host, because changing column is a workflow transition.

One `TaskBoardController` backs the overlay and the opener. It mirrors the whole board from a single `taskBoard.list` read, serializes mutations so a queued operation always compares against the committed revision, and reconciles a `revision-conflict` from the authoritative card carried by the reply. The forwarded `task-board/updated` event re-reads the board and the open drawer, which closes any revision gap a dropped frame could leave behind; a connection reset refreshes a loaded board while a cold one stays cold. Copy lives in the `taskBoard` locale namespace (English and Chinese).

The `/client` exports are the plugin body (`apply`/`inject`), the `TaskBoardOverlay` and `TaskBoardOpener` components, the `TaskBoardController` class, and the injected face types.

## Model Experience

None, as the board is a sidecar over `ctx.taskBoard` that never enters the Session log, model context, or telemetry; no title, requirement, or transition is ever visible to the model.

#### KV Cache effect

None; no board mutation touches the history tail.

## Known Limitations and Deferred Work

- **Creation-only compose form** — the drawer reads every field but edits only status; retitling or rewriting requirements goes through the Host Remote contract, and a field editor is deferred.
- **In-column drag only** — cross-column moves are refused with `move-target-invalid` by design; the drawer's transition buttons are the only way to change column.
- **Whole-board refresh on change** — the forwarded event re-reads the complete board rather than patching named cards; at `maxTasks` scale that is one bounded request per notification.
