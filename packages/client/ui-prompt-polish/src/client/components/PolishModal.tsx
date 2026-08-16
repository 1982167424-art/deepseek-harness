import { useSyncExternalStore, useEffect, useMemo, useState } from 'react'
import {
  createPortal,
} from 'react-dom'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { PerSessionPolishState } from '../store.ts'
import type { PolishStyle, PolishedVariation } from '../slots.ts'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './PromptPolish.module.css'

const POLISH_STYLES: readonly PolishStyle[] = ['general', 'professional', 'concise', 'creative', 'detailed', 'technical']

interface PolishModalProps {
  store: SnapshotStore<PerSessionPolishState>
  onClose: () => void
  onSetStyle: (style: PolishStyle) => void
  onSetVariations: (n: number) => void
  onSetCompare: (compare: boolean) => void
  onSelect: (index: number) => void
  onGenerate: () => Promise<void>
  onAccept: (text: string) => void
  t: TranslateNS<'promptPolish'>
}

const STYLE_LOCALIZED_KEYS: Record<PolishStyle, `style${Capitalize<PolishStyle>}`> = {
  general: 'styleGeneral',
  professional: 'styleProfessional',
  concise: 'styleConcise',
  creative: 'styleCreative',
  detailed: 'styleDetailed',
  technical: 'styleTechnical',
}

function VariationCard({
  variation,
  selected,
  onSelect,
  t,
}: {
  variation: PolishedVariation
  selected: boolean
  onSelect: () => void
  t: TranslateNS<'promptPolish'>
}) {
  return (
    <div
      className={`${css.variationCard} ${selected ? css.variationCardSelected : ''}`}
      onClick={onSelect}
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
    >
      <div className={css.variationHeader}>
        <span className={css.variationLabel}>
          <span className={`${css.radio} ${selected ? css.radioSelected : ''}`} aria-hidden>
            <span className={css.radioDot} />
          </span>
          {t('variation', { n: String(variation.index + 1) })}
        </span>
      </div>
      <div className={css.variationText}>{variation.text}</div>
    </div>
  )
}

export function PolishModal(props: PolishModalProps) {
  const {
    store, onClose, onSetStyle, onSetVariations, onSetCompare,
    onSelect, onGenerate, onAccept, t,
  } = props

  const snap = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot(),
    () => store.getSnapshot(),
  )
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true); return () => setMounted(false) }, [])
  const selected = snap.selectedIndex !== null ? snap.results[snap.selectedIndex] : undefined
  const canAccept = selected !== undefined

  const styles: PolishStyle[] = useMemo(() => [...POLISH_STYLES], [])

  if (!mounted || !snap.open) return null

  return createPortal(
    <div className={css.backdrop} role="dialog" aria-modal="true" aria-label={t('modalTitle')} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={css.modal}>
        <div className={css.header}>
          <h2 className={css.title}>{t('modalTitle')}</h2>
          <button className={css.closeBtn} onClick={onClose} aria-label={t('close')}>×</button>
        </div>

        <div className={css.body}>
          <div className={css.controlsRow} style={{ gap: '20px' }}>
            <div style={{ flex: '1 1 auto', minWidth: 0 }}>
              <label className={css.controlLabel}>{t('styleLabel')}</label>
              <div className={css.stylePills}>
                {styles.map((s) => (
                  <button
                    key={s}
                    className={`${css.pill} ${snap.style === s ? css.pillActive : ''}`}
                    onClick={() => onSetStyle(s)}
                  >
                    {t(STYLE_LOCALIZED_KEYS[s])}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ flex: '0 0 auto' }}>
              <label className={css.controlLabel}>{t('variationCount')}</label>
              <select
                className={css.variationSelect}
                value={snap.variations}
                onChange={(e) => onSetVariations(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>

            <div style={{ flex: '0 0 auto', alignSelf: 'flex-end' }}>
              <button
                className={css.generateBtn}
                disabled={snap.status === 'generating' || snap.originalText.trim() === ''}
                onClick={() => { void onGenerate() }}
              >
                {snap.status === 'generating' && <span className={css.spinner} aria-hidden />}
                {t('generate')}
              </button>
            </div>
          </div>

          {snap.originalText.trim() === '' && (
            <div className={`${css.statusRow} ${css.statusError}`}>{t('emptyDraft')}</div>
          )}

          {snap.status === 'generating' && (
            <div className={`${css.statusRow} ${css.statusGenerating}`}>
              <span className={css.spinner} aria-hidden />
              <span>{t('generating')}</span>
            </div>
          )}

          {snap.status === 'error' && (
            <div className={`${css.statusRow} ${css.statusError}`}>
              <span>{t('generationFailed', { message: snap.error ?? 'unknown' })}</span>
              <button className={css.retryBtn} onClick={() => { void onGenerate() }}>
                {t('retry')}
              </button>
            </div>
          )}

          {snap.status === 'ready' && snap.results.length > 0 && (
            <>
              <div className={css.results}>
                {snap.results.map((v, i) => (
                  <VariationCard
                    key={`${i}-${v.index}`}
                    variation={v}
                    selected={snap.selectedIndex === i}
                    onSelect={() => onSelect(i)}
                    t={t}
                  />
                ))}
              </div>

              {snap.compare && selected !== undefined && (
                <div className={css.compareSection}>
                  <div className={css.compareColumn}>
                    <div className={css.compareLabel}>{t('originalText')}</div>
                    <div className={css.compareBody}>{snap.originalText}</div>
                  </div>
                  <div className={css.compareColumn}>
                    <div className={css.compareLabel}>{t('polishedText')}</div>
                    <div className={css.compareBody}>{selected.text}</div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className={css.footer}>
          <label className={css.compareToggle}>
            <input
              type="checkbox"
              checked={snap.compare}
              onChange={(e) => onSetCompare(e.target.checked)}
            />
            {t('compareWithOriginal')}
          </label>
          <div className={css.footerActions}>
            <button className={css.cancelBtn} onClick={onClose}>{t('cancel')}</button>
            <button
              className={css.acceptBtn}
              disabled={!canAccept}
              onClick={() => { if (selected !== undefined) onAccept(selected.text) }}
              title={selected !== undefined ? t('selectedHint', { n: String(selected.index + 1) }) : ''}
            >
              {t('acceptPolish')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
