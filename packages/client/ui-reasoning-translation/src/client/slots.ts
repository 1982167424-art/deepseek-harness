import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { PerSessionTranslationState } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Wraps the reasoning content display with side-by-side original/translated tabs.
     * Declared by ui-conversation's reasoning render site; this package injects
     * the tab wrapper component here.
     */
    'conversation.chat.reasoning-content': { kind: 'single'; scope: 'session'; owner: ReasoningContentOwnerProps }
  }
}

export interface ReasoningContentOwnerProps {
  /** The original reasoning block text (full or streaming). */
  text: string
  /** The reasoning block index for matching with translated events. */
  blockIndex: number
  /** Whether this reasoning block is currently streaming. */
  running: boolean
}

export interface ReasoningTranslationInjected {
  /** The session's per-session translation store. */
  translation: SnapshotStore<PerSessionTranslationState>
  /** Toggle translation enabled for this session. */
  setEnabled: (enabled: boolean) => void
  /** Retrieve translated text for a given reasoning block index, or undefined. */
  translatedText: (blockIndex: number) => string | undefined
  /** Whether a translation is in-progress (started, not yet complete). */
  isTranslating: (blockIndex: number) => boolean
}
