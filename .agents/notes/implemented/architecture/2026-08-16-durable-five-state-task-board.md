# Agent Note: Durable five-state task board

Status: implemented

English | [中文](2026-08-16-durable-five-state-task-board.zh.md)

## Problem

The session `todo_write` tool gives the model scratch state that lives inside one conversation and is model-visible by design. Product work items need the opposite: a kanban board a human opens from the sidebar, edits across turns and restarts, reviews, retries, and audits — without any of it entering model context, the Session log, or telemetry. That state needs its own lifecycle discipline (a card must not skip from `initialized` to `completed`), its own audit trail (who moved what, when, with what note), and a concurrency story now that a browser client, a second tab, and a restarted Host can all touch the same card.

The existing `jobs` registry is process-local background execution, not durable product state; the `message-feedback` sidecar owns per-message ratings, not workflow. Nothing in the repository owns a durable, guarded, retryable work-item object.

## Decision

`@deepseek-ai/dsh-task-board` owns `ctx.taskBoard` and stores the whole board as one storage-domain `task_board` domain (version 0) with a single `tasks` table keyed by an opaque `TaskId`. One row carries the card, its `revision`, its fractional in-column `order`, and the complete append-only activity log, so a card and its audit history commit atomically on the domain's write chain and a cold restart reconciles to identical state. Rows are zod-validated on read with structural invariants (contiguous `seq` from 1, log opening with `created`, `updatedAt` never before `createdAt`).

The workflow is a closed five-column, eight-action graph — `start`, `stop`, `submit`, `approve`, `reject`, `fail`, `retry`, `reopen` — encoded as one declarative transition table whose `countsAttempt` flag marks the two entries into `running`. A `reject` returns a card from `review` to `running` on the same card: continuation is the task, not a fresh copy. Any action outside the table's source statuses returns `invalid-transition` without touching storage.

Concurrency is per-card compare-and-set. Every material mutation carries the caller's last observed `ifRevision`; a mismatch returns `revision-conflict` together with the authoritative current card, so a lost race reconciles from the reply with no second read. A matching-revision no-op returns the stored card unchanged. In-column drag reorder goes through `move` with a `beforeTaskId` anchor; a cross-column target returns `move-target-invalid`, because changing column is a workflow transition, not a drag. Fractional `order` spacing is renormalized lazily when interleaved inserts collapse it.

The service publishes seven Host Remote methods (`taskBoard.list/get/create/update/transition/move/remove`) through `TypertRemoteService` and `@Remote`, each returning a discriminated business union. Every committed mutation emits the Host `task-board/updated` event naming the touched ids; `dsh-api-remotes` adds it to the forwarded-event allowlist, so the browser mirror converges across tabs and reconnects. `dsh-client-ui-task-board` is the browser consumer: one `TaskBoardController` mirrors the board from a single `list` read, serializes mutations behind the committed revision, reconciles conflicts from the reply, and re-reads on each forwarded event. The overlay contributes the `shell.overlay` entry and a `sidebar.footer.action` opener; copy lives in the `taskBoard` locale namespace.

Execution is deliberately not owned: `start` and `retry` record attempts and move the card, and driving an agent session for an `agent` card (its preset and workspace are stored fields) is deferred orchestration. Deployment policy is explicit `Config` — `maxTasks`, `maxTitleBytes`, `maxTextBytes` — validated at load; the reference-image bound is a fixed protocol constant.

## Alternatives considered

**Reuse `todo_write` or the `jobs` registry.** Rejected because todo state is model-visible scratch inside one session, and jobs are process-local execution records; neither has a guarded lifecycle, durable audit trail, or a product-facing editing surface.

**Derive the board from Session events or a projection.** Rejected for the same reason message feedback chose a sidecar: editable product metadata would become canonical conversation-adjacent history, forks would replay it, and deletion would need tombstones. The board is a storage-domain object, not Session content.

**A per-card status enum with free-form updates.** Rejected because an unguarded `update` could move a card from `initialized` straight to `completed`, bypassing review; the declarative transition table makes the workflow mechanically enforceable and self-documenting.

**Cross-column drag with automatic transitions.** Rejected because silently mapping a drag onto `submit` or `approve` would hide review semantics inside a reorder; the drawer's explicit transition buttons are the only path between columns.

**Event-sourced activity in a separate table.** Rejected because it would give up the atomic commit of a card with its audit record and add a join to every `get`; the log lives inside the row, bounded by the same write chain.

## Consequences

What it cost: mutations pay one revision round-trip and the browser mirror re-reads the whole board per forwarded event — bounded by `maxTasks`, and the simple, gap-proof answer to a dropped frame. Revision compare-and-set holds inside one service instance only; multiple Host processes on one storage root can still lose updates, and the board claims no cross-process linearizability. The activity log grows without pruning inside the row. Nothing yet drives agent execution from an `agent` card, so the board records intent and outcome but not the running work itself.

What it bought: a product work-item surface with a mechanically guarded lifecycle, an atomic per-card audit trail, restart-proof durability, conflict replies that carry their own reconciliation, and a browser kanban whose copy is bilingual and whose state never touches model context — the same separation the message-feedback sidecar established, extended from one rating to a full workflow.
