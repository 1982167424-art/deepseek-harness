import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { PromptPolishService as ClientPromptPolishService } from './store.ts'
import type { PolishStyle } from './slots.ts'
import type { PolishButtonInjected } from './slots.ts'
import { PolishToolbarButton } from './components/PolishToolbarButton.tsx'
import { PolishModal } from './components/PolishModal.tsx'
import type { PromptPolishKey } from './locales.ts'
import { en, zh } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    promptPolish: PromptPolishKey
  }
  interface SlotMap {
    'conversation.composer.toolbar': { kind: 'list'; scope: 'session'; owner: import('./slots.ts').ComposerToolbarOwnerProps }
  }
}

export type { PromptPolishKey } from './locales.ts'
export { PromptPolishService } from './store.ts'
export type { PerSessionPolishState, PolishStatus } from './store.ts'
export type { PolishButtonInjected, ComposerToolbarOwnerProps } from './slots.ts'

const NS = 'promptPolish'

export const inject = ['theme', 'locale', 'conversation', 'slots', 'runtime', 'remote', 'remote.promptPolish']

/**
 * Client plugin body: mount the PromptPolishService, register dictionaries,
 * and inject the AI Polish button into the composer toolbar list plus the
 * polish modal portal at the session root.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-prompt-polish: dictionaries')
  const t: TranslateNS<'promptPolish'> = ctx.locale.bind(NS)
  ctx.plugin(ClientPromptPolishService)

  ctx.inject(['slots', 'promptPolish'], (scope) => {
    const svc = scope.promptPolish as unknown as ClientPromptPolishService

    const PolishInjectedComponent = (props: {
      sessionId: SessionId
      useInput?: (selector: (s: unknown) => unknown) => unknown
      inputActions?: { setDraft: (t: string) => void }
      inject: PolishButtonInjected
    }) => {
      const { inject, inputActions } = props
      const draft = (props.useInput as unknown as (sel: (s: { draft: string }) => string) => string | undefined)?.(s => s.draft) ?? ''
      const onOpen = () => { inject.open(draft) }
      const onAccept = (text: string) => {
        inputActions?.setDraft(text)
        inject.accept(text)
      }
      const store = svc.storeFor(props.sessionId)
      return (
        <>
          <PolishToolbarButton store={store} draft={draft} onOpen={onOpen} t={t} />
          <PolishModal
            store={store}
            onClose={inject.close}
            onSetStyle={inject.setStyle}
            onSetVariations={inject.setVariations}
            onSetCompare={inject.setCompare}
            onSelect={inject.select}
            onGenerate={inject.generate}
            onAccept={onAccept}
            t={t}
          />
        </>
      )
    }

    scope.slots.inject('conversation.input.left', () => scope.slots.register({
      name: 'conversation.input.left',
      id: 'prompt-polish-button',
      order: 20,
      locale: NS,
      inject: (sessionId: SessionId) => {
        const store = svc.storeFor(sessionId)
        const injected: PolishButtonInjected = {
          polish: store,
          open: (text) => svc.open(sessionId, text),
          close: () => svc.close(sessionId),
          setStyle: (style: PolishStyle) => svc.setStyle(sessionId, style),
          setVariations: (n) => svc.setVariations(sessionId, n),
          setCompare: (compare) => svc.setCompare(sessionId, compare),
          select: (i) => svc.select(sessionId, i),
          generate: () => svc.generate(sessionId),
          accept: (_text) => {
            svc.close(sessionId)
          },
        }
        return injected
      },
    }, PolishInjectedComponent as unknown as never))
  })
}
