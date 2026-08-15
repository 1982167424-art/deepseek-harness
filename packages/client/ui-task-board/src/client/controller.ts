/**
 * Browser-local object layer over the durable task board. The Host owns
 * per-card revision compare-and-set: every mutation carries the revision this
 * controller last observed, and a `revision-conflict` reply carries the
 * authoritative card, so a lost race reconciles from the reply itself. The
 * forwarded `task-board/updated` event drives a whole-board re-read, which
 * closes any revision gap a dropped frame could leave behind.
 * @module @deepseek-ai/dsh-client-ui-task-board/client/controller
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  TaskAction,
  TaskBoardChange,
  TaskBoardCreateRequest,
  TaskBoardCreateResult,
  TaskBoardFailure,
  TaskBoardGetResult,
  TaskBoardListResult,
  TaskBoardMoveResult,
  TaskBoardRejected,
  TaskBoardRemoveResult,
  TaskBoardSuccess,
  TaskBoardTransitionResult,
  TaskBoardUpdateResult,
  TaskEvent,
  TaskId,
  TaskView,
} from '@deepseek-ai/dsh-task-board/types'

/**
 * The seven Remote calls this controller needs. The generated face wraps
 * every business result in {@link RemoteResult}: a carrier failure arrives as
 * the `ok: false` branch rather than a rejection.
 */
export interface TaskBoardRemote {
  list: () => Promise<RemoteResult<TaskBoardListResult>>
  get: (request: { id: TaskId }) => Promise<RemoteResult<TaskBoardGetResult>>
  create: (request: TaskBoardCreateRequest) => Promise<RemoteResult<TaskBoardCreateResult>>
  update: (request: {
    id: TaskId
    ifRevision: number
    title?: string
    requirements?: string
    acceptanceCriteria?: string | null
    workspace?: string | null
    agentPreset?: string | null
  }) => Promise<RemoteResult<TaskBoardUpdateResult>>
  transition: (request: {
    id: TaskId
    action: TaskAction
    ifRevision: number
    note?: string
  }) => Promise<RemoteResult<TaskBoardTransitionResult>>
  move: (request: {
    id: TaskId
    beforeTaskId: TaskId | null
    ifRevision: number
  }) => Promise<RemoteResult<TaskBoardMoveResult>>
  remove: (request: { id: TaskId }) => Promise<RemoteResult<TaskBoardRemoveResult>>
}

/** Load state of the board mirror. */
export type TaskBoardStatus = 'cold' | 'loading' | 'ready' | 'error'

/** The open task's activity log, fetched on demand. */
export interface TaskBoardDetailState {
  readonly id: TaskId
  readonly events: readonly TaskEvent[]
}

/** Immutable view published to every board component. */
export interface TaskBoardView {
  /** Whether the board overlay is visible. */
  readonly open: boolean
  readonly status: TaskBoardStatus
  /** Cards in board order; the component layer searches and filters locally. */
  readonly tasks: readonly TaskView[]
  /** The task whose detail drawer is open, with its activity log. */
  readonly detail: TaskBoardDetailState | null
  /** Reason the last load failed, cleared by the next successful load. */
  readonly error: string | null
}

/** Settled action shape rendered by the board controls. */
export type TaskBoardActionResult =
  | { ok: true }
  | { ok: false; error: { code: string; message: string } }

const INITIAL_VIEW: TaskBoardView = Object.freeze({
  open: false,
  status: 'cold',
  tasks: Object.freeze([]),
  detail: null,
  error: null,
})

/**
 * The widened outcome every card-returning mutation shares: the surviving
 * card, or a named business failure. Each Remote method's own result union is
 * a subset of this union, so one peel covers create, update, transition, and
 * move.
 */
type TaskBoardMutationOutcome = TaskBoardSuccess<TaskView> | TaskBoardRejected<TaskBoardFailure>

const OK: TaskBoardActionResult = Object.freeze({ ok: true })

const DISPOSED: TaskBoardActionResult = Object.freeze({
  ok: false,
  error: Object.freeze({ code: 'disposed', message: 'task board controller is disposed' }),
})

/** Carrier failure rendered with the Host-supplied code and message. */
function carrierFailure(error: { code: string; message: string }): TaskBoardActionResult {
  return { ok: false, error: { code: error.code, message: error.message } }
}

/**
 * The board's browser object layer: one mirror of the durable board, one
 * detail drawer, and serialized mutations that always compare against the
 * committed revision.
 */
export class TaskBoardController implements HostObservable<TaskBoardView> {
  private view = INITIAL_VIEW
  private readonly listeners = new Set<() => void>()
  private loadPromise: Promise<TaskBoardActionResult> | null = null
  private operationTail: Promise<void> = Promise.resolve()
  private disposed = false

