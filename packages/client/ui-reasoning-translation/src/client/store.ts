import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  createSnapshotStore,
  type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'

export interface TranslatedBlockState {
  original: string
  translated: string
  streaming: boolean
}

export interface PerSessionTranslationState {
  enabled: boolean
  blocks: Map<number, TranslatedBlockState>
}

export interface ReasoningTranslationState {
  enabled: boolean
}

const DEFAULT_PER_SESSION: PerSessionTranslationState = {
  enabled: false,
  blocks: new Map(),
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    reasoningTranslation: ReasoningTranslationService
  }
}

export class ReasoningTranslationService extends Service {
  static inject = ['sessions']

  private readonly live = {
    stores: new Map<SessionId, SnapshotStore<PerSessionTranslationState>>(),
  }

  constructor(ctx: Context) {
    super(ctx, 'reasoningTranslation')
  }

  storeFor(sessionId: SessionId): SnapshotStore<PerSessionTranslationState> {
    const { live } = this
    const existing = live.stores.get(sessionId)
    if (existing !== undefined) return existing
    const sessions = this.ctx.sessions
    const actx = sessions.scope(sessionId)
    if (actx === undefined) throw new Error(`ui-reasoning-translation: session "${String(sessionId)}" resolved no scope`)
    const store = createSnapshotStore<PerSessionTranslationState>({
      ...DEFAULT_PER_SESSION,
      blocks: new Map(),
    })
    live.stores.set(sessionId, store)

    let offDelta: (() => void) | undefined
    let offComplete: (() => void) | undefined

    const ctx = this.ctx
    const anyCtx = ctx as unknown as {
      remote?: {
        events?: {
          on(event: string, handler: (...args: unknown[]) => void): () => void
        }
      }
    }
    const remote = anyCtx.remote
    if (remote?.events !== undefined) {
      offDelta = remote.events.on('reasoning-translation/delta', (...args: unknown[]) => {
        const blockIndex = args[1] as number
        const text = args[2] as string
        store.update((d) => {
          const existingBlock = d.blocks.get(blockIndex) ?? { original: '', translated: '', streaming: true }
          d.blocks.set(blockIndex, {
            ...existingBlock,
            translated: existingBlock.translated + text,
            streaming: true,
          })
        })
      })
      offComplete = remote.events.on('reasoning-translation/complete', (...args: unknown[]) => {
        const blockIndex = args[1] as number
        const translatedText = args[2] as string
        store.update((d) => {
          const existingBlock = d.blocks.get(blockIndex) ?? { original: '', translated: '', streaming: false }
          d.blocks.set(blockIndex, {
            ...existingBlock,
            translated: translatedText,
            streaming: false,
          })
        })
      })
    }

    actx.effect(() => {
      return () => {
        live.stores.delete(sessionId)
        offDelta?.()
        offComplete?.()
      }
    }, 'ui-reasoning-translation: session store')
    return store
  }

  setEnabled(sessionId: SessionId, enabled: boolean): void {
    this.storeFor(sessionId).update((d) => {
      d.enabled = enabled
    })
  }

  translatedText(sessionId: SessionId, blockIndex: number): string {
    return this.storeFor(sessionId).getSnapshot().blocks.get(blockIndex)?.translated ?? ''
  }

  isTranslating(sessionId: SessionId, blockIndex: number): boolean {
    return this.storeFor(sessionId).getSnapshot().blocks.get(blockIndex)?.streaming ?? false
  }
}
