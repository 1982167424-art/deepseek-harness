/** Navigation timeline entry: one turn or step rendered in the panel list. */
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'

/** Classification of one navigation timeline row. */
export type NavItemKind = 'turn' | 'tool' | 'reasoning' | 'message'

/** One row rendered in the navigation timeline list. */
export interface NavItem {
  /** Stable opaque row key (seq + kind). */
  readonly id: string
  /** Owning turn index (1-based display). */
  readonly turn: number
  /** Optional step index within the turn. */
  readonly step?: number
  /** Seq value of the anchor this item scrolls to. */
  readonly seq: number
  /** Row kind: turn header / tool-call / reasoning block / assistant message. */
  readonly kind: NavItemKind
  /** i18n-agnostic display label for the turn (Turn N) or step type name. */
  readonly turnLabel: string
  /** A short plain-text preview (first line of message text, tool name, etc.). */
  readonly previewText: string
  /** The DOM anchor id that the conversation viewport scrolls to. */
  readonly anchorId?: string
  /** True while this turn or step is still streaming / executing. */
  readonly running?: boolean
}

const MAX_PREVIEW = 120

/** Trim one line of preview text to MAX_PREVIEW characters with ellipsis. */
export function previewOf(text: string): string {
  const trimmed = text.trim()
  const newline = trimmed.indexOf('\n')
  const firstLine = newline === -1 ? trimmed : trimmed.slice(0, newline)
  if (firstLine.length <= MAX_PREVIEW) return firstLine
  return `${firstLine.slice(0, MAX_PREVIEW)}…`
}

/** Extract nav items from the ordered list of assembled chat view nodes. */
export function buildNavItems(nodes: readonly ChatConversationViewNode[]): NavItem[] {
  const items: NavItem[] = []
  let lastTurn = 0
  for (const node of nodes) {
    if (node.visibility === 'hidden') continue
    const loc = node.location
    let turn = 0
    let stepNum: number | undefined
    if (loc.kind === 'turn') {
      turn = loc.turn.turn
    } else if (loc.kind === 'step') {
      turn = loc.turn.turn
      stepNum = loc.step.step
    }
    if (!turn) continue

    if (turn !== lastTurn) {
      lastTurn = turn
      items.push({
        id: `turn-${turn}`,
        turn,
        seq: node.anchorSeq,
        kind: 'turn',
        turnLabel: 'Turn',
        previewText: '',
        anchorId: `seq-${node.anchorSeq}`,
        running: loc.kind !== 'session' && loc.kind !== 'unresolved' ? loc.turn.status === 'open' : false,
      })
    }

    switch (node.kind) {
      case 'assistant-step': {
        const data = node.data as { blocks?: readonly { kind: string; text?: string; name?: string }[] }
        for (const block of data.blocks ?? []) {
          if (block.kind === 'reasoning' && block.text) {
            const base = {
              id: `${node.anchorSeq}-reasoning`,
              turn,
              seq: node.anchorSeq,
              kind: 'reasoning' as const,
              turnLabel: 'Reasoning',
              previewText: previewOf(block.text),
              anchorId: `seq-${node.anchorSeq}`,
            }
            items.push(stepNum !== undefined ? { ...base, step: stepNum } : base)
          } else if (block.kind === 'tool-call' && block.name) {
            const base = {
              id: `${node.anchorSeq}-tool-${block.name}`,
              turn,
              seq: node.anchorSeq,
              kind: 'tool' as const,
              turnLabel: 'Tool',
              previewText: block.name,
              anchorId: `seq-${node.anchorSeq}`,
            }
            items.push(stepNum !== undefined ? { ...base, step: stepNum } : base)
          } else if (block.kind === 'text' && block.text) {
            const base = {
              id: `${node.anchorSeq}-msg`,
              turn,
              seq: node.anchorSeq,
              kind: 'message' as const,
              turnLabel: 'Message',
              previewText: previewOf(block.text),
              anchorId: `seq-${node.anchorSeq}`,
            }
            items.push(stepNum !== undefined ? { ...base, step: stepNum } : base)
          }
        }
        break
      }
      case 'tool-call': {
        const data = node.data as { root?: { name?: string } }
        const name = data?.root?.name ?? 'Tool'
        const base = {
          id: `${node.anchorSeq}-toolroot`,
          turn,
          seq: node.anchorSeq,
          kind: 'tool' as const,
          turnLabel: 'Tool',
          previewText: name,
          anchorId: `seq-${node.anchorSeq}`,
        }
        items.push(stepNum !== undefined ? { ...base, step: stepNum } : base)
        break
      }
      default:
        break
    }
  }
  return items
}
