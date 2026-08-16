/**
 * Standalone reasoning effort (thinking intensity) selector.
 *
 * Component contract: reads session scoped data through the injected face
 * (the plugin apply binds sessionId to the RPC calls at slot registration time,
 * so the component stays untangled from connection transports). Owns three
 * render surfaces: a 28px chip trigger, a Menu-driven dropdown with the
 * three off/high/max rows, and an in-menu status line for pending saves or
 * failures. Optimistic UI: the trigger label reflects the clicked row at
 * once; a failed write rolls the trigger back to the host-confirmed value
 * and surfaces a status line until the user's next interaction.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import clsx from 'clsx'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconChevronDownOutline14, IconThinkOutline14, Menu, type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the SlotMap merge so TS recognises the input.right seat.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ReasoningEffortInjected } from './index.ts'
import css from './ReasoningEffortSelect.module.css'

/** Effort ids covered by the shipped DeepSeek + OpenRouter serializers. */
type KnownEffort = 'off' | 'high' | 'max'

const KNOWN: readonly KnownEffort[] = ['off', 'high', 'max'] as const

/** The host-facing SessionModels payload — only the fields we actually consume. */
interface SessionModelSnapshot {
  readonly current: { readonly selection: ModelSelection } | null
}

/** Full seat props: InputZone owner share + injected business face + locale. */
export type ReasoningEffortProps =
  & { readonly session: unknown; readonly input: { readonly busy?: boolean } | undefined }
  & ReasoningEffortInjected
  & PropsLocale<'reasoning'>

/**
 * Public component: mounted by apply() onto `conversation.input.right`.
 */
export function ReasoningEffortSelect(props: ReasoningEffortProps) {
  const { input, loadModels, subscribeChanges, writeEffort, t } = props

  const disabled = input?.busy === true

  const [models, setModels] = useState<SessionModelSnapshot | null>(null)
  const [optimistic, setOptimistic] = useState<KnownEffort | undefined>(undefined)
  const [status, setStatus] = useState<null | { kind: 'busy' | 'error'; message: string }>(null)
  const aliveRef = useRef(true)
  const workingRef = useRef<KnownEffort | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  useEffect(() => {
    let cancelled = false
    const reload = (): void => {
      void loadModels().then((snapshot) => {
        if (cancelled || !aliveRef.current) return
        setModels(snapshot as SessionModelSnapshot)
        if (workingRef.current === null) setOptimistic(undefined)
      }, () => {})
    }
    reload()
    const unsubscribe = subscribeChanges?.(() => {
      if (cancelled || !aliveRef.current) return
      reload()
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [loadModels, subscribeChanges])

  const current: KnownEffort | undefined = useMemo(() => {
    if (optimistic !== undefined) return optimistic
    const id = models?.current?.selection.reasoningEffort
    if (id === undefined) return undefined
    return (KNOWN as readonly string[]).includes(id) ? (id as KnownEffort) : undefined
  }, [models, optimistic])

  const displayLabel = (): string => {
    switch (current) {
      case undefined: return t('reasoningEffort')
      case 'off': return t('dropdownOff')
      case 'high': return t('dropdownHigh')
      case 'max': return t('dropdownMax')
      default: return t('reasoningEffort')
    }
  }

  const stateLabel = (): string => {
    switch (current) {
      case undefined: return t('stateDefault')
      case 'off': return t('stateOff')
      case 'high': return t('stateHigh')
      case 'max': return t('stateMax')
      default: return t('stateDefault')
    }
  }

  const active = current !== undefined && current !== 'off'

  const choose = async (effort: KnownEffort): Promise<void> => {
    if (disabled || !models?.current?.selection) return
    setOpen(false)
    setOptimistic(effort)
    workingRef.current = effort
    setStatus({ kind: 'busy', message: t('statusSubmitting') })
    const err = await writeEffort(effort)
    if (!aliveRef.current) return
    workingRef.current = null
    if (err === null) {
      setStatus(null)
      setOptimistic(undefined)
    } else {
      setStatus({ kind: 'error', message: t('statusFailed', { message: err }) })
      setOptimistic(undefined)
    }
  }

  const triggerTitle = (): string => {
    if (status?.kind === 'error') return status.message
    return t('reasoningEffort')
  }

  const selectedId: string | undefined = current === undefined ? undefined : `effort-${current}`

  const items = buildMenu({ t, status })

  const trigger = (
    <span className={css.root}>
      <button
        type="button"
        className={clsx(
          css.trigger,
          active && css.triggerActive,
          open && css.triggerActive,
        )}
        disabled={disabled || !models?.current?.selection}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('triggerAria', { state: stateLabel() })}
        title={triggerTitle()}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={css.triggerIcon} aria-hidden>
          <IconThinkOutline14 size={14} />
        </span>
        <span className={css.triggerLabel}>{displayLabel()}</span>
        <span className={clsx(css.triggerChevron, open && css.triggerChevronOpen)} aria-hidden>
          <IconChevronDownOutline14 size={14} />
        </span>
      </button>
    </span>
  )

  return (
    <Menu
      open={open}
      onClose={() => setOpen(false)}
      onSelect={(id) => {
        if (id === 'effort-off') void choose('off')
        else if (id === 'effort-high') void choose('high')
        else if (id === 'effort-max') void choose('max')
      }}
      selectedId={selectedId}
      align="end"
      portal
      anchor={trigger}
      items={items}
    />
  )
}

interface BuildMenuArgs {
  t: (key: ReasoningKeyUnion, params?: Record<string, unknown>) => string
  status: null | { kind: 'busy' | 'error'; message: string }
}

type ReasoningKeyUnion =
  | 'reasoningEffort' | 'effortOff' | 'effortHigh' | 'effortMax'
  | 'dropdownOff' | 'dropdownHigh' | 'dropdownMax'
  | 'statusSubmitting' | 'statusFailed'

function buildMenu({ t, status }: BuildMenuArgs): readonly MenuEntry[] {
  const stack: CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0,
  }
  const title: CSSProperties = {
    fontSize: 13, lineHeight: '18px', fontWeight: 600,
  }
  const hint: CSSProperties = {
    fontSize: 12, lineHeight: '16px', color: 'var(--dsw-alias-label-secondary)',
  }
  const entries: MenuEntry[] = [
    {
      id: 'effort-off',
      label: (
        <div style={stack}>
          <div style={title}>{t('dropdownOff')}</div>
          <div style={hint}>{t('effortOff')}</div>
        </div>
      ),
    },
    {
      id: 'effort-high',
      label: (
        <div style={stack}>
          <div style={title}>{t('dropdownHigh')}</div>
          <div style={hint}>{t('effortHigh')}</div>
        </div>
      ),
    },
    {
      id: 'effort-max',
      label: (
        <div style={stack}>
          <div style={title}>{t('dropdownMax')}</div>
          <div style={hint}>{t('effortMax')}</div>
        </div>
      ),
    },
  ]
  if (status !== null) {
    entries.push({ id: 'sep-status', type: 'separator' })
    entries.push({
      id: 'status-label',
      type: 'label',
      text: status.message,
    })
  }
  return entries
}
