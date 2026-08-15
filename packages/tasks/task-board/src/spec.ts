/**
 * Durable storage-domain declaration for the task board.
 * @module @deepseek-ai/dsh-task-board/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { TaskId, TaskKind, TaskStatus } from './types.ts'

const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const positiveSafeInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

/** Runtime schema for the closed column vocabulary. */
export const taskStatusSchema = z.union([
  z.literal('initialized'),
  z.literal('running'),
  z.literal('review'),
  z.literal('completed'),
  z.literal('failed'),
]) satisfies z.ZodType<TaskStatus>

/** Runtime schema for the closed executor vocabulary. */
export const taskKindSchema = z.union([
  z.literal('agent'),
  z.literal('manual'),
]) satisfies z.ZodType<TaskKind>

/** Runtime schema for one activity-log record stored on disk. */
export const taskEventSchema = z.object({
  seq: positiveSafeInteger,
  type: z.union([
    z.literal('created'),
    z.literal('edited'),
    z.literal('moved'),
    z.literal('start'),
    z.literal('stop'),
    z.literal('submit'),
    z.literal('approve'),
    z.literal('reject'),
    z.literal('fail'),
    z.literal('retry'),
    z.literal('reopen'),
  ]),
  at: nonNegativeSafeInteger,
  note: z.string().optional(),
})

/**
 * One whole task card with its activity log. The log is carried inside the
 * row so a card and its audit history commit atomically on the domain's
 * write chain.
 */
export const taskRowSchema = z.object({
  id: z.string().min(1).transform(value => value as TaskId),
  kind: taskKindSchema,
  status: taskStatusSchema,
  title: z.string().min(1),
  requirements: z.string().min(1),
  acceptanceCriteria: z.string().optional(),
  workspace: z.string().optional(),
  agentPreset: z.string().optional(),
  referenceImages: z.array(z.string()),
  attempts: nonNegativeSafeInteger,
  revision: positiveSafeInteger,
  order: z.number().finite(),
  createdAt: nonNegativeSafeInteger,
  updatedAt: nonNegativeSafeInteger,
  events: z.array(taskEventSchema),
}).superRefine((row, ctx) => {
  if (row.updatedAt < row.createdAt) {
    ctx.addIssue({
      code: 'custom',
      path: ['updatedAt'],
      message: 'task updatedAt must not precede createdAt',
    })
  }
  if (row.events.length === 0 || row.events[0]?.type !== 'created') {
    ctx.addIssue({
      code: 'custom',
      path: ['events'],
      message: 'task activity log must open with a created record',
    })
  }
  row.events.forEach((event, index) => {
    if (event.seq !== index + 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['events', index, 'seq'],
        message: `task activity seq must be contiguous from 1, got ${String(event.seq)} at ${String(index + 1)}`,
      })
    }
  })
})

/** Persisted task row inferred from {@link taskRowSchema}. */
export type TaskRow = z.infer<typeof taskRowSchema>

/** One durable task card per task id. */
export const taskBoardDomainSpec = defineDomain({
  name: 'task_board',
  version: 0,
  tables: {
    tasks: domainTable<TaskId, TaskRow>(taskRowSchema),
  },
})
