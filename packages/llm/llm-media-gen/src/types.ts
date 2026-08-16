/**
 * Shared media-generation domain types: providers, requests, results, and
 * the prompt-polish contract.
 * @module @deepseek-ai/dsh-llm-media-gen/types
 */

/** Every media provider kind, aligned with CherryStudio's painting matrix. */
export type MediaProvider =
  | 'volcengine'
  | 'minimax'
  | 'openai'
  | 'zhipu'
  | 'dashscope'
  | 'siliconflow'
  | 'aihubmix'
  | 'tokenflux'
  | 'newapi'

/** Every provider in automatic-try order; mirrors the default model policy. */
export const IMAGE_PROVIDERS: readonly MediaProvider[] = [
  'volcengine',
  'openai',
  'minimax',
  'zhipu',
  'dashscope',
  'siliconflow',
  'aihubmix',
  'tokenflux',
  'newapi',
]

/** Providers able to generate videos. Image generation covers all of them. */
export const VIDEO_PROVIDERS: readonly MediaProvider[] = ['volcengine', 'minimax']

/** Automatic selection: try each configured provider in listed order. */
export type ProviderSelection = 'auto' | MediaProvider

export type ImageSize =
  | '256x256'
  | '512x512'
  | '1024x1024'
  | '1024x1792'
  | '1792x1024'
  | '768x768'
  | '720x1280'
  | '1280x720'

export type ImageStyle =
  | 'general'
  | 'photographic'
  | 'anime'
  | 'cinematic'
  | 'digital_art'
  | 'oil_painting'
  | 'watercolor'
  | 'sketch'
  | '3d_render'

export interface GeneratedImage {
  data: Uint8Array
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
  revisedPrompt?: string
  provider: MediaProvider
}

export interface GeneratedVideo {
  data: Uint8Array
  mediaType: 'video/mp4'
  width: number
  height: number
  duration: number
  provider: MediaProvider
}

export interface ModerationResult {
  safe: boolean
  flagged?: string[]
  score?: number
  details?: string
}

export interface VolcengineImageGenRequest {
  prompt: string
  size?: ImageSize
  n?: number
  style?: ImageStyle
  negativePrompt?: string
}

export interface MiniMaxImageGenRequest {
  prompt: string
  size?: ImageSize
  n?: number
  style?: ImageStyle
  negativePrompt?: string
  model?: string
}

/** OpenAI-compatible image request shared by six providers. */
export interface OpenAICompatibleImageGenRequest {
  prompt: string
  size?: ImageSize
  n?: number
  style?: ImageStyle
  negativePrompt?: string
}

/** DashScope (Aliyun Bailian) async image request. */
export interface DashScopeImageGenRequest {
  prompt: string
  size?: ImageSize
  n?: number
  negativePrompt?: string
}

export interface VolcengineVideoGenRequest {
  prompt: string
  duration?: number
  fps?: number
  size?: '720p' | '1080p'
  ratio?: '16:9' | '9:16' | '1:1'
  model?: string
}

export interface MiniMaxVideoGenRequest {
  prompt: string
  duration?: number
  model?: string
}

export interface ModerationImageRequest {
  imageData: Uint8Array
  provider?: MediaProvider
}

/** Generation target a polished prompt is written for. */
export type PolishTarget = 'image' | 'video'

/** One prompt-polish request: the user's rough idea plus the target medium. */
export interface PolishPromptRequest {
  idea: string
  target: PolishTarget
  signal?: AbortSignal
}

/** One prompt-polish reply, carrying the route actually used. */
export interface PolishPromptResult {
  polishedPrompt: string
  provider: string
  model: string
}
