/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-task-board`.
 * @module @deepseek-ai/dsh-task-board/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-task-board'

/** Cordis companion plugin name. */
export const name = 'task-board-invariant'

/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Install the notification contract: `task-board/updated` exists to name the
 * cards a mirror must re-read, so an emission naming nothing is a broken
 * mutation path. Row-level shape (contiguous log sequence, opening `created`
 * record, revision and timestamp ordering) is enforced by the durable
 * schema at the storage-domain read boundary and is not re-checked here.
 */
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) => {
  ctx.on('task-board/updated', (change) => {
    if (change.ids.length === 0) {
      fail('task-board/updated emitted with an empty ids list; a committed change must name its cards')
    }
  })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
