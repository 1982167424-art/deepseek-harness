import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import TaskBoardService, { DEFAULT_CONFIG } from '../src/index.ts'
import type { TaskBoardCreateRequest, TaskId, TaskView } from '../src/index.ts'

interface Harness {
  readonly ctx: Context
  readonly board: TaskBoardService
  disposeFiber(): Promise<void>
  dispose(): Promise<void>
}

const harnesses: Harness[] = []

/**
 * Compose the board over the real storage hub/domain/JSON backend. The
 * harness exposes the live service through `ctx.taskBoard`, so disposing and
 * re-loading the fiber observes cold-restart reconciliation on the same root.
 */
async function setup(config: Record<string, number> = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-task-board-test-'))
  const ctx = new Context()
  let disposeFiber: (() => Promise<void>) | undefined
  const harness: Harness = {
    ctx,
    get board() { return ctx.taskBoard },
    disposeFiber: () => Promise.resolve(),
    async dispose() {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
  try {
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    const fiber = await ctx.plugin(TaskBoardService, config)
    disposeFiber = fiber.dispose
    harness.disposeFiber = () => disposeFiber!()
  } catch (error) {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
    throw error
  }
  harnesses.push(harness)
  return harness
}

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(harness => harness.dispose()))
})

/** Unwrap a successful board result or fail the test with its code. */
function ok(result: { ok: true; value: TaskView } | { ok: false; error: { code: string } }): TaskView {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}`)
  return result.value
}

/** One minimal creation request. */
function createRequest(overrides: Partial<TaskBoardCreateRequest> = {}): TaskBoardCreateRequest {
  return {
    kind: 'manual',
    title: 'Ship the thing',
    requirements: 'Ship it completely, then verify.',
    ...overrides,
  }
}

/** Create one task and return its card. */
async function create(harness: Harness, overrides: Partial<TaskBoardCreateRequest> = {}): Promise<TaskView> {
  return ok(await harness.board.create(createRequest(overrides)))
}

/** The current board titles in list order. */
async function titles(harness: Harness): Promise<string[]> {
  const listed = await harness.board.list()
  if (!listed.ok) throw new Error('list failed')
  return listed.value.tasks.map(task => task.title)
}

describe('TaskBoardService public contract', () => {
  it('publishes the exact Gateway namespace and the single-tool Remote method', async () => {
    const { board } = await setup()
    const binding = board.typertRemote
    expect(binding.serviceKey).toBe('taskBoard')
    expect(binding.namespace).toBe('taskBoard')
    // Follows CodeGraph's single-tool pattern: one narrowed entry instead of
    // seven narrow methods. The discriminant dispatches inside execute().
    expect(remoteMethods(board)).toEqual([
      { method: 'execute', invocation: { kind: 'direct' } },
    ])
  })

  it('resolves the documented defaults and rejects a broken capacity bound', () => {
    expect(DEFAULT_CONFIG.maxTasks).toBe(500)
    expect(() => new TaskBoardService(new Context(), { maxTasks: 0 })).toThrow(/maxTasks/)
  })
})

describe('create and list', () => {
  it('creates initialized by default and running with start, recording the attempt', async () => {
    const harness = await setup()
    const cold = await create(harness)
    expect(cold.status).toBe('initialized')
    expect(cold.attempts).toBe(0)
    expect(cold.revision).toBe(1)

    const hot = await create(harness, { title: 'Hot', start: true })
    expect(hot.status).toBe('running')
    expect(hot.attempts).toBe(1)

    const hotDetail = await harness.board.get({ id: hot.id })
    if (!hotDetail.ok) throw new Error('get failed')
    expect(hotDetail.value.events.map(event => event.type)).toEqual(['created', 'start'])
  })

  it('lists in column, in-column order, and creation order', async () => {
    const harness = await setup()
    const first = await create(harness, { title: 'first' })
    await create(harness, { title: 'second' })
    const running = await create(harness, { title: 'running', start: true })
    // Columns read left to right: initialized, running, review, completed, failed.
    expect(await titles(harness)).toEqual(['first', 'second', 'running'])

    const started = ok(await harness.board.transition({ id: first.id, action: 'start', ifRevision: first.revision }))
    expect(started.status).toBe('running')
    expect(await titles(harness)).toEqual(['second', 'running', 'first'])

    const stopped = ok(await harness.board.transition({
      id: running.id, action: 'stop', ifRevision: running.revision,
    }))
    expect(stopped.status).toBe('initialized')
    expect(await titles(harness)).toEqual(['second', 'running', 'first'])
  })

  it('keeps optional fields absent until set and never stores blank ones', async () => {
    const harness = await setup()
    const bare = await create(harness, {
      workspace: '   ',
      agentPreset: '',
      referenceImages: ['  ', 'file:///tmp/a.png', ''],
    })
    expect(bare.workspace).toBeUndefined()
    expect(bare.agentPreset).toBeUndefined()
    expect(bare.referenceImages).toEqual(['file:///tmp/a.png'])
  })

  it('rejects blank and over-long text by field, and over-many reference images', async () => {
    const harness = await setup()
    await expect(harness.board.create(createRequest({ title: '  ' })))
      .resolves.toMatchObject({ ok: false, error: { code: 'text-blank', field: 'title' } })
    await expect(harness.board.create(createRequest({ requirements: '\t\n' })))
      .resolves.toMatchObject({ ok: false, error: { code: 'text-blank', field: 'requirements' } })
    await expect(harness.board.create(createRequest({ title: 'x'.repeat(241) })))
      .resolves.toMatchObject({ ok: false, error: { code: 'field-too-long', field: 'title' } })
    await expect(harness.board.create(createRequest({ acceptanceCriteria: 'y'.repeat(10_001) })))
      .resolves.toMatchObject({ ok: false, error: { code: 'field-too-long', field: 'acceptanceCriteria' } })
    await expect(harness.board.create(createRequest({
      referenceImages: Array.from({ length: 17 }, (_, index) => `img-${index}`),
    }))).resolves.toMatchObject({ ok: false, error: { code: 'reference-images-too-many', max: 16 } })
  })

  it('enforces the configured capacity as a loud failure', async () => {
    const harness = await setup({ maxTasks: 1 })
    await create(harness)
    await expect(harness.board.create(createRequest({ title: 'second' })))
      .resolves.toMatchObject({ ok: false, error: { code: 'board-full', maxTasks: 1 } })
  })
})

describe('workflow transitions', () => {
  it('walks the happy path start → submit → approve to completed', async () => {
    const harness = await setup()
    const task = await create(harness)
    const started = ok(await harness.board.transition({ id: task.id, action: 'start', ifRevision: task.revision }))
    expect(started.status).toBe('running')
    expect(started.attempts).toBe(1)
    const submitted = ok(await harness.board.transition({
      id: task.id, action: 'submit', ifRevision: started.revision, note: 'ready for review',
    }))
    expect(submitted.status).toBe('review')
    const approved = ok(await harness.board.transition({ id: task.id, action: 'approve', ifRevision: submitted.revision }))
    expect(approved.status).toBe('completed')

    const detail = await harness.board.get({ id: task.id })
    if (!detail.ok) throw new Error('get failed')
    expect(detail.value.events.map(event => event.type)).toEqual(['created', 'start', 'submit', 'approve'])
    expect(detail.value.events[2]).toMatchObject({ note: 'ready for review' })
  })

  it('continues revision on the same card after a rejection', async () => {
    const harness = await setup()
    const task = await create(harness, { start: true })
    const submitted = ok(await harness.board.transition({ id: task.id, action: 'submit', ifRevision: task.revision }))
    const rejected = ok(await harness.board.transition({
      id: task.id, action: 'reject', ifRevision: submitted.revision, note: 'criteria unmet',
    }))
    expect(rejected.status).toBe('running')
    expect(rejected.attempts).toBe(1)

    const detail = await harness.board.get({ id: task.id })
    if (!detail.ok) throw new Error('get failed')
    expect(detail.value.events.at(-1)).toMatchObject({ type: 'reject', note: 'criteria unmet' })
  })

  it('counts a retry as a new attempt and reopens a completed card', async () => {
    const harness = await setup()
    let task = await create(harness, { start: true })
    task = ok(await harness.board.transition({ id: task.id, action: 'fail', ifRevision: task.revision, note: 'provider down' }))
    expect(task.status).toBe('failed')
    task = ok(await harness.board.transition({ id: task.id, action: 'retry', ifRevision: task.revision }))
    expect(task.status).toBe('running')
    expect(task.attempts).toBe(2)

    task = ok(await harness.board.transition({ id: task.id, action: 'submit', ifRevision: task.revision }))
    task = ok(await harness.board.transition({ id: task.id, action: 'approve', ifRevision: task.revision }))
    task = ok(await harness.board.transition({ id: task.id, action: 'reopen', ifRevision: task.revision }))
    expect(task.status).toBe('initialized')
  })

  it('rejects every illegal source state with invalid-transition', async () => {
    const harness = await setup()
    const task = await create(harness, { start: true })
    await expect(harness.board.transition({ id: task.id, action: 'start', ifRevision: task.revision }))
      .resolves.toMatchObject({ ok: false, error: { code: 'invalid-transition', action: 'start', status: 'running' } })
    await expect(harness.board.transition({ id: task.id, action: 'approve', ifRevision: task.revision }))
      .resolves.toMatchObject({ ok: false, error: { code: 'invalid-transition', action: 'approve', status: 'running' } })
    await expect(harness.board.transition({ id: task.id, action: 'retry', ifRevision: task.revision }))
      .resolves.toMatchObject({ ok: false, error: { code: 'invalid-transition' } })
    await expect(harness.board.transition({ id: task.id, action: 'reopen', ifRevision: task.revision }))
      .resolves.toMatchObject({ ok: false, error: { code: 'invalid-transition' } })
  })

  it('names unknown tasks and stale revisions without touching stored state', async () => {
    const harness = await setup()
    const task = await create(harness)
    const missing = '00000000-0000-4000-8000-000000000000' as TaskId
    await expect(harness.board.transition({ id: missing, action: 'start', ifRevision: 1 }))
      .resolves.toMatchObject({ ok: false, error: { code: 'task-not-found' } })

    const stale = await harness.board.transition({ id: task.id, action: 'start', ifRevision: task.revision + 5 })
    expect(stale).toMatchObject({ ok: false, error: { code: 'revision-conflict' } })
    if (!stale.ok && stale.error.code === 'revision-conflict') {
      expect(stale.error.current?.revision).toBe(task.revision)
    }

    const after = await harness.board.get({ id: task.id })
    if (!after.ok) throw new Error('get failed')
    expect(after.value.task.status).toBe('initialized')
  })
})

describe('update', () => {
  it('edits fields, clears optionals with null, and records what changed', async () => {
    const harness = await setup()
    const task = await create(harness, { acceptanceCriteria: 'all green', workspace: '/tmp/w' })
    let next = ok(await harness.board.update({
      id: task.id,
      ifRevision: task.revision,
      title: 'Renamed',
      agentPreset: 'anchored-standard',
    }))
    expect(next.title).toBe('Renamed')
    expect(next.agentPreset).toBe('anchored-standard')
    expect(next.acceptanceCriteria).toBe('all green')

    next = ok(await harness.board.update({
      id: task.id,
      ifRevision: next.revision,
      acceptanceCriteria: null,
      workspace: null,
    }))
    expect(next.acceptanceCriteria).toBeUndefined()
    expect(next.workspace).toBeUndefined()

    const detail = await harness.board.get({ id: task.id })
    if (!detail.ok) throw new Error('get failed')
    expect(detail.value.events.filter(event => event.type === 'edited').map(event => event.note))
      .toEqual(['title,agentPreset', 'acceptanceCriteria,workspace'])
  })

  it('returns the stored card unchanged for a matching no-op edit', async () => {
    const harness = await setup()
    const task = await create(harness)
    const before = await harness.board.get({ id: task.id })
    const result = await harness.board.update({ id: task.id, ifRevision: task.revision, title: task.title })
    expect(result).toMatchObject({ ok: true, value: { revision: task.revision } })
    const after = await harness.board.get({ id: task.id })
    expect(after).toEqual(before)
  })

  it('validates edits with the same text rules as create', async () => {
    const harness = await setup()
    const task = await create(harness)
    await expect(harness.board.update({ id: task.id, ifRevision: task.revision, title: '' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'text-blank', field: 'title' } })
    await expect(harness.board.update({ id: task.id, ifRevision: task.revision, workspace: 'z'.repeat(10_001) }))
      .resolves.toMatchObject({ ok: false, error: { code: 'field-too-long', field: 'workspace' } })
  })
})

describe('move', () => {
  it('reorders within a column and reports an anchor outside it as invalid', async () => {
    const harness = await setup()
    const a = await create(harness, { title: 'a' })
    const b = await create(harness, { title: 'b' })
    const c = await create(harness, { title: 'c' })
    expect(await titles(harness)).toEqual(['a', 'b', 'c'])

    const moved = ok(await harness.board.move({ id: c.id, beforeTaskId: a.id, ifRevision: c.revision }))
    expect(moved.order).toBeLessThan(a.order)
    expect(await titles(harness)).toEqual(['c', 'a', 'b'])

    const end = ok(await harness.board.move({ id: c.id, beforeTaskId: null, ifRevision: moved.revision }))
    expect(end.order).toBeGreaterThan(b.order)
    expect(await titles(harness)).toEqual(['a', 'b', 'c'])

    const running = await create(harness, { title: 'other column', start: true })
    await expect(harness.board.move({ id: c.id, beforeTaskId: running.id, ifRevision: end.revision }))
      .resolves.toMatchObject({ ok: false, error: { code: 'move-target-invalid' } })
    await expect(harness.board.move({ id: c.id, beforeTaskId: a.id, ifRevision: end.revision + 3 }))
      .resolves.toMatchObject({ ok: false, error: { code: 'revision-conflict' } })
  })

  it('treats dropping onto the current position as a no-op without a write', async () => {
    const harness = await setup()
    const a = await create(harness, { title: 'a' })
    const b = await create(harness, { title: 'b' })
    const result = await harness.board.move({ id: a.id, beforeTaskId: b.id, ifRevision: a.revision })
    expect(result).toMatchObject({ ok: true, value: { revision: a.revision } })
  })

  it('renormalizes spacing after midpoint halving exhausts it', async () => {
    const harness = await setup()
    const a = await create(harness, { title: 'a' })
    const b = await create(harness, { title: 'b' })
    const shuttle = await create(harness, { title: 'shuttle' })

    // Each pass inserts the shuttle directly above `b`, halving the gap
    // between `a` and the shuttle's previous slot until the midpoint
    // exhausts and the column renormalizes.
    let revision = shuttle.revision
    for (let pass = 0; pass < 24; pass += 1) {
      const result = await harness.board.move({ id: shuttle.id, beforeTaskId: b.id, ifRevision: revision })
      if (!result.ok) throw new Error(`move pass ${pass} failed: ${result.error.code}`)
      revision = result.value.revision
      expect(await titles(harness)).toEqual(['a', 'shuttle', 'b'])
    }

    // Spacing survived renormalizing: a fresh insert still finds room.
    const fresh = await create(harness, { title: 'fresh' })
    const moved = ok(await harness.board.move({ id: fresh.id, beforeTaskId: a.id, ifRevision: fresh.revision }))
    expect(moved.order).toBeLessThan(a.order)
    expect(await titles(harness)).toEqual(['fresh', 'a', 'shuttle', 'b'])
  })
})

describe('remove', () => {
  it('removes once and reports later removals as task-not-found', async () => {
    const harness = await setup()
    const task = await create(harness)
    await expect(harness.board.remove({ id: task.id })).resolves.toMatchObject({ ok: true, value: { absent: true } })
    await expect(harness.board.remove({ id: task.id })).resolves.toMatchObject({ ok: false, error: { code: 'task-not-found' } })
    await expect(harness.board.get({ id: task.id })).resolves.toMatchObject({ ok: false, error: { code: 'task-not-found' } })
  })
})

describe('notification and durability', () => {
  it('emits task-board/updated naming the committed card', async () => {
    const harness = await setup()
    const seen: string[][] = []
    harness.ctx.on('task-board/updated', change => seen.push([...change.ids]))

    const task = await create(harness)
    const started = ok(await harness.board.transition({ id: task.id, action: 'start', ifRevision: task.revision }))
    await harness.board.update({ id: task.id, ifRevision: started.revision, title: 'Later' })
    await harness.board.remove({ id: task.id })

    expect(seen).toHaveLength(4)
    expect(seen.every(ids => ids.length === 1)).toBe(true)
    expect(seen[0]?.[0]).toBe(task.id)
  })

  it('reconciles cards, logs, and revisions across a cold restart', async () => {
    const harness = await setup()
    const task = await create(harness, { start: true, acceptanceCriteria: 'all green' })
    const edited = ok(await harness.board.update({
      id: task.id, ifRevision: task.revision, title: 'Renamed',
    }))
    const submitted = ok(await harness.board.transition({ id: task.id, action: 'submit', ifRevision: edited.revision }))

    await harness.disposeFiber()
    await harness.ctx.plugin(TaskBoardService, {})

    const listed = await harness.board.list()
    if (!listed.ok) throw new Error('list failed')
    expect(listed.value.tasks).toHaveLength(1)
    const revived = listed.value.tasks[0]!
    expect(revived).toMatchObject({
      id: task.id, status: 'review', title: 'Renamed', attempts: 1, revision: submitted.revision,
    })
    const detail = await harness.board.get({ id: task.id })
    if (!detail.ok) throw new Error('get failed')
    expect(detail.value.events.map(event => event.type)).toEqual(['created', 'start', 'edited', 'submit'])

    const conflict = await harness.board.transition({ id: task.id, action: 'approve', ifRevision: 1 })
    expect(conflict).toMatchObject({ ok: false, error: { code: 'revision-conflict' } })
  })

  it('admits no mutation once the service fiber is disposing', async () => {
    const harness = await setup()
    const board = harness.board
    const task = await create(harness)
    await harness.disposeFiber()
    await expect(board.create(createRequest())).rejects.toThrow(/disposing/u)
    await expect(board.remove({ id: task.id })).rejects.toThrow(/disposing/u)
  })
})
