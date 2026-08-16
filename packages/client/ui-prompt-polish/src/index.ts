/**
 * Host registration for prompt polish plugin.
 * Exposes a polishPrompt service method that returns N polished variations
 * using a configurable style, and registers durable default settings.
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  createMessage,
  type GenerateOptions,
  type Message,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { PROMPT_POLISH_KEY } from './invariant.ts'

export const SETTINGS_NAMESPACE = 'ui-prompt-polish'

export const DEFAULT_POLISH_MODEL = 'deepseek-v4-flash'
export const DEFAULT_POLISH_STYLE = 'general' as const
export const DEFAULT_VARIATION_COUNT = 3

export const POLISH_STYLES = ['professional', 'concise', 'creative', 'detailed', 'technical', 'general'] as const
export type PolishStyle = typeof POLISH_STYLES[number]

export interface PromptPolishSettings {
  defaultPolishStyle: PolishStyle
  polishModelOverride: string
  defaultVariationCount: number
}

export const PromptPolishSettingsSchema: z<PromptPolishSettings> = z.object({
  defaultPolishStyle: z.union([...POLISH_STYLES]).default(DEFAULT_POLISH_STYLE),
  polishModelOverride: z.string().default(''),
  defaultVariationCount: z.natural().min(1).max(5).default(DEFAULT_VARIATION_COUNT),
})

export interface PolishOptions {
  style?: PolishStyle
  model?: string
  variations?: number
}

export interface PolishedVariation {
  index: number
  style: PolishStyle
  text: string
}

const STYLE_SYSTEM_PROMPTS: Record<PolishStyle, string> = {
  general:
    `You are a writing assistant. Rewrite and polish the user's prompt text into a clearer, more effective version. 
Fix grammar, improve flow, and enhance clarity while preserving the original intent and all requirements.
Respond ONLY with the polished text, no preamble or explanation.`,
  professional:
    `You are a professional business writing assistant. Rewrite and polish the user's prompt into formal, professional language suitable for a workplace or formal context. Elevate tone, improve precision, remove colloquialisms, and maintain the original request intact.
Respond ONLY with the polished text, no preamble or explanation.`,
  concise:
    `You are an editor who removes every unnecessary word. Rewrite and polish the user's prompt into its most concise form. Cut redundancy, use shorter phrasing, eliminate filler, and keep only the essential meaning and all concrete requirements.
Respond ONLY with the polished text, no preamble or explanation.`,
  creative:
    `You are a creative writing partner. Rewrite and polish the user's prompt into a more vivid, engaging, and creative expression. Add color, imagery, and evocative language while staying faithful to the original request and keeping all functional requirements intact.
Respond ONLY with the polished text, no preamble or explanation.`,
  detailed:
    `You are a thorough writing assistant. Expand and polish the user's prompt into a more detailed, specific, and comprehensive request. Add helpful context, break ambiguous parts into concrete steps, and make each requirement explicit — but never invent requirements the user didn't imply.
Respond ONLY with the polished text, no preamble or explanation.`,
  technical:
    `You are a technical writing specialist. Rewrite and polish the user's prompt into precise, structured, and unambiguous technical language. Use accurate terminology, favor explicit numbered/bulleted structure where it helps, and keep every requirement clear and testable.
Respond ONLY with the polished text, no preamble or explanation.`,
}

function stylePrompt(style: PolishStyle): string {
  return STYLE_SYSTEM_PROMPTS[style] ?? STYLE_SYSTEM_PROMPTS.general
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    promptPolish: PromptPolishService
  }
}

const PLUGIN_ID = 'ui-prompt-polish'

/**
 * Host service exposing {@link PromptPolishService.polishPrompt}.
 */
export class PromptPolishService extends Service {
  static inject = ['llm', 'settings']

  constructor(ctx: Context) {
    super(ctx, 'promptPolish')
  }

