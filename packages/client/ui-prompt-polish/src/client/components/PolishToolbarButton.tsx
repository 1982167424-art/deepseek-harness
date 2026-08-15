import { useSyncExternalStore } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { PerSessionPolishState } from '../store.ts'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './PromptPolish.module.css'

interface Props {
  store: SnapshotStore<PerSessionPolishState>
  draft: string
  onOpen: () => void
  t: TranslateNS<'promptPolish'>
}

export function PolishToolbarButton({ store, draft, onOpen, t }: Props) {
  const open = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().open,
    () => store.getSnapshot().open,
  )
  const disabled = draft.trim().length === 0 || open
  return (
    <button
      type="button"
      className={css.toolbarBtn}
      onClick={onOpen}
      disabled={disabled}
      aria-label={t('polishBtn')}
      title={disabled ? t('emptyDraft') : t('polishBtn')}
    >
      <span>{t('polishBtn')}</span>
    </button>
  )
}
