import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { PerSessionPolishState } from './store.ts'

export type PolishStyle = 'general' | 'professional' | 'concise' | 'creative' | 'detailed' | 'technical'

export interface PolishedVariation {
  index: number
  style: PolishStyle
  text: string
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Composer toolbar list entry for the AI Polish button. Declared by
     * ui-conversation; this package contributes one entry.
     */
    'conversation.composer.toolbar': { kind: 'list'; scope: 'session'; owner: ComposerToolbarOwnerProps }
  }
}

export interface ComposerToolbarOwnerProps {
  /** Current draft text snapshot (the text that will be polished). */
  draft: string
  /** Stable action face used to replace the composer draft after polishing. */
  inputActions: {
    setDraft: (text: string) => void
  }
}

export interface PolishButtonInjected {
  /** Session's prompt-polish state store. */
  polish: SnapshotStore<PerSessionPolishState>
  /** Open the polish modal with the current draft as original text. */
  open: (originalText: string) => void
  /** Close the modal. */
  close: () => void
  /** Update style selection. */
  setStyle: (style: PolishStyle) => void
  /** Update variation count (1..5). */
  setVariations: (n: number) => void
  /** Toggle compare-with-original view. */
  setCompare: (compare: boolean) => void
  /** Mark a variant index as selected. */
  select: (index: number) => void
  /** Trigger generation on the host. */
  generate: () => Promise<void>
  /** Replace composer draft with the selected variant and close. */
  accept: (selectedText: string) => void
}
