/**
 * Conversation-collapse plugin (browser half):
 * - Registers the `conversation-collapse` locale dictionary (zh+en).
 * - Mounts a per-session collapse state store (registered on the turn-tail slot entry
 *   so its lifetime is tied to session scope).
 * - Adds per-turn Expand / Collapse action buttons through the chain-mounted
 *   `conversation.chat.turnTail` seat.
 * - Listens for turn/step completion events so it can auto-collapse reasoning
 *   and tool-call blocks, controlled by the Host-owned settings section
 *   `ui-conversation-collapse` (collapseReasoning + collapseToolCalls).
 *
 * The collapsible DisclosureRow wrapper is exported as {@link CollapseWrapper};
 * consuming renderers wrap their reasoning/tool surfaces by importing it and
 * reading the session-scoped collapse store off the standard kit.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { en, zh, type ConversationCollapseKey } from './locales.ts'
import { createCollapseStore, type CollapseStoreState } from './collapse-store.ts'
import { TurnCollapseActions, type TurnCollapseActionsInjected } from './TurnCollapseActions.tsx'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

export { CollapseWrapper, wrapChatRenderer } from './CollapseWrapper.tsx'
export {
  createCollapseStore, setNodeCollapsed, setTurnCollapsed, type CollapsedNodeMap, type CollapseStoreState,
} from './collapse-store.ts'
export type { ConversationCollapseKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Collapse-workflow controls copy (disclosure titles + turn action strip). */
    'conversation-collapse': ConversationCollapseKey
  }
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationTurnDataMap {
    /** Snapshot store handle reference held by the turn-tail slot store axis. */
    'conversation-collapse-store': SnapshotStore<CollapseStoreState>
  }
}

const NS = 'conversation-collapse'

export const inject = ['theme', 'locale', 'conversation', 'slots']

function selectAny(_owner: TurnTailOwnerProps): true {
  return true
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-conversation-collapse: dictionaries')

  let globalCollapseReasoning = true
  let globalCollapseToolCalls = true

  const collapseHandle = createCollapseStore()

  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    select: selectAny,
    locale: NS,
    store: collapseHandle,
    inject: (sessionId: SessionId, actions): TurnCollapseActionsInjected => {
      void sessionId
      return {
        collapseReasoning: globalCollapseReasoning,
        collapseToolCalls: globalCollapseToolCalls,
        expandTurn: (keys) => actions.setTurnCollapsed(0, keys, false),
        collapseTurn: (keys) => actions.setTurnCollapsed(0, keys, true),
      }
    },
  }, TurnCollapseActions))
}
