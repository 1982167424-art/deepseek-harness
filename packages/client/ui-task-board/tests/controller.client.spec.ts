/**
 * TaskBoardController: the browser-local object layer over the durable task
 * board. These specs pin the compare-and-set contract — every mutation sends
 * the revision last observed, a conflict reconciles from the authoritative
 * card carried by the reply, a forwarded change re-reads the board and the
 * open drawer, and a disposed controller stops publishing.
 */
import { describe, expect, it } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  TaskBoardCreateRequest,
  TaskDetail,
  TaskEvent,
  TaskId,
  TaskView,
} from '@deepseek-ai/dsh-task-board/types'
import { TaskBoardController, type TaskBoardRemote } from '../src/client/controller.ts'

const ID = 't-1' as TaskId
const OTHER = 't-2' as TaskId

function card(overrides: Partial<TaskView> = {}): TaskView {
  return {
    id: ID,
    kind: 'manual',
    status: 'initialized',
    title: 'Ship it',
    requirements: 'Ship it completely.',
    referenceImages: [],
    attempts: 0,
    revision: 1,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

/**
 * Per-op scripted answers. The single-tool execute() unwraps the `op`
 * discriminant and routes to the matching handler; this keeps the test
 * script surface identical to the old seven-method shape so call sites
 * don't need to rewrite every assertion.
 */
type Script = {
  list?: () => Promise<unknown>
  get?: (request: { id: TaskId }) => Promise<unknown>
  create?: (request: TaskBoardCreateRequest) => Promise<unknown>
  update?: (request: unknown) => Promise<unknown>
  transition?: (request: unknown) => Promise<unknown>
  move?: (request: unknown) => Promise<unknown>
  remove?: (request: { id: TaskId }) => Promise<unknown>
}

/**
 * A recording fake Remote implementing the single-tool execute() surface.
 * Scripts return the *business* result; this wraps it in the carrier
 * envelope the generated face uses. A script may also return an already-
 * enveloped carrier failure to exercise that branch.
 */
function fakeRemote(script: Script = {}) {
  const calls: { method: string; request: unknown }[] = []
  const carrier = (v: unknown): boolean =>
    typeof v === 'object' && v !== null && 'ok' in v && v.ok === false
      && 'error' in v && 'details' in ((v as { error: object }).error ?? {})
  const handlers: Record<ScriptKey, { handler: Script[ScriptKey]; fallback: unknown }> = {
    list: { handler: script.list, fallback: { ok: true, value: { tasks: [card()] } } },
    get: { handler: script.get, fallback: { ok: true, value: { task: card(), events: [] } satisfies TaskDetail } },
    create: { handler: script.create, fallback: { ok: true, value: card() } },
    update: { handler: script.update, fallback: { ok: true, value: card() } },
    transition: { handler: script.transition, fallback: { ok: true, value: card() } },
    move: { handler: script.move, fallback: { ok: true, value: card() } },
    remove: { handler: script.remove, fallback: { ok: true, value: { absent: true } } },
  }
  type ScriptKey = keyof Script
  type ExecuteRequest = Parameters<TaskBoardRemote['execute']>[0]
  const remote: TaskBoardRemote = {
    execute: (request: ExecuteRequest): Promise<ReturnType<TaskBoardRemote['execute']>> => {
      const op = request.op as ScriptKey
      const inner = handlers[op]
      // Extract the per-op payload the controller actually sent.
      // create/update/transition/move carry a payload; get/remove carry id.
      let innerRequest: unknown
      if ('payload' in request) innerRequest = request.payload
      else if ('id' in request) innerRequest = { id: request.id }
      else innerRequest = undefined
      calls.push({ method: op, request: innerRequest ?? request })
      const { handler, fallback } = inner
      const business = handler === undefined
        ? Promise.resolve(fallback)
        : (handler as (...args: never[]) => Promise<unknown>)(
          ...(innerRequest === undefined ? [] : [innerRequest] as never),
        )
      return business.then(v =>
        (carrier(v) ? v : { ok: true, value: v })) as ReturnType<TaskBoardRemote['execute']>
    },
  }
  return { remote, calls }
}

describe('TaskBoardController', () => {
  it('seeds the view from one list read and collapses concurrent loads', async () => {
    const { remote, calls } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { tasks: [card()] } }),
    })
    const controller = new TaskBoardController(remote)

    expect(controller.getSnapshot().status).toBe('cold')
    await Promise.all([controller.ensure(), controller.ensure(), controller.refresh()])

    const view = controller.getSnapshot()
    expect(view.status).toBe('ready')
    expect(view.tasks).toHaveLength(1)
    expect(calls.filter(call => call.method === 'list')).toHaveLength(1)
  })

  it('opens the board loaded and closes it without dropping the mirror', async () => {
    const { remote } = fakeRemote()
    const controller = new TaskBoardController(remote)

    await controller.openBoard()
    expect(controller.getSnapshot()).toMatchObject({ open: true, status: 'ready' })

    controller.closeBoard()
    const closed = controller.getSnapshot()
    expect(closed).toMatchObject({ open: false, detail: null, status: 'ready' })
  })

  it('sends the observed revision and commits the returned card', async () => {
    const started = card({ status: 'running', attempts: 1, revision: 2 })
    const { remote, calls } = fakeRemote({
      transition: () => Promise.resolve({ ok: true, value: started }),
    })
    const controller = new TaskBoardController(remote)
    await controller.openBoard()

    await expect(controller.transition(ID, 'start')).resolves.toEqual({ ok: true })

    expect(calls).toContainEqual({
      method: 'transition',
      request: { id: ID, action: 'start', ifRevision: 1 },
    })
    expect(controller.getSnapshot().tasks[0]).toEqual(started)
  })

  it('reconciles a revision conflict from the authoritative card in the reply', async () => {
    const authoritative = card({ title: 'Moved on', revision: 7 })
    const { remote, calls } = fakeRemote({
      transition: () => Promise.resolve({
        ok: false,
        error: { code: 'revision-conflict', current: authoritative },
      }),
    })
    const controller = new TaskBoardController(remote)
    await controller.openBoard()

    const result = await controller.transition(ID, 'start')

    expect(result).toMatchObject({ ok: false, error: { code: 'revision-conflict' } })
    expect(controller.getSnapshot().tasks[0]).toEqual(authoritative)
    // The retried mutation now compares against the reconciled revision.
    await controller.transition(ID, 'start', 'again')
    expect(calls.at(-1)?.request).toMatchObject({ ifRevision: 7 })
  })

  it('re-reads the board and the open drawer on a forwarded change', async () => {
    const events: TaskEvent[] = [{ seq: 1, type: 'created', at: 1 }]
    let lists = 0
    let gets = 0
    const { remote } = fakeRemote({
      list: () => {
        lists += 1
        return Promise.resolve({ ok: true, value: { tasks: [card()] } })
      },
      get: () => {
        gets += 1
        return Promise.resolve({ ok: true, value: { task: card(), events } satisfies TaskDetail })
      },
    })
    const controller = new TaskBoardController(remote)
    await controller.openBoard()
    await controller.openDetail(ID)

    await controller.notifyChanged({ ids: [ID] })

    expect(lists).toBe(2)
    expect(gets).toBe(2)
    expect(controller.getSnapshot().detail).toMatchObject({ id: ID })
    expect(controller.getSnapshot().detail?.events).toEqual(events)
  })

  it('closes the drawer with a removed card and keeps every other card', async () => {
    const { remote } = fakeRemote({
      list: () => Promise.resolve({
        ok: true,
        value: { tasks: [card(), card({ id: OTHER, title: 'Other' })] },
      }),
    })
    const controller = new TaskBoardController(remote)
    await controller.openBoard()
    await controller.openDetail(ID)

    await expect(controller.remove(ID)).resolves.toEqual({ ok: true })

    const view = controller.getSnapshot()
    expect(view.detail).toBeNull()
    expect(view.tasks.map(task => task.id)).toEqual([OTHER])
  })

  it('reports a load failure that stays retryable', async () => {
    let failures = 0
    const { remote } = fakeRemote({
      list: () => {
        failures += 1
        return failures === 1
          ? Promise.resolve({ ok: false, error: { code: 'transport', message: 'down', details: {} } })
          : Promise.resolve({ ok: true, value: { tasks: [] } })
      },
    })
    const controller = new TaskBoardController(remote)

    const first = await controller.refresh()
    expect(first).toMatchObject({ ok: false, error: { code: 'transport' } })
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', error: 'down' })

    await expect(controller.refresh()).resolves.toEqual({ ok: true })
    expect(controller.getSnapshot()).toMatchObject({ status: 'ready', error: null })
  })

  it('refuses work once disposed', async () => {
    const { remote } = fakeRemote()
    const controller = new TaskBoardController(remote)
    await controller.openBoard()
    controller.dispose()

    await expect(controller.transition(ID, 'start')).resolves.toMatchObject({
      ok: false, error: { code: 'disposed' },
    })
  })

  it('reconciles the RemoteResult carrier shape through unwrap', async () => {
    const carried = { ok: false, error: { code: 'gone', message: 'namespace gone', details: {} } } as RemoteResult<never>
    const { remote, calls } = fakeRemote({
      transition: () => Promise.resolve(carried as unknown as never),
    })
    const controller = new TaskBoardController(remote)
    await controller.openBoard()

    await expect(controller.transition(ID, 'start')).resolves.toMatchObject({
      ok: false, error: { code: 'gone' },
    })
    expect(calls.at(-1)?.method).toBe('transition')
  })
})
