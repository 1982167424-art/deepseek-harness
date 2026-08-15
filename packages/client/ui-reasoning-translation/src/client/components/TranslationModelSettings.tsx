import { useEffect, useState } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScopeBinder } from '@deepseek-ai/dsh-client-ui-settings/client'
import { SETTINGS_NAMESPACE, type ReasoningTranslationSettings } from '../../index.ts'
import css from './ReasoningTranslation.module.css'

interface FlatModel {
  provider: string
  id: string
  name: string
  description?: string | undefined
}

export interface TranslationModelSettingsProps {
  inject?: {
    scope: SettingsScopeBinder
    remote: unknown
    t: TranslateNS<'reasoningTranslation'>
  }
}

export function TranslationModelSettings(props: TranslationModelSettingsProps) {
  const injected = props.inject
  if (injected === undefined) return null
  const { scope, remote, t } = injected
  const settings: SettingsScope<ReasoningTranslationSettings> = scope.bind({ namespace: SETTINGS_NAMESPACE })
  const [models, setModels] = useState<readonly FlatModel[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const ns = remote as unknown as {
          llm: {
            models(req: { provider?: string }): Promise<{ ok: true; value: { groups: readonly ModelProviderGroup[] } } | { ok: false; error: unknown }>
          }
        }
        const result = await ns.llm.models({})
        if (cancelled) return
        const list: FlatModel[] = []
        if (result.ok) {
          for (const g of result.value.groups ?? []) {
            for (const m of g.models) {
              list.push({ provider: g.id, id: m.id, name: m.name, description: m.description })
            }
          }
        }
        setModels(list)
        setLoaded(true)
      } catch {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [remote])

  const snapshot = settings.getSnapshot()
  const value = snapshot.value
  return (
    <>
      <div className={css.modelRow}>
        <label className={css.modelLabel}>{t('translationModel')}</label>
        <select
          className={css.modelSelect}
          value={value?.defaultTranslationModel ?? 'deepseek-v4-flash'}
          onChange={(e) => void settings.set('defaultTranslationModel', e.target.value)}
        >
          {!loaded && <option value="">Loading…</option>}
          {models.map(m => (
            <option key={`${m.provider}/${m.id}`} value={m.id}>
              {m.name} ({m.provider})
            </option>
          ))}
        </select>
      </div>
      <div className={css.modelRow}>
        <label className={css.modelLabel}>{t('enabledByDefault')}</label>
        <input
          type="checkbox"
          checked={value?.defaultTranslationEnabled ?? false}
          onChange={(e) => void settings.set('defaultTranslationEnabled', e.target.checked)}
        />
      </div>
      <div className={css.promptRow}>
        <label className={css.modelLabel}>{t('translationPrompt')}</label>
        <textarea
          className={css.promptTextarea}
          value={value?.translationPrompt ?? ''}
          onChange={(e) => void settings.set('translationPrompt', e.target.value)}
        />
      </div>
    </>
  )
}
