/**
 * Task board UI plugin, browser half: one controller mirroring the durable
 * board, one overlay entry in 'shell.overlay', and one opener button in the
 * sidebar footer. Mutations go through the generated taskBoard Remote; the
 * Host owns per-card compare-and-set, and the forwarded 'task-board/updated'
 * event keeps the mirror current across tabs and reconnects.
 * @module @deepseek-ai/dsh-client-ui-task-board/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ui-layout SlotMap merge (the shell.overlay seat).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the ui-sidebar SlotMap merge (the footer action seat).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { TaskBoardController } from './controller.ts'
import { TaskBoardOverlay } from './TaskBoardOverlay.tsx'
import { TaskBoardOpener } from './TaskBoardOpener.tsx'
import type { TaskBoardInjected } from './slots.ts'
import { en, zh } from './locales.ts'

export type {
  TaskBoardActionResult, TaskBoardDetailState, TaskBoardRemote, TaskBoardStatus, TaskBoardView,
} from './controller.ts'
export type {
  TaskBoardEditFields, TaskBoardInjected, TaskBoardOpenerProps, TaskBoardOverlayProps,
} from './slots.ts'
export type { TaskBoardKey } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'taskBoard'

/** Required services: the slot registry, the Remote namespace, and the copy. */
export const inject = ['slots', 'remote', 'remote.taskBoard', 'locale']

/**
 * Client plugin body: the board overlay entry, the sidebar opener, and the
 * one controller both share.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-task-board: dictionaries')

  const controller = new TaskBoardController(ctx.remote.taskBoard)

  ctx.effect(() => ctx.remote.$on('task-board/updated', (change) => {
    void controller.notifyChanged(change)
  }), 'ui-task-board: change feed')

  // A reconnect can only invalidate what was already read; a cold board
  // stays cold until something asks for it.
  ctx.on('connection/reset', () => {
    if (controller.getSnapshot().status !== 'cold') void controller.refresh()
  })

  const injectFace = (): TaskBoardInjected => ({
    hooks: { board: controller },
    openBoard: () => controller.openBoard(),
    closeBoard: () => controller.closeBoard(),
    openDetail: id => controller.openDetail(id),
    closeDetail: () => controller.closeDetail(),
    create: request => controller.create(request),
    update: (id, fields) => controller.update(id, fields),
    transition: (id, action, note) => controller.transition(id, action, note),
    move: (id, beforeTaskId) => controller.move(id, beforeTaskId),
    remove: id => controller.remove(id),
  })

  ctx.effect(() => ctx.slots.inject('shell.overlay', () => {
    const dispose = ctx.slots.register({
      name: 'shell.overlay',
      id: 'task-board',
      order: 40,
      locale: NS,
      inject: injectFace,
    }, TaskBoardOverlay)
    return () => {
      dispose()
      controller.dispose()
    }
  }), 'ui-task-board: overlay entry')

  ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'task-board',
      order: 30,
      locale: NS,
      inject: injectFace,
    }, TaskBoardOpener),
  ), 'ui-task-board: sidebar opener')
}
