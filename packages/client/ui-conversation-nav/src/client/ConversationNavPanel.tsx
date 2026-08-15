/** Draggable / resizable navigation panel component. */
import {
  type ReactElement, useEffect, useMemo, useRef, type PointerEvent as RPointerEvent,
} from 'react'
import clsx from 'clsx'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconChevronLeftOutline14, IconChecklistOutline14,
  IconSendOutline14, IconCloseFill14, IconThinkOutline14, IconApiOutline14,
  IconEllipsisOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  NAV_MAX_WIDTH, NAV_MIN_WIDTH, type NavPanelState,
} from './nav-store.ts'
import { buildNavItems, type NavItem, type NavItemKind } from './nav-items.ts'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'
import css from './ConversationNavPanel.module.css'

/** Injected face of the conversation-nav slot owner (shell-supplied callbacks). */
export interface ConversationNavInjected {
  /** Ordered list of assembled chat view nodes for the current session. */
  readonly nodes: readonly ChatConversationViewNode[]
  /** Session geometry store, mutated live by drag / resize / toggle actions. */
  readonly store: SnapshotStore<NavPanelState>
  /** One-shot scroll-to-anchor: scrollport scrolls the node with anchorSeq == seq into view. */
  readonly scrollToSeq: (seq: number, anchorId: string) => void
  /** Persist the latest geometry to the session location data store. */
  readonly persist: (state: NavPanelState) => void
}

/**
 * Full component props as composed by the slot framework: the injected fields
 * are spread directly onto props (not nested under `inject`), plus the
 * framework-standard session id, translate seat, and owner share.
 */
export interface ConversationNavPanelProps {
  readonly sessionId: string
  readonly t: TranslateNS<'conversation-nav'>
  readonly nodes: readonly ChatConversationViewNode[]
  readonly store: SnapshotStore<NavPanelState>
  readonly scrollToSeq?: (seq: number, anchorId: string) => void
  readonly persist: (state: NavPanelState) => void
}

function kindIcon(kind: NavItemKind) {
  switch (kind) {
    case 'tool': return <IconApiOutline14 size={12} />
    case 'reasoning': return <IconThinkOutline14 size={12} />
    case 'message': return <IconSendOutline14 size={12} />
    default: return <IconChecklistOutline14 size={12} />
  }
}

function kindLabel(kind: NavItemKind, t: TranslateNS<'conversation-nav'>): string {
  switch (kind) {
    case 'tool': return t('stepTool')
    case 'reasoning': return t('stepReasoning')
    case 'message': return t('stepMessage')
    default: return ''
  }
}

/**
 * Render the floating navigation panel: draggable header, resize handle,
 * minimize button, per-turn timeline of steps/turns, click-to-jump scroll.
 *
 * Geometry reads come from the SnapshotStore (re-renders subscribe via
 * getSnapshot on each render pass — the owning slot store-scope triggers
 * the render cycle when the snapshot mutates).
 */