  /**
   * @param remote - the taskBoard Remote namespace.
   */
  constructor(private readonly remote: TaskBoardRemote) {}

  /** Return the cached immutable view. */
  getSnapshot = (): TaskBoardView => this.view

  /** Subscribe to view replacement. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Show the board, loading it first when it is still cold.
   * @returns the settled load result.
   */
  openBoard(): Promise<TaskBoardActionResult> {
    this.publish({ ...this.view, open: true })
    return this.ensure()
  }

  /** Hide the board and the detail drawer; the mirror stays loaded. */
  closeBoard(): void {
    this.publish({ ...this.view, open: false, detail: null })
  }

  /**
   * Load once; a failed load stays retryable.
   * @returns the settled load result.
   */
  ensure(): Promise<TaskBoardActionResult> {
    if (this.view.status === 'ready') return Promise.resolve(OK)
    return this.refresh()
  }

  /**
   * Re-read the whole board, collapsing concurrent callers onto one read.
   * @returns the settled load result, shared by concurrent callers.
   */
  refresh(): Promise<TaskBoardActionResult> {
    if (this.loadPromise !== null) return this.loadPromise
    this.publish({ ...this.view, status: 'loading', error: null })
    const pending = this.load()
    this.loadPromise = pending
    return pending.finally(() => { this.loadPromise = null })
  }

  /**
   * Reconcile one forwarded change notification by re-reading the board and
   * the open detail — the simple, gap-proof answer to a dropped frame.
   * @param change - the cards the Host named.
   * @returns the settled reconcile result.
   */
  notifyChanged(change: TaskBoardChange): Promise<TaskBoardActionResult> {
    return this.mutate(async () => {
      await this.refresh()
      const detail = this.view.detail
      if (detail !== null) await this.loadDetail(detail.id)
      return OK
    }, { seed: false, ids: change.ids })
  }

  /**
   * Open the detail drawer for one task, fetching its activity log.
   * @param id - target card.
   * @returns the settled detail-load result.
   */
  openDetail(id: TaskId): Promise<TaskBoardActionResult> {
    return this.mutate(async () => this.loadDetail(id))
  }

  /** Close the detail drawer without touching the mirror. */
  closeDetail(): void {
    this.publish({ ...this.view, detail: null })
  }

  /**
   * Create one card from the compose form.
   * @param request - the card to create.
   * @returns the settled mutation result.
   */
  create(request: TaskBoardCreateRequest): Promise<TaskBoardActionResult> {
    return this.mutate(async () => this.commit(await this.remote.create(request)))
  }

  /**
   * Edit the descriptive fields of one card against its committed revision.
   * @param id - target card.
   * @param fields - desired fields; `null` clears an optional one.
   * @returns the settled mutation result.
   */
  update(id: TaskId, fields: {
    title?: string
    requirements?: string
    acceptanceCriteria?: string | null
    workspace?: string | null
    agentPreset?: string | null
  }): Promise<TaskBoardActionResult> {
    return this.mutate(async () => {
      const observed = this.cardOf(id)
      if (observed === undefined) return this.missing()
      return this.commit(await this.remote.update({ id, ...fields, ifRevision: observed.revision }))
    })
  }

  /**
   * Walk one card through a workflow transition against its committed
   * revision.
   * @param id - target card.
   * @param action - the transition to apply.
   * @param note - optional context for the activity log.
   * @returns the settled mutation result.
   */
  transition(id: TaskId, action: TaskAction, note?: string): Promise<TaskBoardActionResult> {
    return this.mutate(async () => {
      const observed = this.cardOf(id)
      if (observed === undefined) return this.missing()
      const result = await this.remote.transition({
        id,
        action,
        ifRevision: observed.revision,
        ...(note === undefined ? {} : { note }),
      })
      return this.commit(result)
    })
  }

  /**
   * Reorder one card inside its column against its committed revision.
   * @param id - the dragged card.
   * @param beforeTaskId - the card it must render above, or `null` for the end.
   * @returns the settled mutation result.
   */
  move(id: TaskId, beforeTaskId: TaskId | null): Promise<TaskBoardActionResult> {
    return this.mutate(async () => {
      const observed = this.cardOf(id)
      if (observed === undefined) return this.missing()
      const result = await this.remote.move({
        id,
        beforeTaskId,
        ifRevision: observed.revision,
      })
      return this.commit(result)
    })
  }

  /**
   * Remove one card; the open drawer closes with it.
   * @param id - target card.
   * @returns the settled mutation result.
   */
  remove(id: TaskId): Promise<TaskBoardActionResult> {
    return this.mutate(async () => {
      const carried = await this.remote.remove({ id })
      if (this.disposed) return OK
      if (!carried.ok) return carrierFailure(carried.error)
      const result = carried.value
      if (!result.ok) {
        return { ok: false, error: { code: result.error.code, message: result.error.code } }
      }
      const tasks = this.view.tasks.filter(task => task.id !== id)
      this.publish({
        ...this.view,
        tasks: Object.freeze(tasks),
        detail: this.view.detail?.id === id ? null : this.view.detail,
      })
      return OK
    })
  }

