/**
 * The task board: a durable, auditable, retryable workflow for agent and
 * manual tasks (`ctx.taskBoard`). One card walks the five columns
 * `initialized → running → review → completed | failed` through guarded
 * transitions, keeps an append-only activity log, and reconciles concurrent
 * editors with per-card revision compare-and-set — a lost race returns the
 * authoritative card instead of silently overwriting it.
 *
 * Durability rides the storage-domain seam: the whole board is one
 * `task_board` domain whose writes commit to the configured backend before
 * memory and events update, so a page refresh or a cold harness restart
 * reconciles to the same cards, logs, and revisions. Execution itself stays
 * with the caller: `start`/`retry` record attempts and move the card, and
 * driving an agent session for an agent task remains the deferred
 * orchestration this package deliberately does not own.
 * @module @deepseek-ai/dsh-task-board
 */

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { taskBoardDomainSpec } from './spec.ts'
import type { TaskRow } from './spec.ts'
import type {
  TaskAction,
  TaskBoardCreateRequest,
  TaskBoardCreateResult,
  TaskBoardExecuteRequest,
  TaskBoardExecuteResult,
  TaskBoardFailure,
  TaskBoardFieldTooLong,
  TaskBoardReferenceImagesTooMany,
  TaskBoardGetResult,
  TaskBoardListResult,
  TaskBoardListValue,
  TaskBoardMoveRequest,
  TaskBoardMoveResult,
  TaskBoardRejected,
  TaskBoardRemoveResult,
  TaskBoardRemoveValue,
  TaskBoardSuccess,
  TaskBoardTextFailure,
  TaskBoardTransitionRequest,
  TaskBoardTransitionResult,
  TaskBoardUpdateRequest,
  TaskBoardUpdateResult,
  TaskDetail,
  TaskEvent,
  TaskId,
  TaskStatus,
  TaskView,
} from './types.ts'

export type * from './types.ts'
export { taskBoardDomainSpec, taskRowSchema } from './spec.ts'
export type { TaskRow } from './spec.ts'

/** Deployment-varying capacity and text-size policy for one board. */
export interface Config {
  /** Maximum number of cards the board accepts. */
  readonly maxTasks?: number
  /** Maximum UTF-8 byte length accepted for one title. */
  readonly maxTitleBytes?: number
  /** Maximum UTF-8 byte length accepted for one free-text field. */
  readonly maxTextBytes?: number
}

/** The one source of the plugin defaults, shared by the schema and resolution. */
export const DEFAULT_CONFIG = Object.freeze({
  maxTasks: 500,
  maxTitleBytes: 240,
  maxTextBytes: 10_000,
})

/** Fixed reference-image count bound; a card naming more images is rejected. */
const MAX_REFERENCE_IMAGES = 16

declare module '@deepseek-ai/cordis' {
  interface Context {
    taskBoard: TaskBoardService
  }
}

/**
 * The legal source statuses and side effects of one workflow action.
 * `countsAttempt` marks the two entries into `running` that start execution.
 */
interface TaskTransitionSpec {
  readonly from: readonly TaskStatus[]
  readonly to: TaskStatus
  readonly countsAttempt: boolean
}

/**
 * The closed workflow: five columns, eight guarded transitions. A rejection
 * returns the card to `running` for continued revision on the same card —
 * the board's unit of continuation is the task, not a fresh copy.
 */
const TASK_TRANSITIONS = {
  start: { from: ['initialized'], to: 'running', countsAttempt: true },
  stop: { from: ['running'], to: 'initialized', countsAttempt: false },
  submit: { from: ['running'], to: 'review', countsAttempt: false },
  approve: { from: ['review'], to: 'completed', countsAttempt: false },
  reject: { from: ['review'], to: 'running', countsAttempt: false },
  fail: { from: ['running'], to: 'failed', countsAttempt: false },
  retry: { from: ['failed'], to: 'running', countsAttempt: true },
  reopen: { from: ['completed'], to: 'initialized', countsAttempt: false },
} as const satisfies Record<TaskAction, TaskTransitionSpec>

/** Kanban column order for `list`. */
const STATUS_RANK: Readonly<Record<TaskStatus, number>> = Object.freeze({
  initialized: 0,
  running: 1,
  review: 2,
  completed: 3,
  failed: 4,
})

/** Order spacing between adjacent cards; halved on inserts, restored on renormalize. */
const ORDER_GAP = 1024

