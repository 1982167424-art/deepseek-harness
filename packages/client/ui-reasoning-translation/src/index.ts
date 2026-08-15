/**
 * Host registration for reasoning translation plugin.
 * Registers durable settings and a llm stream chunk waterfall interceptor
 * that translates reasoning text chunks via a side LLM call and emits
 * translated-chunk events.
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  createMessage,
  type StreamChunk,
  type Message,
  type GenerateOptions,
} from '@deepseek-ai/dsh-llm'
import { REASONING_TRANSLATION_KEY } from './invariant.ts'

export const SETTINGS_NAMESPACE = 'ui-reasoning-translation'

export const DEFAULT_TRANSLATION_MODEL = 'deepseek-v4-flash'
export const DEFAULT_TRANSLATION_ENABLED = false
export const DEFAULT_TRANSLATION_PROMPT = 'You are a professional translator. Translate the following reasoning/thinking text accurately from English to Simplified Chinese. Preserve technical terms, code snippets, and markdown formatting. Only output the translation, nothing else:'

export interface ReasoningTranslationSettings {
  defaultTranslationModel: string
  defaultTranslationEnabled: boolean
  translationPrompt: string
}

export const ReasoningTranslationSettingsSchema: z<ReasoningTranslationSettings> = z.object({
  defaultTranslationModel: z.string().default(DEFAULT_TRANSLATION_MODEL),
  defaultTranslationEnabled: z.boolean().default(DEFAULT_TRANSLATION_ENABLED),
  translationPrompt: z.string().default(DEFAULT_TRANSLATION_PROMPT),
})

declare module '@deepseek-ai/cordis' {
  interface Events {
    'reasoning-translation/delta'(
      sessionId: unknown,
      blockIndex: number,
      text: string,
    ): void
    'reasoning-translation/complete'(
      sessionId: unknown,
      blockIndex: number,
      translatedText: string,
    ): void
  }
}

const PLUGIN_ID = 'ui-reasoning-translation'

export function apply(ctx: Context): void {
  ctx.inject(['llm', 'settings'], (scope) => {
    const settingsScope = scope.settings.register(
      settingsNamespace(SETTINGS_NAMESPACE),
      ReasoningTranslationSettingsSchema,
    )

    scope.on('llm/stream', async function* (
      options: GenerateOptions,
      next: () => AsyncIterable<StreamChunk>,
    ): AsyncIterable<StreamChunk> {
      const snapshot = settingsScope.get()
      const enabled = snapshot.defaultTranslationEnabled

      const originalIterator = next()
      if (!enabled) {
        yield* originalIterator
        return
      }

      const model = snapshot.defaultTranslationModel
      const basePrompt = snapshot.translationPrompt
      const sessionId = (options as { sessionId?: unknown }).sessionId

      const pendingReasoningBuffers: Map<number, string> = new Map()
      const translatingPromises: Map<number, Promise<void>> = new Map()

      const translateAndEmit = async (blockIndex: number, fullText: string): Promise<void> => {
        try {
          const messages: Message[] = [
            createMessage({
              role: 'user',
              content: [{ type: 'text', text: `${basePrompt}\n\n${fullText}` }],
              source: { kind: 'plugin', plugin: PLUGIN_ID },
            }),
          ]
          const genOptions: GenerateOptions = {
            provider: options.provider,
            model,
            messages,
          }
          if (options.signal !== undefined) (genOptions as { signal?: AbortSignal }).signal = options.signal
          const llm = scope.llm
          let translated = ''
          for await (const chunk of llm.stream(genOptions)) {
            if (chunk.type === 'text-delta') {
              translated += chunk.text
              ctx.emit('reasoning-translation/delta', sessionId, blockIndex, chunk.text)
            }
          }
          ctx.emit('reasoning-translation/complete', sessionId, blockIndex, translated)
        } catch {
          // swallow translation failures; original reasoning still displays
        }
      }

      for await (const chunk of originalIterator) {
        if (chunk.type === 'reasoning-delta') {
          const current = pendingReasoningBuffers.get(chunk.index) ?? ''
          pendingReasoningBuffers.set(chunk.index, current + chunk.text)
        } else if (chunk.type === 'block-end' && chunk.block.type === 'reasoning') {
          const fullText = pendingReasoningBuffers.get(chunk.index) ?? chunk.block.text
          pendingReasoningBuffers.delete(chunk.index)
          const promise = translateAndEmit(chunk.index, fullText)
          translatingPromises.set(chunk.index, promise)
        }
        yield chunk
      }

      await Promise.all(translatingPromises.values())
    })
  })
}

export { REASONING_TRANSLATION_KEY }
