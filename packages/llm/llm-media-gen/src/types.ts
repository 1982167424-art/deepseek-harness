export type MediaProvider = 'volcengine' | 'minimax' | 'both'

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

export interface VolcengineVideoGenRequest {
  prompt: string
  duration?: number
  fps?: number
  size?: '720p' | '1080p'
  ratio?: '16:9' | '9:16' | '1:1'
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
