import { useSyncExternalStore } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { PerSessionTranslationState, TranslatedBlockState } from '../store.ts'
import css from './ReasoningTranslation.module.css'

export interface ReasoningTranslationTabsProps {
  sessionId: unknown
  owner?: {
    reasoningBlocks?: ReadonlyArray<{ index: number; text: string }>
  }
  inject?: {
    translation: SnapshotStore<PerSessionTranslationState>
    translatedText?: (blockIndex: number) => string
    isTranslating?: (blockIndex: number) => boolean
  }
  t?: TranslateNS<'reasoningTranslation'>
}

type TabKey = 'original' | 'chinese'

export function ReasoningTranslationTabs(props: ReasoningTranslationTabsProps) {
  const { owner, inject, t } = props
  const blocks = owner?.reasoningBlocks ?? []
  if (blocks.length === 0 || inject === undefined) {
    return null
  }

  const state = useSyncExternalStore(
    (cb) => inject.translation.subscribe(cb),
    () => inject.translation.getSnapshot(),
    () => inject.translation.getSnapshot(),
  )

  if (!state.enabled) {
    return null
  }

  return (
    <div className={css.tabsWrapper}>
      {blocks.map((block) => {
        const blockState = state.blocks.get(block.index)
        const translated = inject.translatedText?.(block.index) ?? blockState?.translated ?? ''
        const streaming = inject.isTranslating?.(block.index) ?? blockState?.streaming ?? false
        const blockProps = {
          original: block.text,
          translated,
          streaming,
          ...(t !== undefined ? { t } : {}),
        }
        return (
          <BlockTabs
            key={block.index}
            {...blockProps}
          />
        )
      })}
    </div>
  )
}

function BlockTabs(props: { original: string; translated: string; streaming: boolean; t?: TranslateNS<'reasoningTranslation'> }) {
  const { original, translated, streaming, t } = props
  const [tab, setTab] = useTabState()
  return (
    <div className={css.block}>
      <div className={css.tabBar}>
        <button className={tab === 'original' ? css.tabActive : css.tab} onClick={() => setTab('original')} type="button">
          {t?.('translationTabOriginal') ?? '原文'}
        </button>
        <button className={tab === 'chinese' ? css.tabActive : css.tab} onClick={() => setTab('chinese')} type="button">
          {t?.('translationTabChinese') ?? '翻译'}{streaming ? <span className={css.typing}> {t?.('translating') ?? '翻译中…'}</span> : null}
        </button>
      </div>
      <div className={css.tabPanel}>
        {tab === 'original' ? (
          <pre className={css.blockText}>{original}</pre>
        ) : (
          <pre className={css.blockText}>
            {translated}
            {streaming && translated.length === 0 ? (
              <span className={css.typing}>{t?.('translationTyping') ?? '正在翻译…'}</span>
            ) : null}
          </pre>
        )}
      </div>
    </div>
  )
}

function useTabState(): [TabKey, (k: TabKey) => void] {
  const [tab, setTab] = useStateCompat<TabKey>('original')
  return [tab, setTab]
}

import { useState as useStateCompat } from 'react'

export type { TranslatedBlockState }
