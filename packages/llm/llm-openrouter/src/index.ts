import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  assertUsableApiKey,
  LlmError,
  resolveRetryPolicy,
  RetryPolicySchema,
} from '@deepseek-ai/dsh-llm'
import type { LlmConfigurableProvider, RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf, type LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { deepEqualJson, installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { getOrCreateAnonymousUserId, type AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  OpenRouterAdapter,
} from './adapter.ts'
import type { OpenRouterCatalogModel, OpenRouterConnectionOptions } from './adapter.ts'

export {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  OpenRouterAdapter,
} from './adapter.ts'
export type { OpenRouterAdapterOptions, OpenRouterCatalogModel, OpenRouterConnectionOptions } from './adapter.ts'
export type { RequestDefaults } from './serialize.ts'
export type * from './types.ts'

export const name = 'llm-openrouter'
export const inject = ['llm']

const NS = settingsNamespace('llm-openrouter')
const PROVIDER_NAMESPACE = 'openrouter-compat'
const DEFAULT_API_KEY_ENV = 'OPENROUTER_API_KEY'

export const PRESET_PROVIDERS: Record<string, { baseURL: string; displayName: string; models: OpenRouterCatalogModel[] }> = {
  siliconflow: {
    baseURL: 'https://api.siliconflow.cn/v1',
    displayName: 'SiliconFlow',
    models: [
      { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek-V3', contextWindow: 128000 },
      { id: 'deepseek-ai/DeepSeek-V2.5', name: 'DeepSeek-V2.5', contextWindow: 128000 },
      { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen2.5-72B-Instruct', contextWindow: 128000 },
      { id: 'meta-llama/Meta-Llama-3.1-405B-Instruct', name: 'Meta-Llama-3.1-405B-Instruct', contextWindow: 128000 },
    ],
  },
  groq: {
    baseURL: 'https://api.groq.com/openai/v1',
    displayName: 'Groq',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama-3.3-70B-Versatile', contextWindow: 128000 },
      { id: 'llama-3.1-405b-reasoning', name: 'Llama-3.1-405B-Reasoning', contextWindow: 128000 },
      { id: 'mixtral-8x7b-32768', name: 'Mixtral-8x7B-32K', contextWindow: 32768 },
    ],
  },
  together: {
    baseURL: 'https://api.together.xyz/v1',
    displayName: 'Together AI',
    models: [
      { id: 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo', name: 'Llama-3.1-405B-Instruct-Turbo', contextWindow: 128000 },
      { id: 'deepseek-ai/deepseek-v3', name: 'DeepSeek-V3', contextWindow: 128000 },
      { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen2.5-72B-Instruct', contextWindow: 128000 },
    ],
  },
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
    displayName: 'OpenRouter',
    models: [
      { id: 'deepseek/deepseek-v3', name: 'DeepSeek-V3', contextWindow: 128000 },
      { id: 'anthropic/claude-sonnet-4', name: 'Claude-Sonnet-4', contextWindow: 200000 },
      { id: 'google/gemini-flash-1.5', name: 'Gemini-Flash-1.5', contextWindow: 1000000 },
    ],
  },
  zhipu: {
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    displayName: '智谱 AI',
    models: [
      { id: 'glm-4-plus', name: 'GLM-4-Plus', contextWindow: 128000 },
      { id: 'glm-4-air', name: 'GLM-4-Air', contextWindow: 128000 },
      { id: 'glm-4-long', name: 'GLM-4-Long', contextWindow: 1000000 },
    ],
  },
  kimi: {
    baseURL: 'https://api.moonshot.cn/v1',
    displayName: '月之暗面 Kimi',
    models: [
      { id: 'moonshot-v1-128k', name: 'Moonshot-V1-128K', contextWindow: 128000 },
      { id: 'moonshot-v1-8k', name: 'Moonshot-V1-8K', contextWindow: 8000 },
    ],
  },
  minimax: {
    baseURL: 'https://api.minimax.chat/v1',
    displayName: 'MiniMax',
    models: [
      { id: 'abab6.5s-chat', name: 'ABAB6.5s-Chat', contextWindow: 245760 },
      { id: 'abab6.5-chat', name: 'ABAB6.5-Chat', contextWindow: 245760 },
    ],
  },
  doubao: {
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    displayName: 'ByteDance 豆包',
    models: [
      { id: 'doubao-pro-4k', name: 'Doubao-Pro-4K', contextWindow: 4096 },
      { id: 'doubao-pro-32k', name: 'Doubao-Pro-32K', contextWindow: 32768 },
      { id: 'doubao-lite-4k', name: 'Doubao-Lite-4K', contextWindow: 4096 },
    ],
  },
  qwen: {
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    displayName: '阿里云 通义千问',
    models: [
      { id: 'qwen-plus', name: 'Qwen-Plus', contextWindow: 131072 },
      { id: 'qwen-turbo', name: 'Qwen-Turbo', contextWindow: 1000000 },
      { id: 'qwen-max', name: 'Qwen-Max', contextWindow: 32768 },
    ],
  },
  custom: {
    baseURL: '',
    displayName: 'Custom OpenAI-Compatible',
    models: [],
  },
}

export interface ProviderProfileConfig {
  displayName: string
  apiKeyEnv?: string
  baseURL: string
  thinking?: 'enabled' | 'disabled'
  reasoningEffort?: 'off' | 'low' | 'medium' | 'high' | 'max'
  reasoningEffortsSupported?: boolean
  maxTokens?: number
  defaultContextWindow?: number
  models?: OpenRouterCatalogModel[]
  streamIdleTimeoutMs?: number
  retryPolicy?: RetryPolicyConfig
}

export interface Config {
  providers: Record<string, ProviderProfileConfig>
}

const catalogModel: z<OpenRouterCatalogModel> = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
})

const providerProfile: z<ProviderProfileConfig> = z.object({
  displayName: z.string().required(),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string().required(),
  thinking: z.union(['enabled', 'disabled']),
  reasoningEffort: z.union(['off', 'low', 'medium', 'high', 'max']),
  reasoningEffortsSupported: z.boolean().default(true),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_TOKENS),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  models: z.array(catalogModel).default([]),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  retryPolicy: RetryPolicySchema,
})

export const Config: z<Config> = z.object({
  providers: z.dict(providerProfile).default({
    [`${PROVIDER_NAMESPACE}/siliconflow`]: PRESET_PROVIDERS.siliconflow as ProviderProfileConfig,
    [`${PROVIDER_NAMESPACE}/groq`]: PRESET_PROVIDERS.groq as ProviderProfileConfig,
    [`${PROVIDER_NAMESPACE}/together`]: PRESET_PROVIDERS.together as ProviderProfileConfig,
  } as Record<string, ProviderProfileConfig>),
})

function resolveModels(models: readonly OpenRouterCatalogModel[] | undefined): OpenRouterCatalogModel[] {
  const seen = new Set<string>()
  return (models ?? []).map((model) => {
    if (model.id.length === 0) throw new Error('llm-openrouter: catalog model ids must be non-empty')
    if (model.name !== undefined && model.name.length === 0) {
      throw new Error(`llm-openrouter: catalog model "${model.id}" has an empty name`)
    }
    if (model.contextWindow !== undefined
      && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) {
      throw new Error(
        `llm-openrouter: catalog model "${model.id}" contextWindow must be a positive integer`,
      )
    }
    if (model.maxTokens !== undefined
      && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) {
      throw new Error(
        `llm-openrouter: catalog model "${model.id}" maxTokens must be a positive integer`,
      )
    }
    if (seen.has(model.id)) throw new Error(`llm-openrouter: duplicate catalog model "${model.id}"`)
    seen.add(model.id)
    return {
      id: model.id,
      ...model.name === undefined ? {} : { name: model.name },
      ...model.description === undefined ? {} : { description: model.description },
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
    }
  })
}

export type ResolvedOpenRouterProfile = OpenRouterConnectionOptions

export function resolveProfile(providerKey: string, profile: ProviderProfileConfig, _environment?: LaunchEnvironmentSnapshot): ResolvedOpenRouterProfile {
  if (profile.thinking === 'disabled'
    && profile.reasoningEffort !== undefined
    && profile.reasoningEffort !== 'off') {
    throw new Error(`llm-openrouter[${providerKey}]: only reasoningEffort "off" can be configured when thinking is disabled`)
  }
  if (profile.defaultContextWindow !== undefined
    && (!Number.isInteger(profile.defaultContextWindow) || profile.defaultContextWindow <= 0)) {
    throw new Error(`llm-openrouter[${providerKey}]: defaultContextWindow must be a positive integer`)
  }
  if (profile.maxTokens !== undefined
    && (!Number.isSafeInteger(profile.maxTokens) || profile.maxTokens <= 0)) {
    throw new Error(`llm-openrouter[${providerKey}]: maxTokens must be a positive safe integer`)
  }
  const streamIdleTimeoutMs = profile.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
  if (!Number.isFinite(streamIdleTimeoutMs)
    || streamIdleTimeoutMs <= 0
    || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `llm-openrouter[${providerKey}]: streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  if (!profile.baseURL || profile.baseURL.trim().length === 0) {
    throw new Error(`llm-openrouter[${providerKey}]: baseURL must be a non-empty string`)
  }
  return {
    apiKeyEnv: credentialRef(profile.apiKeyEnv ?? DEFAULT_API_KEY_ENV),
    baseURL: profile.baseURL.replace(/\/$/, ''),
    defaults: {
      thinking: profile.thinking,
      reasoningEffort: profile.reasoningEffort,
    },
    maxTokens: profile.maxTokens ?? DEFAULT_MAX_TOKENS,
    defaultContextWindow: profile.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
    models: resolveModels(profile.models),
    streamIdleTimeoutMs,
    retryPolicy: resolveRetryPolicy(profile.retryPolicy, `llm-openrouter[${providerKey}]: retryPolicy`),
    displayName: profile.displayName || providerKey,
    reasoningEffortsSupported: profile.reasoningEffortsSupported ?? true,
  }
}

function resolveProfiles(providers: Record<string, ProviderProfileConfig>): Map<string, ResolvedOpenRouterProfile> {
  const resolved = new Map<string, ResolvedOpenRouterProfile>()
  for (const [key, profile] of Object.entries(providers)) {
    if (!key.startsWith(`${PROVIDER_NAMESPACE}/`)) {
      throw new Error(`llm-openrouter: provider key "${key}" must start with "${PROVIDER_NAMESPACE}/"`)
    }
    resolved.set(key, resolveProfile(key, profile))
  }
  return resolved
}

function registrationFacts(profiles: ReadonlyMap<string, ResolvedOpenRouterProfile>): unknown {
  return [...profiles.entries()]
    .map(([provider, profile]) => ({
      provider,
      displayName: profile.displayName,
      retryPolicy: profile.retryPolicy,
    }))
    .sort((left, right) => left.provider.localeCompare(right.provider))
}

function directoryEntries(
  profiles: ReadonlyMap<string, ResolvedOpenRouterProfile>,
): LlmConfigurableProvider[] {
  return [...profiles.entries()].map(([provider, profile]) => ({
    provider,
    displayName: profile.displayName,
    settingsNs: NS,
    settingsPath: ['providers', provider],
    declared: true,
  }))
}

export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  let lastRaw: Config | undefined
  let memoized: Map<string, ResolvedOpenRouterProfile> | undefined

  const profiles = (): Map<string, ResolvedOpenRouterProfile> => {
    const raw = current()
    if (raw === lastRaw && memoized !== undefined) return memoized
    const next = resolveProfiles(raw.providers)
    lastRaw = raw
    memoized = next
    return next
  }
  profiles()

  const resolveApiKey = async (
    provider: string,
    profile: ResolvedOpenRouterProfile,
  ): Promise<string> => {
    const ref = profile.apiKeyEnv
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined) return assertUsableApiKey(hit.value, 'llm-openrouter', ref)
    } else {
      const ambient = launchEnvironmentOf(ctx).get(ref)
      if (ambient !== undefined && ambient.value.length > 0) {
        return assertUsableApiKey(ambient.value, 'llm-openrouter', ref)
      }
    }
    throw new LlmError(
      `llm-openrouter: no API key for provider route "${provider}"; store ${ref} through the credentials`
      + ` service (the web Models page writes it), or export ${ref} in the launching environment`,
      'MISSING_CREDENTIAL',
    )
  }

  let userId: AnonymousUserId | undefined
  const resolveUserId = (): AnonymousUserId => userId ??= getOrCreateAnonymousUserId()

  const adapter = new OpenRouterAdapter({
    profiles,
    resolveApiKey,
    resolveUserId,
  })

  let directory: ReturnType<typeof ctx.llm.registerConfigurableProviders> | undefined
  let directoryFacts: unknown
  const ensureDirectory = (): void => {
    const entries = directoryEntries(profiles())
    if (deepEqualJson(entries, directoryFacts)) return
    if (directory === undefined) {
      if (entries.length > 0) {
        directory = ctx.llm.registerConfigurableProviders(entries)
      }
    } else {
      directory.replace(entries)
    }
    directoryFacts = entries
  }
  ensureDirectory()

  let registration: ReturnType<typeof ctx.llm.registerAdapter> | undefined
  let registeredFacts: unknown
  const ensureRegistrationFacts = (): void => {
    const facts = registrationFacts(profiles())
    if (deepEqualJson(facts, registeredFacts)) return
    const routes = [...profiles().keys()]
    if (registration === undefined) {
      if (routes.length === 0) {
        registeredFacts = facts
        return
      }
      registration = ctx.llm.registerAdapter(routes, adapter)
    } else {
      registration.replace(routes)
    }
    registeredFacts = facts
  }
  ensureRegistrationFacts()

  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {
      try {
        ensureRegistrationFacts()
      } catch (error) {
        ctx.logger.error('llm-openrouter: keeping the previously registered routes after a refused update')
        ctx.logger.error(error)
      }
      try {
        ensureDirectory()
      } catch (error) {
        ctx.logger.error('llm-openrouter: keeping the previous configurable-provider directory after a refused update')
        ctx.logger.error(error)
      }
    },
  })
}
