/**
 * Media generation capability: multi-provider image/video generation tools
 * plus the prompt-polish service the wallpaper studio consumes.
 * @module @deepseek-ai/dsh-llm-media-gen
 */

import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool, type ToolExecution } from '@deepseek-ai/dsh-tools'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import {
  assertUsableApiKey,
  BlockAssembler,
  createUserMessage,
  LlmError,
  type GenerateOptions,
  type Message,
} from '@deepseek-ai/dsh-llm'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {
  DashScopeImageGenRequest,
  GeneratedImage,
  GeneratedVideo,
  ImageSize,
  ImageStyle,
  MediaProvider,
  MiniMaxImageGenRequest,
  ModerationResult,
  OpenAICompatibleImageGenRequest,
  PolishPromptRequest,
  PolishPromptResult,
  PolishTarget,
  ProviderSelection,
  VolcengineImageGenRequest,
  VolcengineVideoGenRequest,
} from './types.ts'
import { IMAGE_PROVIDERS, VIDEO_PROVIDERS } from './types.ts'
import {
  generateImageMiniMax,
  generateVideoMiniMax,
  moderateImageMiniMax,
  type MiniMaxConfig,
} from './providers/minimax.ts'
import {
  generateImageVolcengine,
  generateVideoVolcengine,
  moderateImageVolcengine,
  type VolcengineConfig,
} from './providers/volcengine.ts'
import {
  generateImageOpenAICompatible,
  type OpenAICompatibleConfig,
} from './providers/openai-compatible.ts'
import {
  generateImageDashScope,
  type DashScopeConfig,
} from './providers/dashscope.ts'

export const name = 'llm-media-gen'
export const inject = ['tools', 'llm']

export { IMAGE_PROVIDERS, VIDEO_PROVIDERS } from './types.ts'
export type {
  GeneratedImage,
  GeneratedVideo,
  ImageSize,
  ImageStyle,
  MediaProvider,
  PolishPromptRequest,
  PolishPromptResult,
  PolishTarget,
  ProviderSelection,
} from './types.ts'

const NS = settingsNamespace('llm-media-gen')

const PROVIDER_KEY_ENV: Record<MediaProvider, string> = {
  volcengine: 'VOLCENGINE_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  openai: 'OPENAI_API_KEY',
  zhipu: 'ZHIPU_API_KEY',
  dashscope: 'DASHSCOPE_API_KEY',
  siliconflow: 'SILICONFLOW_API_KEY',
  aihubmix: 'AIHUBMIX_API_KEY',
  tokenflux: 'TOKENFLUX_API_KEY',
  newapi: 'NEWAPI_API_KEY',
}

const PROVIDER_DEFAULT_BASE_URL: Record<MediaProvider, string | undefined> = {
  volcengine: undefined,
  minimax: undefined,
  openai: 'https://api.openai.com/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  dashscope: 'https://dashscope.aliyuncs.com/api/v1',
  siliconflow: 'https://api.siliconflow.cn/v1',
  aihubmix: 'https://aihubmix.com/v1',
  tokenflux: 'https://api.tokenflux.ai/v1',
  newapi: undefined,
}

const PROVIDER_DEFAULT_IMAGE_MODEL: Record<MediaProvider, string | undefined> = {
  volcengine: 'doubao-seedream-5-0',
  minimax: 'abab6.5-img',
  openai: 'gpt-image-2',
  zhipu: 'cogview-4',
  dashscope: 'wanx2.1-t2i-turbo',
  siliconflow: 'Kwai-Kolors/Kolors',
  aihubmix: 'gpt-image-1',
  tokenflux: 'gpt-image-1',
  newapi: undefined,
}

/** Per-provider deployment overrides; every field has a built-in default. */
export interface ProviderEntryConfig {
  apiKeyEnv?: string
  baseURL?: string
  imageModel?: string
  videoModel?: string
  arkBaseURL?: string
  groupIdEnv?: string
}

