import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { TaskId } from '../src/types.ts'
import * as TaskBoardInvariant from '../src/invariant.ts'

describe('task-board invariant companion', () => {
  it('removes its registry contribution when its fiber is disposed (HMR safety)', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(InvariantRegistry)
      const fiber = await ctx.plugin(TaskBoardInvariant)

      expect(() => {
        ctx.invariants.register('@deepseek-ai/dsh-task-board', () => {})
      }).toThrow(/already registered/u)

      await fiber.dispose()
      await expect(ctx.plugin(TaskBoardInvariant).await()).resolves.toBeDefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('fails an updated emission that names no card', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(InvariantRegistry)
      await ctx.plugin(TaskBoardInvariant)

      expect(() => { ctx.emit('task-board/updated', { ids: [] }) })
        .toThrow(/invariant violated by "@deepseek-ai\/dsh-task-board"/u)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('accepts an updated emission that names its committed card', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(InvariantRegistry)
      await ctx.plugin(TaskBoardInvariant)

      expect(() => {
        ctx.emit('task-board/updated', {
          ids: ['00000000-0000-4000-8000-000000000000' as TaskId],
        })
      }).not.toThrow()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
