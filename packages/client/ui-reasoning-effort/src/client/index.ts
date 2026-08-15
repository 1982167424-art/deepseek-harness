/**
 * Reasoning effort (thinking intensity) UI plugin — browser half.
 *
 * Occupies the `conversation.input.right` tool-row list seat. Renders a 28px
 * chip selector: clicking opens a menu with the off/high/max triplet.
 * Selection writes through the shared `sessions.selectModel` RPC with the
 * session's current provider+model, so the Host's selection fact is the
 * single ground truth and this package keeps in sync with the model-select
 * plugin (which writes through the same path on different fields) without
 * any direct cross-package dependency.
 *
 * Locale namespace: `reasoning`
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { ReasoningEffortSelect } from './ReasoningEffortSelect.tsx'
import { en, zh, type ReasoningKey } from './locales.ts'

export type { ReasoningKey } from './locales.ts'
export { ReasoningEffortSelect } from './ReasoningEffortSelect.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Reasoning effort selector copy: labels, hints, status lines, aria. */
    reasoning: ReasoningKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'reasoning'

/**
 * Injected business face of the reasoning effort selector.
 *
 * All functions are bound to the slot's sessionId at registration time (the
 * closures live for the lifetime of the session-scoped slot occupant), so
 * the component receives stable callbacks and never touches transports
 * directly. Optional callbacks receive undefined fallbacks in the component.
 */
export interface ReasoningEffortInjected {
  /** Load the session's current model catalog + selection snapshot. */
  loadModels: () => Promise<unknown>
  /** Subscribe to session-scoped updates that change selection; unsubscribe or undefined. */
  subscribeChanges?: (callback: () => void) => (() => void) | undefined
  /**
   * Write a new reasoning effort id against the session's current provider
   * and model (looked up before the write, so the caller can pass effort
   * alone). Returns null on success or a user-visible failure string.
   */
  writeEffort: (effortId: 'off' | 'high' | 'max') => Promise<string | null>
}

/** Required services: slot registry, locale registry, and the remote sessions namespace. */
export const inject = ['slots', 'locale', 'remote']

/**
 * Client plugin body. Registers the locale dictionary and the
 * session-scoped list occupant on `conversation.input.right`.
 *
 * The `ctx.remote` type here is `TypertClientRemote` whose declared key set
 * can be incomplete before the generated remote surfaces (the type declarations
 * live in packages that haven't been built yet). The runtime is populated
 * correctly by the transport regardless, so the narrow casts that follow cast
 * only through `unknown` to reach the well-known session RPC names.
 *
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  type SessionsRemote = {
    models: (req: { sessionId: SessionId }) => Promise<{
      ok: true
      value: { current: { selection: { provider: string; model: string; reasoningEffort?: string } } | null }
    } | { ok: false; error: { message: string } }>
    selectModel: (req: {
      sessionId: SessionId
      provider: string
      model: string
      reasoningEffort?: string
    }) => Promise<{ ok: true } | { ok: false; error: { message: string } }>
  }
  // ctx.remote is TypertClientRemote at this package's compile time; the full
  // merged namespaces arrive at runtime. Narrow through unknown.
  const sessions = (ctx as unknown as { remote: { sessions: SessionsRemote } }).remote.sessions

  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    'ui-reasoning-effort: dictionaries',
  )
  ctx.slots.inject('conversation.input.right', () =>
    ctx.slots.register({
      name: 'conversation.input.right',
      id: 'reasoning-effort',
      locale: NS,
      inject: (sessionId: SessionId): ReasoningEffortInjected => ({
        loadModels: async () => {
          const result = await sessions.models({ sessionId })
          return result.ok ? result.value : { current: null }
        },
        writeEffort: async (effortId) => {
          const models = await sessions.models({ sessionId })
          if (!models.ok) {
            return models.error.message
          }
          const selection = models.value.current?.selection
          if (selection === undefined) return 'no current selection'
          const selected = await sessions.selectModel({
            sessionId,
            provider: selection.provider,
            model: selection.model,
            reasoningEffort: effortId,
          })
          if (!selected.ok) return selected.error.message
          return null
        },
      }),
    }, ReasoningEffortSelect),
  )
}
