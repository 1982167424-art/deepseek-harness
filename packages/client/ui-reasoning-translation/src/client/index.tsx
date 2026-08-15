import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { ReasoningTranslationService } from './store.ts'
import type { ReasoningTranslationInjected } from './slots.ts'
import { ReasoningTranslationTabs } from './components/ReasoningTranslationTabs.tsx'
import { SessionTranslationToggle } from './components/TranslationToggle.tsx'
import { TranslationModelSettings } from './components/TranslationModelSettings.tsx'
import type { SettingsScopeBinder } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ReasoningTranslationKey } from './locales.ts'
import { en, zh } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    reasoningTranslation: ReasoningTranslationKey
  }
  interface SlotMap {
    'conversation.chat.reasoning-content': { kind: 'single'; scope: 'session'; owner: import('./slots.ts').ReasoningContentOwnerProps }
  }
}

export type { ReasoningTranslationKey } from './locales.ts'
export { ReasoningTranslationService } from './store.ts'
export type { PerSessionTranslationState, ReasoningTranslationState, TranslatedBlockState } from './store.ts'
export type { ReasoningTranslationInjected, ReasoningContentOwnerProps } from './slots.ts'

const NS = 'reasoningTranslation'

export const inject = ['theme', 'locale', 'conversation', 'slots', 'settingsScope', 'runtime', 'remote', 'sessions']

/**
 * Client plugin body: register the reasoning translation service,
 * dictionaries, toggle button in the composer toolbar, translation tabs
 * wrapping the reasoning display, and the settings section entries.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-reasoning-translation: dictionaries')
  const t: TranslateNS<'reasoningTranslation'> = ctx.locale.bind(NS)

  ctx.plugin(ReasoningTranslationService)

  ctx.inject(['slots', 'reasoningTranslation'], (scope) => {
    const svc = scope.reasoningTranslation as unknown as ReasoningTranslationService

    scope.slots.inject('conversation.chat.reasoning-content', () => scope.slots.register({
      name: 'conversation.chat.reasoning-content',
      locale: NS,
      inject: (sessionId: SessionId): ReasoningTranslationInjected => {
        const store = svc.storeFor(sessionId)
        return {
          translation: store,
          setEnabled: (enabled) => svc.setEnabled(sessionId, enabled),
          translatedText: (blockIndex) => svc.translatedText(sessionId, blockIndex),
          isTranslating: (blockIndex) => svc.isTranslating(sessionId, blockIndex),
        }
      },
    }, ReasoningTranslationTabs as never))

    scope.slots.inject('conversation.session.header.actions', () => scope.slots.register({
      name: 'conversation.session.header.actions',
      id: 'reasoning-translation-toggle',
      order: 15,
      locale: NS,
      inject: (sessionId: SessionId) => {
        return {
          sessionId,
          store: svc.storeFor(sessionId),
          toggle: (enabled: boolean) => svc.setEnabled(sessionId, enabled),
          t,
        }
      },
    }, SessionTranslationToggle as unknown as never))

    const settingsScope = (scope as unknown as { settingsScope: SettingsScopeBinder }).settingsScope
    const remote = (ctx as unknown as { remote: unknown }).remote
    scope.slots.inject('settings.general.item', () => scope.slots.register({
      name: 'settings.general.item',
      id: 'reasoning-translation-model',
      order: 50,
      locale: NS,
      label: () => t('settingsSection'),
      inject: () => ({ scope: settingsScope, remote, t }),
    }, TranslationModelSettings as unknown as never))
  })
}
