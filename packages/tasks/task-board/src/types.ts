/**
 * Client-safe type surface of the task board: the id brand, the five-state
 * workflow vocabulary, the Remote request/value/failure unions, and the
 * Cordis event declaration. Types only — no runtime code, and nothing here
 * reaches a Host-only symbol, so a Client compilation face reads exactly the
 * signature the Host emits.
 * @module @deepseek-ai/dsh-task-board/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Nominal identity of one task card on the board. */
export type TaskId = Branded<'TaskId'>

/** The five board columns, in kanban order. */
export type TaskStatus =
  | 'initialized'
  | 'running'
  | 'review'
  | 'completed'
  | 'failed'

/** Who executes the task; both kinds walk the same workflow. */
export type TaskKind = 'agent' | 'manual'

/** One guarded workflow transition; the service owns the legal source states. */
export type TaskAction =
  | 'start'
  | 'stop'
  | 'submit'
  | 'approve'
  | 'reject'
  | 'fail'
  | 'retry'
  | 'reopen'

/** One append-only audit record in a task's activity log. */
export interface TaskEvent {
  /** Position inside the owning task's log, contiguous from 1. */
  readonly seq: number
  /** What happened: a lifecycle action or a content edit. */
  readonly type: 'created' | 'edited' | 'moved' | TaskAction
  /** Host-assigned time in Unix epoch milliseconds. */
  readonly at: number
  /** Optional human context, preserved verbatim after validation. */
  readonly note?: string | undefined
}

/** One task card, safe for board rendering — the activity log is not carried. */
export interface TaskView {
  /** Stable identity. */
  readonly id: TaskId
  /** Who executes: an agent preset the harness may drive, or a human. */
  readonly kind: TaskKind
  /** Current column. */
  readonly status: TaskStatus
  /** Non-blank one-line summary. */
  readonly title: string
  /** Non-blank task statement: requirements or instructions. */
  readonly requirements: string
  /** Optional acceptance criteria the reviewer checks. */
  readonly acceptanceCriteria?: string
  /** Optional working directory the task names. */
  readonly workspace?: string
  /** Optional agent preset an agent task names. */
  readonly agentPreset?: string
  /** Optional reference images (paths or URLs), stored verbatim. */
  readonly referenceImages: readonly string[]
  /** Execution attempts started so far; `start` and `retry` increment it. */
  readonly attempts: number
  /** Compare-and-set token replaced by every material mutation. */
  readonly revision: number
  /** Position inside the current column; smaller renders higher. */
  readonly order: number
  /** Host-assigned creation time in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Host-assigned time of the most recent material update. */
  readonly updatedAt: number
}

/** One task plus its full activity log. */
export interface TaskDetail {
  /** The current card. */
  readonly task: TaskView
  /** The activity log, in sequence order. */
  readonly events: readonly TaskEvent[]
}

/** Read the whole board; the client searches and filters locally. */
export interface TaskBoardListValue {
  /** Every task, sorted by column, then in-column order, then creation. */
  readonly tasks: readonly TaskView[]
}

/** Create one task card. */
export interface TaskBoardCreateRequest {
  /** Who executes the task. */
  readonly kind: TaskKind
  /** Non-blank one-line summary. */
  readonly title: string
  /** Non-blank task statement. */
  readonly requirements: string
  /** Optional acceptance criteria. */
  readonly acceptanceCriteria?: string
  /** Optional working directory. */
  readonly workspace?: string
  /** Optional agent preset an agent task names. */
  readonly agentPreset?: string
  /** Optional reference images. */
  readonly referenceImages?: readonly string[]
  /** Create already running (create-and-start); records the first attempt. */
  readonly start?: boolean
}

/** Edit the descriptive fields of one task; workflow goes through transitions. */
export interface TaskBoardUpdateRequest {
  /** Target task. */
  readonly id: TaskId
  /** Observed revision the edit must match. */
  readonly ifRevision: number
  /** Replacement title; omitted keeps the stored one. */
  readonly title?: string
  /** Replacement requirements; omitted keeps the stored one. */
  readonly requirements?: string
  /** Replacement acceptance criteria; `null` clears, omitted keeps. */
  readonly acceptanceCriteria?: string | null
  /** Replacement workspace; `null` clears, omitted keeps. */
  readonly workspace?: string | null
  /** Replacement agent preset; `null` clears, omitted keeps. */
  readonly agentPreset?: string | null
}

/** Walk one task through a guarded workflow transition. */
export interface TaskBoardTransitionRequest {
  /** Target task. */
  readonly id: TaskId
  /** The transition to apply. */
  readonly action: TaskAction
  /** Observed revision the transition must match. */
  readonly ifRevision: number
  /** Optional context recorded into the activity log. */
  readonly note?: string
}

/**
 * Reorder one task inside its current column. Cross-column moves are
 * rejected: column changes are workflow transitions, not drags.
 */
export interface TaskBoardMoveRequest {
  /** The dragged task. */
  readonly id: TaskId
  /** The task the dragged one must render above, or `null` for the column end. */
  readonly beforeTaskId: TaskId | null
  /** Observed revision of the dragged task. */
  readonly ifRevision: number
}