export interface Config {
  provider: ProviderSelection
  volcengine?: ProviderEntryConfig
  minimax?: ProviderEntryConfig
  openai?: ProviderEntryConfig
  zhipu?: ProviderEntryConfig
  dashscope?: ProviderEntryConfig
  siliconflow?: ProviderEntryConfig
  aihubmix?: ProviderEntryConfig
  tokenflux?: ProviderEntryConfig
  newapi?: ProviderEntryConfig
  defaultImageSize?: ImageSize
  defaultImageStyle?: ImageStyle
  defaultVideoDuration?: number
  wallpaperModerationEnabled?: boolean
  polish: { enabled: boolean; provider: string; model: string }
}

function providerFields() {
  return z.object({
    apiKeyEnv: z.string().role('credential-ref'),
    baseURL: z.string(),
    imageModel: z.string(),
    videoModel: z.string(),
    arkBaseURL: z.string(),
    groupIdEnv: z.string(),
  })
}

export const Config: z<Config> = z.object({
  provider: z.union([
    'auto', 'volcengine', 'minimax', 'openai', 'zhipu', 'dashscope',
    'siliconflow', 'aihubmix', 'tokenflux', 'newapi',
  ]).default('auto'),
  volcengine: providerFields(),
  minimax: providerFields(),
  openai: providerFields(),
  zhipu: providerFields(),
  dashscope: providerFields(),
  siliconflow: providerFields(),
  aihubmix: providerFields(),
  tokenflux: providerFields(),
  newapi: providerFields(),
  defaultImageSize: z.union([
    '256x256',
    '512x512',
    '1024x1024',
    '1024x1792',
    '1792x1024',
    '768x768',
    '720x1280',
    '1280x720',
  ]).default('1024x1024'),
  defaultImageStyle: z.union([
    'general',
    'photographic',
    'anime',
    'cinematic',
    'digital_art',
    'oil_painting',
    'watercolor',
    'sketch',
    '3d_render',
  ]).default('general'),
  defaultVideoDuration: z.number().min(1).max(60).step(1).default(5),
  wallpaperModerationEnabled: z.boolean().default(true),
  polish: z.object({
    enabled: z.boolean().default(true),
    provider: z.string().default('deepseek'),
    model: z.string().default('deepseek-v4-flash'),
  }).default({ enabled: true, provider: 'deepseek', model: 'deepseek-v4-flash' }),
})

const IMAGE_SIZE_CHOICES: ImageSize[] = [
  '256x256',
  '512x512',
  '1024x1024',
  '1024x1792',
  '1792x1024',
  '768x768',
  '720x1280',
  '1280x720',
]

const IMAGE_STYLE_CHOICES: ImageStyle[] = [
  'general',
  'photographic',
  'anime',
  'cinematic',
  'digital_art',
  'oil_painting',
  'watercolor',
  'sketch',
  '3d_render',
]

/** Resolved per-provider runtime configuration for one configured provider. */
export type ResolvedProvider =
  | { kind: 'volcengine'; config: VolcengineConfig }
  | { kind: 'minimax'; config: MiniMaxConfig }
  | { kind: 'openai' | 'zhipu' | 'siliconflow' | 'aihubmix' | 'tokenflux' | 'newapi'; config: OpenAICompatibleConfig }
  | { kind: 'dashscope'; config: DashScopeConfig }

export interface MediaGenSettings {
  provider: ProviderSelection
  defaultImageSize: ImageSize
  defaultImageStyle: ImageStyle
  defaultVideoDuration: number
  wallpaperModerationEnabled: boolean
  polish: Config['polish']
  /** Resolve one provider's runtime configuration; undefined when uncredentialed. */
  resolveProvider(kind: MediaProvider): Promise<ResolvedProvider | undefined>
}

