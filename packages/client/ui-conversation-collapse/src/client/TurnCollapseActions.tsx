/** Per-turn action strip: Expand all workflow / Collapse buttons. */
import { type ReactElement } from 'react'
import type {
  InjectFace, PropsLocale, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { CollapseStoreState } from './collapse-store.ts'
import { createCollapseStore } from './collapse-store.ts'
import css from './CollapseWrapper.module.css'

type CollapseStoreHandle = ReturnType<typeof createCollapseStore>

/** Injected face of the turn-tail chain entry for collapse controls. */
export interface TurnCollapseActionsInjected {
  readonly collapseReasoning: boolean
  readonly collapseToolCalls: boolean
  /** Expand every collapsible node in the turn whose key is listed. */
  readonly expandTurn: (keys: readonly string[]) => void
  /** Collapse every collapsible node in the turn whose key is listed. */
  readonly collapseTurn: (keys: readonly string[]) => void
}

export type TurnCollapseActionsProps =
  & PropsRuntime<'conversation.chat.turnTail'>
  & PropsStore<CollapseStoreHandle>
  & InjectFace<TurnCollapseActionsInjected>
  & PropsLocale<'conversation-collapse'>

/**
 * Render the per-turn Expand / Collapse action row in the turn-tail chain slot.
 * The two buttons mutate the shared session collapse store so the DisclosureRow
 * wrappers (mounted on the same session's nodes) reflect the new state.
 */
export function TurnCollapseActions({
  t, turn, useStore, actions, collapseReasoning: _cr, collapseToolCalls: _ct, expandTurn, collapseTurn,
}: TurnCollapseActionsProps): ReactElement | null {
  const turnNumber = turn.turn
  const collapsedNodes = useStore((s: CollapseStoreState) => s.collapsedNodes)
  const keysForTurn: string[] = []
  for (const key of collapsedNodes.keys()) {
    if (key.startsWith(`${turnNumber}:`) || key.includes(`:${turnNumber}:`)) keysForTurn.push(key)
  }
  const anyCollapsed = Array.from(collapsedNodes.values()).some((c) => c)
  const onExpandAll = () => {
    const affected = keysForTurn.length > 0 ? keysForTurn : Array.from(collapsedNodes.keys())
    actions.setTurnCollapsed(turnNumber, affected, false)
    expandTurn(affected)
  }
  const onCollapseAll = () => {
    const affected = keysForTurn.length > 0 ? keysForTurn : Array.from(collapsedNodes.keys())
    actions.setTurnCollapsed(turnNumber, affected, true)
    collapseTurn(affected)
  }
  return (
    <div className={css.turnActions}>
      <button type="button" className={css.actionButton} onClick={onExpandAll}>
        {t('expandAllTurns')}
      </button>
      <button
        type="button"
        className={css.actionButton}
        onClick={onCollapseAll}
        disabled={!anyCollapsed}
      >
        {t('collapseAllTurns')}
      </button>
    </div>
  )
}
