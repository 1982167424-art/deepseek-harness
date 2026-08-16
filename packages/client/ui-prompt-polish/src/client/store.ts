import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  createSnapshotStore,
  type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { RpcError } from '@deepseek-ai/dsh-api-remotes/client'
import type { PolishStyle, PolishedVariation } from './slots.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    promptPolish: {
      polishPrompt(request: {
        rawText: string
        style?: PolishStyle
        variations?: number
        model?: string
      }): Promise<{ ok: true; value: PolishedVariation[] } | { ok: false; error: RpcError }>
    }
  }
}

export type PolishStatus = 'idle' | 'generating' | 'ready' | 'error'

export interface PerSessionPolishState {
  open: boolean
  style: PolishStyle
  variations: number
  status: PolishStatus
  error: string | null
  results: PolishedVariation[]
  selectedIndex: number | null
  compare: boolean
  originalText: string
}

const DEFAULT_PER_SESSION: PerSessionPolishState = {
  open: false,
  style: 'general',
  variations: 3,
  status: 'idle',
  error: null,
  results: [],
  selectedIndex: null,
  compare: false,
  originalText: '',
}

export class PromptPolishService extends Service {
  static inject = ['sessions', 'remote', 'remote.promptPolish']

  private readonly live = {
    stores: new Map<SessionId, SnapshotStore<PerSessionPolishState>>(),
  }

  constructor(ctx: Context) {
    super(ctx, 'promptPolish')
  }

  storeFor(sessionId: SessionId): SnapshotStore<PerSessionPolishState> {
    const { live } = this
    const existing = live.stores.get(sessionId)
    if (existing !== undefined) return existing
    const sessions = this.ctx.sessions
    const actx = sessions.scope(sessionId)
    if (actx === undefined) throw new Error(`ui-prompt-polish: session "${String(sessionId)}" resolved no scope`)
    const store = createSnapshotStore<PerSessionPolishState>({ ...DEFAULT_PER_SESSION })
    live.stores.set(sessionId, store)
    actx.effect(() => {
      return () => {
        live.stores.delete(sessionId)
      }
    }, 'ui-prompt-polish: session store')
    return store
  }

  open(sessionId: SessionId, originalText: string): void {
    this.storeFor(sessionId).update((d) => {
      d.open = true
      d.originalText = originalText
      d.results = []
      d.selectedIndex = null
      d.error = null
      d.status = 'idle'
    })
  }

  close(sessionId: SessionId): void {
    this.storeFor(sessionId).update((d) => { d.open = false })
  }

  setStyle(sessionId: SessionId, style: PolishStyle): void {
    this.storeFor(sessionId).update((d) => { d.style = style })
  }

  setVariations(sessionId: SessionId, count: number): void {
    const clamped = Math.max(1, Math.min(5, count))
    this.storeFor(sessionId).update((d) => { d.variations = clamped })
  }

  setCompare(sessionId: SessionId, compare: boolean): void {
    this.storeFor(sessionId).update((d) => { d.compare = compare })
  }

  select(sessionId: SessionId, index: number): void {
    this.storeFor(sessionId).update((d) => { d.selectedIndex = index })
  }

  async generate(sessionId: SessionId): Promise<void> {
    const store = this.storeFor(sessionId)
    const snap = store.getSnapshot()
    if (snap.status === 'generating') return
    store.update((d) => {
      d.status = 'generating'
      d.error = null
      d.results = []
      d.selectedIndex = null
    })
    try {
      const remote = this.ctx.remote as unknown as { promptPolish: {
        polishPrompt(request: {
          rawText: string
          style?: PolishStyle
          variations?: number
          model?: string
        }): Promise<{ ok: true; value: PolishedVariation[] } | { ok: false; error: RpcError }>
      } }
      const ns = remote.promptPolish
      const result = await ns.polishPrompt({
        rawText: snap.originalText,
        style: snap.style,
        variations: snap.variations,
      })
      if (result.ok) {
        store.update((d) => {
          d.status = 'ready'
          d.results = result.value
          d.selectedIndex = result.value.length > 0 ? 0 : null
        })
      } else {
        store.update((d) => {
          d.status = 'error'
          d.error = `${result.error.code}: ${result.error.message}`
        })
      }
    } catch (err) {
      store.update((d) => {
        d.status = 'error'
        d.error = err instanceof Error ? err.message : String(err)
      })
    }
  }
}