/** Build a frozen success branch. */
function success<T>(value: T): TaskBoardSuccess<T> {
  return Object.freeze({ ok: true, value })
}

/** Build a frozen business-failure branch. */
function rejected<E extends TaskBoardFailure>(error: E): TaskBoardRejected<E> {
  return Object.freeze({ ok: false, error: Object.freeze(error) })
}

/** Project one stored row into the client-facing card view. */
function viewOf(row: TaskRow): TaskView {
  return Object.freeze({
    id: row.id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    requirements: row.requirements,
    ...(row.acceptanceCriteria === undefined ? {} : { acceptanceCriteria: row.acceptanceCriteria }),
    ...(row.workspace === undefined ? {} : { workspace: row.workspace }),
    ...(row.agentPreset === undefined ? {} : { agentPreset: row.agentPreset }),
    referenceImages: row.referenceImages,
    attempts: row.attempts,
    revision: row.revision,
    order: row.order,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}

/** Sort snapshot rows into board order: column, in-column order, creation, id. */
function boardSorted(rows: readonly TaskRow[]): readonly TaskRow[] {
  return [...rows].sort((left, right) =>
    STATUS_RANK[left.status] - STATUS_RANK[right.status]
    || left.order - right.order
    || left.createdAt - right.createdAt
    || (left.id < right.id ? -1 : 1),
  )
}

/** Blank or over-long text decided by validation; `null` means keep stored. */

/**
 * Internal sentinel carrying a business failure out of a `table.update`
 * transform, so the serialized mutation maps it onto a rejected result
 * instead of surfacing as an infrastructure error.
 */
class OperationReject extends Error {
  /**
   * @param failure - the business failure the transform decided.
   */
  constructor(readonly failure: TaskBoardFailure) {
    super(failure.code)
  }
}

/** The three string-field limits after config resolution. */
interface TextBounds {
  readonly maxTitleBytes: number
  readonly maxTextBytes: number
}

/**
 * The durable, auditable task board service, exposed over the `taskBoard`
 * Remote namespace.
 */
export class TaskBoardService extends TypertRemoteService {
  static inject = ['storageDomain']

  /** Loader validation for the capacity and text-size policy. */
  static Config: s<Config> = s.object({
    maxTasks: s.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_CONFIG.maxTasks),
    maxTitleBytes: s.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_CONFIG.maxTitleBytes),
    maxTextBytes: s.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_CONFIG.maxTextBytes),
  })

  private readonly maxTasks: number
  private readonly textBounds: TextBounds
  private table?: KvTable<TaskId, TaskRow>
  /** Tail serializing every mutation so read-check-write stays race-free. */
  private operationTail: Promise<void> = Promise.resolve()
  private admissionOpen = true

  /**
   * @param ctx - Host context carrying the storage-domain facility.
   * @param config - capacity and text-size policy.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'taskBoard')
    this.maxTasks = TaskBoardService.resolveBound(config.maxTasks, DEFAULT_CONFIG.maxTasks, 'maxTasks')
    this.textBounds = {
      maxTitleBytes: TaskBoardService.resolveBound(config.maxTitleBytes, DEFAULT_CONFIG.maxTitleBytes, 'maxTitleBytes'),
      maxTextBytes: TaskBoardService.resolveBound(config.maxTextBytes, DEFAULT_CONFIG.maxTextBytes, 'maxTextBytes'),
    }
  }

  /** Open and own the one task-board storage domain. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(taskBoardDomainSpec)
    this.ctx.effect(() => async () => {
      this.admissionOpen = false
      await this.operationTail
      await domain.close()
    }, 'task-board.domainClose')
    this.table = domain.table('tasks')
  }

  /**
   * Single unified entry point for every task-board operation — modeled on
   * CodeGraph's single-tool pattern. One narrowed Remote surface steers
   * callers better than a menu of seven independent methods and saves a
   * smaller type footprint in every session's protocol manifest.
   *
   * The `op` discriminant selects an operation; each arm delegates to the
   * matching internal implementation (kept as plain methods so host-side
   * code can still call a narrow shape directly when that reads better).
   *
   * @param request - the discriminated-union request naming one of the seven
   *   operations and carrying its payload.
   * @returns the widened execute result, whose branches match the former
   *   per-operation result unions exactly so callers branch the same way.
   */
  @Remote('execute')
  execute(request: TaskBoardExecuteRequest): Promise<TaskBoardExecuteResult> {
    switch (request.op) {
      case 'list': return this.list()
      case 'get': return this.get({ id: request.id })
      case 'create': return this.create(request.payload)
      case 'update': return this.update(request.payload)
      case 'transition': return this.transition(request.payload)
      case 'move': return this.move(request.payload)
      case 'remove': return this.remove({ id: request.id })
    }
  }

  /** @internal Read the whole board in board order. */
  async list(): Promise<TaskBoardListResult> {
    const rows: TaskRow[] = []
    for (const [, row] of this.requireTable().entries()) rows.push(row)
    const value: TaskBoardListValue = Object.freeze({
      tasks: Object.freeze(boardSorted(rows).map(viewOf)),
    })
    return success(value)
  }

  /** @internal Read one task with its full activity log. */
  async get(request: { readonly id: TaskId }): Promise<TaskBoardGetResult> {
    const row = this.requireTable().get(request.id)
    if (row === undefined) return rejected({ code: 'task-not-found', id: request.id })
    const detail: TaskDetail = Object.freeze({ task: viewOf(row), events: row.events })
    return success(detail)
  }

  /** @internal Create one task card, optionally already running. */
  create(request: TaskBoardCreateRequest): Promise<TaskBoardCreateResult> {
    const title = this.resolveRequired(request.title, 'title', this.textBounds.maxTitleBytes)
    if (!title.ok) return Promise.resolve(title)
    const requirements = this.resolveRequired(request.requirements, 'requirements', this.textBounds.maxTextBytes)
    if (!requirements.ok) return Promise.resolve(requirements)
    const acceptanceCriteria = this.resolveOptional(request.acceptanceCriteria, 'acceptanceCriteria')
    if (!acceptanceCriteria.ok) return Promise.resolve(acceptanceCriteria)
    const workspace = this.resolveOptional(request.workspace, 'workspace')
    if (!workspace.ok) return Promise.resolve(workspace)
    const agentPreset = this.resolveOptional(request.agentPreset, 'agentPreset')
    if (!agentPreset.ok) return Promise.resolve(agentPreset)
    const images = this.resolveReferenceImages(request.referenceImages)
    if (!images.ok) return Promise.resolve(images)

    return this.serialize(async () => {
      const table = this.requireTable()
      if (table.size >= this.maxTasks) {
        return rejected({ code: 'board-full', maxTasks: this.maxTasks })
      }
      const now = Date.now()
      const start = request.start === true
      const events: TaskEvent[] = [
        { seq: 1, type: 'created', at: now },
        ...(start ? [{ seq: 2, type: 'start' as const, at: now }] : []),
      ]
      const row: TaskRow = {
        id: randomUUID() as TaskId,
        kind: request.kind,
        status: start ? 'running' : 'initialized',
        title: title.value,
        requirements: requirements.value,
        ...(acceptanceCriteria.value === undefined ? {} : { acceptanceCriteria: acceptanceCriteria.value }),
        ...(workspace.value === undefined ? {} : { workspace: workspace.value }),
        ...(agentPreset.value === undefined ? {} : { agentPreset: agentPreset.value }),
        referenceImages: [...images.value],
        attempts: start ? 1 : 0,
        revision: 1,
        order: this.nextOrder(start ? 'running' : 'initialized'),
        createdAt: now,
        updatedAt: now,
        events,
      }
      await table.put(row.id, row)
      this.emitChanged(row.id)
      return success(viewOf(row))
    })
  }

  /** @internal Edit the descriptive fields of one task. */
  update(request: TaskBoardUpdateRequest): Promise<TaskBoardUpdateResult> {
    const title = request.title === undefined ? null : this.resolveRequired(request.title, 'title', this.textBounds.maxTitleBytes)
    if (title !== null && !title.ok) return Promise.resolve(title)
    const requirements = request.requirements === undefined
      ? null
      : this.resolveRequired(request.requirements, 'requirements', this.textBounds.maxTextBytes)
    if (requirements !== null && !requirements.ok) return Promise.resolve(requirements)
    const acceptanceCriteria = request.acceptanceCriteria === undefined
      ? null
      : request.acceptanceCriteria === null
        ? success<string | undefined>(undefined)
        : this.resolveOptional(request.acceptanceCriteria, 'acceptanceCriteria')
    if (acceptanceCriteria !== null && !acceptanceCriteria.ok) return Promise.resolve(acceptanceCriteria)
    const workspace = request.workspace === undefined ? null : request.workspace === null
      ? success<string | undefined>(undefined)
      : this.resolveOptional(request.workspace, 'workspace')
    if (workspace !== null && !workspace.ok) return Promise.resolve(workspace)
    const agentPreset = request.agentPreset === undefined ? null : request.agentPreset === null
      ? success<string | undefined>(undefined)
      : this.resolveOptional(request.agentPreset, 'agentPreset')
    if (agentPreset !== null && !agentPreset.ok) return Promise.resolve(agentPreset)

    const edits: {
      title?: string
      requirements?: string
      acceptanceCriteria?: string | undefined
      workspace?: string | undefined
      agentPreset?: string | undefined
    } = {}
    if (title !== null) edits.title = title.value
    if (requirements !== null) edits.requirements = requirements.value
    if (acceptanceCriteria !== null) edits.acceptanceCriteria = acceptanceCriteria.value
    if (workspace !== null) edits.workspace = workspace.value
    if (agentPreset !== null) edits.agentPreset = agentPreset.value

    return this.serialize(() => this.mutateRow<TaskBoardUpdateResult>(request.id, request.ifRevision, (row) => {
      const nextTitle = edits.title ?? row.title
      const nextRequirements = edits.requirements ?? row.requirements
      const nextAcceptance = 'acceptanceCriteria' in edits ? edits.acceptanceCriteria : row.acceptanceCriteria
      const nextWorkspace = 'workspace' in edits ? edits.workspace : row.workspace
      const nextPreset = 'agentPreset' in edits ? edits.agentPreset : row.agentPreset
      const changed: string[] = []
      if (nextTitle !== row.title) changed.push('title')
      if (nextRequirements !== row.requirements) changed.push('requirements')
      if (nextAcceptance !== row.acceptanceCriteria) changed.push('acceptanceCriteria')
      if (nextWorkspace !== row.workspace) changed.push('workspace')
      if (nextPreset !== row.agentPreset) changed.push('agentPreset')
      if (changed.length === 0) return row
      return this.withEvent(row, { type: 'edited', note: changed.join(',') }, {
        title: nextTitle,
        requirements: nextRequirements,
        acceptanceCriteria: nextAcceptance,
        workspace: nextWorkspace,
        agentPreset: nextPreset,
      })
    }))
  }

  /** @internal Walk one task through a guarded workflow transition. */
  transition(request: TaskBoardTransitionRequest): Promise<TaskBoardTransitionResult> {
    return this.serialize(() => this.mutateRow<TaskBoardTransitionResult>(request.id, request.ifRevision, (row) => {
      const spec: TaskTransitionSpec = TASK_TRANSITIONS[request.action]
      if (!spec.from.includes(row.status)) {
        throw new OperationReject({ code: 'invalid-transition', action: request.action, status: row.status })
      }
      return this.withEvent(row, { type: request.action, ...(request.note === undefined ? {} : { note: request.note }) }, {
        status: spec.to,
        attempts: row.attempts + (spec.countsAttempt ? 1 : 0),
      })
    }))
  }

  /** @internal Reorder one task inside its current column. */
  move(request: TaskBoardMoveRequest): Promise<TaskBoardMoveResult> {
    return this.serialize(async () => {
      const table = this.requireTable()
      const row = table.get(request.id)
      if (row === undefined) return rejected({ code: 'task-not-found', id: request.id })
      if (row.revision !== request.ifRevision) {
        return rejected({ code: 'revision-conflict', current: viewOf(row) })
      }

      let order = this.moveOrderWithin(row.status, request.id, request.beforeTaskId)
      if (order === undefined) {
        await this.renormalizeColumn(row.status)
        order = this.moveOrderWithin(row.status, request.id, request.beforeTaskId)
      }
      if (order === null || order === undefined) {
        return rejected({ code: 'move-target-invalid', beforeTaskId: request.beforeTaskId })
      }
      if (order === row.order) return success(viewOf(row))
      const now = Date.now()
      const next: TaskRow = {
        ...row,
        order,
        revision: row.revision + 1,
        updatedAt: now,
        events: [...row.events, { type: 'moved', seq: row.events.length + 1, at: now }],
      }
      await table.put(row.id, next)
      this.emitChanged(row.id)
      return success(viewOf(next))
    })
  }

  /** @internal Remove one task. */
  remove(request: { readonly id: TaskId }): Promise<TaskBoardRemoveResult> {
    return this.serialize(async () => {
      const removed = await this.requireTable().delete(request.id)
      if (!removed) return rejected({ code: 'task-not-found', id: request.id })
      this.emitChanged(request.id)
      const value: TaskBoardRemoveValue = Object.freeze({ absent: true })
      return success(value)
    })
  }

  /** Resolve one positive bound with its default; misconfiguration fails loud. */
  private static resolveBound(value: number | undefined, fallback: number, name: string): number {
    const resolved = value ?? fallback
    if (!Number.isSafeInteger(resolved) || resolved < 1) {
      throw new TypeError(
        `task-board: ${name} must be a positive safe integer, got ${String(resolved)}`,
      )
    }
    return resolved
  }

  /** Validate one required text field: non-blank and within its byte bound. */
  private resolveRequired(
    value: string,
    field: 'title' | 'requirements',
    maxBytes: number,
  ): TaskBoardSuccess<string> | TaskBoardRejected<TaskBoardTextFailure> {
    if (value.trim().length === 0) return rejected({ code: 'text-blank', field })
    return this.boundText(value, field, maxBytes)
  }

  /** Validate one optional text field: blank means absent, never stored empty. */
  private resolveOptional(
    value: string | undefined,
    field: 'acceptanceCriteria' | 'workspace' | 'agentPreset',
  ): TaskBoardSuccess<string | undefined> | TaskBoardRejected<TaskBoardTextFailure> {
    if (value === undefined || value.trim().length === 0) return success(undefined)
    return this.boundText(value, field, this.textBounds.maxTextBytes)
  }

  /** Enforce the configured UTF-8 byte bound on one validated field. */
  private boundText(
    value: string,
    field: 'title' | 'requirements' | 'acceptanceCriteria' | 'workspace' | 'agentPreset' | 'referenceImages',
    maxBytes: number,
  ): TaskBoardSuccess<string> | TaskBoardRejected<TaskBoardFieldTooLong> {
    const actualBytes = Buffer.byteLength(value, 'utf8')
    if (actualBytes > maxBytes) {
      return rejected({ code: 'field-too-long', field, maxBytes, actualBytes })
    }
    return success(value)
  }

  /** Validate reference images: bounded count, each non-blank and size-bounded. */
  private resolveReferenceImages(
    value: readonly string[] | undefined,
  ): TaskBoardSuccess<readonly string[]> | TaskBoardRejected<TaskBoardFieldTooLong | TaskBoardReferenceImagesTooMany> {
    if (value === undefined) return success([])
    if (value.length > MAX_REFERENCE_IMAGES) {
      return rejected({ code: 'reference-images-too-many', max: MAX_REFERENCE_IMAGES })
    }
    const images: string[] = []
    for (const candidate of value) {
      if (candidate.trim().length === 0) continue
      const bounded = this.boundText(candidate, 'referenceImages', this.textBounds.maxTextBytes)
      if (!bounded.ok) return bounded
      images.push(bounded.value)
    }
    return success(images)
  }

  /**
   * Run one compare-and-set row mutation on the domain write chain. The
   * transform sees the row current at its queue slot; a revision mismatch or
   * workflow violation throws the business sentinel, mapped here onto a
   * rejected result with the authoritative card attached. The static result
   * union is the caller's; the thrown sentinel decides the actual failure at
   * runtime, so the two `as R` boundaries are the one place the wide runtime
   * vocabulary narrows onto each public method's precise result type.
   */
  private async mutateRow<R extends TaskBoardSuccess<TaskView> | TaskBoardRejected<TaskBoardFailure>>(
    id: TaskId,
    ifRevision: number,
    transform: (row: TaskRow) => TaskRow,
  ): Promise<R> {
    const table = this.requireTable()
    // Existence is decided inside the serialized mutation, so a concurrent
    // removal still answers task-not-found rather than a storage error.
    if (table.get(id) === undefined) {
      return Promise.resolve(rejected({ code: 'task-not-found', id }) as R)
    }
    let material = false
    try {
      const next = await table.update(id, (row) => {
        if (row.revision !== ifRevision) {
          throw new OperationReject({ code: 'revision-conflict', current: viewOf(row) })
        }
        const out = transform(row)
        material = out !== row
        return out
      })
      if (material) this.emitChanged(id)
      return success(viewOf(next)) as R
    } catch (error) {
      if (error instanceof OperationReject) return rejected(error.failure) as R
      throw error
    }
  }

  /** Apply one event and field overrides, bumping revision and updatedAt. */
  private withEvent(
    row: TaskRow,
    event: Omit<TaskEvent, 'seq' | 'at'>,
    fields: {
      status?: TaskStatus
      attempts?: number
      title?: string
      requirements?: string
      acceptanceCriteria?: string | undefined
      workspace?: string | undefined
      agentPreset?: string | undefined
    },
  ): TaskRow {
    const now = Date.now()
    const next: TaskRow = { ...row }
    if (fields.title !== undefined) next.title = fields.title
    if (fields.requirements !== undefined) next.requirements = fields.requirements
    if ('acceptanceCriteria' in fields) {
      if (fields.acceptanceCriteria === undefined || fields.acceptanceCriteria.length === 0) {
        delete next.acceptanceCriteria
      } else {
        next.acceptanceCriteria = fields.acceptanceCriteria
      }
    }
    if ('workspace' in fields) {
      if (fields.workspace === undefined || fields.workspace.length === 0) {
        delete next.workspace
      } else {
        next.workspace = fields.workspace
      }
    }
    if ('agentPreset' in fields) {
      if (fields.agentPreset === undefined || fields.agentPreset.length === 0) {
        delete next.agentPreset
      } else {
        next.agentPreset = fields.agentPreset
      }
    }
    if (fields.status !== undefined) next.status = fields.status
    if (fields.attempts !== undefined) next.attempts = fields.attempts
    // A card entering a different column appends to that column's end; its
    // order value from the old column is meaningless in the new one.
    if (fields.status !== undefined && fields.status !== row.status) {
      next.order = this.nextOrder(fields.status)
    }
    next.revision = row.revision + 1
    next.updatedAt = now
    next.events = [...row.events, { ...event, seq: row.events.length + 1, at: now }]
    return next
  }

  /** The column's rows in board order, excluding one task. */
  private columnRows(status: TaskStatus, exclude: TaskId): TaskRow[] {
    const rows: TaskRow[] = []
    for (const [, row] of this.requireTable().entries()) {
      if (row.status === status && row.id !== exclude) rows.push(row)
    }
    return rows.sort((left, right) => left.order - right.order || left.createdAt - right.createdAt)
  }

  /** The order value for a card appended to one column. */
  private nextOrder(status: TaskStatus): number {
    const last = this.columnRows(status, '' as TaskId).at(-1)
    return last === undefined ? 0 : last.order + ORDER_GAP
  }

  /**
   * The order value placing the dragged task above one anchor (or at the
   * column end for `null`). Returns `null` when the anchor is absent or
   * sits in another column, and `undefined` when midpoint spacing between
   * the anchor pair has exhausted and the column needs renormalizing.
   */
  private moveOrderWithin(status: TaskStatus, dragged: TaskId, beforeTaskId: TaskId | null): number | null | undefined {
    const column = this.columnRows(status, dragged)
    if (beforeTaskId === null) {
      const last = column.at(-1)
      return last === undefined ? 0 : last.order + ORDER_GAP
    }
    const anchorIndex = column.findIndex(candidate => candidate.id === beforeTaskId)
    if (anchorIndex < 0) return null
    const anchor = column[anchorIndex]!
    const above = column[anchorIndex - 1]
    if (above === undefined) return anchor.order - ORDER_GAP
    const mid = (above.order + anchor.order) / 2
    if (mid === above.order || mid === anchor.order) return undefined
    return mid
  }

  /**
   * Restore full spacing in one column after midpoint halving exhausts it.
   * Each sibling write commits individually; a crash mid-renormalize leaves a
   * valid board with merely uneven spacing, which the schema permits.
   */
  private async renormalizeColumn(status: TaskStatus): Promise<void> {
    const table = this.requireTable()
    for (const [index, row] of this.columnRows(status, '' as TaskId).entries()) {
      const order = index * ORDER_GAP
      if (order === row.order) continue
      await table.put(row.id, { ...row, order })
    }
  }

  /** Announce one committed card change to mirrors. */
  private emitChanged(id: TaskId): void {
    this.ctx.emit('task-board/updated', { ids: [id] })
  }

  /**
   * Queue one complete mutation behind the prior mutation, so a size check or
   * column scan always observes the previously committed write.
   */
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.admissionOpen) {
      return Promise.reject(new Error('task-board: service is disposing'))
    }
    const result = this.operationTail.then(operation, operation)
    this.operationTail = result.then(() => undefined, () => undefined)
    return result
  }

  /** Resolve the initialized durable table or fail a broken service lifecycle. */
  private requireTable(): KvTable<TaskId, TaskRow> {
    if (this.table === undefined) {
      throw new Error('task-board: durable domain is not initialized')
    }
    return this.table
  }
}

export default TaskBoardService