  /**
   * Produce one or more polished rewrites of the given raw prompt text.
   * @param rawText - raw user prompt text to polish.
   * @param options - style, model override, and variation count.
   * @returns polished variations (length = variations, default 3).
   */
  async polishPrompt(rawText: string, options: PolishOptions = {}): Promise<PolishedVariation[]> {
    const ctx = this.ctx
    const settings = (ctx as { promptPolishSettings?: PromptPolishSettings }).promptPolishSettings
    const style = options.style ?? settings?.defaultPolishStyle ?? DEFAULT_POLISH_STYLE
    const count = Math.max(1, Math.min(5, options.variations ?? settings?.defaultVariationCount ?? DEFAULT_VARIATION_COUNT))
    const llm = ctx.llm
    if (llm === undefined) throw new Error('ui-prompt-polish: llm service unavailable')

    let chosenProvider = ''
    let chosenModel = options.model ?? settings?.polishModelOverride ?? DEFAULT_POLISH_MODEL
    if (chosenModel === '') chosenModel = DEFAULT_POLISH_MODEL

    const providers = await llm.listProviders()
    for (const provider of providers) {
      const models = await llm.listModels(provider.id)
      const match = models.find(m => m.id === chosenModel)
      if (match !== undefined) {
        chosenProvider = provider.id
        chosenModel = match.id
        break
      }
    }
    if (chosenProvider === '') {
      const first = providers[0]
      if (first === undefined) throw new Error('ui-prompt-polish: no LLM providers available')
      chosenProvider = first.id
      const models = await llm.listModels(chosenProvider)
      const firstModel = models[0]
      if (firstModel !== undefined) chosenModel = firstModel.id
    }

    const baseSys = stylePrompt(style)
    const userIntro =
      count === 1
        ? `Please polish the following prompt, style="${style}". Respond with the single polished version only:\n\n`
        : `Please produce exactly ${count} distinct polished rewrites of the prompt below, style="${style}". Number each version starting at 1 using exactly "1. ", "2. ", etc. on separate lines. Do not add commentary before or after. Prompt:\n\n`

    const messages: Message[] = [
      createMessage({
        role: 'system',
        content: [{ type: 'text', text: baseSys }],
        source: { kind: 'plugin', plugin: PLUGIN_ID },
      }),
      createMessage({
        role: 'user',
        content: [{ type: 'text', text: `${userIntro}${rawText}` }],
        source: { kind: 'plugin', plugin: PLUGIN_ID },
      }),
    ]

    const genOptions: GenerateOptions = {
      provider: chosenProvider,
      model: chosenModel,
      messages,
      temperature: 0.7,
    }

    const chunks: StreamChunk[] = []
    for await (const c of llm.stream(genOptions)) chunks.push(c)

    const fullText = chunks
      .filter((c): c is Extract<StreamChunk, { type: 'text-delta' }> => c.type === 'text-delta')
      .map(c => c.text)
      .join('')
      .trim()

    if (count === 1) {
      return [{ index: 0, style, text: fullText || rawText }]
    }

    const lines = fullText.split(/\r?\n/)
    const results: PolishedVariation[] = []
    let currentIndex = -1
    let currentBuf: string[] = []
    const re = /^\s*(\d+)\s*[.)、]\s*(.*)$/
    const push = () => {
      if (currentIndex >= 0 && currentBuf.length > 0) {
        results.push({ index: currentIndex, style, text: currentBuf.join('\n').trim() })
      }
      currentBuf = []
    }
    for (const line of lines) {
      const m = line.match(re)
      if (m !== null) {
        push()
        const numStr = m[1] ?? '1'
        const rest = m[2] ?? ''
        currentIndex = Number.parseInt(numStr, 10) - 1
        currentBuf = [rest]
      } else if (currentIndex >= 0) {
        currentBuf.push(line)
      }
    }
    push()

    if (results.length === 0) {
      return [{ index: 0, style, text: fullText || rawText }]
    }
    while (results.length < count) {
      results.push({ index: results.length, style, text: fullText || rawText })
    }
    return results.slice(0, count)
  }
}

export function apply(ctx: Context): void {
  ctx.inject(['llm', 'settings'], (scope) => {
    const settingsScope = scope.settings.register(
      settingsNamespace(SETTINGS_NAMESPACE),
      PromptPolishSettingsSchema,
    )
    scope.plugin(PromptPolishService)
    scope.effect(() => {
      const svc = scope.promptPolish as PromptPolishService & { promptPolishSettings?: PromptPolishSettings }
      const snap = settingsScope.get()
      svc.promptPolishSettings = snap
      const off = settingsScope.watch((next) => {
        svc.promptPolishSettings = next
      })
      return off
    }, 'ui-prompt-polish: settings bridge')
  })
}

export { PROMPT_POLISH_KEY }
export type {} from './invariant.ts'
