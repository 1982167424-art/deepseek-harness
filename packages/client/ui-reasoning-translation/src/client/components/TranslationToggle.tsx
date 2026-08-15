import { useSyncExternalStore } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { PerSessionTranslationState } from '../store.ts'
import css from './ReasoningTranslation.module.css'

export interface TranslationToggleProps {
  sessionId?: unknown
  store?: SnapshotStore<PerSessionTranslationState>
  toggle?: (enabled: boolean) => void
  t?: TranslateNS<'reasoningTranslation'>
  inject?: {
    store?: SnapshotStore<PerSessionTranslationState>
    toggle?: (enabled: boolean) => void
    t?: TranslateNS<'reasoningTranslation'>
  }
}

export function SessionTranslationToggle(props: TranslationToggleProps) {
  const injected = props.inject ?? {}
  const store = props.store ?? injected.store
  const toggle = props.toggle ?? injected.toggle
  const t = props.t ?? injected.t

  if (store === undefined || toggle === undefined) return null
  const enabled = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot().enabled,
    () => store.getSnapshot().enabled,
  )

  return (
    <label className={css.toggleLabel} title={t?.('translationOnOff') ?? '翻译思维链 (中)'}>
      <span className={css.toggleText}>{t?.('translationOnOff') ?? '翻译思维链 (中)'}</span>
      <input
        type="checkbox"
        className={css.toggleInput}
        checked={enabled}
        onChange={(e) => toggle(e.target.checked)}
      />
      <span className={css.toggleSwitch} />
    </label>
  )
}
