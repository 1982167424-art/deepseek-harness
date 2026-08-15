/**
 * Disclosure wrapper for assistant-step reasoning blocks and tool-call blocks.
 *
 * This component is rendered as the chain-slot wrapper around existing chat
 * node renderers: it inspects the node kind, and when the enclosed renderer
 * contains collapsible material (reasoning blocks inside assistant-step, or
 * the whole tool-call / turn-tail tool-result region), it mounts a
 * DisclosureRow that collapses the content after the turn settles.
 */
import { type ReactElement, useMemo, type ComponentType } from 'react'
import type {
  ChatNode, ChatNodeDataMap,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  AssistantBlock, ToolCallBlock,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  DisclosureRow, IconThinkOutline14, IconCordisPluginOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { CollapseStoreState } from './collapse-store.ts'
import { setNodeCollapsed, setTurnCollapsed } from './collapse-store.ts'
import css from './CollapseWrapper.module.css'

export interface CollapseWrapperOwnerProps {
  /** Global settings: whether to auto-collapse reasoning blocks. */
  readonly collapseReasoning: boolean
  /** Global settings: whether to auto-collapse tool-call blocks. */
  readonly collapseToolCalls: boolean
}

export interface CollapseWrapperInjected {
  /** Per-session collapse store. */
  readonly store: SnapshotStore<CollapseStoreState>
  /** One-shot callback: expand all collapsed blocks in the turn. */
  readonly expandTurn: (turn: number) => void
  /** One-shot callback: collapse all blocks in the turn. */
  readonly collapseTurn: (turn: number) => void
}

export type CollapseWrapperProps<Kind extends keyof ChatNodeDataMap & string = keyof ChatNodeDataMap & string> =
  & {
    node: ChatNode<Kind>
    t: TranslateNS<'conversation-collapse'>
    children: ReactElement | null
    collapseReasoning: boolean
    collapseToolCalls: boolean
    store: SnapshotStore<CollapseStoreState>
  }

/** Extract node key used for collapsed-map lookups. */
function nodeKey<Kind extends keyof ChatNodeDataMap & string>(node: ChatNode<Kind>): string {
  return `${node.anchorSeq}:${node.kind}`
}

/** Turn number from a node's location, or 0 if unknown. */
function turnOf<Kind extends keyof ChatNodeDataMap & string>(node: ChatNode<Kind>): number {
  const loc = node.location
  if (loc.kind === 'turn') return loc.turn.turn
  if (loc.kind === 'step') return loc.turn.turn
  return 0
}

/** Whether the turn owning this node is settled (closed = completion done). */
function isSettled<Kind extends keyof ChatNodeDataMap & string>(node: ChatNode<Kind>): boolean {
  const loc = node.location
  if (loc.kind === 'turn') return loc.turn.status === 'closed'
  if (loc.kind === 'step') return loc.step.status === 'closed'
  return true
}

type BlockSummary = {
  reasoningCount: number
  toolCallCount: number
  reasoningPreview: string
  toolNamePreview: string
}

function summarize(blocks: readonly AssistantBlock[] | undefined): BlockSummary {
  let reasoningCount = 0
  let toolCallCount = 0
  let reasoningPreview = ''
  let toolNamePreview = ''
  for (const block of blocks ?? []) {
    if (block.kind === 'reasoning') {
      reasoningCount += 1
      if (!reasoningPreview) {
        const newline = block.text.indexOf('\n')
        reasoningPreview = newline === -1 ? block.text : block.text.slice(0, newline)
      }
    } else if (block.kind === 'tool-call') {
      toolCallCount += 1
      if (!toolNamePreview) toolNamePreview = block.name
    }
  }
  return { reasoningCount, toolCallCount, reasoningPreview, toolNamePreview }
}

/**
 * Wrap a child renderer with the disclosure chrome when the node has
 * collapsible content; otherwise forward the child unchanged.
 */
export function CollapseWrapper<Kind extends keyof ChatNodeDataMap & string>({
  node,
  t,
  children,
  collapseReasoning,
  collapseToolCalls,
  store,
}: CollapseWrapperProps<Kind>): ReactElement | null {
  const key = nodeKey(node)
  const turn = turnOf(node)
  const settled = isSettled(node)
  const collapsedFromStore = store.getSnapshot().collapsedNodes.get(key)

  const defaultCollapsed = useMemo(() => {
    switch (node.kind) {
      case 'assistant-step': {
        const data = node.data as ChatNodeDataMap['assistant-step']
        const summary = summarize(data?.blocks)
        const autoReasoning = collapseReasoning && summary.reasoningCount > 0
        const autoTool = collapseToolCalls && summary.toolCallCount > 0
        return settled && (autoReasoning || autoTool)
      }
      case 'tool-call':
        return settled && collapseToolCalls
      default:
        return false
    }
  }, [node, collapseReasoning, collapseToolCalls, settled])

  const open = !(collapsedFromStore ?? defaultCollapsed)
  const onToggle = () => {
    setNodeCollapsed(store, key, open)
  }

  const actionKeys = useMemo(() => [key], [key])
  const onExpandAll = () => { setTurnCollapsed(store, turn, actionKeys, false) }
  const onCollapseAll = () => { setTurnCollapsed(store, turn, actionKeys, true) }

  const kind = node.kind
  if (kind === 'assistant-step') {
    const data = node.data as ChatNodeDataMap['assistant-step']
    const summary = summarize(data?.blocks)
    const collapsible = summary.reasoningCount > 0 || summary.toolCallCount > 0
    if (!collapsible) return children
    const preview = summary.reasoningPreview || summary.toolNamePreview || ''
    return (
      <div className={css.root}>
        <DisclosureRow
          icon={<IconThinkOutline14 size={14} />}
          title={t('expandWorkflowLabel')}
          open={open}
          expandable
          expandOnRowClick
          onToggle={onToggle}
          collapsedContent={preview ? (
            <span className={css.wrappedBlock}>{preview}</span>
          ) : undefined}
        >
          <div className={css.wrappedBlock}>{children}</div>
        </DisclosureRow>
        <div className={css.turnActions}>
          <button type="button" className={css.actionButton} onClick={onExpandAll}>
            {t('expandAllTurns')}
          </button>
          <button type="button" className={css.actionButton} onClick={onCollapseAll}>
            {t('collapseAllTurns')}
          </button>
        </div>
      </div>
    )
  }

  if (kind === 'tool-call') {
    const data = node.data as ChatNodeDataMap['tool-call']
    const root = data?.root as ToolCallBlock | undefined
    const name = root && 'callId' in root ? (root as { name: string }).name : ''
    return (
      <DisclosureRow
        icon={<IconCordisPluginOutline14 size={14} />}
        title={name || t('expandWorkflowLabel')}
        open={open}
        expandable
        expandOnRowClick
        onToggle={onToggle}
        collapsedContent={name ? undefined : undefined}
      >
        <div className={css.wrappedBlock}>{children}</div>
      </DisclosureRow>
    )
  }

  return children
}

/** Higher-order: wrap the original registered renderer with the collapse shell. */
export function wrapChatRenderer(
  Original: ComponentType<any>,
): ComponentType<any> {
  return function CollapseWrapped(props: any) {
    const { node, t, collapseReasoning, collapseToolCalls, store } = props
    const original = <Original {...props} />
    const hasCollapseProps = collapseReasoning !== undefined && collapseToolCalls !== undefined && store !== undefined
    if (!hasCollapseProps) return original
    return (
      <CollapseWrapper
        node={node}
        t={t}
        collapseReasoning={collapseReasoning}
        collapseToolCalls={collapseToolCalls}
        store={store}
      >
        {original}
      </CollapseWrapper>
    )
  }
}