/** Ordered providers to try for one capability under the current selection. */
async function orderedProviders(
  settings: MediaGenSettings,
  capability: 'image' | 'video',
  requested?: MediaProvider,
): Promise<ResolvedProvider[]> {
  const pool = capability === 'video' ? VIDEO_PROVIDERS : IMAGE_PROVIDERS
  const pinned = requested ?? (settings.provider === 'auto' ? undefined : settings.provider)
  if (pinned !== undefined) {
    if (capability === 'video' && !pool.includes(pinned)) {
      throw new LlmError(
        `llm-media-gen: provider '${pinned}' does not generate video`,
        'INVALID_REQUEST',
      )
    }
    const hit = await settings.resolveProvider(pinned)
    if (hit === undefined) {
      throw new LlmError(
        `llm-media-gen: provider '${pinned}' is not configured; set ${PROVIDER_KEY_ENV[pinned]}`,
        'MISSING_CREDENTIAL',
      )
    }
    return [hit]
  }
  const candidates: ResolvedProvider[] = []
  for (const kind of pool) {
    const hit = await settings.resolveProvider(kind)
    if (hit !== undefined) candidates.push(hit)
  }
  return candidates
}

/** Arguments for one image-generation request; unset fields fall back to settings defaults. */
export interface GenerateImageArgs {
  prompt: string
  size?: ImageSize
  n?: number
  style?: ImageStyle
  negativePrompt?: string
  provider?: MediaProvider
}

/** Arguments for one video-generation request; unset fields fall back to settings defaults. */
export interface GenerateVideoArgs {
  prompt: string
  duration?: number
  fps?: number
  size?: '720p' | '1080p'
  ratio?: '16:9' | '9:16' | '1:1'
  provider?: MediaProvider
}

const POLISH_SYSTEM_PROMPTS: Record<PolishTarget, string> = {
  image: '你是文生图提示词专家。把用户的粗略想法改写成一段高质量中文文生图提示词，'
    + '覆盖主体、场景构图、光线、色调、镜头视角、艺术风格与材质细节，40-120字。'
    + '直接输出提示词本身，不要任何解释或前后缀。',
  video: '你是文生视频提示词专家。把用户的粗略想法改写成一段高质量中文文生视频提示词，'
    + '覆盖主体与动作、镜头运动、场景推进、节奏与风格，40-120字。'
    + '直接输出提示词本身，不要任何解释或前后缀。',
}

/**
 * Media generation service exposed on `ctx.mediaGen`: provider-ordered image
 * and video generation plus DeepSeek-backed prompt polish.
 */
export class MediaGenService extends Service {
  constructor(
    ctx: Context,
    private readonly settingsOf: () => MediaGenSettings,
  ) {
    super(ctx, 'mediaGen')
  }

