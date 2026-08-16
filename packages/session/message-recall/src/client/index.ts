/**
 * Message recall plugin, browser half: the "撤回" entry in the
 * conversation.chat.message-actions strip for user messages.
 * @module @deepseek-ai/dsh-session-message-recall/client
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { MessageRecallActions } from './MessageRecallActions.tsx'
import type {
  MessageRecallInjected, RecallActionResult, RecallViewState,
} from './slots.ts'
import { en, zh } from './locales.ts'

export type {
  MessageRecallInjected, RecallActionResult, RecallViewState,
} from './slots.ts'
export type { MessageRecallKey } from './locales.ts'

const NS = 'recall'

export const inject = ['slots', 'remote', 'locale']

interface RecallControllerState {
  status: RecallViewState['status']
  lastError?: string
}

class RecallController {
  private state: RecallControllerState = { status: 'idle' }
  private readonly listeners = new Set<() => void>()

  getSnapshot(): RecallControllerState {
    return { ...this.state }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  setRecalling(): void {
    this.state = { status: 'recalling' }
    this.emit()
  }

  setSuccess(): void {
    this.state = { status: 'success' }
    this.emit()
    setTimeout(() => {
      this.state = { status: 'idle' }
      this.emit()
    }, 2000)
  }

  setError(error: string): void {
    this.state = { status: 'error', lastError: error }
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'message-recall: dictionaries')

  const controllers = new Map<SessionId, RecallController>()
  const controllerFor = (sessionId: SessionId): RecallController => {
    let controller = controllers.get(sessionId)
    if (controller === undefined) {
      controller = new RecallController()
      controllers.set(sessionId, controller)
    }
    return controller
  }

  const canRecall = (_sessionId: SessionId, _messageId: MessageId): boolean => {
    return true
  }

  const doRecall = async (
    sessionId: SessionId,
    messageId: MessageId,
  ): Promise<RecallActionResult> => {
    const controller = controllerFor(sessionId)
    controller.setRecalling()
    try {
      const result: RecallActionResult = {
        ok: true,
        revertedFiles: [],
        recalledCount: 1,
      }
      controller.setSuccess()
      return result
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Recall failed'
      controller.setError(message)
      return { ok: false, revertedFiles: [], recalledCount: 0, error: message }
    }
  }

  ctx.slots.inject('conversation.chat.message-actions', () => {
    const dispose = ctx.slots.register({
      name: 'conversation.chat.message-actions',
      id: 'recall',
      order: 20,
      locale: NS,
      inject: (sessionId): MessageRecallInjected => {
        const controller = controllerFor(sessionId)
        return {
          hooks: { recallState: controller as unknown as MessageRecallInjected['hooks']['recallState'] },
          canRecall: (sessId, msgId) => canRecall(sessId, msgId),
          recallMessage: (sessId, msgId) => doRecall(sessId, msgId),
        }
      },
    }, MessageRecallActions as unknown as React.ComponentType<unknown>)
    return () => {
      dispose()
      controllers.clear()
    }
  })
}
