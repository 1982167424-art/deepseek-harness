import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool, type ToolExecution } from '@deepseek-ai/dsh-tools'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { deepEqualJson, installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {
  GeneratedImage,
  GeneratedVideo,
  ImageSize,
  ImageStyle,
  MediaProvider,
  MiniMaxImageGenRequest,
  ModerationResult,
  VolcengineImageGenRequest,
  VolcengineVideoGenRequest,
} from './types.ts'
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

export const name = 'llm-media-gen'
export const inject = ['tools']

const NS = settingsNamespace('llm-media-gen')
const DEFAULT_VOLC_API_KEY_ENV = 'VOLCENGINE_API_KEY'
const DEFAULT_MINIMAX_API_KEY_ENV = 'MINIMAX_API_KEY'
const DEFAULT_VOLC_GROUP_ID_ENV = 'VOLCENGINE_GROUP_ID'
const DEFAULT_MINIMAX_GROUP_ID_ENV = 'MINIMAX_GROUP_ID'

export interface Config {
  provider: MediaProvider
  volcengineApiKeyEnv?: string
  volcengineBaseURL?: string
  minimaxApiKeyEnv?: string
  minimaxBaseURL?: string
  defaultImageSize?: ImageSize
  defaultImageStyle?: ImageStyle
  defaultVideoDuration?: number
  wallpaperModerationEnabled?: boolean
}

export const Config: z<Config> = z.object({
  provider: z.union(['volcengine', 'minimax', 'both']).required(),
  volcengineApiKeyEnv: z.string().role('credential-ref').default(DEFAULT_VOLC_API_KEY_ENV),
  volcengineBaseURL: z.string(),
  minimaxApiKeyEnv: z.string().role('credential-ref').default(DEFAULT_MINIMAX_API_KEY_ENV),
  minimaxBaseURL: z.string(),
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

export interface MediaGenSettings {
  provider: MediaProvider
  defaultImageSize: ImageSize
  defaultImageStyle: ImageStyle
  defaultVideoDuration: number
  wallpaperModerationEnabled: boolean
  volcengineApiKey: () => Promise<VolcengineConfig | undefined>
  minimaxApiKey: () => Promise<MiniMaxConfig | undefined>
}

function resolveConfig(
  ctx: Context,
  raw: Config,
): MediaGenSettings {
  const getCredential = async (envName: string): Promise<string | undefined> => {
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

  return {
    provider: raw.provider,
    defaultImageSize: raw.defaultImageSize ?? '1024x1024',
    defaultImageStyle: raw.defaultImageStyle ?? 'general',
    defaultVideoDuration: raw.defaultVideoDuration ?? 5,
    wallpaperModerationEnabled: raw.wallpaperModerationEnabled !== false,
    volcengineApiKey: async (): Promise<VolcengineConfig | undefined> => {
      if (raw.provider === 'minimax') return undefined
      const envName = raw.volcengineApiKeyEnv ?? DEFAULT_VOLC_API_KEY_ENV
      const key = await getCredential(envName)
      if (key === undefined) return undefined
      const groupEnv = DEFAULT_VOLC_GROUP_ID_ENV
      const groupId = launchEnvironmentOf(ctx).get(groupEnv)?.value
      const cfg: VolcengineConfig = {
        apiKey: key,
      }
      if (raw.volcengineBaseURL !== undefined && raw.volcengineBaseURL !== null) {
        cfg.baseURL = raw.volcengineBaseURL
      }
      if (groupId !== undefined && groupId.length > 0) {
        cfg.model = groupId
      }
      return cfg
    },
    minimaxApiKey: async (): Promise<MiniMaxConfig | undefined> => {
      if (raw.provider === 'volcengine') return undefined
      const envName = raw.minimaxApiKeyEnv ?? DEFAULT_MINIMAX_API_KEY_ENV
      const key = await getCredential(envName)
      if (key === undefined) return undefined
      const groupEnv = DEFAULT_MINIMAX_GROUP_ID_ENV
      const groupId = launchEnvironmentOf(ctx).get(groupEnv)?.value
      const cfg: MiniMaxConfig = {
        apiKey: key,
      }
      if (raw.minimaxBaseURL !== undefined && raw.minimaxBaseURL !== null) {
        cfg.baseURL = raw.minimaxBaseURL
      }
      if (groupId !== undefined && groupId.length > 0) {
        cfg.groupId = groupId
      }
      return cfg
    },
  }
}

async function generateImageWithProviders(
  settings: MediaGenSettings,
  args: {
    prompt: string
    size?: ImageSize
    n?: number
    style?: ImageStyle
    negativePrompt?: string
  },
  signal?: AbortSignal,
): Promise<GeneratedImage[]> {
  const size = args.size ?? settings.defaultImageSize
  const style = args.style ?? settings.defaultImageStyle
  const n = args.n ?? 1

  const volcConfig = await settings.volcengineApiKey()
  const miniConfig = await settings.minimaxApiKey()

  const errors: string[] = []
  if (volcConfig !== undefined) {
    try {
      const req: VolcengineImageGenRequest = {
        prompt: args.prompt,
        size,
        n,
        style,
      }
      if (args.negativePrompt !== undefined) req.negativePrompt = args.negativePrompt
      const results = await generateImageVolcengine(volcConfig, req, signal)
      if (results.length > 0) return results
    } catch (e) {
      errors.push(`volcengine: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (miniConfig !== undefined) {
    try {
      const req: MiniMaxImageGenRequest = {
        prompt: args.prompt,
        size,
        n,
        style,
      }
      if (args.negativePrompt !== undefined) req.negativePrompt = args.negativePrompt
      const results = await generateImageMiniMax(miniConfig, req, signal)
      if (results.length > 0) return results
    } catch (e) {
      errors.push(`minimax: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (errors.length === 0) {
    throw new LlmError(
      'llm-media-gen: no image generation provider is configured; set '
      + `${settings.provider === 'volcengine' ? DEFAULT_VOLC_API_KEY_ENV : settings.provider === 'minimax' ? DEFAULT_MINIMAX_API_KEY_ENV : `${DEFAULT_VOLC_API_KEY_ENV} or ${DEFAULT_MINIMAX_API_KEY_ENV}`}`,
      'MISSING_CREDENTIAL',
    )
  }
  throw new LlmError(`llm-media-gen: all image providers failed: ${errors.join('; ')}`, 'TRANSPORT')
}

async function generateVideoWithProviders(
  settings: MediaGenSettings,
  args: {
    prompt: string
    duration?: number
    fps?: number
    size?: '720p' | '1080p'
    ratio?: '16:9' | '9:16' | '1:1'
  },
  signal?: AbortSignal,
): Promise<GeneratedVideo> {
  const duration = args.duration ?? settings.defaultVideoDuration

  const volcConfig = await settings.volcengineApiKey()
  const miniConfig = await settings.minimaxApiKey()

  const errors: string[] = []
  if (volcConfig !== undefined) {
    try {
      const req: VolcengineVideoGenRequest = {
        prompt: args.prompt,
        duration,
      }
      if (args.fps !== undefined) req.fps = args.fps
      if (args.size !== undefined) req.size = args.size
      if (args.ratio !== undefined) req.ratio = args.ratio
      return await generateVideoVolcengine(volcConfig, req, signal)
    } catch (e) {
      errors.push(`volcengine: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (miniConfig !== undefined) {
    try {
      return await generateVideoMiniMax(miniConfig, {
        prompt: args.prompt,
        duration,
      }, signal)
    } catch (e) {
      errors.push(`minimax: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (errors.length === 0) {
    throw new LlmError(
      'llm-media-gen: no video generation provider is configured; set '
      + `${settings.provider === 'volcengine' ? DEFAULT_VOLC_API_KEY_ENV : settings.provider === 'minimax' ? DEFAULT_MINIMAX_API_KEY_ENV : `${DEFAULT_VOLC_API_KEY_ENV} or ${DEFAULT_MINIMAX_API_KEY_ENV}`}`,
      'MISSING_CREDENTIAL',
    )
  }
  throw new LlmError(`llm-media-gen: all video providers failed: ${errors.join('; ')}`, 'TRANSPORT')
}

async function moderateImageWithProviders(
  settings: MediaGenSettings,
  imageData: Uint8Array,
  signal?: AbortSignal,
): Promise<ModerationResult> {
  if (!settings.wallpaperModerationEnabled) {
    return { safe: true, details: 'moderation disabled by configuration' }
  }
  const volcConfig = await settings.volcengineApiKey()
  const miniConfig = await settings.minimaxApiKey()
  if (volcConfig === undefined && miniConfig === undefined) {
    return { safe: true, details: 'no moderation provider available' }
  }
  if (volcConfig !== undefined) {
    try {
      return await moderateImageVolcengine(volcConfig, { imageData }, signal)
    } catch {
    }
  }
  if (miniConfig !== undefined) {
    try {
      return await moderateImageMiniMax(miniConfig, { imageData }, signal)
    } catch {
    }
  }
  return { safe: true, details: 'all moderation providers failed; allowing by default' }
}

function detectMediaTypeFromBytes(data: Uint8Array): ImageMediaType {
  if (data.length >= 8) {
    if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) return 'image/png'
    if (data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) return 'image/jpeg'
    if (data.length >= 12
      && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46
      && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) return 'image/webp'
    if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return 'image/gif'
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

export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  let lastRaw: Config | undefined
  let lastSettings: MediaGenSettings | undefined
  const settings = (): MediaGenSettings => {
    const raw = current()
    if (raw === lastRaw && lastSettings !== undefined) return lastSettings
    lastSettings = resolveConfig(ctx, raw)
    lastRaw = raw
    return lastSettings
  }
  settings()

  ctx.tools.register(defineTool({
    name: 'media_generate_image',
    description:
      'Generate AI images from a text prompt using Volcengine/ByteDance or MiniMax. '
      + 'Accepts prompt, optional image size, count (n), art style, and a negative prompt. '
      + 'Returns generated images as session attachments the user can see. Always include '
      + 'a descriptive, detailed prompt — specify subject, composition, lighting, and style.',
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: 'The image description in English or Chinese — detailed, specific subjects, scene, lighting, mood.',
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
    execute: async (args, exec: ToolExecution) => {
      const images = await generateImageWithProviders(settings(), args, exec.signal)
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
      'Generate AI videos from a text prompt using Volcengine/ByteDance or MiniMax. '
      + 'Takes a prompt, optional duration in seconds (1-60), FPS, resolution, and aspect ratio. '
      + 'Use this tool for short video clips, product demos, motion concepts, and scene animations.',
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: 'The video description — describe motion, camera movement, scene progression, subject action, and style.',
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
    execute: async (args, exec: ToolExecution) => {
      const video = await generateVideoWithProviders(settings(), args, exec.signal)
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
    name: 'media_moderate_image',
    description:
      'Run an AI safety moderation check on an image before it is used as a wallpaper or shared. '
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
      render: (_args, value) => {
        const v = value as ModerationResult
        const status = v.safe ? 'SAFE' : 'FLAGGED'
        const extras: string[] = []
        if (v.flagged !== undefined && v.flagged.length > 0) extras.push(`categories: ${v.flagged.join(', ')}`)
        if (v.score !== undefined) extras.push(`confidence: ${(v.score * 100).toFixed(0)}%`)
        if (v.details !== undefined) extras.push(v.details)
        return [{
          type: 'text',
          text: extras.length > 0 ? `Image moderation: ${status}; ${extras.join('; ')}` : `Image moderation: ${status}`,
        }]
      },
    },
    execute: async (args, exec: ToolExecution) => {
      if (typeof args.imageData !== 'string' || args.imageData.length === 0) {
        throw new Error('media_moderate_image: imageData must be a non-empty base64 string')
      }
      const imageBytes = Uint8Array.from(Buffer.from(args.imageData, 'base64'))
      return moderateImageWithProviders(settings(), imageBytes, exec.signal)
    },
  }))

  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {
      const next = current()
      if (!deepEqualJson(next, lastRaw)) {
        lastSettings = resolveConfig(ctx, next)
        lastRaw = next
      }
    },
  })
}
