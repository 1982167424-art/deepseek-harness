/**
 * The recall entry's injected face for 'conversation.chat.message-actions' slot.
 * @module @deepseek-ai/dsh-session-message-recall/client/slots
 */

import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MessageId, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type {} from './locales.ts'

export interface MessageRecallInjected {
  hooks: {
    recallState: HostObservable<RecallViewState>
  }
  canRecall: (sessionId: SessionId, messageId: MessageId) => boolean
  recallMessage: (sessionId: SessionId, messageId: MessageId) => Promise<RecallActionResult>
}

export interface RecallViewState {
  status: 'idle' | 'recalling' | 'success' | 'error'
  lastError?: string
}

export interface RecallActionResult {
  ok: boolean
  revertedFiles: string[]
  recalledCount: number
  error?: string
}

export type MessageRecallActionProps =
  PropsRuntime<'conversation.chat.message-actions'>
  & InjectFace<MessageRecallInjected>
  & PropsLocale<'recall'>