  /**
   * Generate one or more images, trying configured providers in order.
   * @param args Prompt plus optional size, count, style, and provider pin.
   * @param signal Aborts an in-flight provider request.
   * @returns Images from the first provider that returned any.
   */
  async generateImage(args: GenerateImageArgs, signal?: AbortSignal): Promise<GeneratedImage[]> {
    const settings = this.settingsOf()
    const size = args.size ?? settings.defaultImageSize
    const style = args.style ?? settings.defaultImageStyle
    const n = args.n ?? 1
    const candidates = await orderedProviders(settings, 'image', args.provider)

    const errors: string[] = []
    for (const candidate of candidates) {
      try {
        switch (candidate.kind) {
          case 'volcengine': {
            const req: VolcengineImageGenRequest = { prompt: args.prompt, size, n, style }
            if (args.negativePrompt !== undefined) req.negativePrompt = args.negativePrompt
            const results = await generateImageVolcengine(candidate.config, req, signal)
            if (results.length > 0) return results
            break
          }
          case 'minimax': {
            const req: MiniMaxImageGenRequest = { prompt: args.prompt, size, n, style }
            if (args.negativePrompt !== undefined) req.negativePrompt = args.negativePrompt
            const results = await generateImageMiniMax(candidate.config, req, signal)
            if (results.length > 0) return results
            break
          }
          case 'dashscope': {
            const req: DashScopeImageGenRequest = { prompt: args.prompt, size, n }
            if (args.negativePrompt !== undefined) req.negativePrompt = args.negativePrompt
            const results = await generateImageDashScope(candidate.config, req, signal)
            if (results.length > 0) return results
            break
          }
          default: {
            const req: OpenAICompatibleImageGenRequest = { prompt: args.prompt, size, n, style }
            if (args.negativePrompt !== undefined) req.negativePrompt = args.negativePrompt
            const results = await generateImageOpenAICompatible(candidate.config, req, signal)
            if (results.length > 0) return results
            break
          }
        }
      } catch (e) {
        errors.push(`${candidate.kind}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (errors.length === 0) {
      throw noProviderError('image')
    }
    throw new LlmError(`llm-media-gen: all image providers failed: ${errors.join('; ')}`, 'TRANSPORT')
  }

  /**
   * Generate one video through the configured video-capable providers.
   * @param args Prompt plus optional duration, fps, resolution, ratio, and provider pin.
   * @param signal Aborts an in-flight provider request.
   * @returns The video from the first provider that succeeded.
   */
  async generateVideo(args: GenerateVideoArgs, signal?: AbortSignal): Promise<GeneratedVideo> {
    const settings = this.settingsOf()
    const duration = args.duration ?? settings.defaultVideoDuration
    const candidates = await orderedProviders(settings, 'video', args.provider)

    const errors: string[] = []
    for (const candidate of candidates) {
      try {
        if (candidate.kind === 'volcengine') {
          const req: VolcengineVideoGenRequest = { prompt: args.prompt, duration }
          if (args.fps !== undefined) req.fps = args.fps
          if (args.size !== undefined) req.size = args.size
          if (args.ratio !== undefined) req.ratio = args.ratio
          return await generateVideoVolcengine(candidate.config, req, signal)
        }
        if (candidate.kind === 'minimax') {
          return await generateVideoMiniMax(candidate.config, { prompt: args.prompt, duration }, signal)
        }
      } catch (e) {
        errors.push(`${candidate.kind}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (errors.length === 0) {
      throw noProviderError('video')
    }
    throw new LlmError(`llm-media-gen: all video providers failed: ${errors.join('; ')}`, 'TRANSPORT')
  }

  /**
   * Polish a rough idea into a generation-grade prompt via the configured
   * chat model (DeepSeek v4 flash by default). The polish call itself is a
   * charged model request and is never refunded on dissatisfaction.
   * @param request The rough idea, the generation target, and an optional abort signal.
   * @returns The rewritten prompt plus the provider/model that produced it.
   */
  async polishPrompt(request: PolishPromptRequest): Promise<PolishPromptResult> {
    const settings = this.settingsOf()
    if (!settings.polish.enabled) {
      throw new LlmError('llm-media-gen: prompt polish is disabled by configuration', 'INVALID_REQUEST')
    }
    if (request.idea.trim().length === 0) {
      throw new LlmError('llm-media-gen: polish idea must be non-empty', 'INVALID_REQUEST')
    }
    const messages: Message[] = [createUserMessage({
      content: [{ type: 'text', text: request.idea }],
      source: { kind: 'plugin', plugin: 'dsh-llm-media-gen' },
    })]
    const assembler = new BlockAssembler()
    const options: GenerateOptions = {
      provider: settings.polish.provider,
      model: settings.polish.model,
      messages,
      system: POLISH_SYSTEM_PROMPTS[request.target],
      maxTokens: 512,
    }
    if (request.signal !== undefined) options.signal = request.signal
    for await (const chunk of this.ctx.llm.stream(options)) {
      assembler.push(chunk)
    }
    const text = assembler.blocks()
      .filter((block): block is Extract<ReturnType<typeof assembler.blocks>[number], { type: 'text' }> =>
        block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim()
    if (text.length === 0) {
      throw new LlmError('llm-media-gen: polish model produced no text', 'EMPTY_RESPONSE')
    }
    return {
      polishedPrompt: text,
      provider: settings.polish.provider,
      model: settings.polish.model,
    }
  }

  /**
   * Moderation policy shared by tools and the wallpaper pipeline.
   * @param imageData Raw image bytes to check.
   * @param signal Aborts an in-flight moderation request.
   * @returns Whether the image is safe, with flagged categories when it is not.
   */
  async moderateImage(imageData: Uint8Array, signal?: AbortSignal): Promise<ModerationResult> {
    return moderateImageWithProviders(this.settingsOf(), imageData, signal)
  }
}

function noProviderError(capability: 'image' | 'video'): LlmError {
  const envNames = (capability === 'video' ? VIDEO_PROVIDERS : IMAGE_PROVIDERS)
    .map(kind => PROVIDER_KEY_ENV[kind])
    .join(' or ')
  return new LlmError(
    `llm-media-gen: no ${capability} generation provider is configured; set ${envNames}`,
    'MISSING_CREDENTIAL',
  )
}

async function moderateImageWithProviders(
  settings: MediaGenSettings,
  imageData: Uint8Array,
  signal?: AbortSignal,
): Promise<ModerationResult> {
  if (!settings.wallpaperModerationEnabled) {
    return { safe: true, details: 'moderation disabled by configuration' }
  }
  const volc = await settings.resolveProvider('volcengine')
  if (volc?.kind === 'volcengine') {
    try {
      return await moderateImageVolcengine(volc.config, { imageData }, signal)
    } catch {
      // moderation is advisory; fall through to the next provider
    }
  }
  const mini = await settings.resolveProvider('minimax')
  if (mini?.kind === 'minimax') {
    try {
      return await moderateImageMiniMax(mini.config, { imageData }, signal)
    } catch {
      // moderation is advisory; allow rather than block on transport failure
    }
  }
  return { safe: true, details: 'no moderation provider available; allowing by default' }
}

function detectMediaTypeFromBytes(data: Uint8Array): ImageMediaType {
  if (data.length >= 8) {
    if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) return 'image/png'
    if (data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) return 'image/jpeg'
    if (data.length >= 12
      && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46
      && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) return 'image/webp'
    if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return 'image/png'
  }
  return 'image/png'
}

type ImageResultItem = {
  attachmentId: string
  mediaType: ImageMediaType
  width: number
  height: number
  bytes: number
  provider: GeneratedImage['provider']
  revisedPrompt?: string
}

type ImageResult = {
  images: ImageResultItem[]
  count: number
}

type VideoResult = {
  video: {
    mediaType: GeneratedVideo['mediaType']
    width: number
    height: number
    duration: number
    bytes: number
    provider: GeneratedVideo['provider']
  }
}

const PROVIDER_CHOICES: MediaProvider[] = [...IMAGE_PROVIDERS]

export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  const settings = (): MediaGenSettings => ({
    provider: current().provider,
    defaultImageSize: current().defaultImageSize ?? '1024x1024',
    defaultImageStyle: current().defaultImageStyle ?? 'general',
    defaultVideoDuration: current().defaultVideoDuration ?? 5,
    wallpaperModerationEnabled: current().wallpaperModerationEnabled !== false,
    polish: current().polish,
    resolveProvider: kind => resolveProviderEntry(ctx, current, kind),
  })

  ctx.provide('mediaGen', new MediaGenService(ctx, settings))

  ctx.tools.register(defineTool({
    name: 'media_generate_image',
    description:
      + 'Generate AI images from a text prompt across the configured provider matrix '
      + '(Volcengine Seedream, OpenAI gpt-image, MiniMax, Zhipu CogView, Aliyun Wanx, '
      + 'SiliconFlow, AihubMix, Tokenflux, NewAPI). Accepts prompt, optional provider, '
      + 'image size, count (n), art style, and a negative prompt. Returns generated '
      + 'images as session attachments the user can see. Always include a descriptive, '
      + 'detailed prompt — specify subject, composition, lighting, and style.',
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: 'The image description in English or Chinese — detailed, specific subjects, scene, lighting, mood.',
      },
      provider: {
        type: 'string',
        enum: [...PROVIDER_CHOICES],
        description: 'Force one provider. Defaults to automatic ordered fallback.',
      },
      size: {
        type: 'string',
        enum: [...IMAGE_SIZE_CHOICES],
        description: 'Output resolution. Defaults to 1024x1024. Use 1792x1024 for landscape, 1024x1792 for portrait.',
      },
      n: {
        type: 'integer',
        minimum: 1,
        maximum: 4,
        description: 'Number of images to generate (1-4). Defaults to 1.',
      },
      style: {
        type: 'string',
        enum: [...IMAGE_STYLE_CHOICES],
        description: 'Art style preset. Defaults to general.',
      },
      negativePrompt: {
        type: 'string',
        description: 'What to avoid in the output (blurry, distorted, low quality, watermark, etc.).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          images: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                attachmentId: { type: 'string', required: true },
                mediaType: { type: 'string', required: true },
                width: { type: 'integer', required: true },
                height: { type: 'integer', required: true },
                bytes: { type: 'integer', required: true },
                provider: { type: 'string', required: true },
                revisedPrompt: { type: 'string' },
              },
            },
          },
          count: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => {
        const v = value as ImageResult
        const lines: string[] = [`Generated ${v.count} image(s):`]
        for (const img of v.images) {
          const parts = img.mediaType.split('/')
          const formatName = (parts[1] ?? 'IMG').toUpperCase()
          const sizeInfo = `${img.width}x${img.height} ${formatName} (${Math.round(img.bytes / 1024)} KB)`
          lines.push(`- [${img.provider}] ${sizeInfo} — attachment ${img.attachmentId}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    execute: async (args: GenerateImageArgs, exec: ToolExecution) => {
      const mediaGen = ctx.get('mediaGen')
      if (mediaGen === undefined) throw new Error('media_generate_image: mediaGen service unavailable')
      const images = await mediaGen.generateImage(args, exec.signal)
      const attachments = ctx.get('attachments')
      const out: ImageResultItem[] = []
      for (const img of images) {
        const mediaType: ImageMediaType = detectMediaTypeFromBytes(img.data)
        if (attachments !== undefined) {
          const ref = await attachments.saveImage({
            data: img.data,
            mediaType,
            name: `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          })
          const item: ImageResultItem = {
            attachmentId: String(ref.attachmentId),
            mediaType,
            width: ref.width,
            height: ref.height,
            bytes: ref.bytes,
            provider: img.provider,
          }
          if (img.revisedPrompt !== undefined) item.revisedPrompt = img.revisedPrompt
          out.push(item)
        } else {
          const item: ImageResultItem = {
            attachmentId: `inline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            mediaType,
            width: img.width,
            height: img.height,
            bytes: img.data.length,
            provider: img.provider,
          }
          if (img.revisedPrompt !== undefined) item.revisedPrompt = img.revisedPrompt
          out.push(item)
        }
      }
      return { images: out, count: out.length }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'media_generate_video',
    description:
      + 'Generate AI videos from a text prompt using Volcengine Seedance or MiniMax. '
      + 'Takes a prompt, optional duration in seconds (1-60), FPS, resolution, and aspect ratio. '
      + 'Use this tool for short video clips, product demos, motion concepts, and scene animations.',
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: 'The video description — describe motion, camera movement, scene progression, subject action, and style.',
      },
      provider: {
        type: 'string',
        enum: [...VIDEO_PROVIDERS],
        description: 'Force one video provider. Defaults to automatic ordered fallback.',
      },
      duration: {
        type: 'integer',
        minimum: 1,
        maximum: 60,
        description: 'Clip length in seconds. Defaults to 5.',
      },
      fps: {
        type: 'integer',
        minimum: 12,
        maximum: 60,
        description: 'Frames per second. Defaults to 24.',
      },
      size: {
        type: 'string',
        enum: ['720p', '1080p'],
        description: 'Vertical resolution. Defaults to 720p.',
      },
      ratio: {
        type: 'string',
        enum: ['16:9', '9:16', '1:1'],
        description: 'Aspect ratio: 16:9 landscape, 9:16 portrait, 1:1 square. Defaults to 16:9.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          video: {
            type: 'object',
            additionalProperties: false,
            properties: {
              mediaType: { type: 'string', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              duration: { type: 'number', required: true },
              bytes: { type: 'integer', required: true },
              provider: { type: 'string', required: true },
            },
          },
        },
      },
      render: (_args, value) => {
        const v = value as VideoResult
        return [{
          type: 'text',
          text: `Generated video via ${v.video.provider}: ${v.video.width}x${v.video.height}, ${v.video.duration}s, ${Math.round(v.video.bytes / 1024)} KB.`,
        }]
      },
    },
    execute: async (args: GenerateVideoArgs, exec: ToolExecution) => {
      const mediaGen = ctx.get('mediaGen')
      if (mediaGen === undefined) throw new Error('media_generate_video: mediaGen service unavailable')
      const video = await mediaGen.generateVideo(args, exec.signal)
      return {
        video: {
          mediaType: video.mediaType,
          width: video.width,
          height: video.height,
          duration: video.duration,
          bytes: video.data.length,
          provider: video.provider,
        },
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'media_polish_prompt',
    description:
      + 'Rewrite a rough creative idea into a generation-grade prompt using the configured '
      + 'chat model (DeepSeek v4 flash by default). Use before media_generate_image or '
      + 'media_generate_video when the user only has a vague idea. The polished prompt is '
      + 'shown to the user for confirmation before any generation runs. The polish request '
      + 'itself consumes model quota and is not refunded if the user dislikes the result.',
    parameters: {
      idea: {
        type: 'string',
        required: true,
        description: 'The user\'s rough idea in any detail level — a phrase, sentence, or paragraph.',
      },
      target: {
        type: 'string',
        enum: ['image', 'video'],
        required: true,
        description: 'Which generation the polished prompt will feed.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          polishedPrompt: { type: 'string', required: true },
          provider: { type: 'string', required: true },
          model: { type: 'string', required: true },
        },
      },
      render: (_args, value: PolishPromptResult) => [{
        type: 'text',
        text: `Polished prompt (${value.provider}/${value.model}):\n${value.polishedPrompt}`,
      }],
    },
    execute: async (args: { idea: string; target: PolishTarget }, exec: ToolExecution) => {
      const mediaGen = ctx.get('mediaGen')
      if (mediaGen === undefined) throw new Error('media_polish_prompt: mediaGen service unavailable')
      return mediaGen.polishPrompt({ idea: args.idea, target: args.target, signal: exec.signal })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'media_moderate_image',
    description:
      + 'Run an AI safety moderation check on an image before it is used as a wallpaper or shared. '
      + 'Checks for pornography, violence, sensitive figures, and advertising. Returns whether the '
      + 'image is safe, any flagged categories, and the confidence score. This tool is automatically '
      + 'invoked by the wallpaper pipeline — you can call it explicitly when reusing an earlier image.',
    parameters: {
      imageData: {
        type: 'string',
        required: true,
        description: 'Base64-encoded image bytes (PNG/JPEG/WebP/GIF) to check for safety violations.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          safe: { type: 'boolean', required: true },
          flagged: {
            type: 'array',
            items: { type: 'string' },
          },
          score: { type: 'number' },
          details: { type: 'string' },
        },
      },
      render: (_args, value: ModerationResult) => {
        const status = value.safe ? 'SAFE' : 'FLAGGED'
        const extras: string[] = []
        if (value.flagged !== undefined && value.flagged.length > 0) extras.push(`categories: ${value.flagged.join(', ')}`)
        if (value.score !== undefined) extras.push(`confidence: ${(value.score * 100).toFixed(0)}%`)
        if (value.details !== undefined) extras.push(value.details)
        return [{
          type: 'text',
          text: extras.length > 0 ? `Image moderation: ${status}; ${extras.join('; ')}` : `Image moderation: ${status}`,
        }]
      },
    },
    execute: async (args: { imageData: string }, exec: ToolExecution) => {
      if (typeof args.imageData !== 'string' || args.imageData.length === 0) {
        throw new Error('media_moderate_image: imageData must be a non-empty base64 string')
      }
      const imageBytes = Uint8Array.from(Buffer.from(args.imageData, 'base64'))
      const mediaGen = ctx.get('mediaGen')
      if (mediaGen === undefined) throw new Error('media_moderate_image: mediaGen service unavailable')
      return mediaGen.moderateImage(imageBytes, exec.signal)
    },
  }))

  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {
      // Provider resolution is lazy: every generation re-reads `current()`,
      // so a settings change needs no eagerly rebuilt derived state.
    },
  })
}

/** Resolve one credential through the credentials seam, falling back to the launch environment. */
async function getCredential(ctx: Context, envName: string): Promise<string | undefined> {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    const hit = await credentials.resolve(envName as never)
    if (hit !== undefined && hit.value && hit.value.length > 0) {
      return assertUsableApiKey(hit.value, 'llm-media-gen', envName)
    }
  }
  const ambient = launchEnvironmentOf(ctx).get(envName)
  if (ambient !== undefined && ambient.value.length > 0) {
    return assertUsableApiKey(ambient.value, 'llm-media-gen', envName)
  }
  return undefined
}

/** Resolve one provider kind to its runtime configuration; undefined when uncredentialed. */
async function resolveProviderEntry(
  ctx: Context,
  raw: () => Config,
  kind: MediaProvider,
): Promise<ResolvedProvider | undefined> {
  const entry = raw()[kind] ?? {}
  const key = await getCredential(ctx, entry.apiKeyEnv ?? PROVIDER_KEY_ENV[kind])
  if (key === undefined) return undefined
  const baseURL = entry.baseURL ?? PROVIDER_DEFAULT_BASE_URL[kind]
  const imageModel = entry.imageModel ?? PROVIDER_DEFAULT_IMAGE_MODEL[kind]
  switch (kind) {
    case 'volcengine': {
      const config: VolcengineConfig = { apiKey: key }
      if (baseURL !== undefined) config.baseURL = baseURL
      if (entry.arkBaseURL !== undefined && entry.arkBaseURL.length > 0) config.arkBaseURL = entry.arkBaseURL
      if (imageModel !== undefined) config.imageModel = imageModel
      if (entry.videoModel !== undefined && entry.videoModel.length > 0) config.videoModel = entry.videoModel
      return { kind, config }
    }
    case 'minimax': {
      const config: MiniMaxConfig = { apiKey: key }
      if (baseURL !== undefined) config.baseURL = baseURL
      const groupId = launchEnvironmentOf(ctx).get(entry.groupIdEnv ?? 'MINIMAX_GROUP_ID')?.value
      if (groupId !== undefined && groupId.length > 0) config.groupId = groupId
      return { kind, config }
    }
    case 'dashscope': {
      if (baseURL === undefined || imageModel === undefined) return undefined
      return { kind, config: { apiKey: key, baseURL, model: imageModel } }
    }
    default: {
      if (baseURL === undefined || imageModel === undefined) return undefined
      return { kind, config: { apiKey: key, baseURL, model: imageModel, provider: kind } }
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Multi-provider media generation and prompt-polish capability. */
    mediaGen: MediaGenService
  }
}
