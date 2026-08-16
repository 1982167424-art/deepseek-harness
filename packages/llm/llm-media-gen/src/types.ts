/**
 * Shared media-generation domain types: providers, requests, results, and
 * the prompt-polish contract. Provider list is aligned with CherryStudio's
 * 62 built-in providers; a handful of historical aliases (`siliconflow`,
 * `newapi`, `volcengine`) are kept so existing cordis.yml keeps working.
 * @module @deepseek-ai/dsh-llm-media-gen/types
 */

/** Every media provider kind, aligned with CherryStudio plus legacy aliases. */
export type MediaProvider =
  // Direct model providers (23 from CherryStudio)
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'deepseek'
  | 'mistral'
  | 'grok'
  | 'nvidia'
  | 'cerebras'
  | 'mimo'
  | 'zhipu'
  | 'moonshot'
  | 'baichuan'
  | 'dashscope'
  | 'stepfun'
  | 'doubao'
  | 'infini'
  | 'minimax'
  | 'yi'
  | 'hunyuan'
  | 'perplexity'
  | 'jina'
  | 'voyageai'
  | 'huggingface'
  // Cloud platforms (9)
  | 'azure-openai'
  | 'vertexai'
  | 'aws-bedrock'
  | 'github'
  | 'copilot'
  | 'tencent-cloud-ti'
  | 'baidu-cloud'
  | 'modelscope'
  | 'xirang'
  // Local & self-hosted (5; keep `newapi` alias alongside CherryStudio's `new-api`)
  | 'ollama'
  | 'lmstudio'
  | 'ovms'
  | 'gpustack'
  | 'new-api'
  | 'newapi'
  // Inference platforms (5)
  | 'groq'
  | 'together'
  | 'fireworks'
  | 'hyperbolic'
  | 'poe'
  // Aggregation & gateway (23; keep `siliconflow` alias alongside `silicon`)
  | 'cherryin'
  | 'silicon'
  | 'siliconflow'
  | 'aihubmix'
  | 'ppio'
  | 'tokenflux'
  | '302ai'
  | 'aionly'
  | 'cherryai'
  | 'openrouter'
  | 'dmxapi'
  | 'ocoolai'
  | 'alayanew'
  | 'burncloud'
  | 'cephalon'
  | 'lanyun'
  | 'ph8'
  | 'sophnet'
  | 'qiniu'
  | 'longcat'
  | 'gateway'
  | 'lmsys'
  | 'aity'
  | 'datasmith'
  // Historical aliases kept for cordis.yml back-compat
  | 'volcengine'

/**
 * Every image provider in automatic-try order. Volcengine/Doubao come first
 * (Seedream 5.0 defaults), then OpenAI gpt-image-2, then Chinese domestic
 * vendors, then aggregations, then cloud/local/custom (each needs explicit
 * configuration and so is skipped by auto when unset).
 */
export const IMAGE_PROVIDERS: readonly MediaProvider[] = [
  // Volcengine / Doubao default, Seedream 5.0 (aliases, both kept)
  'volcengine',
  'doubao',
  // OpenAI default, gpt-image-2
  'openai',
  // MiniMax (also video-capable)
  'minimax',
  // Chinese domestic LLM vendors with native image endpoints
  'zhipu',
  'dashscope',
  'hunyuan',
  'moonshot',
  'yi',
  'baichuan',
  'stepfun',
  'infini',
  // Foreign OEMs whose gateways sometimes expose /v1/images
  'anthropic',
  'gemini',
  'deepseek',
  'mistral',
  'nvidia',
  'perplexity',
  'groq',
  'together',
  'fireworks',
  'hyperbolic',
  // Aggregation (OpenAI compatible, most carry image models)
  'silicon',
  'siliconflow',
  'aihubmix',
  'ppio',
  'tokenflux',
  '302ai',
  'aionly',
  'cherryai',
  'openrouter',
  'dmxapi',
  'ocoolai',
  'alayanew',
  'burncloud',
  'cephalon',
  'lanyun',
  'ph8',
  'sophnet',
  'qiniu',
  'longcat',
  'gateway',
  'lmsys',
  'aity',
  'datasmith',
  'cherryin',
  // Platform & marketplace
  'vertexai',
  'aws-bedrock',
  'github',
  'modelscope',
  'huggingface',
  'tencent-cloud-ti',
  'baidu-cloud',
  'xirang',
  // Exotica (most LLM only, no images yet)
  'grok',
  'cerebras',
  'mimo',
  'jina',
  'voyageai',
  'copilot',
  'poe',
  // Local self-hosted & passthrough (no defaults, user config required)
  'ollama',
  'lmstudio',
  'ovms',
  'gpustack',
  'azure-openai',
  'new-api',
  'newapi',
]

/** Providers able to generate videos — still Volcengine + MiniMax (verified contracts). */
export const VIDEO_PROVIDERS: readonly MediaProvider[] = ['volcengine', 'doubao', 'minimax']

/**
 * Providers able to generate 3D models. Volcengine/Doubao default with the
 * ByteDance Seed 3D family via the Ark contents-task API. Pool is closed
 * until each addition's wire contract is verified — see VIDEO_PROVIDERS for
 * the same reasoning.
 */
export const MODEL_PROVIDERS: readonly MediaProvider[] = ['volcengine', 'doubao']

/** Amount of detail in the generated mesh; higher = more triangles. */
export type ModelSubdivision = 'low' | 'medium' | 'high'

/** Output mesh+texture file format produced by the 3D task. */
export type ModelFileFormat = 'glb' | 'obj' | 'usd' | 'usdz'

/** 3D-generation result: bytes of a single file or zip-of-files (provider choice). */
export interface GeneratedModel {
  data: Uint8Array
  /** File media type. `.glb` downloads as model/gltf-binary; zip-wrapped sets application/zip. */
  mediaType: 'model/gltf-binary' | 'application/zip'
  /** The exact format string the downstream unpacker should use. */
  fileFormat: ModelFileFormat
  subdivision: ModelSubdivision
  provider: MediaProvider
}

/** Generate one 3D model from a text prompt (and an optional reference image). */
export interface GenerateModelArgs {
  /** The creative prompt. If empty, an imageUrl reference is required. */
  prompt: string
  /** Optional reference image URL (base64 or remote). Seed 3D 2.0 is image-to-3D; Hyper3D also accepts pure text. */
  imageUrl?: string
  subdivision?: ModelSubdivision
  fileFormat?: ModelFileFormat
  /** Provider pick, or 'auto'. Pinned non-model providers fail with INVALID_REQUEST. */
  provider?: ProviderSelection
  /** Override the provider's default model id (e.g. doubao-seed3d-2-0-260328 vs hyper3d-gen2-260112). */
  model?: string
  signal?: AbortSignal
}

/** Volcengine/Doubao ARK text/image-to-3D task request body (shared by Seed 3D and Hyper 3D). */
export interface VolcengineModelGenRequest {
  prompt: string
  imageUrl?: string
  subdivision?: ModelSubdivision
  fileFormat?: ModelFileFormat
  model?: string
}

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

/** OpenAI-compatible image request shared by every non-dedicated provider. */
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
export type PolishTarget = 'image' | 'video' | 'model'

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