  /** Drop subscribers and refuse further work when the owning fiber unloads. */
  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  /** Fetch the whole board and publish it as the seeded view. */
  private async load(): Promise<TaskBoardActionResult> {
    try {
      const carried = await this.remote.list()
      if (this.disposed) return OK
      if (!carried.ok) {
        this.publish({ ...this.view, status: 'error', error: carried.error.message })
        return carrierFailure(carried.error)
      }
      // `list` has no business rejection: its only failure is the carrier.
      this.publish({ ...this.view, status: 'ready', tasks: carried.value.value.tasks, error: null })
      return OK
    } catch (error) {
      if (this.disposed) return OK
      const message = error instanceof Error ? error.message : 'task board list failed'
      this.publish({ ...this.view, status: 'error', error: message })
      return { ok: false, error: { code: 'transport', message } }
    }
  }

  /** Fetch one card's activity log and open its drawer. */
  private async loadDetail(id: TaskId): Promise<TaskBoardActionResult> {
    try {
      const carried = await this.remote.get({ id })
      if (this.disposed) return OK
      if (!carried.ok) return carrierFailure(carried.error)
      const result = carried.value
      if (!result.ok) {
        return { ok: false, error: { code: result.error.code, message: result.error.code } }
      }
      this.commitCard(result.value.task)
      this.publish({ ...this.view, detail: { id, events: result.value.events } })
      return OK
    } catch (error) {
      const message = error instanceof Error ? error.message : 'task board detail failed'
      return { ok: false, error: { code: 'transport', message } }
    }
  }

  /** Read one card out of the committed mirror. */
  private cardOf(id: TaskId): TaskView | undefined {
    return this.view.tasks.find(task => task.id === id)
  }

  /** The settled result for a card the mirror no longer holds. */
  private missing(): TaskBoardActionResult {
    void this.refresh()
    return { ok: false, error: { code: 'task-not-found', message: 'task not found' } }
  }

  /**
   * Peel one card-returning mutation's carrier: a carrier failure as a
   * settled action failure, the surviving card committed into the mirror, and
   * a `revision-conflict` reconciled from the authoritative card the Host
   * attached before the failure surfaces.
   */
  private commit(carried: RemoteResult<TaskBoardMutationOutcome>): TaskBoardActionResult {
    if (this.disposed) return OK
    if (!carried.ok) return carrierFailure(carried.error)
    const result = carried.value
    if (result.ok) {
      this.commitCard(result.value)
      return OK
    }
    if (result.error.code === 'revision-conflict' && result.error.current !== null) {
      this.commitCard(result.error.current)
    }
    return { ok: false, error: { code: result.error.code, message: result.error.code } }
  }

  /** Replace one card's entry, keeping every other card's identity. */
  private commitCard(card: TaskView): void {
    const tasks = [...this.view.tasks]
    const index = tasks.findIndex(task => task.id === card.id)
    if (index < 0) tasks.push(card)
    else tasks[index] = card
    this.publish({ ...this.view, status: 'ready', tasks: Object.freeze(tasks), error: null })
  }

  /**
   * Serialize one mutation behind the prior mutation so queued operations
   * always compare against the committed revision, and translate a transport
   * throw into the same settled shape the controls already render.
   */
  private mutate(
    operation: () => Promise<TaskBoardActionResult>,
    options: { readonly seed?: boolean; readonly ids?: readonly TaskId[] } = {},
  ): Promise<TaskBoardActionResult> {
    const guarded = async (): Promise<TaskBoardActionResult> => {
      if (this.disposed) return DISPOSED
      if (options.ids !== undefined && options.ids.length === 0) return OK
      if (options.seed !== false) {
        const loaded = await this.ensure()
        if (!loaded.ok) return loaded
        // Disposal can land while the seeding read is in flight; without this
        // second check the fiber would still reach the wire after unloading.
        if (this.disposed) return DISPOSED
      }
      try {
        return await operation()
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'transport',
            message: error instanceof Error ? error.message : 'task board mutation failed',
          },
        }
      }
    }
    const result = this.operationTail.then(guarded, guarded)
    this.operationTail = result.then(() => undefined)
    return result
  }

  /** Replace the view and contain subscriber failures at the observable boundary. */
  private publish(view: TaskBoardView): void {
    this.view = Object.freeze(view)
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.error('[ui-task-board] subscriber threw:', error)
      }
    }
  }
}
