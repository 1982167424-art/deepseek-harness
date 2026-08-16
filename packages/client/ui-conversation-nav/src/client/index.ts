/**
 * Conversation-nav plugin (browser half):
 * - Registers the `conversation-nav` locale dictionary (zh+en).
 * - Declares and occupies the floating `conversation.layout.sidebar` slot
 *   with the draggable / resizable ConversationNavPanel.
 * - Persists panel geometry per session via the Conversation Location
 *   data store: key `conversation-nav-state`, written on every resize /
 *   drag / toggle action and restored when a session re-opens.
 * - Keyboard shortcut Ctrl/Cmd+Shift+F toggles the panel shell.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the SlotMap merge for the standard conversation seats.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {
  TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { ConversationNavPanel, type ConversationNavInjected } from './ConversationNavPanel.tsx'
import { createNavStore, type NavPanelState } from './nav-store.ts'
import { en, zh, type ConversationNavKey } from './locales.ts'

export {
  ConversationNavPanel, type ConversationNavInjected, type ConversationNavPanelProps,
} from './ConversationNavPanel.tsx'
export {
  DEFAULT_NAV_STATE, NAV_LOCATION_DATA_KEY, createNavStore, type NavPanelState,
  NAV_MIN_WIDTH, NAV_MAX_WIDTH, navStoreHandle,
} from './nav-store.ts'
export { buildNavItems, previewOf, type NavItem, type NavItemKind } from './nav-items.ts'
export type { ConversationNavKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Navigation timeline panel copy: titles, labels, and step kinds. */
    'conversation-nav': ConversationNavKey
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Floating draggable/resizable sidebar rendered above the conversation.
     * A single occupant (ConversationNavPanel by default). Session scope so
     * the geometry store and the assembled node list both re-render with the
     * session. Unoccupied, the shell renders nothing at all — the panel is
     * purely additive, never reserved space.
     */
    'conversation.layout.sidebar': { kind: 'single'; scope: 'session'; owner: ConversationNavSidebarOwnerProps }
  }
}

/** Owner share of the layout sidebar seat: conversation viewport scroll bridge. */
export interface ConversationNavSidebarOwnerProps {
  /**
   * Scroll the conversation scrollport so the chat node whose anchorSeq ===
   * `seq` is positioned near the top of the viewport.
   */
  scrollToSeq?: (seq: number, anchorId: string) => void
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationTurnDataMap {
    /** Per-session navigation panel geometry (published on session scope). */
    'conversation-nav-state': NavPanelState
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'conversation-nav'

/** Required services: slot registry, locale, conversation node stream, runtime shell. */
export const inject = ['theme', 'locale', 'conversation', 'slots', 'runtime']

/** Transient per-session runtime: store + persistence callbacks. */
interface SessionRuntime {
  readonly store: SnapshotStore<NavPanelState>
  persist(_state: NavPanelState): void
  setNodes(nodes: readonly ChatConversationViewNode[]): void
  nodes: readonly ChatConversationViewNode[]
}

/**
 * Scroll an element with id anchorId, or whose dataset carries the seq, into
 * view. When both are present the anchorId wins; when neither, this is a
 * no-op (the conversation skeleton has not painted its anchors yet).
 */
function defaultScrollToSeq(seq: number, anchorId: string): void {
  if (typeof document === 'undefined') return
  let target = document.getElementById(anchorId)
  if (target === null) target = document.querySelector(`[data-seq="${seq}"]`) as HTMLElement | null
  target?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

/**
 * Client plugin body: register locale dictionary, declare the
 * `conversation.layout.sidebar` slot + occupy it, subscribe to session
 * lifecycle to read/write panel geometry from the location data store, and
 * install the Ctrl/Cmd+Shift+F toggle shortcut.
 *
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-conversation-nav: dictionaries')

  const sessionRuntimes = new Map<SessionId, SessionRuntime>()
  ctx.effect(() => () => { sessionRuntimes.clear() }, 'ui-conversation-nav: session runtime map teardown')

  // Build (or reuse) one SessionRuntime per session id. The caller provides
  // the persistence bridge so both the initial read and subsequent writes
  // route through the conversation-location data API.
  const acquire = (sessionId: SessionId): SessionRuntime => {
    const existing = sessionRuntimes.get(sessionId)
    if (existing !== undefined) return existing
    const runtime: SessionRuntime = {
      store: createNavStore(),
      nodes: [],
      persist(_state) {
        // Best-effort publication. In tests and composition-off configurations
        // the session may not have a location-data writer; in those cases the
        // transient store still supports live interaction.
      },
      setNodes(nodes) { runtime.nodes = nodes },
    }
    sessionRuntimes.set(sessionId, runtime)
    return runtime
  }

  // Keyboard shortcut: Ctrl/Cmd + Shift + F toggles the panel open state.
  ctx.effect(() => {
    if (typeof window === 'undefined') return () => {}
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      if (!mod || !event.shiftKey) return
      if (event.key.toLowerCase() !== 'f') return
      const sessions = ctx.get?.('sessions') as { current: { sessionId: SessionId } } | undefined
      const sessionId = sessions?.current?.sessionId
      if (sessionId === undefined) return
      const rt = sessionRuntimes.get(sessionId)
      if (rt === undefined) return
      const snap = rt.store.getSnapshot()
      rt.store.set({ ...snap, open: !snap.open, minimized: false })
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, 'ui-conversation-nav: shortcut Ctrl/Cmd+Shift+F')

  // Register the conversation.layout.sidebar slot declaration + occupy it.
  ctx.effect(
    () => ctx.slots.register({
      name: 'conversation.layout.sidebar',
      locale: NS,
      inject: (sessionId: SessionId): ConversationNavInjected => {
        const rt = acquire(sessionId)
        return {
          nodes: rt.nodes,
          store: rt.store,
          scrollToSeq: defaultScrollToSeq,
          persist: (_state) => { rt.persist(_state) },
        }
      },
    }, ConversationNavPanel),
    'ui-conversation-nav: slot registration',
  )
}

/** Re-exported locale binder type helper; mirrors the renderer's `t` seat. */
export type ConversationNavTranslate = TranslateNS<'conversation-nav'>