/** Remove one task. */
export interface TaskBoardRemoveRequest {
  /** Target task. */
  readonly id: TaskId
}

/** Read one task with its activity log. */
export interface TaskBoardGetRequest {
  /** Target task. */
  readonly id: TaskId
}

/** Idempotent removal acknowledgement. */
export interface TaskBoardRemoveValue {
  /** Stable postcondition shared by the first removal and every retry. */
  readonly absent: true
}

/** No task exists for the requested id. */
export interface TaskBoardTaskNotFound {
  readonly code: 'task-not-found'
  readonly id: TaskId
}

/** The action's source state does not include the task's current status. */
export interface TaskBoardInvalidTransition {
  readonly code: 'invalid-transition'
  readonly action: TaskAction
  readonly status: TaskStatus
}

/** A material mutation did not match the addressed task's current revision. */
export interface TaskBoardRevisionConflict {
  readonly code: 'revision-conflict'
  /** Authoritative current card, or `null` when it does not exist. */
  readonly current: TaskView | null
}

/** The board already holds the configured maximum number of tasks. */
export interface TaskBoardFull {
  readonly code: 'board-full'
  readonly maxTasks: number
}

/** A required text field contains no non-whitespace character. */
export interface TaskBoardTextBlank {
  readonly code: 'text-blank'
  readonly field: 'title' | 'requirements'
}

/** A text field exceeds its configured UTF-8 byte limit. */
export interface TaskBoardFieldTooLong {
  readonly code: 'field-too-long'
  readonly field: 'title' | 'requirements' | 'acceptanceCriteria' | 'workspace' | 'agentPreset' | 'referenceImages'
  readonly maxBytes: number
  readonly actualBytes: number
}

/** A card named more reference images than the fixed bound accepts. */
export interface TaskBoardReferenceImagesTooMany {
  readonly code: 'reference-images-too-many'
  readonly max: number
}

/** A move target is absent or sits in another column. */
export interface TaskBoardMoveTargetInvalid {
  readonly code: 'move-target-invalid'
  readonly beforeTaskId: TaskId | null
}

/** Blank-or-over-long text failures, shared by create and update. */
export type TaskBoardTextFailure = TaskBoardTextBlank | TaskBoardFieldTooLong

/** Failures shared by the public task-board operations. */
export type TaskBoardFailure =
  | TaskBoardTaskNotFound
  | TaskBoardInvalidTransition
  | TaskBoardRevisionConflict
  | TaskBoardFull
  | TaskBoardTextBlank
  | TaskBoardFieldTooLong
  | TaskBoardReferenceImagesTooMany
  | TaskBoardMoveTargetInvalid

/** Successful public operation result. */
export interface TaskBoardSuccess<T> {
  readonly ok: true
  readonly value: T
}

/** Rejected public operation result with a stable business failure. */
export interface TaskBoardRejected<E extends TaskBoardFailure> {
  readonly ok: false
  readonly error: E
}

/** Result returned by the task-board `list` operation. */
export type TaskBoardListResult = TaskBoardSuccess<TaskBoardListValue>

/** Result returned by the task-board `get` operation. */
export type TaskBoardGetResult =
  | TaskBoardSuccess<TaskDetail>
  | TaskBoardRejected<TaskBoardTaskNotFound>

/** Result returned by the task-board `create` operation. */
export type TaskBoardCreateResult =
  | TaskBoardSuccess<TaskView>
  | TaskBoardRejected<
    | TaskBoardFull
    | TaskBoardTextBlank
    | TaskBoardFieldTooLong
    | TaskBoardReferenceImagesTooMany
  >

/** Result returned by the task-board `update` operation. */
export type TaskBoardUpdateResult =
  | TaskBoardSuccess<TaskView>
  | TaskBoardRejected<
    | TaskBoardTaskNotFound
    | TaskBoardRevisionConflict
    | TaskBoardTextBlank
    | TaskBoardFieldTooLong
  >

/** Result returned by the task-board `transition` operation. */
export type TaskBoardTransitionResult =
  | TaskBoardSuccess<TaskView>
  | TaskBoardRejected<
    | TaskBoardTaskNotFound
    | TaskBoardRevisionConflict
    | TaskBoardInvalidTransition
  >

/** Result returned by the task-board `move` operation. */
export type TaskBoardMoveResult =
  | TaskBoardSuccess<TaskView>
  | TaskBoardRejected<
    | TaskBoardTaskNotFound
    | TaskBoardRevisionConflict
    | TaskBoardMoveTargetInvalid
  >

/** Result returned by the task-board `remove` operation. */
export type TaskBoardRemoveResult =
  | TaskBoardSuccess<TaskBoardRemoveValue>
  | TaskBoardRejected<TaskBoardTaskNotFound>

/** Committed change to one or more tasks, named by id. */
export interface TaskBoardChange {
  /** Tasks whose stored card changed; a removed task is still named. */
  readonly ids: readonly TaskId[]
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Committed change to one or more task-board cards: a create, edit,
     * transition, move, or removal. The write has already committed, so a
     * listener reconciles from the ids rather than participating in the
     * operation; listener failures are contained and logged.
     * @param change - the tasks whose stored cards changed.
     * @mode emit
     */
    'task-board/updated'(change: TaskBoardChange): void
  }
}