export function ConversationNavPanel({
    t, nodes, store, scrollToSeq: ownerScrollToSeq, persist,
  }: ConversationNavPanelProps): ReactElement | null {
  const scrollToSeq = ownerScrollToSeq ?? (() => {})
  const snap = store.getSnapshot()
  const { x, y, width, minimized, open } = snap

  const panelRef = useRef<HTMLDivElement>(null)
  const pointerStart = useRef<{ x: number; y: number; panelX: number; panelY: number; panelW: number } | null>(null)

  const items = useMemo(() => buildNavItems(nodes), [nodes])

  const write = (patch: Partial<NavPanelState>): void => {
    const next = { ...store.getSnapshot(), ...patch }
    store.set(next)
    persist(next)
  }

  const onDragStart = (event: RPointerEvent<HTMLDivElement>) => {
    if (minimized) return
    pointerStart.current = {
      x: event.clientX,
      y: event.clientY,
      panelX: x,
      panelY: y,
      panelW: width,
    }
    ;(event.target as Element).setPointerCapture?.(event.pointerId)
  }

  const onResizeStart = (event: RPointerEvent<HTMLDivElement>) => {
    pointerStart.current = {
      x: event.clientX,
      y: event.clientY,
      panelX: x,
      panelY: y,
      panelW: width,
    }
    ;(event.target as Element).setPointerCapture?.(event.pointerId)
    event.stopPropagation()
  }

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const start = pointerStart.current
      if (start === null) return
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      const resizeCls = css.resizeHandle as string | undefined
      const targetEl = event.target as HTMLElement | null
      if (resizeCls !== undefined && targetEl !== null && targetEl.classList?.contains(resizeCls)) {
        const w = Math.max(NAV_MIN_WIDTH, Math.min(NAV_MAX_WIDTH, start.panelW + dx))
        write({ width: w })
      } else {
        write({ x: Math.max(0, start.panelX + dx), y: Math.max(0, start.panelY + dy) })
      }
    }
    const onUp = () => { pointerStart.current = null }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [store, persist])

  const handleJump = (seq: number, anchorId: string | undefined): void => {
    if (anchorId === undefined) return
    const anchor = anchorId as string
    scrollToSeq(seq, anchor)
  }

  if (!open) {
    return (
      <div
        className={css.launcher}
        style={{ left: x, top: y }}
      >
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('togglePanel')}
          title={t('togglePanel')}
          onClick={() => write({ open: true, minimized: false })}
        >
          <IconChecklistOutline14 size={18} />
        </button>
      </div>
    )
  }

  const groupedByTurn = new Map<number, NavItem[]>()
  let lastTurn = -1
  for (const item of items) {
    if (item.kind === 'turn') {
      lastTurn = item.turn
      if (!groupedByTurn.has(lastTurn)) groupedByTurn.set(lastTurn, [])
    } else if (lastTurn !== -1) {
      const arr = groupedByTurn.get(lastTurn)
      if (arr !== undefined) arr.push(item)
    }
  }

  return (
    <div
      ref={panelRef}
      className={clsx(css.panel, minimized && css.panelMinimized)}
      style={{ left: x, top: y, width: minimized ? undefined : width, maxHeight: 'calc(100vh - 120px)' }}
    >
      <div className={css.header}>
        <div className={css.dragHandle} onPointerDown={onDragStart}>
          <IconEllipsisOutline16 size={14} />
          <span>{minimized ? '…' : t('navPanelTitle')}</span>
        </div>
        {!minimized && (
          <>
            <button
              type="button"
              className={css.iconButton}
              aria-label={t('collapseAllTurns')}
              title={t('collapseAllTurns')}
              onClick={() => write({ minimized: true })}
            >
              <IconChevronLeftOutline14 size={14} />
            </button>
            <button
              type="button"
              className={css.iconButton}
              aria-label={t('minimizePanel')}
              title={t('minimizePanel')}
              onClick={() => write({ minimized: true, open: false })}
            >
              <IconCloseFill14 size={14} />
            </button>
            <button
              type="button"
              className={css.iconButton}
              aria-label={t('closePanel')}
              title={t('closePanel')}
              onClick={() => write({ open: false })}
            >
              <IconCloseFill14 size={14} />
            </button>
          </>
        )}
      </div>
      {!minimized && (
        <div className={css.list}>
          {items.length === 0 ? (
            <div className={css.empty}>—</div>
          ) : (
            <div className={css.listInner}>
              {items.map((item) => {
                if (item.kind === 'turn') {
                  return (
                    <div
                      key={item.id}
                      className={css.turnRow}
                      onClick={() => handleJump(item.seq, item.anchorId)}
                      role="button"
                      tabIndex={0}
                      title={t('jumpToMsg')}
                    >
                      {item.running && <span className={css.runningDot} />}
                      <span>{t('turnLabel', { n: String(item.turn) })}</span>
                    </div>
                  )
                }
                return (
                  <div
                    key={item.id}
                    className={css.stepRow}
                    onClick={() => handleJump(item.seq, item.anchorId)}
                    role="button"
                    tabIndex={0}
                    title={t('jumpToMsg')}
                  >
                    <span className={css.stepIcon}>{kindIcon(item.kind)}</span>
                    <span className={css.stepKind}>{kindLabel(item.kind, t)}</span>
                    <span className={css.stepPreview}>{item.previewText || '—'}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
      {!minimized && <div className={css.resizeHandle} onPointerDown={onResizeStart} aria-hidden />}
    </div>
  )
}
